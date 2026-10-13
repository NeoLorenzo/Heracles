# Heracles

**An evidence-aware strength training system that turns workout logs into interpretable strength and hypertrophy signals.**

Most lifting apps are good notebooks: they record exercises, sets, reps, and personal records. Heracles is built around a stronger requirement — the analytical model should be inspectable. It combines a practical training ledger with explicit movement and muscle models, RIR-aware strength estimation, body-weight context, provenance, and documented limitations.

The goal is not to manufacture a single authoritative "progress score." It is to preserve the underlying training evidence and derive useful signals in ways that remain understandable and contestable.

## What Heracles does

Heracles covers both the act of training and the analysis that follows it:

- start or resume persistent workout sessions and record exercises, equipment, sets, reps, load, and RIR;
- use previous-performance context while training;
- review completed sessions and progression over time;
- calculate multiple observed and RIR-adjusted e1RM estimates without averaging them into a false single truth;
- optionally normalize strength estimates to body weight when valid body-weight evidence exists;
- model exercise-to-muscle relevance through explicit, versioned movement and muscle matrices;
- manage reusable workout presets;
- expose the reasoning, evidence quality, scientific foundations, and limitations through the Literature surface.

Heracles deliberately does **not** treat weight × reps / tonnage as a default hypertrophy metric. Product decisions like this are documented rather than hidden inside an opaque scoring layer.

## Position in the system

Heracles is a domain-specific system rather than a whole-person model:

- **Heracles** owns resistance-training history, training-specific analysis, and strength evidence.
- **Kleos** can consume relevant Heracles outputs as evidence when modelling the broader current state of the person.
- **Ariadne** connects current state and desired direction to priorities, projects, opportunities, and action.

Conceptually:

```text
Training observations → Heracles analysis → Kleos current-state evidence → Ariadne strategy and action
```

Heracles goes deep on one domain. Kleos goes broad across the person. Ariadne turns desired change into execution.

## Current product

The application has two access states:

- **Signed out:** a crawlable public front page with **Sign in** in the top-right. It shows the product through an animated live-workout demo, a tour of each signed-in screen (clearly labelled as illustrative example data), a scroll-driven walk-through of one set from entry to progression, an e1RM calculator that runs the app's own `set-model.js`, and an explorer for the complete exercise-to-muscle hypertrophic-relevance matrix loaded from its authoritative CSV. It also covers principles, evidence boundaries, the Fabbro Systems context, and the Literature library.
- **Signed in:** Home (start or resume a workout, a year-long heatmap of analytical working sets per day, plus recent sessions) and live-workout flow, Session History, My Data analytics, My Stuff preset management, a Literature hub, Settings for body-weight data, and sign-out controls.

The signed-in workout flow supports persistent session state, equipment-aware exercise history, previous-performance context, and recovery-oriented autosave behavior. The application is deployed as a static GitHub Pages site and uses Supabase Auth plus owner-scoped workout data and global reference data in Postgres.

> **Branding note:** the product is **Heracles** everywhere: the GitHub repository (`NeoLorenzo/Heracles`), the Supabase project, and the canonical production application at `heracles.fabbrosystems.com`. "Lorenzo's Lifting Ledger" is a retired former name and must not be reintroduced. Early migrations still reference the original gym-data CSV filename as immutable import provenance; that is historical data, not product branding.

## Security model

`config.js` contains a Supabase project URL and a **publishable** key. Both are designed to be public in browser apps. Never put any of these in this repository:

- a Supabase secret key or legacy `service_role` key
- a Google OAuth client secret
- database passwords
- private access tokens

All future user-owned tables must enable Row Level Security before the app writes data.

## Data model

