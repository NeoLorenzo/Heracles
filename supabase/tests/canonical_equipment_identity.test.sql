begin;

create extension if not exists pgtap with schema extensions;
select plan(68);

-- Schema
select has_table('public', 'equipment', 'canonical equipment table exists');
select has_table('public', 'equipment_gym_availability', 'gym availability table exists');
select has_column('public', 'session_exercises', 'canonical_equipment_id', 'performed exercises reference canonical equipment');
select hasnt_column('public', 'equipment', 'gym_id', 'canonical equipment identity has no gym');
select ok((select relrowsecurity from pg_class where oid = 'public.equipment'::regclass), 'RLS is enabled on equipment');
select ok((select relrowsecurity from pg_class where oid = 'public.equipment_gym_availability'::regclass), 'RLS is enabled on equipment availability');
select hasnt_function('public', 'create_or_get_gym_equipment', array['bigint', 'text'], 'gym-scoped equipment creation is retired');

-- Canonical catalogue
select is((select count(*) from public.exercises where is_active), 116::bigint, '116 canonical exercises are active');
select is((select count(*) from public.exercises), 139::bigint, 'merged exercises are retired, not deleted');
select is(
  (select count(*) from public.exercises where is_active and name ~* '\((Dumbbells?|Barbell|EZ Bar|Machine|Cable|Cable Machine|Smith Machine|T-Bar|Bodyweight|Plate Loaded)\)'),
  0::bigint,
  'active exercise names no longer encode equipment'
);
select is(
  (select e.name from public.exercises e join heracles_private.issue22_exercise_changes c on c.exercise_id = e.id where c.old_name = 'Press (Barbell)'),
  'Chest Press',
  'the flat barbell press survives as Chest Press and keeps its identifier'
);
select ok(
  (select not is_active from public.exercises where name = 'Press (Smith Machine)'),
  'a merged exercise keeps its original name and is retired'
);
select is(
  (select survivor.name from heracles_private.issue22_exercise_changes c join public.exercises survivor on survivor.id = c.survivor_exercise_id where c.old_name = 'Press (Machine) (Horizontal)'),
  'Chest Press',
  'the horizontal machine press merges into Chest Press'
);
select is((select count(*) from public.exercises where is_active and name in ('Hip Adduction', 'Fly', 'Calf Raises', 'Pullup (Neutral Grip)', 'Pushdown (EZ Bar Attachment)')), 5::bigint, 'approved special renames exist');

-- Scientific versions
select is((select code from public.movement_mapping_versions where is_current), 'issue22_canonical_exercise_identity_2026_10_17', 'canonical movement version is current');
select is((select code from public.exercise_muscle_relevance_versions where is_current), 'issue22_canonical_exercise_identity_2026_10_17', 'canonical relevance version is current');
select is(
  (select c.coefficient from public.exercise_movement_pattern_coefficients c
   join public.movement_mapping_versions v on v.id = c.mapping_version_id and v.is_current
   join public.exercises e on e.id = c.exercise_id and e.name = 'Chest Press (Incline)'
   join public.movement_patterns mp on mp.id = c.movement_pattern_id and mp.code = 'transverse_plane_scapulothoracic_retraction_isometric'),
  0.400::numeric(4,3),
  'machine incline chest press gains isometric scapular retraction'
);
select is(
  (select c.relevance from public.exercise_muscle_relevance_coefficients c
   join public.exercise_muscle_relevance_versions v on v.id = c.mapping_version_id and v.is_current
   join public.exercises e on e.id = c.exercise_id and e.name = 'Chest Press'
   join public.muscles m on m.id = c.muscle_id and m.name = 'Serratus Anterior'),
  0.00::numeric(3,2),
  'Chest Press uses the bench scoring without cable serratus credit'
);
select is(
  (select c.coefficient from public.exercise_movement_pattern_coefficients c
   join public.movement_mapping_versions v on v.id = c.mapping_version_id and v.is_current
   join public.exercises e on e.id = c.exercise_id and e.name = 'Row (Close Grip)'
   join public.movement_patterns mp on mp.id = c.movement_pattern_id and mp.code = 'sagittal_plane_lumbar_intervertebral_extension_isometric'),
  0.300::numeric(4,3),
  'Row (Close Grip) keeps the unsupported lumbar hold'
);
select is(
  (select c.coefficient from public.exercise_movement_pattern_coefficients c
   join public.movement_mapping_versions v on v.id = c.mapping_version_id and v.is_current
   join public.exercises e on e.id = c.exercise_id and e.name = 'Row (Chest Supported) (Wide Grip)'
   join public.movement_patterns mp on mp.id = c.movement_pattern_id and mp.code = 'sagittal_plane_lumbar_intervertebral_extension_isometric'),
  0.000::numeric(4,3),
  'chest-supported wide row scores no lumbar hold'
);
select ok(
  exists (
    select 1 from public.exercise_movement_pattern_coefficients c
    join public.exercises e on e.id = c.exercise_id and e.name = 'Press (Smith Machine)'
  ),
  'historical coefficients of retired exercises are preserved'
);

