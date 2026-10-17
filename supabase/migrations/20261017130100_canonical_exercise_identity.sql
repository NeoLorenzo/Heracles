-- Migration: canonical_exercise_identity (issue #22, step 2 of 2)
-- Exercise names stop encoding equipment. Exercises that differed only by equipment merge into one
-- canonical exercise (the survivor keeps its id and code; merged rows are retired with their original
-- names and historical coefficients). New scientific versions are published for the canonical catalogue.
-- Performed exercises without recorded equipment receive the equipment their previous name stated.
-- Every change is logged so heracles_private.issue22_undo_exercise_identity() can reverse this step.
-- Decision record: docs/scientific/issue-22-canonical-exercise-identity.json

begin;

do $$
begin
  if not exists (
    select 1 from heracles_private.issue22_step_state
    where step = 'canonical_equipment' and status = 'applied'
  ) then
    raise exception 'Issue #22 canonical equipment step must be applied first';
  end if;

  if (select count(*) from public.movement_mapping_versions where is_current) <> 1
     or (select count(*) from public.exercise_muscle_mapping_versions where is_current) <> 1
     or (select count(*) from public.exercise_muscle_relevance_versions where is_current) <> 1
  then
    raise exception 'Expected exactly one current scientific mapping version per model';
  end if;
end
$$;

create table heracles_private.issue22_exercise_plan (
  old_name text primary key,
  new_name text not null,
  inferred_equipment text not null check (
    inferred_equipment in ('Dumbbell', 'Barbell', 'EZ Bar', 'Bodyweight', 'Machine', 'Cable', 'Smith Machine', 'Leg Press', 'Pec Deck', 'T-Bar')
  ),
  is_survivor boolean not null
);

-- old_name, canonical name, equipment the old name stated, survivor (keeps id/code and scoring source)
insert into heracles_private.issue22_exercise_plan (old_name, new_name, inferred_equipment, is_survivor)
values
    ('Back Extensions (Dumbbell)', 'Back Extensions', 'Dumbbell', true),
    ('Behind Back Wrist Curls (Cable) (Straight Bar)', 'Behind Back Wrist Curls (Straight Bar)', 'Cable', true),
    ('Belt Squat (Machine)', 'Belt Squat', 'Machine', true),
    ('Calf Raises (Leg Press Machine)', 'Calf Raises', 'Leg Press', true),
    ('Calf Raises (Machine) (Standing)', 'Calf Raises (Standing)', 'Machine', true),
    ('Chest Fly (Cable) (Bent Over Standing) (Horizontal)', 'Chest Fly (Bent Over Standing) (Horizontal)', 'Cable', true),
    ('Chest Fly (Cable) (Kneeling) (Horizontal)', 'Chest Fly (Kneeling) (Horizontal)', 'Cable', true),
    ('Chest Fly (Cable) (Seated) (Horizontal)', 'Chest Fly (Seated) (Horizontal)', 'Cable', true),
    ('Press (Barbell)', 'Chest Press', 'Barbell', true),
    ('Press (Cable) (Horizontal)', 'Chest Press', 'Cable', false),
    ('Press (Machine) (Horizontal)', 'Chest Press', 'Machine', false),
    ('Press (Machine) (Horizontal) (Plate Loaded)', 'Chest Press', 'Machine', false),
    ('Press (Smith Machine)', 'Chest Press', 'Smith Machine', false),
    ('Press (Smith Machine) (Incline 10)', 'Chest Press (Incline 10)', 'Smith Machine', true),
    ('Press (Barbell) (Incline 15)', 'Chest Press (Incline 15)', 'Barbell', true),
    ('Press (Dumbbell) (Incline 15)', 'Chest Press (Incline 15)', 'Dumbbell', false),
    ('Press (Barbell) (Incline 20)', 'Chest Press (Incline 20)', 'Barbell', true),
    ('Press (Dumbbell) (Incline 20)', 'Chest Press (Incline 20)', 'Dumbbell', false),
    ('Press (Barbell) (Incline 24)', 'Chest Press (Incline 24)', 'Barbell', true),
    ('Press (Dumbbell) (Incline 24)', 'Chest Press (Incline 24)', 'Dumbbell', false),
    ('Press (Barbell) (Incline 30)', 'Chest Press (Incline 30)', 'Barbell', true),
    ('Press (Dumbbell) (Incline 30)', 'Chest Press (Incline 30)', 'Dumbbell', false),
    ('Press (Smith Machine) (Incline 30)', 'Chest Press (Incline 30)', 'Smith Machine', false),
    ('Press (Barbell) (Incline 30) (Larson)', 'Chest Press (Incline 30) (Larson)', 'Barbell', true),
    ('Press (Dumbbell) (Incline 40)', 'Chest Press (Incline 40)', 'Dumbbell', true),
    ('Press (Machine) (Incline)', 'Chest Press (Incline)', 'Machine', true),
    ('Press (Machine) (Incline) (Plate Loaded)', 'Chest Press (Incline)', 'Machine', false),
    ('Press (Machine) (Incline) (Plate Loaded) (Close Neutral Grip)', 'Chest Press (Incline) (Close Neutral Grip)', 'Machine', true),
    ('Press (Barbell) (Larson)', 'Chest Press (Larson)', 'Barbell', true),
    ('Press (Smith Machine) (Larson)', 'Chest Press (Larson)', 'Smith Machine', false),
    ('Press (Barbell) (Paused)', 'Chest Press (Paused)', 'Barbell', true),
    ('Press (Barbell) (Spoto) (Paused)', 'Chest Press (Spoto) (Paused)', 'Barbell', true),
    ('Crunch (Machine)', 'Crunch', 'Machine', true),
    ('Curl (Cable) (Bayesian) (Unilateral)', 'Curl (Bayesian) (Unilateral)', 'Cable', true),
    ('Curl (Dumbbell) (Concentration) (Unilateral)', 'Curl (Concentration) (Unilateral)', 'Dumbbell', true),
    ('Curl (Cable) (EZ Bar Attachment)', 'Curl (EZ Bar Attachment)', 'Cable', true),
    ('Curl (Dumbbell) (Incline)', 'Curl (Incline)', 'Dumbbell', true),
    ('Curl (EZ Bar) (Preacher)', 'Curl (Preacher)', 'EZ Bar', true),
    ('Curl (Dumbbell) (Preacher) (Unilateral)', 'Curl (Preacher) (Unilateral)', 'Dumbbell', true),
    ('Curl (Machine) (Preacher) (Unilateral)', 'Curl (Preacher) (Unilateral)', 'Machine', false),
    ('Decline Weighted Sit Ups (Dumbbell)', 'Decline Weighted Sit Ups', 'Dumbbell', true),
    ('Dips (Machine)', 'Dips', 'Machine', true),
    ('Extension (Dumbbell) (Overhead)', 'Extension (Overhead)', 'Dumbbell', true),
    ('Extension (Cable) (Overhead) (Katana)', 'Extension (Overhead) (Katana)', 'Cable', true),
    ('Extension (Cable) (Overhead) (Unilateral)', 'Extension (Overhead) (Unilateral)', 'Cable', true),
    ('Extension (Dumbbell) (Overhead) (Unilateral)', 'Extension (Overhead) (Unilateral)', 'Dumbbell', false),
    ('Fly (Pec Deck Machine)', 'Fly', 'Pec Deck', true),
    ('Fly (Cable) (High-to-Low)', 'Fly (High-to-Low)', 'Cable', true),
    ('Fly (Cable) (Low-to-High)', 'Fly (Low-to-High)', 'Cable', true),
    ('Fly (Cable) (Low-to-High) (Unilateral)', 'Fly (Low-to-High) (Unilateral)', 'Cable', true),
    ('French Press (Machine)', 'French Press', 'Machine', true),
    ('French Press (Cable) (EZ Bar Attachment)', 'French Press (EZ Bar Attachment)', 'Cable', true),
    ('French Press (Cable) (V-Bar)', 'French Press (V-Bar)', 'Cable', true),
    ('Grip Squeeze (Machine)', 'Grip Squeeze', 'Machine', true),
    ('Grip Squeeze (Cable) (Unilateral)', 'Grip Squeeze (Unilateral)', 'Cable', true),
    ('Hack Squat (Machine)', 'Hack Squat', 'Machine', true),
    ('Hammer Curl (Dumbbell) (Alternating)', 'Hammer Curl (Alternating)', 'Dumbbell', true),
    ('Hammer Curl (Dumbbell) (Concentration) (Unilateral)', 'Hammer Curl (Concentration) (Unilateral)', 'Dumbbell', true),
    ('Hammer Curl (Dumbbell) (Preacher) (Unilateral)', 'Hammer Curl (Preacher) (Unilateral)', 'Dumbbell', true),
    ('Hammer Curl (Dumbbell) (Seated)', 'Hammer Curl (Seated)', 'Dumbbell', true),
    ('Hammer Curl (Cable) (Unilateral)', 'Hammer Curl (Unilateral)', 'Cable', true),
    ('Adductor Machine (Machine)', 'Hip Adduction', 'Machine', true),
    ('Adductor Machine (Machine) (Unilateral)', 'Hip Adduction (Unilateral)', 'Machine', true),
    ('Hip Thrust (Machine)', 'Hip Thrust', 'Machine', true),
    ('JM Press (Cable) (Unilateral)', 'JM Press (Unilateral)', 'Cable', true),
    ('Kelso Shrug (Cable Machine)', 'Kelso Shrug', 'Cable', true),
    ('Kelso Shrug (Barbell) (Chest Supported)', 'Kelso Shrug (Chest Supported)', 'Barbell', true),
    ('Kelso Shrug (Machine) (Chest Supported)', 'Kelso Shrug (Chest Supported)', 'Machine', false),
    ('Kickback (Cable)', 'Kickback', 'Cable', true),
    ('Lat Pulldown (Cable Machine) (Close Grip)', 'Lat Pulldown (Close Grip)', 'Cable', true),
    ('Lat Pulldown (Machine) (Close Grip)', 'Lat Pulldown (Close Grip)', 'Machine', false),
    ('Lat Pulldown (Cable) (Kneeling) (Unilateral)', 'Lat Pulldown (Kneeling) (Unilateral)', 'Cable', true),
    ('Lat Pulldown (Cable Machine) (Neutral Grip)', 'Lat Pulldown (Neutral Grip)', 'Cable', true),
    ('Lat Pulldown (Cable Machine) (Unilateral)', 'Lat Pulldown (Unilateral)', 'Cable', true),
    ('Lat Pulldown (Machine) (Unilateral)', 'Lat Pulldown (Unilateral)', 'Machine', false),
    ('Lat Pulldown (Cable Machine) (Wide Grip)', 'Lat Pulldown (Wide Grip)', 'Cable', true),
    ('Lat Pulldown (Machine) (Wide Grip)', 'Lat Pulldown (Wide Grip)', 'Machine', false),
    ('Lateral Raise (Machine)', 'Lateral Raise', 'Machine', true),
    ('Lateral Raise (Dumbbells) (Seated - Leaning)', 'Lateral Raise (Seated - Leaning)', 'Dumbbell', true),
    ('Lateral Raise (Dumbbell) (Seated)', 'Lateral Raise (Seated)', 'Dumbbell', true),
    ('Lateral Raise (Dumbbell) (Standing)', 'Lateral Raise (Standing)', 'Dumbbell', true),
    ('Lateral Raise (Cable) (Unilateral)', 'Lateral Raise (Unilateral)', 'Cable', true),
    ('Leg Curl (Machine) (Prone)', 'Leg Curl (Prone)', 'Machine', true),
    ('Leg Curl (Machine) (Prone) (Unilateral)', 'Leg Curl (Prone) (Unilateral)', 'Machine', true),
    ('Leg Curl (Machine) (Seated)', 'Leg Curl (Seated)', 'Machine', true),
    ('Leg Curl (Machine) (Seated) (Unilateral)', 'Leg Curl (Seated) (Unilateral)', 'Machine', true),
    ('Leg Extension (Machine)', 'Leg Extension', 'Machine', true),
    ('Leg Extension (Machine) (Unilateral)', 'Leg Extension (Unilateral)', 'Machine', true),
    ('Leg Press (Machine)', 'Leg Press', 'Machine', true),
    ('Leg Press (Machine) (Unilateral)', 'Leg Press (Unilateral)', 'Machine', true),
    ('Leg Press (Machine) (Unilateral) (High Foot Placement)', 'Leg Press (Unilateral) (High Foot Placement)', 'Machine', true),
    ('Leg Press (Machine) (Unilateral) (High Foot Placement) (Plate Loaded)', 'Leg Press (Unilateral) (High Foot Placement)', 'Machine', false),
    ('Lu Raises (Dumbbell) (Seated)', 'Lu Raises (Seated)', 'Dumbbell', true),
    ('Lu Raises (Dumbbell) (Standing)', 'Lu Raises (Standing)', 'Dumbbell', true),
    ('Overhead Press (Smith Machine)', 'Overhead Press', 'Smith Machine', true),
    ('Overhead Press (Machine) (Close Grip)', 'Overhead Press (Close Grip)', 'Machine', true),
    ('Overhead Press (Landmine) (Barbell) (Kneeling)', 'Overhead Press (Landmine) (Kneeling)', 'Barbell', true),
    ('Overhead Press (Dumbbell) (Seated) (Close Grip) (Incline 60)', 'Overhead Press (Seated) (Close Grip) (Incline 60)', 'Dumbbell', true),
    ('Overhead Press (Dumbbell) (Seated) (Wide Grip) (Incline 60)', 'Overhead Press (Seated) (Wide Grip) (Incline 60)', 'Dumbbell', true),
    ('Overhead Press (Barbell) (Standing)', 'Overhead Press (Standing)', 'Barbell', true),
    ('Overhead Press (Machine) (Wide Grip)', 'Overhead Press (Wide Grip)', 'Machine', true),
    ('Pullover (Machine)', 'Pullover', 'Machine', true),
    ('Pullover (Cable) (EZ Bar Attachment)', 'Pullover (EZ Bar Attachment)', 'Cable', true),
    ('Pullup (Bodyweight) (Neutral Grip)', 'Pullup (Neutral Grip)', 'Bodyweight', true),
    ('Pushdown (Machine)', 'Pushdown', 'Machine', true),
    ('Pushdown (Cable) (Bench Supported)', 'Pushdown (Bench Supported)', 'Cable', true),
    ('Pushdown (Cable) (EZ bar)', 'Pushdown (EZ Bar Attachment)', 'Cable', true),
    ('Pushdown (Cable) (Unilateral)', 'Pushdown (Unilateral)', 'Cable', true),
    ('Pushdown (Cable) (V-Bar)', 'Pushdown (V-Bar)', 'Cable', true),
    ('Pushdown (Cable) (Wrist Cuffs)', 'Pushdown (Wrist Cuffs)', 'Cable', true),
    ('RDLs (Barbell)', 'RDLs', 'Barbell', true),
    ('Rear Delt Fly (Machine)', 'Rear Delt Fly', 'Machine', true),
    ('Rear Delt Fly (Cable) (Unilateral)', 'Rear Delt Fly (Unilateral)', 'Cable', true),
    ('Reverse Curls (EZ Bar) (Standing)', 'Reverse Curls (Standing)', 'EZ Bar', true),
    ('Reverse Curls (EZ Bar) (Standing) (Strict)', 'Reverse Curls (Standing) (Strict)', 'EZ Bar', true),
    ('Reverse Curls (Cable) (Straight Bar)', 'Reverse Curls (Straight Bar)', 'Cable', true),
    ('Reverse Curls (Cable) (Unilateral)', 'Reverse Curls (Unilateral)', 'Cable', true),
    ('Row (Dumbbell) (Bent Over) (Unilateral)', 'Row (Bent Over) (Unilateral)', 'Dumbbell', true),
    ('Row (Barbell) (Bent Over) (Wide)', 'Row (Bent Over) (Wide)', 'Barbell', true),
    ('Row (Machine) (Chest Supported) (Close Grip)', 'Row (Chest Supported) (Close Grip)', 'Machine', true),
    ('Row (T-Bar) (Chest Supported) (Close-Grip)', 'Row (Chest Supported) (Close Grip)', 'T-Bar', false),
    ('Row (Machine) (Chest Supported) (Unilateral)', 'Row (Chest Supported) (Unilateral)', 'Machine', true),
    ('Row (Machine) (Chest Supported) (Wide Grip)', 'Row (Chest Supported) (Wide Grip)', 'Machine', false),
    ('Row (T-Bar) (Chest Supported) (Wide-Grip)', 'Row (Chest Supported) (Wide Grip)', 'T-Bar', true),
    ('Row (Cable Machine) (Close Grip)', 'Row (Close Grip)', 'Cable', true),
    ('Row (Machine) (Close Grip)', 'Row (Close Grip)', 'Machine', false),
    ('Row (Cable Machine) (Close Grip) (Unilateral)', 'Row (Close Grip) (Unilateral)', 'Cable', true),
    ('Row (Machine) (Close Grip) (Unilateral)', 'Row (Close Grip) (Unilateral)', 'Machine', false),
    ('Row (T-Bar) (Meadows)', 'Row (Meadows)', 'T-Bar', true),
    ('Row (Cable Machine) (Wide Grip) (Pronated)', 'Row (Wide Grip) (Pronated)', 'Cable', true),
    ('Skull Crushers (EZ Bar) (Lying)', 'Skull Crushers (Lying)', 'EZ Bar', true),
    ('Split Squats (Dumbbells)', 'Split Squats', 'Dumbbell', true),
    ('Static Holds (Cable)', 'Static Holds', 'Cable', true),
    ('Static Holds (Dumbbell)', 'Static Holds', 'Dumbbell', false),
    ('Static Holds (Cable) (Unilateral)', 'Static Holds (Unilateral)', 'Cable', true),
    ('Wrist Curls (Cable)', 'Wrist Curls', 'Cable', true),
    ('Wrist Curls (Cable) (Unilateral)', 'Wrist Curls (Unilateral)', 'Cable', true),
    ('Y-Raise (Cable) (Lying)', 'Y-Raise (Lying)', 'Cable', true),
    ('Y-Raise (Cable) (Standing)', 'Y-Raise (Standing)', 'Cable', true)
;

create table heracles_private.issue22_exercise_changes (
  exercise_id bigint primary key,
  old_name text not null,
  old_is_active boolean not null,
  new_name text not null,
  survivor_exercise_id bigint not null,
  inferred_equipment text not null,
  changed_at timestamptz not null default now()
);

create table heracles_private.issue22_session_exercise_repoints (
  session_exercise_id bigint primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  old_exercise_id bigint not null,
  new_exercise_id bigint not null,
  repointed_at timestamptz not null default now()
);

create table heracles_private.issue22_preset_membership_changes (
  id bigint generated always as identity primary key,
  preset_id bigint not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  old_exercise_id bigint not null,
  new_exercise_id bigint not null,
  old_set_count smallint not null,
  action text not null check (action in ('repointed', 'merged_into_existing')),
  survivor_old_set_count smallint,
  changed_at timestamptz not null default now()
);

create table heracles_private.issue22_equipment_backfill (
  session_exercise_id bigint primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  equipment_id bigint not null,
  source_exercise_name text not null,
  backfilled_at timestamptz not null default now()
);

create table heracles_private.issue22_previous_scientific_versions (
  model text primary key check (model in ('movement', 'derived', 'relevance')),
  version_id bigint not null
);

do $$
begin
  if (select count(*) from heracles_private.issue22_exercise_plan) <> 139
     or (select count(distinct new_name) from heracles_private.issue22_exercise_plan) <> 116
     or (select count(*) from heracles_private.issue22_exercise_plan where is_survivor) <> 116
     or exists (
       select new_name from heracles_private.issue22_exercise_plan
       group by new_name having count(*) filter (where is_survivor) <> 1
     )
     or exists (
       select 1 from heracles_private.issue22_exercise_plan p
       where not exists (select 1 from public.exercises e where e.name = p.old_name and e.is_active)
     )
     or exists (
       select 1 from public.exercises e
       where e.is_active
         and not exists (select 1 from heracles_private.issue22_exercise_plan p where p.old_name = e.name)
     )
  then
    raise exception 'Issue #22 exercise plan does not match the active catalogue';
  end if;
end
$$;

insert into heracles_private.issue22_exercise_changes (
  exercise_id, old_name, old_is_active, new_name, survivor_exercise_id, inferred_equipment
)
select
  e.id,
  e.name,
  e.is_active,
  p.new_name,
  survivor.id,
  p.inferred_equipment
from heracles_private.issue22_exercise_plan p
join public.exercises e on e.name = p.old_name
join heracles_private.issue22_exercise_plan survivor_plan
  on survivor_plan.new_name = p.new_name and survivor_plan.is_survivor
join public.exercises survivor on survivor.name = survivor_plan.old_name;

insert into heracles_private.issue22_previous_scientific_versions (model, version_id)
values
  ('movement', (select id from public.movement_mapping_versions where is_current)),
  ('derived', (select id from public.exercise_muscle_mapping_versions where is_current)),
  ('relevance', (select id from public.exercise_muscle_relevance_versions where is_current));

-- Catalogue: survivors take the canonical name; merged rows are retired under their original name.
update public.exercises e
set is_active = false
from heracles_private.issue22_exercise_changes c
where c.exercise_id = e.id
  and c.survivor_exercise_id <> e.id;

update public.exercises e
set name = c.new_name
from heracles_private.issue22_exercise_changes c
where c.exercise_id = e.id
  and c.survivor_exercise_id = e.id;

-- Scientific model: new published versions over the canonical catalogue.
update public.movement_mapping_versions set is_current = false
where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'movement');

