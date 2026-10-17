begin;

-- Owner-scoped preference for ordering preset-started workouts (issue #78).
alter table public.user_settings
  add column preset_order_mode text not null default 'balanced_rotation',
  add column preset_order_alternate_muscle_groups boolean not null default true,
  add constraint user_settings_preset_order_mode_check
    check (preset_order_mode in ('balanced_rotation', 'muscle_group_priority'));

comment on column public.user_settings.preset_order_mode is
  'How preset-started workouts are ordered: balanced_rotation (default) or muscle_group_priority. A product decision about in-session order, not a hypertrophy claim.';
comment on column public.user_settings.preset_order_alternate_muscle_groups is
  'When true (default), preset-started workouts alternate exercises between main muscle groups where possible. Exercise-level only; sets of one exercise stay together.';

create table public.user_priority_muscle_groups (
  owner_id uuid not null references auth.users(id) on delete cascade,
  ui_muscle_group_id bigint not null references public.ui_muscle_groups(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (owner_id, ui_muscle_group_id)
);

create index user_priority_muscle_groups_ui_muscle_group_idx
  on public.user_priority_muscle_groups (ui_muscle_group_id);

alter table public.user_priority_muscle_groups enable row level security;

create policy "Users can view their own priority muscle groups"
  on public.user_priority_muscle_groups for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can add their own priority muscle groups"
  on public.user_priority_muscle_groups for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "Users can remove their own priority muscle groups"
  on public.user_priority_muscle_groups for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

revoke all on table public.user_priority_muscle_groups from anon, authenticated;
grant select, insert, delete on table public.user_priority_muscle_groups to authenticated;

comment on table public.user_priority_muscle_groups is
  'Owner-selected UI muscle groups whose exercises are placed first in preset-started workouts when preset_order_mode is muscle_group_priority.';

create function public.save_preset_order_preference(
  p_mode text,
  p_alternate_muscle_groups boolean,
  p_priority_muscle_group_ids bigint[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  preference_owner_id uuid := (select auth.uid());
  priority_ids bigint[] := coalesce(p_priority_muscle_group_ids, array[]::bigint[]);
begin
  if preference_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if p_mode is null or p_mode not in ('balanced_rotation', 'muscle_group_priority') then
    raise exception using errcode = '22023', message = 'Unknown preset order mode.';
  end if;

  if p_alternate_muscle_groups is null then
    raise exception using errcode = '22023', message = 'Choose whether to alternate exercises between muscle groups.';
  end if;

  if array_position(priority_ids, null) is not null
     or exists (
       select 1 from unnest(priority_ids) as selected(id)
       where not exists (select 1 from public.ui_muscle_groups ui_group where ui_group.id = selected.id)
     ) then
    raise exception using errcode = '22023', message = 'Unknown priority muscle group.';
  end if;

  if p_mode = 'muscle_group_priority' and cardinality(priority_ids) = 0 then
    raise exception using errcode = '22023', message = 'Choose at least one priority muscle group.';
  end if;

  insert into public.user_settings (owner_id, preset_order_mode, preset_order_alternate_muscle_groups)
  values (preference_owner_id, p_mode, p_alternate_muscle_groups)
  on conflict (owner_id) do update
    set preset_order_mode = excluded.preset_order_mode,
        preset_order_alternate_muscle_groups = excluded.preset_order_alternate_muscle_groups,
        updated_at = now();

  delete from public.user_priority_muscle_groups
  where owner_id = preference_owner_id;

  insert into public.user_priority_muscle_groups (owner_id, ui_muscle_group_id)
  select distinct preference_owner_id, selected.id
  from unnest(priority_ids) as selected(id);
end;
$$;

revoke all on function public.save_preset_order_preference(text, boolean, bigint[]) from public, anon;
grant execute on function public.save_preset_order_preference(text, boolean, bigint[]) to authenticated;

-- Why a preset-started session begins in its order. Written once at session
-- start; historical sessions keep null.
alter table public.workout_sessions
  add column exercise_order_basis jsonb,
  add constraint workout_sessions_exercise_order_basis_check
    check (
      exercise_order_basis is null
      or (jsonb_typeof(exercise_order_basis) = 'object' and octet_length(exercise_order_basis::text) <= 16384)
    );

comment on column public.workout_sessions.exercise_order_basis is
  'Structured explanation of the starting exercise order of a preset-started session (mode, rotation source, priority groups). Null for scratch sessions and sessions created before ordering existed.';

-- Replace the random preset shuffle with a caller-supplied deterministic order
-- (computed by preset-ordering.js) or, without one, a stable alphabetical order.
-- This builds on issue #22's two-argument version: each preset exercise still
-- defaults to the canonical equipment last used for it at the selected gym.
do $$
begin
  if not exists (
    select 1 from heracles_private.issue22_step_state
    where step = 'canonical_equipment' and status = 'applied'
  ) then
    raise exception 'Issue #78 preset ordering requires the issue #22 canonical equipment step to be applied.';
  end if;
end
$$;

drop function public.start_or_resume_workout_session(bigint, bigint);

create function public.start_or_resume_workout_session(
  p_gym_id bigint default null,
  p_preset_id bigint default null,
  p_exercise_order bigint[] default null,
  p_exercise_order_basis jsonb default null
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
  order_basis jsonb;
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

  if p_preset_id is null and (p_exercise_order is not null or p_exercise_order_basis is not null) then
    raise exception using errcode = '22023', message = 'An exercise order can only be supplied for a preset workout.';
  end if;

  if p_exercise_order_basis is not null and p_exercise_order is null then
    raise exception using errcode = '22023', message = 'An exercise order basis requires an exercise order.';
  end if;

  if p_exercise_order_basis is not null and jsonb_typeof(p_exercise_order_basis) <> 'object' then
    raise exception using errcode = '22023', message = 'The exercise order basis must be a JSON object.';
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

    if p_exercise_order is not null and (
      array_position(p_exercise_order, null) is not null
      or exists (
        select 1 from unnest(p_exercise_order) as supplied(exercise_id)
        group by supplied.exercise_id having count(*) > 1
      )
      or cardinality(p_exercise_order) <> (
        select count(*) from public.workout_preset_exercises
        where preset_id = p_preset_id and owner_id = session_owner_id
      )
      or exists (
        select 1 from public.workout_preset_exercises as membership
        where membership.preset_id = p_preset_id
          and membership.owner_id = session_owner_id
          and not (membership.exercise_id = any(p_exercise_order))
      )
    ) then
      raise exception using errcode = '22023', message = 'The supplied exercise order does not match the preset exercises.';
    end if;

    order_basis := case
      when p_exercise_order is null then jsonb_build_object('version', 1, 'strategy', 'server_alphabetical')
      else p_exercise_order_basis
    end;
  end if;

  insert into public.workout_sessions (
    owner_id, gym_id, performed_on, status, source_preset_id, source_preset_name, exercise_order_basis
  )
  values (
    session_owner_id, p_gym_id, current_date, 'in_progress', p_preset_id, preset_name_snapshot, order_basis
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
    with ordered_exercises as (
      select
        membership.exercise_id,
        (case
          when p_exercise_order is null
            then row_number() over (order by exercise.name collate "C", exercise.id)
          else array_position(p_exercise_order, membership.exercise_id)
        end)::integer as exercise_order
      from public.workout_preset_exercises as membership
      join public.exercises as exercise
        on exercise.id = membership.exercise_id
      where membership.preset_id = p_preset_id
        and membership.owner_id = session_owner_id
    ), resolved_equipment as (
      select
        oe.exercise_id,
        oe.exercise_order,
        (
          select se_hist.canonical_equipment_id
          from public.session_exercises se_hist
          join public.workout_sessions ws_hist
            on ws_hist.id = se_hist.session_id and ws_hist.owner_id = se_hist.owner_id
          where ws_hist.owner_id = session_owner_id
            and ws_hist.gym_id = p_gym_id
            and ws_hist.status = 'completed'
            and se_hist.exercise_id = oe.exercise_id
            and se_hist.canonical_equipment_id is not null
          order by
            ws_hist.performed_on desc,
            ws_hist.created_at desc,
            ws_hist.id desc,
            se_hist.exercise_order desc,
            se_hist.id desc
          limit 1
        ) as default_equipment_id
      from ordered_exercises oe
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

revoke all on function public.start_or_resume_workout_session(bigint, bigint, bigint[], jsonb) from public, anon;
grant execute on function public.start_or_resume_workout_session(bigint, bigint, bigint[], jsonb) to authenticated;

comment on function public.start_or_resume_workout_session(bigint, bigint, bigint[], jsonb) is
  'Resumes the active session or starts one. Preset sessions use the supplied deterministic exercise order (a permutation of the preset exercises) or, without one, alphabetical order by exercise name. Never random. Preset exercises default to the canonical equipment last used at the gym.';

-- Issue #22 undo interplay. heracles_private.issue22_undo_canonical_equipment()
-- re-creates the captured pre-#22 two-argument start function and drops the
-- canonical equipment columns this function reads. It does not know about the
-- four-argument replacement above, so without a guard an undo would leave two
-- overloads (ambiguous calls) and a function referencing dropped columns. When
-- that undo marks its step undone, drop the four-argument version so exactly
-- one start function remains: the legacy one the undo restored. The #22
-- migration itself is not modified.
create function heracles_private.issue78_after_issue22_equipment_undo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.step = 'canonical_equipment' and new.status = 'undone' and old.status = 'applied' then
    drop function if exists public.start_or_resume_workout_session(bigint, bigint, bigint[], jsonb);
  end if;
  return new;
end;
$$;

revoke all on function heracles_private.issue78_after_issue22_equipment_undo() from public, anon, authenticated;

create trigger issue78_after_issue22_equipment_undo
after update of status on heracles_private.issue22_step_state
for each row execute function heracles_private.issue78_after_issue22_equipment_undo();

commit;
