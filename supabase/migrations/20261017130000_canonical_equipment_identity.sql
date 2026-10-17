-- Migration: canonical_equipment_identity (issue #22, step 1 of 2)
-- Equipment identity no longer contains the gym. One owner-scoped canonical equipment record exists per
-- real piece of equipment; gyms only record where a machine is available. Historical rows keep their
-- legacy gym_equipment_id and equipment_name_snapshot untouched, and every merge is logged so
-- heracles_private.issue22_undo_canonical_equipment() can reverse this step.

begin;

-- Private bookkeeping schema: not exposed through the Data API and not readable by app roles.
create schema if not exists heracles_private;
revoke all on schema heracles_private from public;
revoke all on schema heracles_private from anon, authenticated;

create table heracles_private.issue22_step_state (
  step text primary key check (step in ('canonical_equipment', 'exercise_identity')),
  status text not null check (status in ('applied', 'undone')),
  changed_at timestamptz not null default now()
);

create table heracles_private.issue22_replaced_functions (
  signature text primary key,
  step text not null check (step in ('canonical_equipment', 'exercise_identity')),
  definition text not null,
  captured_at timestamptz not null default now()
);

create table heracles_private.issue22_equipment_map (
  gym_equipment_id bigint primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  gym_id bigint not null,
  old_name text not null,
  old_is_active boolean not null,
  equipment_id bigint not null,
  reason text not null check (reason in ('generic', 'unknown_model_per_gym', 'same_name', 'same_machine_user_confirmed')),
  mapped_at timestamptz not null default now()
);

create table heracles_private.issue22_created_equipment (
  equipment_id bigint primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  step text not null check (step in ('canonical_equipment', 'exercise_identity')),
  created_at timestamptz not null default now()
);

-- Canonical equipment identity: owner-scoped and independent of gyms.
create table public.equipment (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (
    char_length(name) <= 100
    and name = regexp_replace(btrim(name), '\s+', ' ', 'g')
    and name <> ''
  ),
  kind text not null check (kind in ('generic', 'machine', 'unknown_model')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index equipment_owner_lower_name_idx
  on public.equipment (owner_id, lower(name));

comment on table public.equipment is
  'Owner-scoped canonical equipment identity. One row per real piece of equipment; never per gym.';
comment on column public.equipment.kind is
  'generic = free-weight implement or bodyweight usable at every gym; machine = a specific machine model; unknown_model = placeholder for a machine whose model was not recorded and should be corrected.';

-- Gym availability is location metadata, not identity.
create table public.equipment_gym_availability (
  owner_id uuid not null references auth.users(id) on delete cascade,
  equipment_id bigint not null,
  gym_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (equipment_id, gym_id),
  foreign key (equipment_id, owner_id)
    references public.equipment(id, owner_id)
    on delete cascade,
  foreign key (gym_id, owner_id)
    references public.gyms(id, owner_id)
    on delete cascade
);

create index equipment_gym_availability_gym_owner_idx
  on public.equipment_gym_availability (gym_id, owner_id);
create index equipment_gym_availability_equipment_owner_idx
  on public.equipment_gym_availability (equipment_id, owner_id);

comment on table public.equipment_gym_availability is
  'Which gyms a canonical machine is available at. Generic implements never need a row here.';

create function public.enforce_equipment_availability_kind()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.equipment e
    where e.id = new.equipment_id
      and e.owner_id = new.owner_id
      and e.kind = 'generic'
  ) then
    raise exception using errcode = '22023', message = 'Generic equipment is available at every gym and cannot be tied to one gym.';
  end if;
  return new;
end;
$$;

create trigger equipment_gym_availability_kind_check
  before insert or update on public.equipment_gym_availability
  for each row execute function public.enforce_equipment_availability_kind();

create function public.enforce_generic_equipment_has_no_gym()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind = 'generic' and exists (
    select 1
    from public.equipment_gym_availability a
    where a.equipment_id = new.id
      and a.owner_id = new.owner_id
  ) then
    raise exception using errcode = '22023', message = 'Generic equipment is available at every gym and cannot be tied to one gym.';
  end if;
  return new;
end;
$$;

create trigger equipment_generic_kind_check
  before update of kind on public.equipment
  for each row execute function public.enforce_generic_equipment_has_no_gym();

alter table public.equipment enable row level security;
alter table public.equipment_gym_availability enable row level security;

create policy "Users can view their own equipment"
  on public.equipment for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can create their own equipment"
  on public.equipment for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can update their own equipment"
  on public.equipment for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can delete their own equipment"
  on public.equipment for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

create policy "Users can view their own equipment availability"
  on public.equipment_gym_availability for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can create their own equipment availability"
  on public.equipment_gym_availability for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can update their own equipment availability"
  on public.equipment_gym_availability for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can delete their own equipment availability"
  on public.equipment_gym_availability for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

revoke all on public.equipment from anon;
revoke all on public.equipment_gym_availability from anon;
grant select, insert, update, delete on public.equipment to authenticated;
grant select, insert, update, delete on public.equipment_gym_availability to authenticated;
grant usage, select on sequence public.equipment_id_seq to authenticated;

-- Performed exercises reference canonical equipment separately from the exercise identity.
alter table public.session_exercises
  add column canonical_equipment_id bigint;

alter table public.session_exercises
  add constraint session_exercises_canonical_equipment_fk
    foreign key (canonical_equipment_id, owner_id)
    references public.equipment(id, owner_id)
    on delete restrict;

create index session_exercises_canonical_equipment_owner_idx
  on public.session_exercises (canonical_equipment_id, owner_id);

comment on column public.session_exercises.canonical_equipment_id is
  'Canonical equipment used for this occurrence. Independent of exercise identity and of the gym; null when not recorded.';
comment on column public.session_exercises.gym_equipment_id is
  'Legacy gym-scoped equipment reference kept for history and undo. New writes use canonical_equipment_id.';
comment on column public.session_exercises.equipment_name_snapshot is
  'Historical name snapshot of the equipment used, preserved even if the equipment entity is renamed or merged.';
comment on table public.gym_equipment is
  'Legacy gym-scoped equipment rows (pre issue #22). Superseded by public.equipment and public.equipment_gym_availability; kept read-only for history and undo.';

-- Canonical naming rules shared by the migration and create_or_get_equipment().
create function public.canonical_equipment_identity(p_name text, p_gym_name text default null)
returns table (kind text, name text)
language sql
immutable
set search_path = ''
as $$
  with input as (
    select
      regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g') as normalized,
      nullif(regexp_replace(btrim(coalesce(p_gym_name, '')), '\s+', ' ', 'g'), '') as gym_name
  ), classified as (
    select
      normalized,
      gym_name,
      case lower(normalized)
        when 'dumbbell' then 'Dumbbell'
        when 'dumbbells' then 'Dumbbell'
        when 'barbell' then 'Barbell'
        when 'ez bar' then 'EZ Bar'
        when 'ez-bar' then 'EZ Bar'
        when 'bodyweight' then 'Bodyweight'
        when 'body weight' then 'Bodyweight'
      end as generic_name,
      case lower(normalized)
        when 'machine' then 'Machine'
        when 'cable' then 'Cable'
        when 'cable machine' then 'Cable'
        when 'smith machine' then 'Smith Machine'
        when 'leg press' then 'Leg Press'
        when 'leg press machine' then 'Leg Press'
        when 'pec deck' then 'Pec Deck'
        when 'pec deck machine' then 'Pec Deck'
        when 't-bar' then 'T-Bar'
        when 't bar' then 'T-Bar'
      end as unknown_model_type
    from input
  )
  select
    case
      when generic_name is not null then 'generic'
      when unknown_model_type is not null or lower(normalized) like '%(unknown model)%' then 'unknown_model'
      else 'machine'
    end,
    case
      when generic_name is not null then generic_name
      when unknown_model_type is not null then
        btrim(left(unknown_model_type || ' (unknown model)' || coalesce(' — ' || gym_name, ''), 100))
      else normalized
    end
  from classified;
$$;

comment on function public.canonical_equipment_identity(text, text) is
  'Canonical kind and name for an equipment label. Generic implements share one name; bare machine-type words become a per-gym "(unknown model)" placeholder.';

-- Idempotent data step: maps every not-yet-mapped legacy gym_equipment row to canonical equipment.
create function heracles_private.issue22_canonicalize_gym_equipment()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  mapped_count integer;
begin
  drop table if exists pg_temp.issue22_equipment_plan;

  create temporary table issue22_equipment_plan on commit drop as
  with legacy as (
    select
      ge.id as gym_equipment_id,
      ge.owner_id,
      ge.gym_id,
      ge.name as old_name,
      ge.is_active as old_is_active,
      ge.created_at,
      g.name as gym_name,
      identity.kind,
      identity.name as identity_name
    from public.gym_equipment ge
    join public.gyms g on g.id = ge.gym_id and g.owner_id = ge.owner_id
    cross join lateral public.canonical_equipment_identity(ge.name, g.name) as identity
    where not exists (
      select 1 from heracles_private.issue22_equipment_map m where m.gym_equipment_id = ge.id
    )
  ), confirmed_same_machine(from_name, to_name) as (
    -- Same physical machine recorded under two spellings; confirmed by the user on 2026-10-17.
    values
      ('prime extreme row', 'Prime Extreme Row P-122'),
      ('prime leg extension plate loaded', 'Prime Leg Extension P-105')
  ), resolved as (
    select
      legacy.*,
      case
        when legacy.kind = 'machine' and target.to_name is not null then target.to_name
        else legacy.identity_name
      end as canonical_name,
      case
        when legacy.kind = 'generic' then 'generic'
        when legacy.kind = 'unknown_model' then 'unknown_model_per_gym'
        when target.to_name is not null then 'same_machine_user_confirmed'
        else 'same_name'
      end as reason
    from legacy
    left join confirmed_same_machine target
      on legacy.kind = 'machine'
     and lower(legacy.identity_name) = target.from_name
     and (
       exists (
         select 1 from public.gym_equipment sibling
         where sibling.owner_id = legacy.owner_id
           and lower(regexp_replace(btrim(sibling.name), '\s+', ' ', 'g')) = lower(target.to_name)
       )
       or exists (
         select 1 from public.equipment existing
         where existing.owner_id = legacy.owner_id
           and lower(existing.name) = lower(target.to_name)
       )
     )
  )
  select
    resolved.*,
    first_value(resolved.canonical_name) over (
      partition by resolved.owner_id, lower(resolved.canonical_name)
      order by (resolved.reason = 'same_machine_user_confirmed'), resolved.created_at, resolved.gym_equipment_id
    ) as display_name
  from resolved;

  with inserted as (
    insert into public.equipment (owner_id, name, kind, is_active, created_at)
    select
      plan.owner_id,
      min(plan.display_name),
      min(plan.kind),
      bool_or(plan.old_is_active),
      min(plan.created_at)
    from pg_temp.issue22_equipment_plan plan
    group by plan.owner_id, lower(plan.canonical_name)
    on conflict (owner_id, lower(name)) do nothing
    returning id, owner_id
  )
  insert into heracles_private.issue22_created_equipment (equipment_id, owner_id, step)
  select id, owner_id, 'canonical_equipment' from inserted;

  insert into heracles_private.issue22_equipment_map (
    gym_equipment_id, owner_id, gym_id, old_name, old_is_active, equipment_id, reason
  )
  select
    plan.gym_equipment_id,
    plan.owner_id,
    plan.gym_id,
    plan.old_name,
    plan.old_is_active,
    e.id,
    plan.reason
  from pg_temp.issue22_equipment_plan plan
  join public.equipment e
    on e.owner_id = plan.owner_id
   and lower(e.name) = lower(plan.canonical_name);

  get diagnostics mapped_count = row_count;

  insert into public.equipment_gym_availability (owner_id, equipment_id, gym_id)
  select distinct m.owner_id, m.equipment_id, m.gym_id
  from heracles_private.issue22_equipment_map m
  join public.equipment e on e.id = m.equipment_id and e.owner_id = m.owner_id
  where e.kind <> 'generic'
  on conflict (equipment_id, gym_id) do nothing;

  update public.session_exercises se
  set canonical_equipment_id = m.equipment_id
  from heracles_private.issue22_equipment_map m
  where se.gym_equipment_id = m.gym_equipment_id
    and se.owner_id = m.owner_id
    and se.canonical_equipment_id is null;

  return mapped_count;
end;
$$;

-- Keep the replaced RPC definitions so the undo can restore them exactly. They are captured with an empty
-- search_path so every type and relation in the stored definition is schema-qualified.
do $$
declare
  saved_search_path text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);

  insert into heracles_private.issue22_replaced_functions (signature, step, definition)
  select
    format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)),
    'canonical_equipment',
    pg_catalog.pg_get_functiondef(p.oid)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.oid in (
    'public.create_or_get_gym_equipment(bigint, text)'::regprocedure,
    'public.add_session_exercise(bigint, bigint, bigint)'::regprocedure,
    'public.start_or_resume_workout_session(bigint, bigint)'::regprocedure,
    'public.update_session_history_exercise(bigint, text, jsonb)'::regprocedure
  );

  perform set_config('search_path', saved_search_path, true);

  if (select count(*) from heracles_private.issue22_replaced_functions where step = 'canonical_equipment') <> 4 then
    raise exception 'Expected to capture four replaced function definitions';
  end if;