-- Legacy-shaped fixture data (pre issue #22 rows)
insert into auth.users (id, email)
values
  ('22000000-0000-0000-0000-000000000001', 'canonical-1@example.test'),
  ('22000000-0000-0000-0000-000000000002', 'canonical-2@example.test');

insert into public.gyms (owner_id, name)
values
  ('22000000-0000-0000-0000-000000000001', 'Gym One'),
  ('22000000-0000-0000-0000-000000000001', 'Gym Two'),
  ('22000000-0000-0000-0000-000000000002', 'Other Gym');

insert into public.gym_equipment (owner_id, gym_id, name)
select '22000000-0000-0000-0000-000000000001', g.id, v.name
from (values
  ('Gym One', 'Dumbbell'),
  ('Gym Two', 'Dumbbells'),
  ('Gym One', 'Smith Machine'),
  ('Gym Two', 'Smith Machine'),
  ('Gym One', 'Matrix G3-S71'),
  ('Gym Two', 'Matrix G3-S71'),
  ('Gym One', 'Prime Extreme Row'),
  ('Gym One', 'Prime Extreme Row P-122')
) as v(gym_name, name)
join public.gyms g on g.name = v.gym_name and g.owner_id = '22000000-0000-0000-0000-000000000001';

insert into public.gym_equipment (owner_id, gym_id, name)
select '22000000-0000-0000-0000-000000000002', id, 'Other Owner Machine'
from public.gyms where name = 'Other Gym';

insert into public.workout_sessions (owner_id, gym_id, performed_on, status)
select '22000000-0000-0000-0000-000000000001', g.id, v.performed_on, 'completed'
from (values ('Gym One', date '2026-09-01'), ('Gym Two', date '2026-09-02')) as v(gym_name, performed_on)
join public.gyms g on g.name = v.gym_name and g.owner_id = '22000000-0000-0000-0000-000000000001';

insert into public.workout_sessions (owner_id, gym_id, performed_on, status)
values ('22000000-0000-0000-0000-000000000001', null, date '2026-08-01', 'completed');

create table public.issue22_test_fixture_rows (label text primary key, session_exercise_id bigint, original_exercise_id bigint);
grant all on public.issue22_test_fixture_rows to authenticated;

with source(label, performed_on, exercise_order, exercise_name, equipment_gym, equipment_name) as (
  values
    ('lateral_dumbbell_g1', date '2026-09-01', 1, 'Lateral Raise (Seated)', 'Gym One', 'Dumbbell'),
    ('smith_press_g1', date '2026-09-01', 2, 'Press (Smith Machine)', 'Gym One', 'Smith Machine'),
    ('matrix_g1', date '2026-09-01', 3, 'Leg Extension', 'Gym One', 'Matrix G3-S71'),
    ('prime_row_g1', date '2026-09-01', 4, 'Row (Chest Supported) (Wide Grip)', 'Gym One', 'Prime Extreme Row'),
    ('leg_extension_no_equipment_g1', date '2026-09-01', 5, 'Leg Extension', null, null),
    ('lateral_dumbbell_g2', date '2026-09-02', 1, 'Lateral Raise (Seated)', 'Gym Two', 'Dumbbells'),
    ('matrix_g2', date '2026-09-02', 2, 'Leg Extension', 'Gym Two', 'Matrix G3-S71'),
    ('machine_press_no_equipment_g2', date '2026-09-02', 3, 'Press (Machine) (Horizontal)', null, null),
    ('lateral_no_gym', date '2026-08-01', 1, 'Lateral Raise (Seated)', null, null)
), inserted as (
  insert into public.session_exercises (owner_id, session_id, exercise_order, exercise_id, gym_equipment_id, equipment_name_snapshot)
  select
    '22000000-0000-0000-0000-000000000001',
    ws.id,
    source.exercise_order,
    e.id,
    ge.id,
    ge.name
  from source
  join public.workout_sessions ws on ws.owner_id = '22000000-0000-0000-0000-000000000001' and ws.performed_on = source.performed_on
  join public.exercises e on e.name = source.exercise_name
  left join public.gyms g on g.name = source.equipment_gym and g.owner_id = '22000000-0000-0000-0000-000000000001'
  left join public.gym_equipment ge on ge.gym_id = g.id and ge.name = source.equipment_name
  returning id, exercise_id, exercise_order, session_id
)
insert into public.issue22_test_fixture_rows (label, session_exercise_id, original_exercise_id)
select source.label, inserted.id, inserted.exercise_id
from inserted
join public.workout_sessions ws on ws.id = inserted.session_id
join source on source.performed_on = ws.performed_on and source.exercise_order = inserted.exercise_order;

insert into public.workout_presets (owner_id, name)
values
  ('22000000-0000-0000-0000-000000000001', 'Without survivor'),
  ('22000000-0000-0000-0000-000000000001', 'With survivor');

insert into public.workout_preset_exercises (preset_id, owner_id, exercise_id, set_count)
select p.id, p.owner_id, e.id, v.set_count
from (values
  ('Without survivor', 'Press (Smith Machine)', 2),
  ('Without survivor', 'Press (Machine) (Horizontal)', 4),
  ('With survivor', 'Chest Press', 3),
  ('With survivor', 'Press (Smith Machine)', 5)
) as v(preset_name, exercise_name, set_count)
join public.workout_presets p on p.name = v.preset_name and p.owner_id = '22000000-0000-0000-0000-000000000001'
join public.exercises e on e.name = v.exercise_name;

select ok(heracles_private.issue22_canonicalize_gym_equipment() = 9, 'all nine legacy equipment rows are mapped');
select ok(heracles_private.issue22_reconcile_exercise_identity_data() >= 3, 'occurrences without equipment are backfilled');

-- Equipment canonicalization
select is((select count(*) from public.equipment where owner_id = '22000000-0000-0000-0000-000000000001' and lower(name) = 'dumbbell'), 1::bigint, 'Dumbbell exists once across gyms');
select is((select kind from public.equipment where owner_id = '22000000-0000-0000-0000-000000000001' and name = 'Dumbbell'), 'generic', 'Dumbbell is generic');
select is(
  (select count(*) from public.equipment_gym_availability a join public.equipment e on e.id = a.equipment_id where e.name = 'Dumbbell'),
  0::bigint,
  'generic equipment has no gym availability rows'
);
select is((select count(*) from public.equipment where owner_id = '22000000-0000-0000-0000-000000000001' and name = 'Matrix G3-S71'), 1::bigint, 'a named machine at two gyms is one canonical machine');
select is(
  (select count(*) from public.equipment_gym_availability a join public.equipment e on e.id = a.equipment_id where e.name = 'Matrix G3-S71'),
  2::bigint,
  'the named machine is available at both gyms'
);
select is(
  (select array_agg(name order by name) from public.equipment where owner_id = '22000000-0000-0000-0000-000000000001' and name like 'Smith Machine (unknown model)%'),
  array['Smith Machine (unknown model) — Gym One', 'Smith Machine (unknown model) — Gym Two'],
  'Smith machines become one unknown-model placeholder per gym'
);
select is(
  (select e.name from heracles_private.issue22_equipment_map m join public.equipment e on e.id = m.equipment_id where m.old_name = 'Prime Extreme Row'),
  'Prime Extreme Row P-122',
  'the user-confirmed same machine merges into its specific model name'
);
select is(
  (select canonical_equipment_id from public.session_exercises where id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'lateral_dumbbell_g1')),
  (select canonical_equipment_id from public.session_exercises where id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'lateral_dumbbell_g2')),
  'one exercise performed with dumbbells at two gyms resolves to one equipment identity'
);
select ok(
  (select gym_equipment_id is not null and equipment_name_snapshot = 'Smith Machine'
   from public.session_exercises where id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'smith_press_g1')),
  'legacy reference and historical snapshot are untouched'
);