insert into public.movement_mapping_versions (
  code, name, status, is_current, methodology_revision, source_file_name, source_sha256,
  payload_sha256, exercise_count, pattern_count, cell_count, nonzero_cell_count, change_notes, published_at
)
select
  'issue22_canonical_exercise_identity_2026_10_17',
  format('Canonical equipment-independent catalogue (%s by %s)', 116, pattern_count),
  'published',
  true,
  methodology_revision,
  'docs/scientific/issue-22-canonical-exercise-identity.json',
  '77bc84162df932622bf04d1fc2bb0f1e62a2833bce2832e54c763ba615715f33',
  repeat('0', 64),
  116,
  pattern_count,
  116 * pattern_count,
  0,
  'Issue #22: exercise identity no longer encodes equipment. Merged exercises take the full movement vector of their documented scoring source; the two machine incline chest presses gain the isometric scapulothoracic retraction (0.4) and depression (0.25) used by every bench and Smith chest press.',
  now()
from public.movement_mapping_versions
where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'movement');

insert into public.exercise_movement_pattern_coefficients (
  mapping_version_id, exercise_id, movement_pattern_id, coefficient, rationale_status, rationale
)
select
  new_version.id,
  c.exercise_id,
  c.movement_pattern_id,
  c.coefficient,
  c.rationale_status,
  c.rationale