end
$$;

select heracles_private.issue22_canonicalize_gym_equipment();

-- New gym-independent equipment creation. Reuses an existing record with the same canonical name.
drop function public.create_or_get_gym_equipment(bigint, text);

create function public.create_or_get_equipment(
  p_name text,
  p_gym_id bigint default null
)
returns public.equipment
language plpgsql
security invoker
set search_path = ''
as $$
declare
  equipment_owner_id uuid := (select auth.uid());
  selected_gym_name text := null;
  canonical_kind text;
  canonical_name text;
  equipment_record public.equipment;
begin
  if equipment_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if p_gym_id is not null then
    select name into selected_gym_name
    from public.gyms
    where id = p_gym_id and owner_id = equipment_owner_id;

    if not found then
      raise exception using errcode = '42501', message = 'Gym not found or not owned by the current user.';
    end if;
  end if;

  select identity.kind, identity.name
  into canonical_kind, canonical_name
  from public.canonical_equipment_identity(p_name, selected_gym_name) as identity;

  if canonical_name is null or canonical_name = '' or char_length(canonical_name) > 100 then
    raise exception using errcode = '22023', message = 'Equipment name must contain 1 to 100 characters.';
  end if;

  select * into equipment_record
  from public.equipment
  where owner_id = equipment_owner_id
    and lower(name) = lower(canonical_name);

  if not found then
    insert into public.equipment (owner_id, name, kind)
    values (equipment_owner_id, canonical_name, canonical_kind)
    on conflict (owner_id, lower(name)) do nothing
    returning * into equipment_record;

    if not found then
      select * into equipment_record
      from public.equipment
      where owner_id = equipment_owner_id
        and lower(name) = lower(canonical_name);
    end if;
  elsif not equipment_record.is_active then
    update public.equipment
    set is_active = true
    where id = equipment_record.id and owner_id = equipment_owner_id
    returning * into equipment_record;
  end if;

  if p_gym_id is not null and equipment_record.kind <> 'generic' then
    insert into public.equipment_gym_availability (owner_id, equipment_id, gym_id)
    values (equipment_owner_id, equipment_record.id, p_gym_id)
    on conflict (equipment_id, gym_id) do nothing;
  end if;

  return equipment_record;