-- Exercise identity reconciliation
select is(
  (select e.name from public.session_exercises se join public.exercises e on e.id = se.exercise_id where se.id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'smith_press_g1')),
  'Chest Press',
  'history on a retired exercise is repointed to the surviving canonical exercise'
);
select is(
  (select e.name from public.session_exercises se join public.equipment e on e.id = se.canonical_equipment_id where se.id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'leg_extension_no_equipment_g1')),
  'Machine (unknown model) — Gym One',
  'a machine exercise without equipment gets the per-gym unknown-model placeholder'
);
select is(
  (select e.name from public.session_exercises se join public.equipment e on e.id = se.canonical_equipment_id where se.id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'machine_press_no_equipment_g2')),
  'Machine (unknown model) — Gym Two',
  'the placeholder uses the original exercise name even after the merge'
);
select is(
  (select e.name from public.session_exercises se join public.equipment e on e.id = se.canonical_equipment_id where se.id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'lateral_no_gym')),
  'Dumbbell',
  'a dumbbell exercise without equipment and without a gym gets generic Dumbbell'
);
select ok(
  (select equipment_name_snapshot is null from public.session_exercises where id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'lateral_no_gym')),
  'backfill does not invent a historical name snapshot'
);
select is(
  (select set_count from public.workout_preset_exercises m join public.workout_presets p on p.id = m.preset_id join public.exercises e on e.id = m.exercise_id
   where p.name = 'Without survivor' and e.name = 'Chest Press'),
  4::smallint,
  'two retired memberships fold into one Chest Press membership keeping the larger set count'
);
select is(
  (select set_count from public.workout_preset_exercises m join public.workout_presets p on p.id = m.preset_id join public.exercises e on e.id = m.exercise_id
   where p.name = 'With survivor' and e.name = 'Chest Press'),
  5::smallint,
  'a retired membership folds into the existing survivor membership'
);
select is(
  (select count(*) from public.workout_preset_exercises m join public.exercises e on e.id = m.exercise_id where not e.is_active),
  0::bigint,
  'no preset references a retired exercise'
);