- `data_imports` records body-weight CSV provenance and checksums per user.
- `exercises` is the global, app-managed exercise catalogue shared by every user.
- `movement_patterns` defines the global biomechanical dimensions used by the movement matrix.
- `muscles` defines the ordered 40-entity global muscle catalogue used by the hypertrophy model.
- `movement_mapping_versions` records immutable published matrix metadata and source hashes.
- `exercise_movement_pattern_coefficients` stores every exercise-by-pattern cell for each matrix version, including explicit zeroes.
- `movement_muscle_mapping_versions` records immutable movement-pattern-to-muscle functional-matrix metadata and source hashes.
- `movement_pattern_muscle_coefficients` stores all 1,600 explicit cells in each 40-by-40 functional matrix version.
- `exercise_muscle_mapping_versions` records the exact upstream versions and composition algorithm used for each derived exercise-to-muscle matrix.
- `exercise_muscle_coefficients` stores all 5,520 explicit raw composition scores in the current 138-by-40 derived matrix.
- `exercise_muscle_relevance_versions` records immutable provenance for the authored exercise-specific hypertrophic-relevance layer.
- `exercise_muscle_relevance_coefficients` stores all 5,520 explicit relevance cells using the documented `0`, `0.25`, `0.50`, `0.75`, and `1.00` contract.
- `gyms` is the top-level owner-scoped gym list.
- `workout_sessions` stores completed and in-progress workouts. A partial unique index allows only one in-progress session per owner; blank active sessions may not have a gym yet.
- `session_exercises` stores ordered exercise occurrences by canonical `exercise_id` plus any equipment ID used in that session. `exercises.name` is the sole display label.
- `exercise_sets` stores each numbered weight/reps pair, warm-up/drop-set/superset flags, reported RIR and its provenance, legacy/deprecated RPE observations, and generated observed and RIR-adjusted Brzycki/Epley estimated 1RM values.
- `workout_presets` stores each owner-scoped, uniquely named reusable exercise pool.
- `workout_preset_exercises` stores unordered, deduplicated exercise references plus a reusable set count. Starting from a preset randomizes exercise order and creates blank set slots without copying load, reps, equipment, RIR, or warm-up state.
- `body_weight_measurements` stores owner-scoped raw scale observations in kilograms from CSV imports or Apple Health synchronization. CSV observations remain date-canonical and retain `data_imports` provenance; Apple Health observations use deterministic source keys, exact timestamps, and optional source metadata, and multiple distinct Apple Health observations may share a calendar date.
- `user_settings` stores the owner-scoped, default-off `relative_e1rm_enabled` presentation preference.

Body-weight CSV imports use column A as an exact `DD/MM/YYYY` date and column B as a positive kilogram value; optional headers and additional ignored columns are supported. The filename and export source are not part of the contract. Raw same-day observations are preserved, while `body_weight_daily_series` selects one deterministic representative per measured day for analytics and calculates missing days only between measured representatives using linear interpolation: `W(d) = W1 + (W2 - W1) × (days from d1 / days between d1 and d2)`. Calculated/interpolated values are not persisted as scale observations and are never extrapolated. Settings supports previewing, importing/correcting, inspecting measurement coverage and last-import freshness, and deleting only the signed-in user's body-weight dataset. See [Body Weight Data](docs/BODY_WEIGHT_DATA.md) for the complete CSV, Apple Health provenance, daily-series, and interpolation contract.

When explicitly enabled in Settings, each absolute e1RM formula value is divided independently by the measured or interpolated body weight on each workout date and displayed as a dimensionless `× BW` value. Absolute generated e1RM columns remain canonical and unchanged. Relative values are unavailable outside body-weight coverage because the app does not extrapolate. Dumbbell relative e1RM remains per dumbbell.

All dumbbell exercise weights use one product-wide convention: the stored value is always the weight of **one dumbbell**, for both unilateral and bilateral exercises. A set performed with two 30 kg dumbbells is therefore stored as `30 kg`, not `60 kg`; dumbbell e1RM values use and retain that same per-dumbbell unit.

Every user-data table has an `owner_id` reference to `auth.users`. Row Level Security limits select, insert, update, and delete operations to the signed-in owner. Parent/child foreign keys also include the owner ID so records cannot be connected across users. Global exercise and movement reference tables are readable by authenticated users but are not writable from the public client. Personal gym and body-weight exports remain local and are ignored by Git because this repository is public.

## Scientific model

The current scientific catalogue contains 138 global exercise definitions, 40 movement patterns, 40 muscles, a current 5,520-cell exercise-to-pattern mapping version, a current 1,600-cell movement-pattern-to-muscle functional mapping version, a current 5,520-cell derived exercise-to-muscle composition version, and a current 5,520-cell exercise-to-muscle hypertrophic-relevance version. Canonical workout history lives only in the normalized workout hierarchy.

Exercise names are globally standardized. `session_exercises.exercise_id` is the sole performed-exercise identity and the current `exercises.name` is always used for presentation. Equipment IDs remain on session exercises rather than exercise definitions because different machines for the same movement can have different resistance profiles.

The movement-pattern schema, access model, import guarantees, and current follow-up work are documented in [Movement-pattern data model](docs/MOVEMENT_PATTERN_DATA_MODEL.md). Coefficient semantics and limitations are documented separately in [Movement-pattern contribution coefficients](docs/MOVEMENT_PATTERN_COEFFICIENTS.md). The 40-entity hypertrophy model is defined in [Muscle Group Taxonomy for Hypertrophy Modelling](docs/MUSCLE_GROUP_TAXONOMY.md). The functional link between movement patterns and muscles is documented in [Movement Pattern → Muscle Function Matrix](docs/MOVEMENT_PATTERN_TO_MUSCLE_FUNCTION.md). The deterministic matrix product is documented in [Exercise × Muscle Functional Composition Matrix](docs/EXERCISE_MUSCLE_COMPOSITION.md). The exercise-specific filtering and weighting layer is documented in [Exercise → Muscle Hypertrophic Relevance Matrix](docs/EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.md), with shared scientific limits stated in [Current Limitations of Muscle Group Mapping](docs/CURRENT_LIMITATIONS_OF_MUSCLE_GROUP_MAPPING.md).