end;
$$;

-- add_session_exercise: same contract, canonical equipment instead of gym-scoped equipment.
drop function public.add_session_exercise(bigint, bigint, bigint);

create function public.add_session_exercise(
  p_session_id bigint,
  p_exercise_id bigint,
  p_equipment_id bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_owner_id uuid := (select auth.uid());
  session_record public.workout_sessions;
  resolved_equipment_id bigint := null;
  equip_name_snapshot text := null;
  next_order integer;
  new_exercise_record public.session_exercises;
  new_set_record public.exercise_sets;
begin
  if session_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  -- Lock the session row to prevent race conditions during concurrent additions
  select * into session_record
  from public.workout_sessions
  where id = p_session_id and owner_id = session_owner_id and status = 'in_progress'
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Active session not found or not owned by current user.';
  end if;

  if not exists (
    select 1 from public.exercises where id = p_exercise_id
  ) then
    raise exception using errcode = '22023', message = 'Exercise not found in catalogue.';
  end if;

  if p_equipment_id is not null then
    select e.name into equip_name_snapshot
    from public.equipment e
    where e.id = p_equipment_id
      and e.owner_id = session_owner_id
      and e.is_active
      and (
        e.kind = 'generic'
        or exists (
          select 1
          from public.equipment_gym_availability a
          where a.equipment_id = e.id
            and a.owner_id = session_owner_id
            and a.gym_id = session_record.gym_id
        )
      );

    if not found then
      raise exception using errcode = '42501', message = 'Equipment not found, inactive, or not available at the session gym.';
    end if;
    resolved_equipment_id := p_equipment_id;
  else
    -- Default to the canonical equipment last used for this exercise at this gym.
    select se_hist.canonical_equipment_id, e.name
    into resolved_equipment_id, equip_name_snapshot
    from public.session_exercises se_hist
    join public.workout_sessions ws_hist
      on ws_hist.id = se_hist.session_id and ws_hist.owner_id = se_hist.owner_id
    join public.equipment e
      on e.id = se_hist.canonical_equipment_id and e.owner_id = session_owner_id
    where ws_hist.owner_id = session_owner_id
      and ws_hist.gym_id = session_record.gym_id
      and ws_hist.status = 'completed'
      and se_hist.exercise_id = p_exercise_id
      and se_hist.canonical_equipment_id is not null
    order by
      ws_hist.performed_on desc,
      ws_hist.created_at desc,
      ws_hist.id desc,
      se_hist.exercise_order desc,
      se_hist.id desc
    limit 1;
  end if;

  select coalesce(max(exercise_order), 0) + 1 into next_order
  from public.session_exercises
  where session_id = p_session_id and owner_id = session_owner_id;

  insert into public.session_exercises (
    owner_id,
    session_id,
    exercise_order,
    exercise_id,
    canonical_equipment_id,
    equipment_name_snapshot
  )
  values (
    session_owner_id,
    p_session_id,
    next_order,
    p_exercise_id,
    resolved_equipment_id,
    equip_name_snapshot
  )
  returning * into new_exercise_record;

  insert into public.exercise_sets (
    owner_id,
    session_exercise_id,
    set_number,
    weight,
    reps,
    is_warmup,
    reported_rir_bucket,
    rir_source
  )
  values (
    session_owner_id,
    new_exercise_record.id,
    1,
    null,
    null,
    false,
    null,
    null
  )
  returning * into new_set_record;

  return jsonb_build_object(
    'id', new_exercise_record.id,
    'session_id', new_exercise_record.session_id,
    'exercise_order', new_exercise_record.exercise_order,
    'exercise_id', new_exercise_record.exercise_id,
    'canonical_equipment_id', new_exercise_record.canonical_equipment_id,
    'equipment_name_snapshot', new_exercise_record.equipment_name_snapshot,
    'initial_set_id', new_set_record.id
  );
end;
$$;

-- start_or_resume_workout_session: preset starts copy the canonical equipment last used at this gym.
create or replace function public.start_or_resume_workout_session(
  p_gym_id bigint default null,
  p_preset_id bigint default null
)
returns public.workout_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_owner_id uuid := (select auth.uid());
  active_session public.workout_sessions;
  preset_name_snapshot text;
  created_session boolean;
begin
  if session_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select * into active_session
  from public.workout_sessions
  where owner_id = session_owner_id and status = 'in_progress'
  limit 1;

  if found then
    return active_session;
  end if;

  if p_gym_id is null then
    raise exception using errcode = '22023', message = 'A gym is required to start a new workout session.';
  end if;

  if not exists (
    select 1 from public.gyms where id = p_gym_id and owner_id = session_owner_id
  ) then
    raise exception using errcode = '42501', message = 'Gym not found or not owned by the current user.';
  end if;

  if p_preset_id is not null then
    select name into preset_name_snapshot
    from public.workout_presets
    where id = p_preset_id and owner_id = session_owner_id;

    if not found then
      raise exception using errcode = '42501', message = 'Preset not found or not owned by the current user.';
    end if;

    if not exists (
      select 1 from public.workout_preset_exercises
      where preset_id = p_preset_id and owner_id = session_owner_id
    ) then
      raise exception using errcode = '22023', message = 'The selected preset has no exercises.';
    end if;
  end if;

  insert into public.workout_sessions (
    owner_id, gym_id, performed_on, status, source_preset_id, source_preset_name
  )
  values (
    session_owner_id, p_gym_id, current_date, 'in_progress', p_preset_id, preset_name_snapshot
  )
  on conflict (owner_id) where status = 'in_progress' do nothing
  returning * into active_session;
  created_session := found;

  if not created_session then
    select * into active_session
    from public.workout_sessions
    where owner_id = session_owner_id and status = 'in_progress';
    return active_session;
  end if;

  if p_preset_id is not null then
    with randomized_exercises as (
      select
        membership.exercise_id,
        row_number() over (order by random())::integer as exercise_order
      from public.workout_preset_exercises as membership
      where membership.preset_id = p_preset_id
        and membership.owner_id = session_owner_id
    ), resolved_equipment as (
      select
        re.exercise_id,
        re.exercise_order,
        (
          select se_hist.canonical_equipment_id
          from public.session_exercises se_hist
          join public.workout_sessions ws_hist
            on ws_hist.id = se_hist.session_id and ws_hist.owner_id = se_hist.owner_id
          where ws_hist.owner_id = session_owner_id
            and ws_hist.gym_id = p_gym_id
            and ws_hist.status = 'completed'
            and se_hist.exercise_id = re.exercise_id
            and se_hist.canonical_equipment_id is not null
          order by
            ws_hist.performed_on desc,
            ws_hist.created_at desc,
            ws_hist.id desc,
            se_hist.exercise_order desc,
            se_hist.id desc
          limit 1
        ) as default_equipment_id
      from randomized_exercises re
    ), inserted_exercises as (
      insert into public.session_exercises (
        owner_id, session_id, exercise_order, exercise_id, canonical_equipment_id, equipment_name_snapshot
      )
      select
        session_owner_id,
        active_session.id,
        resolved.exercise_order,
        resolved.exercise_id,
        resolved.default_equipment_id,
        e.name
      from resolved_equipment as resolved
      left join public.equipment e
        on e.id = resolved.default_equipment_id
       and e.owner_id = session_owner_id
      returning id, exercise_id
    )
    insert into public.exercise_sets (
      owner_id, session_exercise_id, set_number, weight, reps, is_warmup, reported_rir_bucket, rir_source
    )
    select
      session_owner_id,
      inserted.id,
      generated.set_number::smallint,
      null,
      null,
      false,
      null,
      null
    from inserted_exercises as inserted
    join public.workout_preset_exercises as membership
      on membership.preset_id = p_preset_id
     and membership.owner_id = session_owner_id
     and membership.exercise_id = inserted.exercise_id
    cross join lateral generate_series(1, membership.set_count) as generated(set_number);
  end if;

  return active_session;
end;
$$;

-- Session History corrections select canonical equipment instead of editing the legacy free-text field.
drop function public.update_session_history_exercise(bigint, text, jsonb);

create function public.update_session_history_exercise(
  p_session_exercise_id bigint,
  p_canonical_equipment_id bigint,
  p_set_updates jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  correction_owner_id uuid := (select auth.uid());
  submitted_updates jsonb := coalesce(p_set_updates, '[]'::jsonb);
  target_exercise public.session_exercises;
  selected_equipment_name text := null;
  submitted_set_count integer;
  existing_set_count integer;
  saved_payload jsonb;
begin
  if correction_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if jsonb_typeof(submitted_updates) <> 'array' then
    raise exception using errcode = '22023', message = 'Set updates must be a JSON array.';
  end if;

  select se.* into target_exercise
  from public.session_exercises se
  join public.workout_sessions ws
    on ws.id = se.session_id
   and ws.owner_id = se.owner_id
  where se.id = p_session_exercise_id
    and se.owner_id = correction_owner_id
    and ws.status = 'completed'
  for update of se;

  if not found then
    raise exception using errcode = '42501', message = 'Completed session exercise not found or not owned by the current user.';
  end if;

  if p_canonical_equipment_id is not null then
    select e.name into selected_equipment_name
    from public.equipment e
    where e.id = p_canonical_equipment_id
      and e.owner_id = correction_owner_id;

    if not found then
      raise exception using errcode = '42501', message = 'Equipment not found or not owned by the current user.';
    end if;
  end if;

  -- Lock the current child set collection so validation and mutation use one stable snapshot.
  perform 1
  from public.exercise_sets es
  where es.session_exercise_id = p_session_exercise_id
    and es.owner_id = correction_owner_id
  for update;

  select jsonb_array_length(submitted_updates) into submitted_set_count;

  select count(*)::integer into existing_set_count
  from public.exercise_sets es
  where es.session_exercise_id = p_session_exercise_id
    and es.owner_id = correction_owner_id;

  -- Parse every submitted row before mutating anything. Invalid JSON field types fail here.
  if exists (
    select 1
    from jsonb_to_recordset(submitted_updates) as submitted(
      id bigint,
      weight numeric,
      reps integer,
      is_warmup boolean,
      reported_rir_bucket smallint
    )
    where submitted.id is null
       or submitted.is_warmup is null
       or (submitted.weight is not null and submitted.weight < 0)
       or (submitted.reps is not null and submitted.reps < 0)
       or (
         submitted.reported_rir_bucket is not null
         and (submitted.reported_rir_bucket < 0 or submitted.reported_rir_bucket > 4)
       )
       or (submitted.is_warmup and submitted.reported_rir_bucket is not null)
       or (not submitted.is_warmup and submitted.reported_rir_bucket is null)
  ) then
    raise exception using errcode = '22023', message = 'One or more submitted set values are invalid.';
  end if;

  if exists (
    select submitted.id
    from jsonb_to_recordset(submitted_updates) as submitted(id bigint)
    group by submitted.id
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Duplicate set IDs are not allowed.';
  end if;

  if submitted_set_count <> existing_set_count
     or exists (
       select 1
       from jsonb_to_recordset(submitted_updates) as submitted(id bigint)
       left join public.exercise_sets es
         on es.id = submitted.id
        and es.session_exercise_id = p_session_exercise_id
        and es.owner_id = correction_owner_id
       where es.id is null
     ) then
    raise exception using errcode = '22023', message = 'Submitted set IDs do not exactly match the current exercise sets.';
  end if;

  -- An unchanged selection keeps the historical name snapshot.
  update public.session_exercises
  set canonical_equipment_id = p_canonical_equipment_id,
      equipment_name_snapshot = case
        when p_canonical_equipment_id is not distinct from target_exercise.canonical_equipment_id
          then target_exercise.equipment_name_snapshot
        else selected_equipment_name
      end
  where id = p_session_exercise_id
    and owner_id = correction_owner_id
  returning * into target_exercise;

  with submitted as (
    select *
    from jsonb_to_recordset(submitted_updates) as parsed(
      id bigint,
      weight numeric,
      reps integer,
      is_warmup boolean,
      reported_rir_bucket smallint
    )
  )
  update public.exercise_sets es
  set weight = submitted.weight,
      reps = submitted.reps,
      is_warmup = submitted.is_warmup,
      reported_rir_bucket = submitted.reported_rir_bucket,
      rir_source = case when submitted.is_warmup then null else 'user_entered' end
  from submitted
  where es.id = submitted.id
    and es.session_exercise_id = p_session_exercise_id
    and es.owner_id = correction_owner_id;

  select jsonb_build_object(
    'id', target_exercise.id,
    'canonical_equipment_id', target_exercise.canonical_equipment_id,
    'equipment_name_snapshot', target_exercise.equipment_name_snapshot,
    'sets', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', es.id,
          'weight', es.weight,
          'reps', es.reps,
          'is_warmup', es.is_warmup,
          'reported_rir_bucket', es.reported_rir_bucket,
          'rir_source', es.rir_source,
          'estimated_1rm_brzycki', es.estimated_1rm_brzycki,
          'estimated_1rm_epley', es.estimated_1rm_epley,
          'estimated_1rm_brzycki_rir_adjusted', es.estimated_1rm_brzycki_rir_adjusted,
          'estimated_1rm_epley_rir_adjusted', es.estimated_1rm_epley_rir_adjusted
        ) order by es.set_number, es.id
      ) filter (where es.id is not null),
      '[]'::jsonb
    )
  ) into saved_payload
  from public.exercise_sets es
  where es.session_exercise_id = p_session_exercise_id
    and es.owner_id = correction_owner_id;

  return saved_payload;
