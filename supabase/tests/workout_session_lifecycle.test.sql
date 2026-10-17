begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

select has_table('public', 'workout_session_reopen_snapshots', 'reopen snapshot table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workout_session_reopen_snapshots'::regclass),
  'reopen snapshot table has row level security enabled'
);
select has_function('public', 'delete_completed_workout_session', array['bigint'], 'delete_completed_workout_session exists');
select has_function('public', 'reopen_workout_session', array['bigint'], 'reopen_workout_session exists');
select ok(
  not has_function_privilege('anon', 'public.delete_completed_workout_session(bigint)', 'execute')
  and not has_function_privilege('anon', 'public.reopen_workout_session(bigint)', 'execute'),
  'anon cannot execute the session delete or reopen RPCs'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_completed_workout_session(bigint)', 'execute')
  and has_function_privilege('authenticated', 'public.reopen_workout_session(bigint)', 'execute'),
  'authenticated users can execute the session delete and reopen RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.workout_session_reopen_snapshots', 'update')
  and not has_table_privilege('anon', 'public.workout_session_reopen_snapshots', 'select'),
  'snapshots cannot be updated by clients or read anonymously'
);

select ok(
  exists (select 1 from public.exercises where not is_active),
  'the catalogue contains retired exercises to test against'
);

create temporary table lifecycle_equipment (label text primary key, id bigint not null) on commit drop;
grant select, insert on lifecycle_equipment to authenticated;

insert into auth.users (id, email)
values
  ('50000000-0000-0000-0000-000000000001', 'lifecycle-one@example.test'),
  ('50000000-0000-0000-0000-000000000002', 'lifecycle-two@example.test');

-- Owner one: a rich completed session (S1), a second completed session (S2) and one whose
-- historical sets the live editor cannot finish unchanged (S3).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.gyms (owner_id, name) values ('50000000-0000-0000-0000-000000000001', 'Lifecycle Gym');
do $$
begin
  insert into lifecycle_equipment (label, id)
  values
    ('rack', (public.create_or_get_equipment('Rack One', (select id from public.gyms where name = 'Lifecycle Gym'))).id),
    ('cable', (public.create_or_get_equipment('Cable Two', (select id from public.gyms where name = 'Lifecycle Gym'))).id);
end
$$;

insert into public.workout_sessions (owner_id, gym_id, performed_on, status, created_at)
select '50000000-0000-0000-0000-000000000001', gyms.id, sessions.performed_on, 'completed', sessions.created_at
from public.gyms
cross join (values
  (date '2026-08-01', timestamptz '2026-08-01 18:00:00+00'),
  (date '2026-08-05', timestamptz '2026-08-05 18:00:00+00'),
  (date '2026-07-01', timestamptz '2026-07-01 18:00:00+00'),
  (date '2026-06-01', timestamptz '2026-06-01 18:00:00+00')
) as sessions(performed_on, created_at)
where name = 'Lifecycle Gym';

insert into public.session_exercises (owner_id, session_id, exercise_order, exercise_id, canonical_equipment_id, equipment_name_snapshot, equipment_id)
values
  (
    '50000000-0000-0000-0000-000000000001',
    (select id from public.workout_sessions where performed_on = date '2026-08-01'),
    1,
    (select id from public.exercises where is_active order by id limit 1),
    (select id from lifecycle_equipment where label = 'rack'),
    'Rack One',
    null
  ),
  (
    '50000000-0000-0000-0000-000000000001',
    (select id from public.workout_sessions where performed_on = date '2026-08-01'),
    2,
    (select id from public.exercises where is_active order by id offset 1 limit 1),
    null,
    null,
    'Legacy Bench'
  ),
  (
    '50000000-0000-0000-0000-000000000001',
    (select id from public.workout_sessions where performed_on = date '2026-08-05'),
    1,
    (select id from public.exercises where is_active order by id limit 1),
    (select id from lifecycle_equipment where label = 'cable'),
    'Cable Two',
    null
  ),
  (
    '50000000-0000-0000-0000-000000000001',
    (select id from public.workout_sessions where performed_on = date '2026-07-01'),
    1,
    (select id from public.exercises where is_active order by id limit 1),
    null,
    null,
    null
  ),
  (
    '50000000-0000-0000-0000-000000000001',
    (select id from public.workout_sessions where performed_on = date '2026-06-01'),
    1,
    (select id from public.exercises where not is_active order by id limit 1),
    null,
    null,
    null
  );