-- RPCs and permissions as the owner
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select id from public.create_or_get_equipment('  dumbbells ', (select id from public.gyms where name = 'Gym Two'))),
  (select id from public.equipment where name = 'Dumbbell'),
  'creating a generic implement reuses the canonical record'
);
select is(
  (select id from public.create_or_get_equipment('matrix   g3-s71', (select id from public.gyms where name = 'Gym One'))),
  (select id from public.equipment where name = 'Matrix G3-S71'),
  'creating a named machine reuses the record with the same normalized name'
);
select is(
  (select name from public.create_or_get_equipment('Cable', (select id from public.gyms where name = 'Gym One'))),
  'Cable (unknown model) — Gym One',
  'a bare machine-type word becomes a per-gym unknown-model placeholder'
);
select is(
  (select kind from public.create_or_get_equipment('Panatta Leg Press 1FW', (select id from public.gyms where name = 'Gym One'))),
  'machine',
  'a specific model is created as a machine'
);
select is(
  (select id from public.create_or_get_equipment('Panatta Leg Press 1FW', (select id from public.gyms where name = 'Gym Two'))),
  (select id from public.equipment where name = 'Panatta Leg Press 1FW'),
  'linking a machine to another gym reuses its identity'
);
select is(
  (select count(*) from public.equipment_gym_availability a join public.equipment e on e.id = a.equipment_id where e.name = 'Panatta Leg Press 1FW'),
  2::bigint,
  'the machine is now available at both gyms'
);
select throws_ok($sql$
  insert into public.equipment_gym_availability (owner_id, equipment_id, gym_id)
  values (
    '22000000-0000-0000-0000-000000000001',
    (select id from public.equipment where name = 'Dumbbell'),
    (select id from public.gyms where name = 'Gym One')
  );
$sql$, '22023', 'Generic equipment is available at every gym and cannot be tied to one gym.', 'generic equipment cannot be tied to a gym');

select lives_ok($sql$
  select public.start_or_resume_workout_session((select id from public.gyms where name = 'Gym One'), null);
$sql$, 'a workout starts at Gym One');

select lives_ok($sql$
  insert into public.issue22_test_fixture_rows (label, session_exercise_id)
  select 'live_default', (public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress'),
    (select id from public.exercises where name = 'Lateral Raise (Seated)'),
    null
  ) ->> 'id')::bigint;
$sql$, 'an exercise is added without choosing equipment');
select is(
  (select e.name from public.session_exercises se join public.equipment e on e.id = se.canonical_equipment_id where se.id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'live_default')),
  'Dumbbell',
  'default equipment is the canonical equipment last used for the exercise at this gym'
);
select ok(
  (select gym_equipment_id is null from public.session_exercises where id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'live_default')),
  'new entries no longer create gym-scoped references'
);
select lives_ok($sql$
  insert into public.issue22_test_fixture_rows (label, session_exercise_id)
  select 'live_matrix', (public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress'),
    (select id from public.exercises where name = 'Leg Extension'),
    (select id from public.equipment where name = 'Matrix G3-S71')
  ) ->> 'id')::bigint;
