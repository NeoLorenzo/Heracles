-- Migration: add_completed_session_delete_and_reopen
-- Description: Lets an owner delete a completed workout session from Session History, or reopen it
-- into the existing live-workout flow for full correction. Reopening snapshots the completed
-- session first, so discarding the correction (cancel_workout_session) restores the original
-- completed data instead of deleting history. Applies after issue #22's canonical equipment and
-- exercise identity migrations (20261017130000, 20261017130100).

begin;

-- One row per reopened session while its correction is in progress. The snapshot holds the exact
-- completed rows (including identity values) so a discarded correction restores them unchanged.
create table public.workout_session_reopen_snapshots (
  session_id bigint primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  reopened_at timestamptz not null default now(),
  original_session jsonb not null check (jsonb_typeof(original_session) = 'object'),
  original_exercises jsonb not null check (jsonb_typeof(original_exercises) = 'array'),
  original_sets jsonb not null check (jsonb_typeof(original_sets) = 'array'),
  unique (session_id, owner_id),
  foreign key (session_id, owner_id)
    references public.workout_sessions(id, owner_id)
    on delete cascade
);

create index workout_session_reopen_snapshots_owner_idx
  on public.workout_session_reopen_snapshots (owner_id);

alter table public.workout_session_reopen_snapshots enable row level security;

create policy "Users can view their own reopen snapshots"
  on public.workout_session_reopen_snapshots for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can create their own reopen snapshots"
  on public.workout_session_reopen_snapshots for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can delete their own reopen snapshots"
  on public.workout_session_reopen_snapshots for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

revoke all on public.workout_session_reopen_snapshots from public, anon, authenticated;
grant select, insert, delete on public.workout_session_reopen_snapshots to authenticated;

-- Function: delete_completed_workout_session
create or replace function public.delete_completed_workout_session(
  p_session_id bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_owner_id uuid := (select auth.uid());
  session_row public.workout_sessions;
begin
  if session_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select * into session_row
  from public.workout_sessions
  where id = p_session_id and owner_id = session_owner_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Session not found or not owned by current user.';
  end if;

  if session_row.status <> 'completed' then
    raise exception using errcode = '22023', message = 'Only completed workout sessions can be deleted.';
  end if;

  -- session_exercises and exercise_sets are removed by their owner-scoped ON DELETE CASCADE keys.
  delete from public.workout_sessions
  where id = p_session_id and owner_id = session_owner_id and status = 'completed';

  return true;
end;
$$;

-- Function: reopen_workout_session
create or replace function public.reopen_workout_session(
  p_session_id bigint
)
returns public.workout_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_owner_id uuid := (select auth.uid());
  session_row public.workout_sessions;
  reopened_session public.workout_sessions;
begin
  if session_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select * into session_row
  from public.workout_sessions
  where id = p_session_id and owner_id = session_owner_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Session not found or not owned by current user.';
  end if;

  if session_row.status <> 'completed' then
    raise exception using errcode = '22023', message = 'Only completed workout sessions can be reopened.';
  end if;

  if exists (
    select 1 from public.workout_sessions
    where owner_id = session_owner_id and status = 'in_progress'
  ) then
    raise exception using errcode = '55000', message = 'Finish or cancel your active workout before reopening a completed session.';
  end if;

  -- Finishing a reopened session runs conclude_workout_session, which prunes blank sets and
  -- exercises without sets and rejects incomplete drafts. Refuse to reopen history that the live
  -- editor could not finish unchanged, so an unedited reopen/finish never alters stored data.
  if exists (
    select 1
    from public.session_exercises se
    where se.session_id = p_session_id
      and se.owner_id = session_owner_id
      and not exists (
        select 1 from public.exercise_sets es
        where es.session_exercise_id = se.id and es.owner_id = session_owner_id
      )
  ) or exists (
    select 1
    from public.exercise_sets es
    join public.session_exercises se
      on se.id = es.session_exercise_id and se.owner_id = es.owner_id
    where se.session_id = p_session_id
      and se.owner_id = session_owner_id
      and (
        es.weight is null
        or es.reps is null
        or (not es.is_warmup and es.reported_rir_bucket is null)
      )
  ) then
    raise exception using errcode = '22023', message = 'This session contains historical entries the live workout editor cannot finish unchanged. Use the exercise Edit form instead.';
  end if;

  -- History references active canonical exercises only; never snapshot a retired one.
  if exists (
    select 1
    from public.session_exercises se
    join public.exercises e on e.id = se.exercise_id
    where se.session_id = p_session_id
      and se.owner_id = session_owner_id
      and not e.is_active
  ) then
    raise exception using errcode = '22023', message = 'This session references a retired exercise and cannot be reopened.';
  end if;

  insert into public.workout_session_reopen_snapshots (
    session_id, owner_id, original_session, original_exercises, original_sets
  )
  select
    session_row.id,
    session_owner_id,
    to_jsonb(session_row),
    coalesce((
      select jsonb_agg(to_jsonb(se) order by se.exercise_order, se.id)
      from public.session_exercises se
      where se.session_id = p_session_id and se.owner_id = session_owner_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(es) order by es.session_exercise_id, es.set_number, es.id)
      from public.exercise_sets es
      join public.session_exercises se
        on se.id = es.session_exercise_id and se.owner_id = es.owner_id
      where se.session_id = p_session_id and se.owner_id = session_owner_id
    ), '[]'::jsonb);

  begin
    -- performed_on, created_at, gym and preset provenance are intentionally left untouched.
    update public.workout_sessions
    set status = 'in_progress'
    where id = p_session_id and owner_id = session_owner_id and status = 'completed'
    returning * into reopened_session;
  exception
    when unique_violation then
      -- A concurrent start or reopen claimed the owner's single in-progress slot first.
      raise exception using errcode = '55000', message = 'Finish or cancel your active workout before reopening a completed session.';
  end;

  return reopened_session;