insert into public.exercise_sets (owner_id, session_exercise_id, set_number, weight, reps, is_warmup, reported_rir_bucket, rir_source, rpe, is_drop_set)
select '50000000-0000-0000-0000-000000000001', se.id, v.set_number, v.weight, v.reps, v.is_warmup, v.rir, v.rir_source, v.rpe, v.is_drop_set
from public.session_exercises se
join public.workout_sessions ws on ws.id = se.session_id
join (values
  (date '2026-08-01', 1, 1::smallint, 40::numeric, 10, true, null::smallint, null::text, null::numeric, false),
  (date '2026-08-01', 1, 2::smallint, 60::numeric, 8, false, 2::smallint, 'user_entered', null::numeric, false),
  (date '2026-08-01', 1, 3::smallint, 60::numeric, 7, false, 0::smallint, 'historical_backfill', null::numeric, false),
  (date '2026-08-01', 2, 1::smallint, 30::numeric, 12, false, 1::smallint, 'user_entered', 8.5::numeric, true),
  (date '2026-08-05', 1, 1::smallint, 20::numeric, 10, false, 1::smallint, 'user_entered', null::numeric, false),
  (date '2026-07-01', 1, 1::smallint, null::numeric, 10, false, 0::smallint, 'historical_backfill', null::numeric, false),
  (date '2026-06-01', 1, 1::smallint, 50::numeric, 6, false, 1::smallint, 'user_entered', null::numeric, false)
) as v(performed_on, exercise_order, set_number, weight, reps, is_warmup, rir, rir_source, rpe, is_drop_set)
  on v.performed_on = ws.performed_on and v.exercise_order = se.exercise_order;

-- Owner two: one unrelated completed session.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

insert into public.gyms (owner_id, name) values ('50000000-0000-0000-0000-000000000002', 'Other Gym');
insert into public.workout_sessions (owner_id, gym_id, performed_on, status)
select '50000000-0000-0000-0000-000000000002', id, date '2026-08-01', 'completed' from public.gyms;
insert into public.session_exercises (owner_id, session_id, exercise_order, exercise_id)
select '50000000-0000-0000-0000-000000000002', id, 1, (select id from public.exercises where is_active order by id limit 1)
from public.workout_sessions;
insert into public.exercise_sets (owner_id, session_exercise_id, set_number, weight, reps, reported_rir_bucket, rir_source)
select '50000000-0000-0000-0000-000000000002', id, 1, 50, 5, 1, 'user_entered' from public.session_exercises;

-- Fingerprints of the original completed data, captured with full visibility.
reset role;
create temporary table lifecycle_ids on commit drop as
select
  (select id from public.workout_sessions where owner_id = '50000000-0000-0000-0000-000000000001' and performed_on = date '2026-08-01') as s1,
  (select id from public.workout_sessions where owner_id = '50000000-0000-0000-0000-000000000001' and performed_on = date '2026-08-05') as s2,
  (select id from public.workout_sessions where owner_id = '50000000-0000-0000-0000-000000000001' and performed_on = date '2026-07-01') as s3,
  (select id from public.workout_sessions where owner_id = '50000000-0000-0000-0000-000000000001' and performed_on = date '2026-06-01') as s4,
  (select id from public.workout_sessions where owner_id = '50000000-0000-0000-0000-000000000002') as other_session;
grant select on lifecycle_ids to authenticated;

create temporary table s1_before on commit drop as
select
  (select to_jsonb(ws) from public.workout_sessions ws where ws.id = (select s1 from lifecycle_ids)) as session_row,
  (select jsonb_agg(to_jsonb(se) order by se.id) from public.session_exercises se where se.session_id = (select s1 from lifecycle_ids)) as exercise_rows,
  (select jsonb_agg(to_jsonb(es) order by es.id)
     from public.exercise_sets es
     join public.session_exercises se on se.id = es.session_exercise_id
    where se.session_id = (select s1 from lifecycle_ids)) as set_rows;

