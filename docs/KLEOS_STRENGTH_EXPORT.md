# Kleos strength export

Heracles remains the source of truth for workout sessions, exercise identity, sets, equipment, body-weight measurements, and estimated strength performance. Kleos receives only a narrow derived snapshot; it does not receive raw workout or body-weight history and cannot write either back to Heracles.

## Qualification window

The export examines **today plus the preceding 29 calendar dates**. A set contributes only when:

- its workout session is `completed`;
- it belongs to the authorized Heracles owner;
- it is not a warm-up;
- reported RIR is 0–3;
- `estimated_1rm_high` is positive.

An exercise is exported only after it appears in at least **3 distinct qualifying workout sessions** in that window. Multiple sets from the same session still count as one session.

## Exported strength value

For each qualifying exercise, `best_1rm` is the maximum `estimated_1rm_high` in the window. `estimated_1rm_high` is Heracles's upper observed estimated-1RM value: the higher of the Brzycki and Epley estimates calculated from entered weight and completed repetitions.

It is therefore:

- calculated, not directly measured;
- based on completed repetitions rather than reps + reported RIR;
- not a confidence interval and not a claim about a person's true 1RM;
- expressed using Heracles's normal weight semantics, including weight **per dumbbell** for dumbbell exercises.

The response labels this basis as `observed_e1rm_high`.

## Body-weight-relative strength

The absolute `best_1rm` winner is selected first. Heracles does **not** independently select a second best relative-strength record.

For the exact workout date that produced `best_1rm`, Heracles resolves body weight with the same daily semantics used by the main body-weight subsystem:

- an observation on that calendar date produces `body_weight_kind = measured`;
- a missing date strictly between surrounding measurements is linearly interpolated and produces `body_weight_kind = interpolated`;
- no value is extrapolated before the first or after the final measurement.

When workout-date body weight is available, the export includes:

- `body_weight_kg_at_achieved`;
- `body_weight_kind`;
- `best_1rm_relative_bw = best_1rm / body_weight_kg_at_achieved`.

If workout-date body weight is outside measured coverage, all three relative-strength fields are `null`. Absolute strength remains available.

For dumbbell exercises, the ratio preserves the one-dumbbell convention and should be interpreted as `× BW per dumbbell`.

## Current body weight

Contract `1.2.0` also exposes `current_body_weight` at the top level. This is the latest actual Heracles daily body-weight representative, with:

- `weight_kg`;
- `measured_on`.

It is not extrapolated forward to today. If Heracles has no body-weight measurements, `current_body_weight` is `null`.

## Equipment provenance

`equipment_name` is taken from `session_exercises.equipment_name_snapshot` on the **same session exercise as the set that produced `best_1rm`**. This intentionally uses the historical snapshot rather than the current equipment catalogue name, so a later rename does not rewrite the context of an older lift.

If a legacy session genuinely has no equipment snapshot, `equipment_name` is `null`. Kleos preserves that as missing equipment context rather than guessing a machine. Issue #22 fills canonical equipment for such entries from their previous exercise name but deliberately leaves the snapshot empty, so this export does not change.

Rows are grouped by exercise. After issue #22 merged exercises that differed only by equipment (for example barbell and Smith flat presses into `Chest Press`), those lifts share one row. Grouping by exercise and canonical equipment (`session_exercises.canonical_equipment_id`) is the planned follow-up in issue #45.

## Security boundary

`public.get_kleos_strength_snapshot()` and `public.get_kleos_current_body_weight()` are executable only by the Heracles service role. Ordinary `anon` and `authenticated` Heracles clients cannot call them.

The `kleos-strength` Edge Function is the only cross-project HTTP boundary. It accepts a Kleos bearer token, validates that token against the Kleos Supabase Auth project, requires the authorized Kleos account, and only then calls the service-only export RPCs. No Heracles service credential is shared with Kleos or exposed to a browser.

The endpoint contract is version `1.2.0` and returns only:

- current body weight and its measurement date;
- exercise ID and name;
- historical machine/equipment name for the selected estimate;
- absolute `best_1rm`;
- workout-date body weight and measured/interpolated provenance when available;
- bodyweight-relative `best_1rm_relative_bw` when available;
- qualifying-session count;
- date on which the selected estimate was achieved;
- estimation-basis label;
- contract metadata describing the 30-day / 3-session rule.