The app intentionally does not calculate or display weight × reps, tonnage, or volume load. The scientific and product rationale is documented in [Why the app does not track tonnage](docs/WHY_THE_APP_DOES_NOT_TRACK_TONNAGE.md).

### Strength estimation and RIR

RIR is the active proximity-to-failure input; RPE is retained only as a legacy historical observation. Warm-ups store no RIR. Non-warm-up sets with reported RIR 0–3 are analytical working sets, while the stored bucket `4` means open-ended `4+` RIR and remains visible only as high-RIR history. Historical non-warm-up sets were backfilled to RIR 0 with `historical_backfill` provenance; future saved entries use `user_entered` provenance. The 0–3 cutoff is an app analytical rule, not a biological claim that 4+ RIR produces zero hypertrophy.

For each representative RIR 0–3 working set, strength progression preserves four calculated e1RM values: Brzycki and Epley using completed reps, plus both formulas using completed reps + reported RIR. The representative set is selected from observed completed performance only, before RIR adjustment. Values use Brzycki `weight × 36 ÷ (37 − reps)` and Epley `weight × (1 + reps ÷ 30)`, retain the formulas' existing validity limits, and are rounded to two decimal places.

The four-value model spread is not averaged into one estimate, is not a confidence interval or a measured true 1RM, and does not introduce a literature-derived true-RIR uncertainty model. High-RIR `4+` sets are excluded because their open-ended RIR cannot provide a finite adjusted repetition count. Relative presentation divides each formula value independently by body weight on the workout date; it does not store or replace those absolute estimates.

## Live infrastructure

- App: <https://heracles.fabbrosystems.com/> — canonical production domain for Heracles.
- Supabase project: `Heracles` (`yfhmjwkscqbpzblrpsoy`, London).
- Production Site URL and redirect allow-list are configured in Supabase.
- GitHub Pages deploys from `main` at `/ (root)` with HTTPS enforced.

## Remaining Google setup

1. In Google Cloud Console, create an OAuth 2.0 Client ID of type **Web application**.
2. Add `https://yfhmjwkscqbpzblrpsoy.supabase.co/auth/v1/callback` as its authorized redirect URI.
3. In Supabase, open **Authentication → Providers → Google**, enable Google, and enter the Google client ID and client secret. The secret stays in Supabase and must never be committed.

## Local check

OAuth callbacks require an HTTP origin; do not open `index.html` directly from disk.

```powershell
npm run dev
```

Then visit `http://127.0.0.1:5173/`. The development server disables browser caching so frontend edits appear after a refresh.

Run the repository checks with:

```powershell
npm test
```

## Files

- `index.html` — minimal app shell
- `app.js` — Supabase Google sign-in/session handling, top-level orchestration
- `features/body-weight.js` — body-weight import/deletion controller and relative e1RM preference settings
- `features/dashboard.js` — My Data / Dashboard UI controller, state management, date-range and muscle exposure filtering, progression charts, and recent change rendering
- `features/presets.js` — My Stuff / presets creation, editing, deletion controller, and preset exercise picker UI
- `body-weight.js` — generic body-weight CSV parsing, validation, preview, and interpolation helpers
- `presets.js` — pure preset name normalization, draft validation, and unique exercise extraction helpers
- `relative-e1rm.js` — pure absolute-to-relative e1RM range and effective-mode helpers
- `literature.js` — safe in-app Markdown rendering and the Literature document registry
- `config.js` — public browser configuration only
- `styles.css` — shared base styles and the Fabbro Application Sidebar shell
- `public.css` — signed-out public site (Fabbro Public Shell)
- `features/public-showcase.js` — signed-out interactive showcase (live-workout demo, product tour, set walk-through, e1RM calculator, relevance-matrix explorer); calculated values reuse `set-model.js` and `analytics.js`, and the matrix is read from `EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.csv`
- `app.css` — signed-in application design layer; every rule is scoped to `#signed-in` or `body.is-authenticated` so it cannot affect the public site
- `manifest.webmanifest` and `service-worker.js` — installable PWA metadata and offline shell
- `docs/` — app-facing scientific methods, product decisions, model interpretations, limitations, and evidence-quality specifications surfaced through Literature; filenames use uppercase snake case
