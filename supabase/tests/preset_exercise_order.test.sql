begin;

create extension if not exists pgtap with schema extensions;
select plan(56);

-- Schema and privileges
select has_column('public', 'user_settings', 'preset_order_mode', 'user_settings stores the preset order mode');
select has_column('public', 'user_settings', 'preset_order_alternate_muscle_groups', 'user_settings stores the alternation sub-setting');
select has_table('public', 'user_priority_muscle_groups', 'priority muscle groups have an owner-scoped table');
select has_column('public', 'workout_sessions', 'exercise_order_basis', 'workout_sessions stores the starting-order basis');
select hasnt_function(
  'public', 'start_or_resume_workout_session', array['bigint', 'bigint'],
  'the two-argument start function is replaced rather than overloaded'
);
select ok(
  pg_get_functiondef('public.start_or_resume_workout_session(bigint, bigint, bigint[], jsonb)'::regprocedure) !~* 'random\s*\(',
  'preset start no longer uses random()'
);
select ok(
  not has_function_privilege('anon', 'public.start_or_resume_workout_session(bigint, bigint, bigint[], jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.start_or_resume_workout_session(bigint, bigint, bigint[], jsonb)', 'execute'),
  'only authenticated users can start sessions'
);
select ok(
  not has_function_privilege('anon', 'public.save_preset_order_preference(text, boolean, bigint[])', 'execute')
  and has_function_privilege('authenticated', 'public.save_preset_order_preference(text, boolean, bigint[])', 'execute'),
  'only authenticated users can save an order preference'
);

insert into auth.users (id, email)
values
  ('40000000-0000-0000-0000-000000000001', 'order-user-1@example.test'),
  ('40000000-0000-0000-0000-000000000002', 'order-user-2@example.test');

create temp table picked_exercises on commit drop as
select id, name from public.exercises where is_active order by id limit 3;
create temp table foreign_exercise on commit drop as
select id from public.exercises where is_active order by id offset 3 limit 1;
grant select on picked_exercises, foreign_exercise to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Preference defaults and saving
insert into public.user_settings (owner_id, relative_e1rm_enabled)
values ('40000000-0000-0000-0000-000000000001', true);

select is(
  (select preset_order_mode || ':' || preset_order_alternate_muscle_groups::text from public.user_settings),
  'balanced_rotation:true',
  'the default preference is balanced rotation with alternation enabled'
);

select throws_ok($sql$
  select public.save_preset_order_preference('muscle_group_priority', true, array[]::bigint[]);
$sql$, '22023', 'Choose at least one priority muscle group.', 'priority mode requires at least one group');

select throws_ok($sql$
  select public.save_preset_order_preference('random', true, null);
$sql$, '22023', 'Unknown preset order mode.', 'a shuffle mode is not accepted');

select throws_ok($sql$
  select public.save_preset_order_preference('balanced_rotation', true, array[-1]::bigint[]);
$sql$, '22023', 'Unknown priority muscle group.', 'unknown muscle groups are rejected');

select throws_ok($sql$
  select public.save_preset_order_preference('balanced_rotation', true, array[null]::bigint[]);
$sql$, '22023', 'Unknown priority muscle group.', 'null muscle groups are rejected');

select throws_ok($sql$
  select public.save_preset_order_preference('balanced_rotation', null, null);
$sql$, '22023', 'Choose whether to alternate exercises between muscle groups.', 'the alternation setting is required');

select lives_ok($sql$
  select public.save_preset_order_preference(
    'muscle_group_priority',
    false,
    (select array_agg(id) from public.ui_muscle_groups where code in ('hamstrings', 'quads', 'hamstrings'))
  );
$sql$, 'a priority preference can be saved');

select is(
  (select preset_order_mode || ':' || preset_order_alternate_muscle_groups::text from public.user_settings),
  'muscle_group_priority:false',
  'the saved mode and alternation setting are stored'
);

select is(
  (select array_agg(ui_group.code order by ui_group.code)
   from public.user_priority_muscle_groups priority
   join public.ui_muscle_groups ui_group on ui_group.id = priority.ui_muscle_group_id),
  array['hamstrings', 'quads'],
  'selected priority groups are stored once each'
);

select lives_ok($sql$
  select public.save_preset_order_preference(
    'balanced_rotation',
    true,
    (select array_agg(id) from public.ui_muscle_groups where code = 'chest')
  );
$sql$, 'the preference can be replaced');

select is(
  (select array_agg(ui_group.code)
   from public.user_priority_muscle_groups priority
   join public.ui_muscle_groups ui_group on ui_group.id = priority.ui_muscle_group_id),
  array['chest'],
  'saving replaces the previous priority groups'
);

select is(
  (select relative_e1rm_enabled from public.user_settings),
  true,
  'saving the order preference leaves other settings untouched'
);

-- Preset start ordering
insert into public.gyms (owner_id, name)
values ('40000000-0000-0000-0000-000000000001', 'Order Gym');

