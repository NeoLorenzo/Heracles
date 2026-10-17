# Heracles — Design Rules

## 1. No magic math, numbers, formulas, or science

No magic math/numbers/formulas/science. All of that must have explanations within the app. For example, every value in the movement-pattern mapping matrix must be explained; fatigue calculations, atrophy estimates, and similar derived values must be explained as well.

Any calculated, weighted, estimated, scored, or scientifically framed value shown by the app must let the user understand:

- What the value means in plain language.
- Why the app shows it and how it should be used.
- Which user data and assumptions produced it.
- The formula or method used, including units and the meaning of every input.
- Where fixed coefficients, thresholds, mapping weights, or defaults came from.
- Whether the value is measured, entered by the user, calculated, or estimated.
- The value's uncertainty, limitations, and cases where it may be misleading.
- The scientific source or product decision behind it, when applicable.

Explanations must be available inside the relevant app workflow, close to the value they describe. A user must not need to inspect source code, database migrations, or external spreadsheets to understand a result. Links to deeper documentation or research may supplement an explanation, but must not replace the in-app explanation.

If the app cannot explain a number honestly and clearly, it must not present that number as meaningful or authoritative.

The current interpretation, limits, and permitted uses of the movement-pattern mapping matrix are defined in [Movement-pattern contribution coefficients](MOVEMENT_PATTERN_COEFFICIENTS.md).

## 2. No tonnage or weight × reps metrics

The app must never calculate, display, or use weight × reps—also called tonnage or volume load—as a hypertrophy, training-volume, workload, progression, or personal-statistics metric.

Load and repetitions remain useful as separate, exercise-specific performance data. Hypertrophy-relevant volume should primarily refer to sufficiently hard working sets and explicitly justified measures derived from them.

The product classifies an explicitly marked warm-up as a warm-up, a non-warm-up set reported at RIR 0–3 as a working set, and a non-warm-up set reported at 4+ RIR as a high-RIR history set. Warm-ups and high-RIR sets are excluded from hypertrophy analytics. The 0–3 cutoff is a product inclusion rule, not a claim that 4+ RIR causes literally zero hypertrophy.

The rationale and product-wide implementation rule are defined in [Why the app does not track tonnage](WHY_THE_APP_DOES_NOT_TRACK_TONNAGE.md).

## 3. Dumbbell weight is always per dumbbell

Every weight recorded or displayed for an exercise whose catalogue name contains `(Dumbbell)` must mean the weight of **one dumbbell**.

This rule applies without exception to:

- unilateral dumbbell exercises;
- bilateral dumbbell exercises;
- raw set-history displays;
- exercise-progression comparisons;
- and estimated 1RM calculations and labels.

For example, a bilateral dumbbell press performed with two 30 kg dumbbells is recorded as `30 kg`, not `60 kg`. A unilateral curl with one 15 kg dumbbell is recorded as `15 kg`.

The app must label dumbbell performance as `kg per dumbbell` wherever weight or a weight-derived estimate is displayed. It must never infer or display the combined weight of a dumbbell pair. Exercise names no longer state the implement, so the recorded `Dumbbell` equipment decides the label; when one exercise chart mixes dumbbell and non-dumbbell equipment series, its unit says that dumbbell series are per dumbbell.

## 4. Color meaning must be consistent and intuitive

Exercise colors must be assigned from one shared, deterministic app-wide palette. The same exact exercise and equipment identity must keep the same color everywhere it appears. Different machines or equipment identities for the same exercise must use distinguishable colors and must be identified with a visible text key. Color must never be the only way to identify an exercise series.

Directional change colors have a fixed semantic meaning throughout the app:

- Positive increases are green.
- Negative decreases are red.
- No change or unavailable direction is neutral gray.

Every colored change must also include an explicit sign or text label, such as `+12%`, `−8%`, or `No change`, so the meaning remains accessible without color. Exercise-series palettes should avoid reusing the semantic increase and decrease colors where that would make the meaning ambiguous.

## 5. Body-weight observations and interpolation remain distinct

Imported scale weights are measured user data in kilograms. Only those observations may be stored in the canonical body-weight table or displayed as measured markers.