-- Owner isolation: owner two can neither delete nor reopen owner one's history.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok(
  format('select public.delete_completed_workout_session(%s)', (select s1 from lifecycle_ids)),
  '42501', 'Session not found or not owned by current user.',
  'another owner cannot delete a completed session'
);
select throws_ok(
  format('select public.reopen_workout_session(%s)', (select s1 from lifecycle_ids)),
  '42501', 'Session not found or not owned by current user.',
  'another owner cannot reopen a completed session'
);

-- Owner one reopens S1.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  format('select public.reopen_workout_session(%s)', (select s3 from lifecycle_ids)),
  '22023', 'This session contains historical entries the live workout editor cannot finish unchanged. Use the exercise Edit form instead.',
  'history the live editor cannot finish unchanged is not reopened'
);
select is(
  (select status from public.workout_sessions where id = (select s3 from lifecycle_ids)),
  'completed',
  'a refused reopen leaves the session completed'
);
select throws_ok(
  format('select public.reopen_workout_session(%s)', (select s4 from lifecycle_ids)),
  '22023', 'This session references a retired exercise and cannot be reopened.',
  'a session that references a retired exercise is not reopened'
);

select is(
  (select status from public.reopen_workout_session((select s1 from lifecycle_ids))),
  'in_progress',
  'reopen_workout_session returns the session in progress'
);
select is(
  (select performed_on from public.workout_sessions where id = (select s1 from lifecycle_ids)),
  date '2026-08-01',
  'reopening preserves the original workout date'
);
select is(
  (select created_at from public.workout_sessions where id = (select s1 from lifecycle_ids)),
  timestamptz '2026-08-01 18:00:00+00',
  'reopening preserves the original creation timestamp'
);
select is(
  (select count(*) from public.workout_session_reopen_snapshots where session_id = (select s1 from lifecycle_ids)),
  1::bigint,
  'reopening records one pre-correction snapshot'
);

select throws_ok(
  format('select public.reopen_workout_session(%s)', (select s2 from lifecycle_ids)),
  '55000', 'Finish or cancel your active workout before reopening a completed session.',
  'a second session cannot be reopened while one is in progress'
);
select is(
  (select count(*) from public.workout_sessions where owner_id = '50000000-0000-0000-0000-000000000001' and status = 'in_progress'),
  1::bigint,
  'the one-in-progress-session invariant holds'
);
select throws_ok(
  format('select public.reopen_workout_session(%s)', (select s1 from lifecycle_ids)),
  '22023', 'Only completed workout sessions can be reopened.',
  'an in-progress session cannot be reopened again'
);
select throws_ok(
  format('select public.delete_completed_workout_session(%s)', (select s1 from lifecycle_ids)),
  '22023', 'Only completed workout sessions can be deleted.',
  'a reopened in-progress session cannot be deleted through the history RPC'
);

-- Owner two cannot see, cancel, or edit owner one's reopened session.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*) from public.workout_session_reopen_snapshots),
  0::bigint,
  'another owner cannot read reopen snapshots'
);
select throws_ok(
  format('select public.cancel_workout_session(%s)', (select s1 from lifecycle_ids)),
  '42501', 'Session not found or not owned by current user.',
  'another owner cannot discard a reopened session'
);

-- Owner one applies structural live-workout edits, then discards them.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  format('select public.add_session_exercise(%s, (select id from public.exercises where is_active order by id offset 2 limit 1), null::bigint)', (select s1 from lifecycle_ids)),
  'a reopened session accepts live exercise additions'
);
select lives_ok(
  format(
    'select public.remove_exercise_set((select es.id from public.exercise_sets es join public.session_exercises se on se.id = es.session_exercise_id where se.session_id = %s and se.exercise_order = 1 and es.set_number = 3))',
    (select s1 from lifecycle_ids)
  ),
  'a reopened session accepts live set removal'
);
select lives_ok(
  format(
    'select public.remove_session_exercise((select id from public.session_exercises where session_id = %s and exercise_order = 2))',
    (select s1 from lifecycle_ids)
  ),
  'a reopened session accepts live exercise removal'
);
update public.exercise_sets es
set weight = 999
from public.session_exercises se
where se.id = es.session_exercise_id and se.session_id = (select s1 from lifecycle_ids) and es.set_number = 2;

