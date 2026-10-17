begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

select has_table('public', 'gym_equipment', 'gym_equipment table exists');
select has_column('public', 'session_exercises', 'gym_equipment_id', 'gym_equipment_id column exists on session_exercises');
select has_column('public', 'session_exercises', 'equipment_name_snapshot', 'equipment_name_snapshot exists on session_exercises');
select has_column('public', 'session_exercises', 'canonical_equipment_id', 'canonical_equipment_id exists on session_exercises');
select has_column('public', 'workout_sessions', 'source_preset_id', 'source_preset_id exists on workout_sessions');
select has_column('public', 'workout_sessions', 'source_preset_name', 'source_preset_name exists on workout_sessions');

insert into auth.users (id, email)
values
  ('30000000-0000-0000-0000-000000000001', 'live-user-1@example.test'),
  ('30000000-0000-0000-0000-000000000002', 'live-user-2@example.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Test create_or_get_equipment (canonical, gym-independent identity)
insert into public.gyms (owner_id, name)
values ('30000000-0000-0000-0000-000000000001', 'Sussex Gym');

select lives_ok($sql$
  select public.create_or_get_equipment(
    '  Matrix Incline Press  ',
    (select id from public.gyms where name = 'Sussex Gym')
  );
$sql$, 'create_or_get_equipment creates a normalized equipment record');

select is(
  (select e.name from public.equipment e join public.equipment_gym_availability a on a.equipment_id = e.id where a.gym_id = (select id from public.gyms where name = 'Sussex Gym')),
  'Matrix Incline Press',
  'equipment name is trimmed and normalized and the machine is available at the gym'
);

-- Idempotency / case-insensitivity of create_or_get_equipment
select is(
  (select id from public.create_or_get_equipment(
    'matrix incline press',
    (select id from public.gyms where name = 'Sussex Gym')
  )),
  (select id from public.equipment where name = 'Matrix Incline Press'),
  'create_or_get_equipment returns existing record for case-insensitive match'
);

-- Test workout presets & session creation
select lives_ok($sql$
  select public.save_workout_preset(
    null::bigint,
    'Upper Body',
    array[(select id from public.exercises order by id limit 1)],
    array[2::smallint]
  );
$sql$, 'save_workout_preset creates a preset');

-- Previous completed session for Sussex Gym
insert into public.workout_sessions (owner_id, gym_id, performed_on, status)
values ('30000000-0000-0000-0000-000000000001', (select id from public.gyms where name = 'Sussex Gym'), date '2026-08-21', 'completed');

insert into public.session_exercises (owner_id, session_id, exercise_order, exercise_id, canonical_equipment_id, equipment_name_snapshot)
values (
  '30000000-0000-0000-0000-000000000001',
  (select id from public.workout_sessions where status = 'completed' limit 1),
  1,
  (select id from public.exercises order by id limit 1),
  (select id from public.equipment where name = 'Matrix Incline Press'),
  'Matrix Incline Press'
);

insert into public.exercise_sets (owner_id, session_exercise_id, set_number, weight, reps, is_warmup, reported_rir_bucket, rir_source)
values
  ('30000000-0000-0000-0000-000000000001', (select id from public.session_exercises limit 1), 1, 45, 10, false, 1, 'user_entered'),
  ('30000000-0000-0000-0000-000000000001', (select id from public.session_exercises limit 1), 2, 45, 9, false, 0, 'user_entered');

-- Check ON DELETE RESTRICT on referenced canonical equipment
select throws_ok($sql$
  delete from public.equipment where name = 'Matrix Incline Press';
$sql$, '23503', 'update or delete on table "equipment" violates foreign key constraint "session_exercises_canonical_equipment_fk" on table "session_exercises"', 'deleting referenced equipment is restricted');

-- Start new session from preset
select lives_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Sussex Gym'),
    (select id from public.workout_presets where name = 'Upper Body')
  );