For a missing date strictly between two observations, the app may calculate a daily value with linear interpolation: `W(d) = W1 + (W2 - W1) × (days from d1 / days between d1 and d2)`. The UI must label that value as interpolated and, where practical, identify the surrounding observations. Interpolation is a mathematical convenience, not a scale measurement, prediction, physiological model, or trend-weight estimate. The app must not extrapolate before the first or after the final observation.

Relative estimated 1RM is a calculated presentation of the existing absolute estimated range, divided by measured or interpolated body weight on the workout date. It uses `× BW` units, remains default-off and user-controlled, and must be unavailable rather than substituted or extrapolated when that date has no body-weight value. Normalization does not make e1RM measured or more accurate. Dumbbell relative e1RM remains per dumbbell.

Strength progression preserves four calculated values for a representative RIR 0–3 working set: observed Brzycki and Epley estimates, plus both formulas using completed reps + reported RIR. Representative selection uses only the observed pair, ordered by its lower value and then its upper value. The four-value spread is an estimated model range, not a confidence interval or a measured true 1RM. The app does not add a literature-derived true-RIR uncertainty model: reported RIR remains the entered subjective observation. Stored RIR bucket `4` means open-ended `4+`, so it cannot provide a finite adjusted repetition count and is excluded from this primary graph. The post-workout recap compares one labelled value from that same representative set, the lower of the observed Brzycki and Epley estimates. It compares only the same exercise on the same canonical equipment (at any gym), reports a new best separately from improvement over the last comparable session, and shows no composite workout score; see [Post-workout recap](POST_WORKOUT_RECAP.md).

## 6. Live workout tracking, equipment entities, and durability semantics

Live session tracking enables persistent logging during active training:

- **Canonical Equipment Identity & Isolation**: Equipment (`equipment`) is one owner-scoped identity per real piece of equipment and never includes the gym. Generic implements (Dumbbell, Barbell, EZ Bar, Bodyweight) are offered at every gym; machines and `unknown_model` placeholders are offered where `equipment_gym_availability` lists them. Creating or linking equipment reuses an existing record with the same normalized name. References use database-level composite foreign keys (`ON DELETE RESTRICT`); historical references are never cascaded or destroyed. When equipment changes or is renamed, `session_exercises` preserves an immutable `equipment_name_snapshot`. Inactive equipment is retired via `is_active = false`. The legacy gym-scoped `gym_equipment` rows are kept read-only for history and undo.
- **Source Preset Provenance**: When starting a session from a preset, `source_preset_id` references the preset with composite foreign keys using `ON DELETE SET NULL (source_preset_id)` and a `source_preset_name` snapshot. Deleting a preset never deletes or nullifies owner isolation on historical workout sessions.
- **Preset Workout Order**: A preset-started session never uses a random order. Its starting order is a deterministic, documented product decision (balanced rotation of the last completed order from the same preset, optional priority muscle groups, optional alternation between main muscle groups) and its stored `exercise_order_basis` is explained in the live workout. Ordering reads the exercise-to-muscle relevance matrix with a documented principal-target threshold (0.75) but makes no hypertrophy claim. See [Preset workout order](PRESET_EXERCISE_ORDER.md).
- **Set State Transitions & Data Integrity**:
  - *Blank Set Slot*: Weight, reps, and RIR are unpopulated. Used for live planning and automatically pruned upon session conclusion.
  - *Draft Set*: Partially filled sets (e.g. weight entered without reps, or non-warmup set missing RIR). Draft sets block session conclusion until completed or discarded. The conclusion RPC strictly rejects uncompleted drafts.
  - *Completed Set*: A warmup with weight and reps (RIR omitted), or a working/high-RIR set with weight, reps, and explicit RIR (0–4).
  - *Analytical Working Set*: Completed non-warmup set with RIR 0–3.
- **Offline Durability & Idempotent Autosave**: Field edits are coalesced locally in device storage with generation-aware debounced background autosaving. Sync states (`saved`, `saving`, `offline`, `failed`) keep network status transparent. Session conclusion strictly requires all local pending edits to be persisted to the server before concluding; local pending edits are never cleared until persistence is confirmed. Structural operations (adding exercises, removing exercises, removing sets, reordering) are atomic server-side RPCs with row-level session locking (`FOR UPDATE`) and canonical refetching upon uncertain network results.