end;
$$;

-- Function: cancel_workout_session
-- A normal in-progress workout is still deleted. A reopened completed session is restored from its
-- snapshot and returned to completed, so discarding a correction never destroys history.
create or replace function public.cancel_workout_session(
  p_session_id bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_owner_id uuid := (select auth.uid());
  session_row public.workout_sessions;
  snapshot_row public.workout_session_reopen_snapshots;
  exercise_columns text;
  set_columns text;
begin
  if session_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select * into session_row
  from public.workout_sessions
  where id = p_session_id and owner_id = session_owner_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Session not found or not owned by current user.';
  end if;

  if session_row.status <> 'in_progress' then
    raise exception using errcode = '22023', message = 'Only in-progress workout sessions can be cancelled.';
  end if;

  select * into snapshot_row
  from public.workout_session_reopen_snapshots
  where session_id = p_session_id and owner_id = session_owner_id;

  if not found then
    delete from public.workout_sessions
    where id = p_session_id and owner_id = session_owner_id and status = 'in_progress';
    return true;
  end if;

  -- A restore must never point history at a retired exercise (for example one merged by a catalogue
  -- migration while this session was reopened). Refuse before changing anything: the correction stays
  -- in progress and can still be saved, and no history is lost.
  if exists (
    select 1
    from jsonb_array_elements(snapshot_row.original_exercises) as original(exercise)
    left join public.exercises e on e.id = (original.exercise ->> 'exercise_id')::bigint
    where e.id is null or not e.is_active
  ) then
    raise exception using errcode = '22023', message = 'The original workout references an exercise that has since been retired, so it cannot be restored. Save the corrections instead.';
  end if;

  -- Discard every correction-time child row (sets cascade from their exercises).
  delete from public.session_exercises
  where session_id = p_session_id and owner_id = session_owner_id;

  -- Restore every stored, non-generated column so the original identities, provenance and legacy
  -- fields return unchanged. Ownership and parentage are forced to this session and owner.
  select string_agg(quote_ident(attribute.attname), ', ' order by attribute.attnum)
  into exercise_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.session_exercises'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = '';

  select string_agg(quote_ident(attribute.attname), ', ' order by attribute.attnum)
  into set_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.exercise_sets'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = '';

  execute format(
    'insert into public.session_exercises (%1$s) overriding system value '
    'select %1$s from jsonb_populate_recordset(null::public.session_exercises, $1)',
    exercise_columns
  )
  using (
    select coalesce(jsonb_agg(
      original.exercise
        || jsonb_build_object('owner_id', session_owner_id, 'session_id', p_session_id)
        -- The snapshot is not a foreign-key reference, so ON DELETE RESTRICT does not stop the owner
        -- deleting equipment that only the snapshot still names (possible through the API, not the app).
        -- Such a row cannot be re-linked; its equipment_name_snapshot is kept.
        || case
             when original.exercise ->> 'canonical_equipment_id' is not null
              and not exists (
                select 1 from public.equipment eq
                where eq.id = (original.exercise ->> 'canonical_equipment_id')::bigint
                  and eq.owner_id = session_owner_id
              )
             then jsonb_build_object('canonical_equipment_id', null)
             else '{}'::jsonb
           end
        -- Legacy pre-#22 link, kept for history and undo only.
        || case
             when original.exercise ->> 'gym_equipment_id' is not null
              and not exists (
                select 1 from public.gym_equipment ge
                where ge.id = (original.exercise ->> 'gym_equipment_id')::bigint
                  and ge.owner_id = session_owner_id
              )
             then jsonb_build_object('gym_equipment_id', null)
             else '{}'::jsonb
           end
    ), '[]'::jsonb)
    from jsonb_array_elements(snapshot_row.original_exercises) as original(exercise)
  );

  execute format(
    'insert into public.exercise_sets (%1$s) overriding system value '
    'select %1$s from jsonb_populate_recordset(null::public.exercise_sets, $1)',
    set_columns
  )
  using (
    select coalesce(jsonb_agg(
      original.exercise_set || jsonb_build_object('owner_id', session_owner_id)
    ), '[]'::jsonb)
    from jsonb_array_elements(snapshot_row.original_sets) as original(exercise_set)
  );

  update public.workout_sessions
  set status = 'completed',
      gym_id = (snapshot_row.original_session ->> 'gym_id')::bigint,
      performed_on = (snapshot_row.original_session ->> 'performed_on')::date,
      source_preset_name = snapshot_row.original_session ->> 'source_preset_name',
      source_preset_id = (
        select preset.id from public.workout_presets preset
        where preset.id = (snapshot_row.original_session ->> 'source_preset_id')::bigint
          and preset.owner_id = session_owner_id
      )
  where id = p_session_id and owner_id = session_owner_id and status = 'in_progress';

  delete from public.workout_session_reopen_snapshots
  where session_id = p_session_id and owner_id = session_owner_id;

  return true;
end;
$$;

-- Trigger: once a reopened session is completed again (conclude_workout_session or any other
-- completion path), its correction is canonical and the pre-correction snapshot is discarded.
create or replace function public.discard_reopen_snapshot_on_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.workout_session_reopen_snapshots
  where session_id = new.id and owner_id = new.owner_id;
  return new;
end;
$$;

create trigger discard_reopen_snapshot_on_completion
after update of status on public.workout_sessions
for each row
when (old.status = 'in_progress' and new.status = 'completed')
execute function public.discard_reopen_snapshot_on_completion();

revoke all on function public.delete_completed_workout_session(bigint) from public, anon;
revoke all on function public.reopen_workout_session(bigint) from public, anon;
revoke all on function public.cancel_workout_session(bigint) from public, anon;
revoke all on function public.discard_reopen_snapshot_on_completion() from public, anon, authenticated;

grant execute on function public.delete_completed_workout_session(bigint) to authenticated;
grant execute on function public.reopen_workout_session(bigint) to authenticated;
grant execute on function public.cancel_workout_session(bigint) to authenticated;

comment on table public.workout_session_reopen_snapshots is
  'Owner-scoped pre-correction copy of a reopened completed session. Exists only while the reopened session is in progress; cancel restores it, completion discards it.';
comment on function public.delete_completed_workout_session(bigint) is
  'Deletes one completed session owned by the caller; its exercises and sets cascade.';
comment on function public.reopen_workout_session(bigint) is
  'Returns one completed owner session to in_progress for live-workout correction after snapshotting it. Blocked while another workout is in progress. Preserves performed_on and created_at.';
comment on function public.cancel_workout_session(bigint) is
  'Deletes a normal in-progress workout, or restores a reopened completed session from its snapshot.';

commit;