select is(
  (select public.cancel_workout_session((select s1 from lifecycle_ids))),
  true,
  'discarding a correction succeeds'
);

reset role;
select is(
  (select to_jsonb(ws) from public.workout_sessions ws where ws.id = (select s1 from lifecycle_ids)),
  (select session_row from s1_before),
  'discarding a correction restores the completed session row exactly'
);
select is(
  (select jsonb_agg(to_jsonb(se) order by se.id) from public.session_exercises se where se.session_id = (select s1 from lifecycle_ids)),
  (select exercise_rows from s1_before),
  'discarding a correction restores the original exercises, identities, canonical and legacy equipment'
);
select is(
  (select canonical_equipment_id from public.session_exercises where session_id = (select s1 from lifecycle_ids) and exercise_order = 1),
  (select id from lifecycle_equipment where label = 'rack'),
  'discarding a correction restores the canonical equipment reference'
);
select is(
  (select jsonb_agg(to_jsonb(es) order by es.id)
     from public.exercise_sets es
     join public.session_exercises se on se.id = es.session_exercise_id
    where se.session_id = (select s1 from lifecycle_ids)),
  (select set_rows from s1_before),
  'discarding a correction restores the original sets, provenance, legacy fields, and estimates'
);
select is(
  (select count(*) from public.workout_session_reopen_snapshots),
  0::bigint,
  'discarding a correction removes its snapshot'
);

-- Reopen again and finish with corrections: they become canonical and the date is preserved.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  format('select public.reopen_workout_session(%s)', (select s1 from lifecycle_ids)),
  'a restored session can be reopened again'
);
update public.exercise_sets es
set weight = 62.5
from public.session_exercises se
where se.id = es.session_exercise_id and se.session_id = (select s1 from lifecycle_ids) and se.exercise_order = 1 and es.set_number = 2;
select lives_ok(
  format('select public.reorder_session_exercises(%1$s, array(select id from public.session_exercises where session_id = %1$s order by exercise_order desc))', (select s1 from lifecycle_ids)),
  'a reopened session accepts live reordering'
);
select lives_ok(
  format('select public.conclude_workout_session(%s)', (select s1 from lifecycle_ids)),
  'a reopened session can be finished again'
);
select is(
  (select status from public.workout_sessions where id = (select s1 from lifecycle_ids)),
  'completed',
  'finishing a correction returns the session to completed'
);
select is(
  (select performed_on from public.workout_sessions where id = (select s1 from lifecycle_ids)),
  date '2026-08-01',
  'finishing a correction preserves the original workout date'
);
select is(
  (select es.weight from public.exercise_sets es join public.session_exercises se on se.id = es.session_exercise_id
    where se.session_id = (select s1 from lifecycle_ids) and es.set_number = 2),
  62.5::numeric,
  'finished corrections are canonical'
);
select is(
  (select array_agg(se.exercise_order order by se.id) from public.session_exercises se where se.session_id = (select s1 from lifecycle_ids)),
  array[2, 1],
  'finished structural corrections are canonical'
);
select is(
  (select count(*) from public.workout_session_reopen_snapshots),
  0::bigint,
  'finishing a correction discards its snapshot'
);
select throws_ok(
  format('select public.cancel_workout_session(%s)', (select s1 from lifecycle_ids)),
  '22023', 'Only in-progress workout sessions can be cancelled.',
  'a finished correction cannot be cancelled afterwards'
);

-- Equipment deleted during a correction cannot be re-linked on discard; its name snapshot remains.
select lives_ok(
  format('select public.reopen_workout_session(%s)', (select s2 from lifecycle_ids)),
  'a second completed session can be reopened once the first is finished'
);
do $$
begin
  perform public.remove_session_exercise((select id from public.session_exercises where session_id = (select s2 from lifecycle_ids)));