$sql$, 'start_or_resume_workout_session creates in-progress session with gym and preset');

select is(
  (select source_preset_name from public.workout_sessions where status = 'in_progress'),
  'Upper Body',
  'source_preset_name snapshot is preserved on workout_sessions'
);

select is(
  (select canonical_equipment_id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress') limit 1),
  (select id from public.equipment where name = 'Matrix Incline Press'),
  'default equipment is deterministically resolved from gym history'
);

select is(
  (select count(*) from public.exercise_sets where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress') limit 1)),
  2::bigint,
  'preset set count creates configured number of slots'
);

select ok(
  (select weight is null and reps is null and reported_rir_bucket is null and rir_source is null from public.exercise_sets where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress') limit 1) and set_number = 1),
  'new set slot is truly blank'
);

-- Enter a complete working set in set 1
update public.exercise_sets
set weight = 50, reps = 10, reported_rir_bucket = 2, rir_source = 'user_entered'
where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress') limit 1)
  and set_number = 1;

-- Add a 2nd exercise to active session
insert into public.session_exercises (owner_id, session_id, exercise_order, exercise_id)
values (
  '30000000-0000-0000-0000-000000000001',
  (select id from public.workout_sessions where status = 'in_progress'),
  2,
  (select id from public.exercises order by id offset 1 limit 1)
);

-- Reorder exercises
select lives_ok($sql$
  select public.reorder_session_exercises(
    (select id from public.workout_sessions where status = 'in_progress'),
    (select array_agg(id order by exercise_order desc) from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress'))
  );
$sql$, 'reorder_session_exercises atomically inverts order');

-- Draft set rejection on conclusion
-- Set 2 of exercise 1 is untouched blank. Make 2nd exercise have a draft set (weight entered, reps null)
insert into public.exercise_sets (owner_id, session_exercise_id, set_number, weight, reps, reported_rir_bucket, rir_source)
values (
  '30000000-0000-0000-0000-000000000001',
  (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress') and exercise_order = 1),
  1,
  30,
  null,
  null,
  null
);

select throws_ok($sql$
  select public.conclude_workout_session(
    (select id from public.workout_sessions where status = 'in_progress')
  );
$sql$, '22023', 'Cannot conclude session: one or more sets are incomplete drafts.', 'concluding session fails if partial draft sets exist');

-- Delete the draft set from exercise 2 (now exercise 2 is empty)
delete from public.exercise_sets
where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress') and exercise_order = 1);

-- Conclude session
select lives_ok($sql$
  select public.conclude_workout_session(
    (select id from public.workout_sessions where status = 'in_progress')
  );
$sql$, 'conclude_workout_session completes successfully');

select is(
  (select status from public.workout_sessions where source_preset_name = 'Upper Body' order by id desc limit 1),
  'completed',
  'session status transitions to completed'
);

select is(
  (select count(*) from public.exercise_sets where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where source_preset_name = 'Upper Body' order by id desc limit 1))),
  1::bigint,
  'untouched blank set slots were cleaned up on conclusion'
);

select is(
  (select count(*) from public.session_exercises where session_id = (select id from public.workout_sessions where source_preset_name = 'Upper Body' order by id desc limit 1)),
  1::bigint,
  'empty exercises without sets were cleaned up on conclusion'
);

-- Test preset deletion preserves session and snapshot name (ON DELETE SET NULL)
delete from public.workout_presets where name = 'Upper Body';

select is(
  (select source_preset_id from public.workout_sessions where source_preset_name = 'Upper Body' order by id desc limit 1),
  null,
  'source_preset_id becomes null on preset deletion'
);

select is(
  (select source_preset_name from public.workout_sessions where source_preset_name = 'Upper Body' order by id desc limit 1),
  'Upper Body',
  'source_preset_name snapshot is preserved on preset deletion'
);

select is(
  (select owner_id from public.workout_sessions where source_preset_name = 'Upper Body' order by id desc limit 1),
  '30000000-0000-0000-0000-000000000001'::uuid,
  'owner_id is preserved on preset deletion'
);

-- Test RLS owner isolation
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*) from public.equipment),
  0::bigint,
  'user 2 cannot view user 1 equipment'
);