end;
$$;

revoke all on function public.canonical_equipment_identity(text, text) from public, anon;
revoke all on function public.create_or_get_equipment(text, bigint) from public, anon;
revoke all on function public.add_session_exercise(bigint, bigint, bigint) from public, anon;
revoke all on function public.start_or_resume_workout_session(bigint, bigint) from public, anon;
revoke all on function public.update_session_history_exercise(bigint, bigint, jsonb) from public, anon;
revoke all on function public.enforce_equipment_availability_kind() from public, anon;
revoke all on function public.enforce_generic_equipment_has_no_gym() from public, anon;

grant execute on function public.canonical_equipment_identity(text, text) to authenticated;
grant execute on function public.create_or_get_equipment(text, bigint) to authenticated;
grant execute on function public.add_session_exercise(bigint, bigint, bigint) to authenticated;
grant execute on function public.start_or_resume_workout_session(bigint, bigint) to authenticated;
grant execute on function public.update_session_history_exercise(bigint, bigint, jsonb) to authenticated;
grant execute on function public.enforce_equipment_availability_kind() to authenticated;
grant execute on function public.enforce_generic_equipment_has_no_gym() to authenticated;

-- Undo: restores the legacy gym-scoped model exactly. Run issue22_undo_exercise_identity() first.
create function heracles_private.issue22_undo_canonical_equipment()
returns void
language plpgsql
set search_path = ''
as $$
declare
  replaced record;