end
$$;
delete from public.equipment where id = (select id from lifecycle_equipment where label = 'cable');
select is(
  (select public.cancel_workout_session((select s2 from lifecycle_ids))),
  true,
  'discarding a correction succeeds after its equipment was deleted'
);
select results_eq(
  format('select canonical_equipment_id, equipment_name_snapshot, (select count(*) from public.exercise_sets es where es.session_exercise_id = se.id) from public.session_exercises se where session_id = %s', (select s2 from lifecycle_ids)),
  $$values (null::bigint, 'Cable Two'::text, 1::bigint)$$,
  'restored history keeps the equipment name snapshot and sets when the equipment row is gone'
);

-- A restore never points history at a retired exercise: if the original exercise was retired while
-- the session was reopened, discarding is refused and nothing changes.
do $$
begin
  perform public.reopen_workout_session((select s2 from lifecycle_ids));
end
$$;
reset role;
update public.exercises set is_active = false
where id = (select exercise_id from public.session_exercises where session_id = (select s2 from lifecycle_ids));
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  format('select public.cancel_workout_session(%s)', (select s2 from lifecycle_ids)),
  '22023', 'The original workout references an exercise that has since been retired, so it cannot be restored. Save the corrections instead.',
  'discarding is refused when the original references a since-retired exercise'
);
select ok(
  (select status from public.workout_sessions where id = (select s2 from lifecycle_ids)) = 'in_progress'
  and (select count(*) from public.workout_session_reopen_snapshots where session_id = (select s2 from lifecycle_ids)) = 1
  and (select count(*) from public.session_exercises where session_id = (select s2 from lifecycle_ids)) = 1,
  'a refused discard leaves the correction and its snapshot intact'
);
reset role;
update public.exercises set is_active = true
where id = (select exercise_id from public.session_exercises where session_id = (select s2 from lifecycle_ids));
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Any completion path discards the snapshot (for example a direct status update).
update public.workout_sessions set status = 'completed' where id = (select s2 from lifecycle_ids);
select is(
  (select count(*) from public.workout_session_reopen_snapshots),
  0::bigint,
  'completing a reopened session by any path discards its snapshot'
);

-- A normal in-progress workout is still deleted by cancellation.
insert into public.workout_sessions (owner_id, gym_id, performed_on, status)
select '50000000-0000-0000-0000-000000000001', id, date '2026-08-10', 'in_progress' from public.gyms;
select is(
  (select public.cancel_workout_session((select id from public.workout_sessions where status = 'in_progress'))),
  true,
  'cancelling a normal in-progress workout succeeds'
);
select is(
  (select count(*) from public.workout_sessions where performed_on = date '2026-08-10'),
  0::bigint,
  'cancelling a normal in-progress workout still deletes it'
);

-- Owner one deletes S1; only that session and its children are removed.
reset role;
create temporary table s1_children on commit drop as
select se.id as exercise_id, es.id as set_id
from public.session_exercises se
left join public.exercise_sets es on es.session_exercise_id = se.id
where se.session_id = (select s1 from lifecycle_ids);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select public.delete_completed_workout_session((select s1 from lifecycle_ids))),
  true,
  'an owner can delete a completed session'
);

reset role;
select is(
  (select count(*) from public.workout_sessions where id = (select s1 from lifecycle_ids)),
  0::bigint,
  'the deleted session is gone'
);
select ok(
  not exists (select 1 from public.session_exercises where id in (select exercise_id from s1_children))
  and not exists (select 1 from public.exercise_sets where id in (select set_id from s1_children)),
  'the deleted session''s exercises and sets cascade away'
);
select is(
  (select count(*) from public.workout_sessions ws
    join public.session_exercises se on se.session_id = ws.id
    join public.exercise_sets es on es.session_exercise_id = se.id
   where ws.id in ((select s2 from lifecycle_ids), (select s3 from lifecycle_ids), (select s4 from lifecycle_ids))),
  3::bigint,
  'the owner''s other sessions keep their exercises and sets'
);
select is(
  (select count(*) from public.workout_sessions ws
    join public.session_exercises se on se.session_id = ws.id
    join public.exercise_sets es on es.session_exercise_id = se.id
   where ws.id = (select other_session from lifecycle_ids)),
  1::bigint,
  'another owner''s session is untouched'
);

select * from finish();
rollback;