select lives_ok($sql$
  select public.save_workout_preset(
    null::bigint,
    'Order Preset',
    (select array_agg(id order by id) from picked_exercises),
    array[2, 1, 3]::smallint[]
  );
$sql$, 'a three-exercise preset is created');

insert into public.workout_sessions (owner_id, gym_id, performed_on, status, source_preset_id, source_preset_name)
values (
  '40000000-0000-0000-0000-000000000001',
  (select id from public.gyms where name = 'Order Gym'),
  date '2026-10-01',
  'completed',
  (select id from public.workout_presets where name = 'Order Preset'),
  'Order Preset'
);

insert into public.session_exercises (owner_id, session_id, exercise_order, exercise_id)
select
  '40000000-0000-0000-0000-000000000001',
  (select id from public.workout_sessions where status = 'completed'),
  row_number() over (order by id desc),
  id
from picked_exercises;

insert into public.equipment (owner_id, name, kind)
values ('40000000-0000-0000-0000-000000000001', 'Dumbbell', 'generic');

update public.session_exercises
set canonical_equipment_id = (select id from public.equipment where name = 'Dumbbell'),
    equipment_name_snapshot = 'Dumbbell'
where session_id = (select id from public.workout_sessions where status = 'completed')
  and exercise_id = (select min(id) from picked_exercises);

select lives_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset')
  );
$sql$, 'a preset session starts without a supplied order');

select is(
  (select array_agg(exercise_id order by exercise_order) from public.session_exercises
   where session_id = (select id from public.workout_sessions where status = 'in_progress')),
  (select array_agg(id order by name collate "C", id) from picked_exercises),
  'without a supplied order, preset exercises start in alphabetical order'
);

select is(
  (select exercise_order_basis from public.workout_sessions where status = 'in_progress'),
  '{"version": 1, "strategy": "server_alphabetical"}'::jsonb,
  'the server fallback records its own order basis'
);

select is(
  (select (public.start_or_resume_workout_session(
     (select id from public.gyms where name = 'Order Gym'),
     (select id from public.workout_presets where name = 'Order Preset'),
     (select array_agg(id order by id desc) from picked_exercises),
     '{"version": 1, "strategy": "rotation"}'::jsonb
   )).id),
  (select id from public.workout_sessions where status = 'in_progress'),
  'an active session is resumed even when an order is supplied'
);

select is(
  (select array_agg(exercise_id order by exercise_order) from public.session_exercises
   where session_id = (select id from public.workout_sessions where status = 'in_progress')),
  (select array_agg(id order by name collate "C", id) from picked_exercises),
  'resuming leaves the active session order unchanged'
);

select ok(public.cancel_workout_session((select id from public.workout_sessions where status = 'in_progress')), 'the in-progress session is cancelled');

select lives_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset')
  );
$sql$, 'the same preset starts again without a supplied order');

select is(
  (select array_agg(exercise_id order by exercise_order) from public.session_exercises
   where session_id = (select id from public.workout_sessions where status = 'in_progress')),
  (select array_agg(id order by name collate "C", id) from picked_exercises),
  'starting again produces the same order'
);

select ok(public.cancel_workout_session((select id from public.workout_sessions where status = 'in_progress')), 'the in-progress session is cancelled');

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset'),
    (select array_agg(id order by id) from (select id from picked_exercises order by id limit 2) two)
  );
$sql$, '22023', 'The supplied exercise order does not match the preset exercises.', 'an order missing a preset exercise is rejected');

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset'),
    (select array_agg(id order by id) from picked_exercises) || (select min(id) from picked_exercises)
  );
$sql$, '22023', 'The supplied exercise order does not match the preset exercises.', 'an order with a repeated exercise is rejected');

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset'),
    (select array_agg(id order by id) from (select id from picked_exercises order by id limit 2) two)
      || (select id from foreign_exercise)
  );
$sql$, '22023', 'The supplied exercise order does not match the preset exercises.', 'an order with a non-preset exercise is rejected');

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset'),
    (select array_agg(id order by id) from (select id from picked_exercises order by id limit 2) two) || null::bigint
  );
$sql$, '22023', 'The supplied exercise order does not match the preset exercises.', 'an order containing null is rejected');

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    null::bigint,
    (select array_agg(id) from picked_exercises)
  );
$sql$, '22023', 'An exercise order can only be supplied for a preset workout.', 'scratch sessions do not accept an order');

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset'),
    null::bigint[],
    '{"version": 1}'::jsonb
  );
$sql$, '22023', 'An exercise order basis requires an exercise order.', 'a basis cannot describe the server fallback order');

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset'),
    (select array_agg(id) from picked_exercises),
    '[1, 2]'::jsonb
  );
$sql$, '22023', 'The exercise order basis must be a JSON object.', 'the basis must be an object');

select is(
  (select count(*) from public.workout_sessions where status = 'in_progress'),
  0::bigint,
  'rejected starts create no session'
);

select lives_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Order Gym'),
    (select id from public.workout_presets where name = 'Order Preset'),
    (select array[max(id), min(id)] || (select id from picked_exercises order by id offset 1 limit 1) from picked_exercises),
    '{"version": 1, "strategy": "rotation", "mode": "balanced_rotation"}'::jsonb
  );