from public.exercise_movement_pattern_coefficients c
join public.movement_mapping_versions new_version
  on new_version.code = 'issue22_canonical_exercise_identity_2026_10_17'
join public.exercises e on e.id = c.exercise_id and e.is_active
where c.mapping_version_id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'movement');

update public.exercise_movement_pattern_coefficients c
set coefficient = aligned.coefficient,
    rationale_status = 'methodology_only',
    rationale = 'Issue #22: aligned with every bench and Smith chest press; the scapulae are held retracted and depressed against the pad on a supported machine press as on a bench.'
from (
  values
    ('transverse_plane_scapulothoracic_retraction_isometric', 0.4::numeric),
    ('frontal_plane_scapulothoracic_depression_isometric', 0.25::numeric)
) as aligned(pattern_code, coefficient)
join public.movement_patterns mp on mp.code = aligned.pattern_code
where c.mapping_version_id = (select id from public.movement_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17')
  and c.movement_pattern_id = mp.id
  and c.exercise_id in (
    select id from public.exercises where name in ('Chest Press (Incline)', 'Chest Press (Incline) (Close Neutral Grip)')
  );

update public.movement_mapping_versions v
set nonzero_cell_count = (
      select count(*) from public.exercise_movement_pattern_coefficients c
      where c.mapping_version_id = v.id and c.coefficient > 0
    ),
    payload_sha256 = (
      select encode(
        extensions.digest(
          string_agg(
            format('%s|%s|%s', c.exercise_id, c.movement_pattern_id, c.coefficient),
            E'\n'
            order by c.exercise_id, c.movement_pattern_id
          ),
          'sha256'
        ),
        'hex'
      )
      from public.exercise_movement_pattern_coefficients c
      where c.mapping_version_id = v.id
    )
where v.code = 'issue22_canonical_exercise_identity_2026_10_17';

update public.exercise_muscle_mapping_versions set is_current = false
where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'derived');