select throws_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms limit 1),
    null::bigint
  );
$sql$, '22023', 'A gym is required to start a new workout session.', 'user 2 cannot create a session with an RLS-hidden gym');

-- User 2 cannot cancel completed session from User 1
select throws_ok($sql$
  select public.cancel_workout_session(
    (select id from public.workout_sessions limit 1)
  );
$sql$, '42501', 'Session not found or not owned by current user.', 'user 2 cannot cancel user 1 session');

-- Switch back to User 1
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Cannot cancel completed session
select throws_ok($sql$
  select public.cancel_workout_session(
    (select id from public.workout_sessions where status = 'completed' limit 1)
  );
$sql$, '22023', 'Only in-progress workout sessions can be cancelled.', 'cannot cancel a completed session');

-- Start a new in-progress session and cancel it
select lives_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where owner_id = '30000000-0000-0000-0000-000000000001' limit 1),
    null::bigint
  );
$sql$, 'user 1 can start another in-progress session');

select is(
  (select public.cancel_workout_session(
    (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001' limit 1)
  )),
  true,
  'cancel_workout_session returns true for in-progress session'
);

select is(
  (select count(*) from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001'),
  0::bigint,
  'in-progress session was deleted by cancellation'
);

-- =========================================================================
-- Tests for atomic structural live-workout mutations (3A, 3B, 3C)
-- =========================================================================

-- Start a fresh in-progress session for User 1 at Sussex Gym
select lives_ok($sql$
  select public.start_or_resume_workout_session(
    (select id from public.gyms where name = 'Sussex Gym'),
    null::bigint
  );
$sql$, 'user 1 can start another fresh in-progress session');

-- 3A: Add exercise with omitted equipment (should resolve Matrix Incline Press from history)
select lives_ok($sql$
  select public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001'),
    (select id from public.exercises order by id limit 1),
    null::bigint
  );
$sql$, 'add_session_exercise creates exercise and initial blank set atomically');

select is(
  (select canonical_equipment_id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_order = 1),
  (select id from public.equipment where name = 'Matrix Incline Press'),
  'add_session_exercise resolves default equipment from prior history when omitted'
);

select is(
  (select equipment_name_snapshot from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_order = 1),
  'Matrix Incline Press',
  'add_session_exercise preserves equipment name snapshot'
);

select is(
  (select count(*) from public.exercise_sets where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_order = 1)),
  1::bigint,
  'add_session_exercise creates 1 blank set slot'
);

select ok(
  (select weight is null and reps is null and reported_rir_bucket is null and rir_source is null from public.exercise_sets where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_order = 1) and set_number = 1),
  'initial set slot from add_session_exercise is blank'
);

-- Add 2nd and 3rd exercises
select lives_ok($sql$
  select public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001'),
    (select id from public.exercises order by id offset 1 limit 1),
    null::bigint
  );
$sql$, 'add second exercise via add_session_exercise');

select lives_ok($sql$
  select public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001'),
    (select id from public.exercises order by id offset 2 limit 1),
    null::bigint
  );
$sql$, 'add third exercise via add_session_exercise');

select is(
  (select exercise_order from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_id = (select id from public.exercises order by id offset 2 limit 1)),
  3,
  'third exercise has exercise_order 3'
);

-- Add a 2nd set to exercise 1
insert into public.exercise_sets (owner_id, session_exercise_id, set_number, weight, reps, is_warmup, reported_rir_bucket, rir_source)
values (
  '30000000-0000-0000-0000-000000000001',
  (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_order = 1),
  2,
  null,
  null,
  false,
  null,
  null
);