$sql$, 'a preset session starts with a supplied deterministic order');

select is(
  (select array_agg(exercise_id order by exercise_order) from public.session_exercises
   where session_id = (select id from public.workout_sessions where status = 'in_progress')),
  (select array[max(id), min(id)] || (select id from picked_exercises order by id offset 1 limit 1) from picked_exercises),
  'session exercises follow the supplied order'
);

select is(
  (select exercise_order_basis ->> 'strategy' from public.workout_sessions where status = 'in_progress'),
  'rotation',
  'the supplied order basis is stored on the session'
);

select is(
  (select canonical_equipment_id from public.session_exercises
   where session_id = (select id from public.workout_sessions where status = 'in_progress')
     and exercise_id = (select min(id) from picked_exercises)),
  (select id from public.equipment where name = 'Dumbbell'),
  'ordered preset exercises still default to the canonical equipment last used at this gym'
);

select is(
  (select equipment_name_snapshot from public.session_exercises
   where session_id = (select id from public.workout_sessions where status = 'in_progress')
     and exercise_id = (select min(id) from picked_exercises)),
  'Dumbbell',
  'the defaulted canonical equipment name is snapshotted'
);

select is(
  (select count(*) from public.session_exercises
   where session_id = (select id from public.workout_sessions where status = 'in_progress')
     and gym_equipment_id is not null),
  0::bigint,
  'no legacy gym-scoped equipment is written'
);

select is(
  (select count(*) from public.exercise_sets es
   join public.session_exercises se on se.id = es.session_exercise_id
   where se.session_id = (select id from public.workout_sessions where status = 'in_progress')
     and es.weight is null and es.reps is null and es.reported_rir_bucket is null and not es.is_warmup),
  6::bigint,
  'ordering does not change set counts or blank-set creation'
);

select lives_ok($sql$
  select public.reorder_session_exercises(
    (select id from public.workout_sessions where status = 'in_progress'),
    (select array_agg(id order by exercise_order desc) from public.session_exercises
     where session_id = (select id from public.workout_sessions where status = 'in_progress'))
  );
$sql$, 'manual reordering still works on an ordered preset session');

select is(
  (select array_agg(exercise_id order by exercise_order) from public.session_exercises
   where session_id = (select id from public.workout_sessions where status = 'in_progress')),
  (select array[(select id from picked_exercises order by id offset 1 limit 1), min(id), max(id)] from picked_exercises),
  'manual reordering is stored as the performed order'
);

select is(
  (select array_agg(exercise_id order by exercise_order) || array[count(*) filter (where ws.exercise_order_basis is null)]
   from public.session_exercises se
   join public.workout_sessions ws on ws.id = se.session_id
   where ws.status = 'completed'),
  (select array_agg(id order by id desc) || array[3::bigint] from picked_exercises),
  'historical sessions keep their order and have no order basis'
);

-- Owner isolation
select set_config('test.order_preset_id', (select id::text from public.workout_presets where name = 'Order Preset'), true);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is((select count(*) from public.user_priority_muscle_groups), 0::bigint, 'another owner cannot see priority groups');
select is((select count(*) from public.user_settings), 0::bigint, 'another owner cannot see the order preference');

select throws_ok($sql$
  insert into public.user_priority_muscle_groups (owner_id, ui_muscle_group_id)
  values ('40000000-0000-0000-0000-000000000001', (select id from public.ui_muscle_groups where code = 'back'));
$sql$, '42501', null, 'another owner cannot add priority groups for the first owner');

delete from public.user_priority_muscle_groups;
select lives_ok($sql$
  select public.save_preset_order_preference(
    'muscle_group_priority', true, (select array_agg(id) from public.ui_muscle_groups where code = 'back')
  );
$sql$, 'another owner saves their own preference');

insert into public.gyms (owner_id, name)
values ('40000000-0000-0000-0000-000000000002', 'Other Gym');

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Other Gym'),
    current_setting('test.order_preset_id')::bigint,
    (select array_agg(id) from picked_exercises)
  );
$sql$, '42501', 'Preset not found or not owned by the current user.', 'another owner cannot start from the first owner preset');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select array_agg(ui_group.code)
   from public.user_priority_muscle_groups priority
   join public.ui_muscle_groups ui_group on ui_group.id = priority.ui_muscle_group_id),
  array['chest'],
  'the first owner priority groups are unaffected by another owner'
);

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($sql$
  select public.save_preset_order_preference('balanced_rotation', true, null);
$sql$, '42501', 'Authentication is required.', 'saving a preference requires authentication');

-- Issue #22 undo interplay: marking the canonical equipment step undone drops the
-- four-argument start function so the undo cannot leave two overloads.
reset role;
update heracles_private.issue22_step_state set status = 'undone' where step = 'canonical_equipment';
select hasnt_function(
  'public', 'start_or_resume_workout_session', array['bigint', 'bigint', 'bigint[]', 'jsonb'],
  'an issue #22 canonical equipment undo removes the four-argument start function'
);

select * from finish();
rollback;