insert into public.exercise_muscle_mapping_versions (
  code, name, status, is_current, exercise_pattern_version_id, pattern_muscle_version_id,
  algorithm_code, formula, payload_sha256, exercise_count, muscle_count, cell_count,
  nonzero_cell_count, over_one_cell_count, maximum_score, change_notes, published_at
)
select
  'issue22_canonical_exercise_identity_2026_10_17',
  format('Derived exercise-to-muscle matrix for the canonical catalogue (%s by %s)', 116, muscle_count),
  'published',
  true,
  (select id from public.movement_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17'),
  pattern_muscle_version_id,
  algorithm_code,
  formula,
  repeat('0', 64),
  116,
  muscle_count,
  116 * muscle_count,
  0,
  0,
  0,
  'Issue #22: recomputed from the canonical movement version with the unchanged pattern-to-muscle version. Rows for every unchanged exercise are verified identical to the previous derived version.',
  now()
from public.exercise_muscle_mapping_versions
where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'derived');

insert into public.exercise_muscle_coefficients (
  mapping_version_id, exercise_id, muscle_id, composition_score, contributing_pattern_count
)
with new_version as (
  select id, exercise_pattern_version_id, pattern_muscle_version_id
  from public.exercise_muscle_mapping_versions
  where code = 'issue22_canonical_exercise_identity_2026_10_17'
), muscle_set as (
  select distinct c.muscle_id
  from public.exercise_muscle_coefficients c
  where c.mapping_version_id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'derived')
), exercise_set as (
  select distinct c.exercise_id
  from public.exercise_movement_pattern_coefficients c
  where c.mapping_version_id = (select exercise_pattern_version_id from new_version)
), products as (
  select
    ec.exercise_id,
    pm.muscle_id,
    ec.coefficient * pm.coefficient as product
  from public.exercise_movement_pattern_coefficients ec
  join public.movement_pattern_muscle_coefficients pm
    on pm.movement_pattern_id = ec.movement_pattern_id
   and pm.mapping_version_id = (select pattern_muscle_version_id from new_version)
  where ec.mapping_version_id = (select exercise_pattern_version_id from new_version)
)
select
  (select id from new_version),
  ex.exercise_id,
  m.muscle_id,
  coalesce(sum(p.product), 0),
  count(p.product) filter (where p.product > 0)