$sql$, 'a machine available at the session gym can be chosen');
select throws_ok($sql$
  select public.add_session_exercise(
    (select id from public.workout_sessions where status = 'in_progress'),
    (select id from public.exercises where name = 'Chest Press'),
    (select id from public.equipment where name = 'Smith Machine (unknown model) — Gym Two')
  );
$sql$, '42501', 'Equipment not found, inactive, or not available at the session gym.', 'a machine from another gym cannot be chosen in a live workout');

select is(
  (public.update_session_history_exercise(
    (select session_exercise_id from public.issue22_test_fixture_rows where label = 'leg_extension_no_equipment_g1'),
    (select id from public.equipment where name = 'Matrix G3-S71'),
    '[]'::jsonb
  ) ->> 'equipment_name_snapshot'),
  'Matrix G3-S71',
  'Session History correction selects canonical equipment and records its name'
);
select is(
  (public.update_session_history_exercise(
    (select session_exercise_id from public.issue22_test_fixture_rows where label = 'smith_press_g1'),
    (select canonical_equipment_id from public.session_exercises where id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'smith_press_g1')),
    '[]'::jsonb
  ) ->> 'equipment_name_snapshot'),
  'Smith Machine',
  'an unchanged selection keeps the historical snapshot'
);

select set_config('request.jwt.claims', '{"sub":"22000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.equipment where owner_id = '22000000-0000-0000-0000-000000000001'), 0::bigint, 'another user cannot see the owner''s equipment');
select throws_ok($sql$
  select public.update_session_history_exercise(
    (select session_exercise_id from public.issue22_test_fixture_rows where label = 'matrix_g1'),
    null,
    '[]'::jsonb
  );
$sql$, '42501', 'Completed session exercise not found or not owned by the current user.', 'another user cannot correct the owner''s history');

reset role;

-- Undo step 2, then step 1
select lives_ok($sql$ select heracles_private.issue22_undo_exercise_identity(); $sql$, 'exercise identity step can be undone');
select is((select count(*) from public.exercises where is_active), 139::bigint, 'undo restores the full previous catalogue');
select is((select code from public.movement_mapping_versions where is_current), (select code from public.movement_mapping_versions where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'movement')), 'undo restores the previous scientific version');
select is(
  (select array_agg(se.exercise_id order by f.label) from public.issue22_test_fixture_rows f join public.session_exercises se on se.id = f.session_exercise_id where f.original_exercise_id is not null),
  (select array_agg(f.original_exercise_id order by f.label) from public.issue22_test_fixture_rows f where f.original_exercise_id is not null),
  'undo restores every original exercise reference'
);
select is(
  (select count(*) from public.workout_preset_exercises m join public.workout_presets p on p.id = m.preset_id where p.owner_id = '22000000-0000-0000-0000-000000000001'),
  4::bigint,
  'undo restores every preset membership'
);
select ok(
  (select canonical_equipment_id is null from public.session_exercises where id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'lateral_no_gym')),
  'undo removes inferred equipment'
);

select lives_ok($sql$ select heracles_private.issue22_undo_canonical_equipment(); $sql$, 'canonical equipment step can be undone');
select hasnt_table('public', 'equipment', 'undo removes the canonical equipment table');
select has_function('public', 'create_or_get_gym_equipment', array['bigint', 'text'], 'undo restores gym-scoped equipment creation');
select is(
  (select ge.name || ' @ ' || g.name from public.session_exercises se join public.gym_equipment ge on ge.id = se.gym_equipment_id join public.gyms g on g.id = ge.gym_id
   where se.id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'live_default')),
  'Dumbbell @ Gym One',
  'entries logged after the change get their legacy gym-scoped equipment back'
);
select is(
  (select ge.name || ' @ ' || g.name from public.session_exercises se join public.gym_equipment ge on ge.id = se.gym_equipment_id join public.gyms g on g.id = ge.gym_id
   where se.id = (select session_exercise_id from public.issue22_test_fixture_rows where label = 'leg_extension_no_equipment_g1')),
  'Matrix G3-S71 @ Gym One',
  'history corrections made after the change are kept in the legacy model'
);

select * from finish();
rollback;
