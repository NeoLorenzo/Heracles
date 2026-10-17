# Preset workout order

## What it does

When a workout starts from a preset, Heracles puts the exercises in a **deterministic, explainable order** instead of shuffling them. The order is only a starting point: the lifter can reorder exercises at any time during the workout, and the next rotation reads the order that was **actually completed**, so manual reordering feeds forward automatically.

Starting an empty workout and resuming an active workout are unchanged. Set counts, blank-set creation, and equipment defaulting are unchanged: each preset exercise still defaults to the canonical equipment last used for it at the selected gym (issue #22).

## Status of this feature

Exercise order is a **product decision about where exercises sit in a session**. It is not a hypertrophy model.

- Placing an exercise earlier in a session reliably helps **performance in that session**, because the lifter is less fatigued. Evidence that exercise order changes **long-term muscle growth** is much weaker. Heracles does not claim or imply that prioritization produces more hypertrophy.
- Alternating muscle groups is intended to spread in-session fatigue so that no group is always trained last. Heracles does **not** claim that alternation balances hypertrophic stimulus; no literature has been reviewed for that claim under the [study-selection protocol](RESISTANCE_TRAINING_OUTCOME_STUDY_SELECTION_PROTOCOL.md). Compound exercises also train secondary muscles (for example, pressing involves the triceps), so alternation reduces but does not eliminate overlapping fatigue.
- In-app copy describes what the order does ("placed earlier in the workout, while you're fresher") and never promises outcomes.
- The feature introduces no fatigue, readiness, or stimulus score, and no new coefficients.

## Preference

Each user has one ordering preference, stored in `user_settings` and `user_priority_muscle_groups` under owner-only Row Level Security, and edited in **My Stuff → Workout order**. It is saved atomically by `save_preset_order_preference`.

| Setting | Values | Default |
|---|---|---|
| Order mode | Balanced rotation, Prioritize muscle groups | Balanced rotation |
| Priority muscle groups | One or more user-facing muscle groups (`ui_muscle_groups`); required in priority mode | none |
| Alternate exercises between muscle groups | on / off | on |

There is no random mode. Per-preset overrides and per-workout overrides are not part of this first version.

## Main muscle group and the principal-target threshold

Ordering uses the published, current exercise → muscle [hypertrophic relevance matrix](EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.md) and the user-facing muscle groups from the [muscle group taxonomy](MUSCLE_GROUP_TAXONOMY.md). It reads them; it never changes them.

- An exercise **mainly trains** a muscle group when at least one of that group's muscles has relevance **0.75 or 1.00** — a *major* or *principal* target in the matrix's coefficient contract. Values of 0.50 and 0.25 do not count.
- An exercise's **main muscle group** is the group with its highest such relevance. Ties go to the group that comes first in the muscle-group list (`ui_muscle_groups.source_order`, which is alphabetical by group name). For example, a squat with quads at 1.00 and glutes and adductors at 0.75 belongs to Quads.
- In priority mode, an exercise that mainly trains any priority group is a **priority exercise** and belongs to its strongest *priority* group. For example, with Glutes as a priority, the same squat is a priority exercise grouped under Glutes.
- An exercise with no principal or major target is **unmapped**: it is non-priority, and for alternation it is treated as its own group (Heracles does not assume two unmapped exercises train the same muscles). The in-workout explanation names such exercises.

The threshold is a product choice that reuses the matrix's own meaning of "major target"; it is not a new scientific claim.

## Method

The inputs are the preset's current exercises, the **most recent completed session started from the same preset** (`workout_sessions.source_preset_id`, ordered by date, creation time, then ID) with its exercises in their completed `exercise_order`, the preference, and the relevance mapping.

1. **Alphabetical base.** Preset exercises are sorted by catalogue name, character by character (equivalent to SQL `collate "C"`), then by ID. This is the stable order used whenever there is no history.
2. **Parts.** In balanced-rotation mode there is one part. In priority mode there are two: priority exercises first, then the rest. Each part is ordered independently by steps 3–5.
3. **Previous order.** Take the previous session's exercises that are still in this part, in the order they were completed. Repeated exercises count once, at their first position. Exercises removed from the preset are dropped.
4. **Rotation.**
   - *Exercise rotation:* the exercise that went first last time moves to the back; the rest move up one place. Exercises added to the preset since then follow, alphabetically.
   - *Group rotation:* the main muscle group that went first last time moves to the back of the group order; groups that are new to the preset follow.
   - Within each group, exercises keep the exercise-rotation order. So when a group leads, its leading exercise moves to the back of that group, and the next time the group leads, a different exercise leads.
   - With no usable history (first workout from the preset, or no overlap with the last one), the group order is the order in which groups first appear in the alphabetical base.
5. **Alternation.**
   - *On:* take one exercise from each group in group order, round-robin, until every group runs out. A group with more exercises than the others finishes at the end.
   - *Off:* each group's exercises are placed together as a block, blocks in group order.

Alternation only changes the order of whole exercises. All sets of an exercise always stay together, so it is fully expressed through `session_exercises.exercise_order` and needs no change to set storage.

When every exercise is its own group (for example Leg Extension, Leg Curl and Hip Adduction), group rotation and exercise rotation coincide: quads → hamstrings → adductors becomes hamstrings → adductors → quads, then adductors → quads → hamstrings. With several exercises per group, both groups and exercises take turns at the front.

The algorithm is deterministic: the same preset, previous session, preference, and mapping always produce the same order, regardless of the order the inputs arrive in. There is no random tiebreak.

## Fallbacks

| Situation | Behavior |
|---|---|
| No completed session from this preset | Alphabetical base, then priority parts and alternation as configured |
| Last session shares no exercises with the current preset | Same as above; the explanation says so |
| Exercise added to the preset since the last session | Placed after last time's exercises in its main muscle group; a new group goes after the rotated groups |
| Exercise removed from the preset | Dropped from the order; the explanation lists it |
| Exercise with no principal or major target | Non-priority; its own group for alternation; named in the explanation |
| Priority mode with no preset exercise in a priority group | Ordered as a balanced rotation; the explanation says so |
| The browser cannot load the preference or history | The server starts the workout in alphabetical order and records that basis |

## Where the order is computed and stored

- `preset-ordering.js` is the pure, tested implementation (`planPresetExerciseOrder`) and turns a stored basis into the in-workout explanation (`describeExerciseOrderBasis`).
- `features/session/preset-order-inputs.js` loads the owner's preset, preference, previous session, and mapping.
- `start_or_resume_workout_session(p_gym_id, p_preset_id, p_exercise_order, p_exercise_order_basis)` accepts the planned order only when it is an exact permutation of the preset's exercises, and otherwise rejects it. Without a supplied order it uses the alphabetical base. It never uses `random()`.
- The muscle-group lookup reads only the current published relevance version, which covers the active canonical exercise catalogue. A retired exercise would have no mapping and be treated as unmapped.
- `workout_sessions.exercise_order_basis` stores a small structured record of why the session started in that order (mode, alternation setting, threshold, rotation source session, first exercises, added/removed/unmapped exercises, priority groups). It is written once at session start and is `null` for empty-start sessions and for sessions created before this feature. Historical sessions are not modified.

## Explanation shown in the workout

The live workout shows a short note above the exercises, for example:

> Rotated from your last Lower workout (Mon 12 Oct): Leg Extension (Machine) went first last time, so Leg Curl (Machine) (Seated) goes first today.

> Hamstrings is a priority, so exercises that mainly train it come first — placed earlier in the workout, while you're fresher.

Further lines, behind "How this order was chosen", describe added, removed, and unmapped exercises, the alternation setting and its limits, and that manual reordering feeds the next rotation.

## Out of scope

- Ordered routines or set prescriptions (#10).
- Detecting the user's weekly split (#73).
- Per-preset or per-workout overrides of the preference.
- A literature review of exercise-order or paired-set evidence; until one is done under the study-selection protocol, the feature stays labelled as a product decision.

## Interaction with the issue #22 undo

Issue #22 ships `heracles_private.issue22_undo_canonical_equipment()`, which re-creates the captured pre-#22 two-argument start function and drops the canonical equipment columns. It does not know about the four-argument function above. To keep that undo safe without editing the applied #22 migration, migration `20261018120000_order_preset_workouts.sql` adds a trigger on `heracles_private.issue22_step_state`: when the canonical equipment step is marked undone, it drops the four-argument start function, so exactly one start function (the legacy one the undo restored) remains. After such an undo, preset starts use the legacy behaviour, and restoring this feature requires a new migration. The ordering preference tables and `exercise_order_basis` column are additive and are left in place.