from exercise_set ex
cross join muscle_set m
left join products p on p.exercise_id = ex.exercise_id and p.muscle_id = m.muscle_id
group by ex.exercise_id, m.muscle_id;

update public.exercise_muscle_mapping_versions v
set nonzero_cell_count = stats.nonzero,
    over_one_cell_count = stats.over_one,
    maximum_score = stats.maximum,
    payload_sha256 = stats.payload
from (
  select
    c.mapping_version_id,
    count(*) filter (where c.composition_score > 0) as nonzero,
    count(*) filter (where c.composition_score > 1) as over_one,
    max(c.composition_score) as maximum,
    encode(
      extensions.digest(
        string_agg(
          format('%s|%s|%s|%s', c.exercise_id, c.muscle_id, c.composition_score, c.contributing_pattern_count),
          E'\n'
          order by c.exercise_id, c.muscle_id
        ),
        'sha256'
      ),
      'hex'
    ) as payload
  from public.exercise_muscle_coefficients c
  group by c.mapping_version_id
) stats
where v.code = 'issue22_canonical_exercise_identity_2026_10_17'
  and stats.mapping_version_id = v.id;

update public.exercise_muscle_relevance_versions set is_current = false
where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'relevance');

insert into public.exercise_muscle_relevance_versions (
  code, name, status, is_current, exercise_pattern_version_id, pattern_muscle_version_id,
  source_file_name, source_sha256, documentation_file_name, documentation_sha256,
  payload_sha256, exercise_count, muscle_count, cell_count, nonzero_cell_count,
  coefficient_contract, change_notes, published_at
)
select
  'issue22_canonical_exercise_identity_2026_10_17',
  format('Exercise-to-muscle relevance for the canonical catalogue (%s by %s)', 116, muscle_count),
  'published',
  true,
  (select id from public.movement_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17'),
  pattern_muscle_version_id,
  'docs/scientific/issue-22-canonical-exercise-identity.json',
  '77bc84162df932622bf04d1fc2bb0f1e62a2833bce2832e54c763ba615715f33',
  documentation_file_name,
  documentation_sha256,
  repeat('0', 64),
  116,
  muscle_count,
  116 * muscle_count,
  0,
  coefficient_contract,
  'Issue #22: each canonical exercise keeps the authored relevance vector of its documented scoring source. No relevance coefficient is invented or edited.',
  now()
from public.exercise_muscle_relevance_versions
where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'relevance');