-- 3B: Remove middle exercise (order 2) and verify order normalization
select lives_ok($sql$
  select public.remove_session_exercise(
    (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_order = 2)
  );
$sql$, 'remove_session_exercise removes middle exercise and normalizes order');

select is(
  (select exercise_order from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_id = (select id from public.exercises order by id offset 2 limit 1)),
  2,
  'remaining exercise order was normalized to 2'
);

-- 3C: Remove set 1 of exercise 1 and verify set renumbering
select lives_ok($sql$
  select public.remove_exercise_set(
    (select id from public.exercise_sets where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_order = 1) and set_number = 1)
  );
$sql$, 'remove_exercise_set removes set and renumbers remaining sets');

select is(
  (select count(*) from public.exercise_sets where session_exercise_id = (select id from public.session_exercises where session_id = (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001') and exercise_order = 1) and set_number = 1),
  1::bigint,
  'remaining set was renumbered to set_number 1'
);

-- Error cases: invalid exercise
select throws_ok($sql$
  select public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001'),
    -999999::bigint,
    null::bigint
  );
$sql$, '22023', 'Exercise not found in catalogue.', 'add_session_exercise with invalid exercise throws 22023');

-- Error cases: completed session
select throws_ok($sql$
  select public.add_session_exercise(
    (select id from public.workout_sessions where status = 'completed' limit 1),
    (select id from public.exercises order by id limit 1),
    null::bigint
  );
$sql$, '42501', 'Active session not found or not owned by current user.', 'add_session_exercise on completed session throws 42501');

-- Error cases: foreign gym equipment (create gym 2)
insert into public.gyms (owner_id, name)
values ('30000000-0000-0000-0000-000000000001', 'Other Gym');
select lives_ok($sql$
  select public.create_or_get_equipment('Other Machine', (select id from public.gyms where name = 'Other Gym'));
$sql$, 'a machine is created at another gym');

select throws_ok($sql$
  select public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001'),
    (select id from public.exercises order by id limit 1),
    (select id from public.equipment where name = 'Other Machine')
  );
$sql$, '42501', 'Equipment not found, inactive, or not available at the session gym.', 'add_session_exercise with equipment unavailable at the session gym throws 42501');

select throws_ok($sql$
  select public.remove_session_exercise(
    (select se.id from public.session_exercises se join public.workout_sessions ws on ws.id = se.session_id where ws.status = 'completed' limit 1)
  );
$sql$, '42501', 'Session exercise not found, not active, or not owned by current user.', 'remove_session_exercise on completed session throws 42501');

select throws_ok($sql$
  select public.remove_exercise_set(
    (select es.id from public.exercise_sets es join public.session_exercises se on se.id = es.session_exercise_id join public.workout_sessions ws on ws.id = se.session_id where ws.status = 'completed' limit 1)
  );
$sql$, '42501', 'Set not found, not active, or not owned by current user.', 'remove_exercise_set on completed session throws 42501');

-- Switch to User 2: Cross-user mutation tests
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok($sql$
  select public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress' and owner_id = '30000000-0000-0000-0000-000000000001'),
    (select id from public.exercises order by id limit 1),
    null::bigint
  );
$sql$, '42501', 'Active session not found or not owned by current user.', 'user 2 cannot add exercise to user 1 session');

select throws_ok($sql$
  select public.remove_session_exercise(
    (select id from public.session_exercises where owner_id = '30000000-0000-0000-0000-000000000001' limit 1)
  );
$sql$, '42501', 'Session exercise not found, not active, or not owned by current user.', 'user 2 cannot remove exercise from user 1 session');

select throws_ok($sql$
  select public.remove_exercise_set(
    (select id from public.exercise_sets where owner_id = '30000000-0000-0000-0000-000000000001' limit 1)
  );
$sql$, '42501', 'Set not found, not active, or not owned by current user.', 'user 2 cannot remove set from user 1 session');

select * from finish();
rollback;