begin
  if not exists (
    select 1 from heracles_private.issue22_step_state
    where step = 'canonical_equipment' and status = 'applied'
  ) then
    raise exception 'Issue #22 canonical equipment step is not applied.';
  end if;

  if exists (
    select 1 from heracles_private.issue22_step_state
    where step = 'exercise_identity' and status = 'applied'
  ) then
    raise exception 'Undo the issue #22 exercise identity step first.';
  end if;

  -- Entries whose canonical equipment no longer matches their legacy reference (new entries and later
  -- edits) get a legacy gym-scoped row for that gym, reusing an existing one with the same name.
  drop table if exists pg_temp.issue22_undo_targets;
  create temporary table issue22_undo_targets on commit drop as
  select
    se.id as session_exercise_id,
    se.owner_id,
    ws.gym_id,
    e.id as equipment_id,
    e.name as equipment_name
  from public.session_exercises se
  join public.workout_sessions ws on ws.id = se.session_id and ws.owner_id = se.owner_id
  join public.equipment e on e.id = se.canonical_equipment_id and e.owner_id = se.owner_id
  where not exists (
    select 1
    from heracles_private.issue22_equipment_map m
    where m.gym_equipment_id = se.gym_equipment_id
      and m.equipment_id = se.canonical_equipment_id
  );

  insert into public.gym_equipment (owner_id, gym_id, name)
  select distinct t.owner_id, t.gym_id, t.equipment_name
  from pg_temp.issue22_undo_targets t
  where t.gym_id is not null
    and not exists (
      select 1 from public.gym_equipment ge
      where ge.owner_id = t.owner_id
        and ge.gym_id = t.gym_id
        and lower(ge.name) = lower(t.equipment_name)
    )
    and not exists (
      select 1 from heracles_private.issue22_equipment_map m
      where m.owner_id = t.owner_id and m.gym_id = t.gym_id and m.equipment_id = t.equipment_id
    )
  on conflict do nothing;

  update public.session_exercises se
  set gym_equipment_id = coalesce(
    (
      select m.gym_equipment_id
      from heracles_private.issue22_equipment_map m
      where m.owner_id = t.owner_id and m.gym_id = t.gym_id and m.equipment_id = t.equipment_id
      order by m.gym_equipment_id
      limit 1
    ),
    (
      select ge.id
      from public.gym_equipment ge
      where ge.owner_id = t.owner_id
        and ge.gym_id = t.gym_id
        and lower(ge.name) = lower(t.equipment_name)
      limit 1
    )
  )
  from pg_temp.issue22_undo_targets t
  where se.id = t.session_exercise_id;

  -- Equipment cleared after the change is cleared in the legacy model too.
  update public.session_exercises
  set gym_equipment_id = null,
      equipment_name_snapshot = null
  where canonical_equipment_id is null
    and gym_equipment_id is not null;

  drop function public.create_or_get_equipment(text, bigint);
  drop function public.add_session_exercise(bigint, bigint, bigint);
  drop function public.update_session_history_exercise(bigint, bigint, jsonb);

  for replaced in
    select signature, definition
    from heracles_private.issue22_replaced_functions
    where step = 'canonical_equipment'
  loop
    execute replaced.definition;
    execute format('revoke all on function %s from public, anon', replaced.signature);
    execute format('grant execute on function %s to authenticated', replaced.signature);
  end loop;

  alter table public.session_exercises drop column canonical_equipment_id;
  drop table public.equipment_gym_availability;
  drop table public.equipment;
  drop function public.canonical_equipment_identity(text, text);
  drop function public.enforce_equipment_availability_kind();
  drop function public.enforce_generic_equipment_has_no_gym();

  comment on column public.session_exercises.gym_equipment_id is
    'Foreign key to gym_equipment; deletion is restricted if referenced by historical exercises.';
  comment on table public.gym_equipment is
    'Owner-scoped equipment entities associated with a specific gym.';

  update heracles_private.issue22_step_state
  set status = 'undone', changed_at = now()
  where step = 'canonical_equipment';
end;
$$;

revoke all on function heracles_private.issue22_canonicalize_gym_equipment() from public, anon, authenticated;
revoke all on function heracles_private.issue22_undo_canonical_equipment() from public, anon, authenticated;

insert into heracles_private.issue22_step_state (step, status)
values ('canonical_equipment', 'applied');

-- Integrity checks.
do $$
begin
  if exists (
    select 1 from public.gym_equipment ge
    where not exists (select 1 from heracles_private.issue22_equipment_map m where m.gym_equipment_id = ge.id)
  ) then
    raise exception 'Every legacy gym_equipment row must map to canonical equipment';
  end if;

  if exists (
    select 1 from public.session_exercises
    where gym_equipment_id is not null and canonical_equipment_id is null
  ) then
    raise exception 'Every legacy equipment reference must resolve to canonical equipment';
  end if;

  if exists (
    select 1 from public.equipment e
    join public.equipment_gym_availability a on a.equipment_id = e.id
    where e.kind = 'generic'
  ) then
    raise exception 'Generic equipment must not be tied to a gym';
  end if;
end
$$;

commit;