insert into public.exercise_muscle_relevance_coefficients (
  mapping_version_id, exercise_id, muscle_id, relevance
)
select
  new_version.id,
  c.exercise_id,
  c.muscle_id,
  c.relevance
from public.exercise_muscle_relevance_coefficients c
join public.exercise_muscle_relevance_versions new_version
  on new_version.code = 'issue22_canonical_exercise_identity_2026_10_17'
join public.exercises e on e.id = c.exercise_id and e.is_active
where c.mapping_version_id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'relevance');

update public.exercise_muscle_relevance_versions v
set nonzero_cell_count = (
      select count(*) from public.exercise_muscle_relevance_coefficients c
      where c.mapping_version_id = v.id and c.relevance > 0
    ),
    payload_sha256 = (
      select encode(
        extensions.digest(
          string_agg(
            format('%s|%s|%s', c.exercise_id, c.muscle_id, c.relevance),
            E'\n'
            order by c.exercise_id, c.muscle_id
          ),
          'sha256'
        ),
        'hex'
      )
      from public.exercise_muscle_relevance_coefficients c
      where c.mapping_version_id = v.id
    )
where v.code = 'issue22_canonical_exercise_identity_2026_10_17';

-- Idempotent owner-data step: repoints history and presets from retired exercises to their survivor and
-- records the equipment stated by the previous exercise name where none was recorded.
create function heracles_private.issue22_reconcile_exercise_identity_data()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  backfilled_count integer;
begin
  with repointed as (
    update public.session_exercises se
    set exercise_id = c.survivor_exercise_id
    from heracles_private.issue22_exercise_changes c
    where se.exercise_id = c.exercise_id
      and c.survivor_exercise_id <> c.exercise_id
    returning se.id, se.owner_id, c.exercise_id as old_exercise_id, c.survivor_exercise_id as new_exercise_id
  )
  insert into heracles_private.issue22_session_exercise_repoints (
    session_exercise_id, owner_id, old_exercise_id, new_exercise_id
  )
  select id, owner_id, old_exercise_id, new_exercise_id from repointed;

  -- Presets without the survivor: the lowest retired membership becomes the survivor membership.
  drop table if exists pg_temp.issue22_preset_keepers;
  create temporary table issue22_preset_keepers on commit drop as
  select distinct on (ranked.preset_id, ranked.survivor_exercise_id)
    ranked.preset_id,
    ranked.owner_id,
    ranked.old_exercise_id,
    ranked.survivor_exercise_id,
    ranked.old_set_count,
    ranked.merged_set_count
  from (
    select
      m.preset_id,
      m.owner_id,
      m.exercise_id as old_exercise_id,
      c.survivor_exercise_id,
      m.set_count as old_set_count,
      max(m.set_count) over (partition by m.preset_id, c.survivor_exercise_id) as merged_set_count
    from public.workout_preset_exercises m
    join heracles_private.issue22_exercise_changes c
      on c.exercise_id = m.exercise_id
     and c.survivor_exercise_id <> c.exercise_id
    where not exists (
      select 1 from public.workout_preset_exercises existing
      where existing.preset_id = m.preset_id
        and existing.exercise_id = c.survivor_exercise_id
    )
  ) ranked
  order by ranked.preset_id, ranked.survivor_exercise_id, ranked.old_exercise_id;

  insert into heracles_private.issue22_preset_membership_changes (
    preset_id, owner_id, old_exercise_id, new_exercise_id, old_set_count, action
  )
  select preset_id, owner_id, old_exercise_id, survivor_exercise_id, old_set_count, 'repointed'
  from pg_temp.issue22_preset_keepers;

  update public.workout_preset_exercises m
  set exercise_id = k.survivor_exercise_id,
      set_count = k.merged_set_count
  from pg_temp.issue22_preset_keepers k
  where m.preset_id = k.preset_id
    and m.exercise_id = k.old_exercise_id;

  -- Remaining retired memberships fold into the survivor membership, keeping the larger set count.
  insert into heracles_private.issue22_preset_membership_changes (
    preset_id, owner_id, old_exercise_id, new_exercise_id, old_set_count, action, survivor_old_set_count
  )
  select m.preset_id, m.owner_id, m.exercise_id, c.survivor_exercise_id, m.set_count, 'merged_into_existing', survivor.set_count
  from public.workout_preset_exercises m
  join heracles_private.issue22_exercise_changes c
    on c.exercise_id = m.exercise_id
   and c.survivor_exercise_id <> c.exercise_id
  join public.workout_preset_exercises survivor
    on survivor.preset_id = m.preset_id
   and survivor.exercise_id = c.survivor_exercise_id
  order by m.preset_id, m.exercise_id;

  update public.workout_preset_exercises survivor
  set set_count = greatest(survivor.set_count, folded.max_set_count)
  from (
    select m.preset_id, c.survivor_exercise_id, max(m.set_count) as max_set_count
    from public.workout_preset_exercises m
    join heracles_private.issue22_exercise_changes c
      on c.exercise_id = m.exercise_id
     and c.survivor_exercise_id <> c.exercise_id
    group by m.preset_id, c.survivor_exercise_id
  ) folded
  where survivor.preset_id = folded.preset_id
    and survivor.exercise_id = folded.survivor_exercise_id;

  delete from public.workout_preset_exercises m
  using heracles_private.issue22_exercise_changes c
  where c.exercise_id = m.exercise_id
    and c.survivor_exercise_id <> c.exercise_id;

  -- Equipment stated by the previous exercise name, for occurrences with none recorded.
  drop table if exists pg_temp.issue22_backfill_plan;
  create temporary table issue22_backfill_plan on commit drop as
  select
    se.id as session_exercise_id,
    se.owner_id,
    ws.gym_id,
    source.old_name as source_exercise_name,
    identity.kind,
    identity.name as equipment_name
  from public.session_exercises se
  join public.workout_sessions ws on ws.id = se.session_id and ws.owner_id = se.owner_id
  left join heracles_private.issue22_session_exercise_repoints r on r.session_exercise_id = se.id
  join heracles_private.issue22_exercise_changes source
    on source.exercise_id = coalesce(r.old_exercise_id, se.exercise_id)
  left join public.gyms g on g.id = ws.gym_id and g.owner_id = ws.owner_id
  cross join lateral public.canonical_equipment_identity(source.inferred_equipment, g.name) as identity
  where se.canonical_equipment_id is null
    and not exists (
      select 1 from heracles_private.issue22_equipment_backfill b where b.session_exercise_id = se.id
    );

  with inserted as (
    insert into public.equipment (owner_id, name, kind)
    select distinct on (plan.owner_id, lower(plan.equipment_name))
      plan.owner_id, plan.equipment_name, plan.kind
    from pg_temp.issue22_backfill_plan plan
    order by plan.owner_id, lower(plan.equipment_name)
    on conflict (owner_id, lower(name)) do nothing
    returning id, owner_id
  )
  insert into heracles_private.issue22_created_equipment (equipment_id, owner_id, step)
  select id, owner_id, 'exercise_identity' from inserted;

  insert into public.equipment_gym_availability (owner_id, equipment_id, gym_id)
  select distinct plan.owner_id, e.id, plan.gym_id
  from pg_temp.issue22_backfill_plan plan
  join public.equipment e on e.owner_id = plan.owner_id and lower(e.name) = lower(plan.equipment_name)
  where plan.gym_id is not null
    and e.kind <> 'generic'
  on conflict (equipment_id, gym_id) do nothing;

  insert into heracles_private.issue22_equipment_backfill (
    session_exercise_id, owner_id, equipment_id, source_exercise_name
  )
  select plan.session_exercise_id, plan.owner_id, e.id, plan.source_exercise_name
  from pg_temp.issue22_backfill_plan plan
  join public.equipment e on e.owner_id = plan.owner_id and lower(e.name) = lower(plan.equipment_name);

  get diagnostics backfilled_count = row_count;

  update public.session_exercises se
  set canonical_equipment_id = b.equipment_id
  from heracles_private.issue22_equipment_backfill b
  where b.session_exercise_id = se.id
    and se.canonical_equipment_id is null;

  return backfilled_count;
end;
$$;

select heracles_private.issue22_reconcile_exercise_identity_data();

-- Undo: restores names, retired exercises, history, presets, equipment backfill and scientific versions.
create function heracles_private.issue22_undo_exercise_identity()
returns void
language plpgsql
set search_path = ''
as $$
declare
  change record;
begin
  if not exists (
    select 1 from heracles_private.issue22_step_state
    where step = 'exercise_identity' and status = 'applied'
  ) then
    raise exception 'Issue #22 exercise identity step is not applied.';
  end if;

  update public.session_exercises se
  set canonical_equipment_id = null
  from heracles_private.issue22_equipment_backfill b
  where b.session_exercise_id = se.id
    and se.canonical_equipment_id = b.equipment_id;

  delete from public.equipment e
  using heracles_private.issue22_created_equipment created
  where created.equipment_id = e.id
    and created.step = 'exercise_identity'
    and not exists (
      select 1 from public.session_exercises se where se.canonical_equipment_id = e.id
    );

  for change in
    select * from heracles_private.issue22_preset_membership_changes order by id desc
  loop
    if change.action = 'merged_into_existing' then
      update public.workout_preset_exercises
      set set_count = change.survivor_old_set_count
      where preset_id = change.preset_id and exercise_id = change.new_exercise_id;

      insert into public.workout_preset_exercises (preset_id, owner_id, exercise_id, set_count)
      values (change.preset_id, change.owner_id, change.old_exercise_id, change.old_set_count)
      on conflict (preset_id, exercise_id) do nothing;
    else
      update public.workout_preset_exercises
      set exercise_id = change.old_exercise_id,
          set_count = change.old_set_count
      where preset_id = change.preset_id and exercise_id = change.new_exercise_id;
    end if;
  end loop;

  update public.session_exercises se
  set exercise_id = r.old_exercise_id
  from heracles_private.issue22_session_exercise_repoints r
  where r.session_exercise_id = se.id;

  update public.exercises e
  set name = c.old_name,
      is_active = c.old_is_active
  from heracles_private.issue22_exercise_changes c
  where c.exercise_id = e.id;

  update public.movement_mapping_versions set is_current = false
  where code = 'issue22_canonical_exercise_identity_2026_10_17';
  update public.exercise_muscle_mapping_versions set is_current = false
  where code = 'issue22_canonical_exercise_identity_2026_10_17';
  update public.exercise_muscle_relevance_versions set is_current = false
  where code = 'issue22_canonical_exercise_identity_2026_10_17';

  update public.movement_mapping_versions set is_current = true
  where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'movement');
  update public.exercise_muscle_mapping_versions set is_current = true
  where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'derived');
  update public.exercise_muscle_relevance_versions set is_current = true
  where id = (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'relevance');

  delete from public.exercise_muscle_relevance_coefficients
  where mapping_version_id in (
    select id from public.exercise_muscle_relevance_versions where code = 'issue22_canonical_exercise_identity_2026_10_17'
  );
  delete from public.exercise_muscle_relevance_versions where code = 'issue22_canonical_exercise_identity_2026_10_17';
  delete from public.exercise_muscle_coefficients
  where mapping_version_id in (
    select id from public.exercise_muscle_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17'
  );
  delete from public.exercise_muscle_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17';
  delete from public.exercise_movement_pattern_coefficients
  where mapping_version_id in (
    select id from public.movement_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17'
  );
  delete from public.movement_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17';

  comment on table public.exercises is
    'Global, app-managed exercise catalogue shared by every user. Equipment remains attached to performed exercises.';

  delete from heracles_private.issue22_created_equipment where step = 'exercise_identity';
  delete from heracles_private.issue22_equipment_backfill;
  delete from heracles_private.issue22_preset_membership_changes;
  delete from heracles_private.issue22_session_exercise_repoints;

  update heracles_private.issue22_step_state
  set status = 'undone', changed_at = now()
  where step = 'exercise_identity';
end;
$$;

revoke all on function heracles_private.issue22_reconcile_exercise_identity_data() from public, anon, authenticated;
revoke all on function heracles_private.issue22_undo_exercise_identity() from public, anon, authenticated;

insert into heracles_private.issue22_step_state (step, status)
values ('exercise_identity', 'applied');

comment on table public.exercises is
  'Global, app-managed exercise catalogue shared by every user. Names describe the movement only; the equipment used is recorded on each performed exercise. Retired rows (is_active = false) keep their original names for provenance.';

-- Integrity checks.
do $$
declare
  movement_version_id bigint := (select id from public.movement_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17');
  derived_version_id bigint := (select id from public.exercise_muscle_mapping_versions where code = 'issue22_canonical_exercise_identity_2026_10_17');
  relevance_version_id bigint := (select id from public.exercise_muscle_relevance_versions where code = 'issue22_canonical_exercise_identity_2026_10_17');
  previous_derived_version_id bigint := (select version_id from heracles_private.issue22_previous_scientific_versions where model = 'derived');
begin
  if (select count(*) from public.exercises where is_active) <> 116
     or exists (
       select 1 from public.exercises
       where is_active
         and name ~* '\((Dumbbells?|Barbell|EZ Bar|Machine|Cable|Cable Machine|Smith Machine|Pec Deck Machine|Leg Press Machine|T-Bar|Bodyweight|Plate Loaded)\)'
     )
  then
    raise exception 'Canonical catalogue must contain 116 equipment-independent exercise names';
  end if;

  if exists (
       select 1 from public.session_exercises se
       join public.exercises e on e.id = se.exercise_id
       where not e.is_active
     )
     or exists (
       select 1 from public.workout_preset_exercises m
       join public.exercises e on e.id = m.exercise_id
       where not e.is_active
     )
  then
    raise exception 'History and presets must reference active canonical exercises only';
  end if;

  if (select count(*) from public.movement_mapping_versions where is_current) <> 1
     or (select count(*) from public.exercise_muscle_mapping_versions where is_current) <> 1
     or (select count(*) from public.exercise_muscle_relevance_versions where is_current) <> 1
     or (select count(distinct exercise_id) from public.exercise_movement_pattern_coefficients where mapping_version_id = movement_version_id) <> 116
     or (select count(distinct exercise_id) from public.exercise_muscle_coefficients where mapping_version_id = derived_version_id) <> 116
     or (select count(distinct exercise_id) from public.exercise_muscle_relevance_coefficients where mapping_version_id = relevance_version_id) <> 116
     or (select cell_count from public.movement_mapping_versions where id = movement_version_id)
        <> (select count(*) from public.exercise_movement_pattern_coefficients where mapping_version_id = movement_version_id)
     or (select cell_count from public.exercise_muscle_mapping_versions where id = derived_version_id)
        <> (select count(*) from public.exercise_muscle_coefficients where mapping_version_id = derived_version_id)
     or (select cell_count from public.exercise_muscle_relevance_versions where id = relevance_version_id)
        <> (select count(*) from public.exercise_muscle_relevance_coefficients where mapping_version_id = relevance_version_id)
  then
    raise exception 'Canonical scientific versions are incomplete';
  end if;

  -- The derived recomputation must reproduce the previous derived rows for every unchanged exercise.
  if exists (
    select c.exercise_id, c.muscle_id, c.composition_score, c.contributing_pattern_count
    from public.exercise_muscle_coefficients c
    join public.exercises e on e.id = c.exercise_id
    where c.mapping_version_id = derived_version_id
      and e.name not in ('Chest Press (Incline)', 'Chest Press (Incline) (Close Neutral Grip)')
    except
    select c.exercise_id, c.muscle_id, c.composition_score, c.contributing_pattern_count
    from public.exercise_muscle_coefficients c
    where c.mapping_version_id = previous_derived_version_id
  ) then
    raise exception 'Derived exercise-to-muscle recomputation does not reproduce unchanged exercises';
  end if;

  -- Aligned machine inclines now share the incline bench press movement vector.
  if exists (
    select c.movement_pattern_id, c.coefficient
    from public.exercise_movement_pattern_coefficients c
    join public.exercises e on e.id = c.exercise_id
    where c.mapping_version_id = movement_version_id and e.name = 'Chest Press (Incline)'
    except
    select c.movement_pattern_id, c.coefficient
    from public.exercise_movement_pattern_coefficients c
    join public.exercises e on e.id = c.exercise_id
    where c.mapping_version_id = movement_version_id and e.name = 'Chest Press (Incline 30)'
  ) then
    raise exception 'Machine incline chest press movement vector was not aligned with the bench incline press';
  end if;
end
$$;

commit;
