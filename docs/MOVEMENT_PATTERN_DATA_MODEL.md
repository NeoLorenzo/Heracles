# Movement-pattern data model

## Scope

Exercises, movement patterns, muscles, and published mappings are global reference data shared by every signed-in user. User ownership begins with workout records such as gyms, sessions, performed exercises, and sets.

Equipment is not part of the global exercise definition or movement mapping. The equipment actually used remains on `session_exercises`, allowing two performances of the same exercise to retain different machine identifiers.

## Global reference tables

### `exercises`

The existing exercise catalogue was converted from owner-scoped rows into a single global catalogue while preserving its existing IDs and all links from workout history.

Important fields are:

- `id`: internal identity key.
- `code`: stable machine identifier that does not change with the display label.
- `name`: globally unique canonical exercise name.
- `description`: optional future explanatory text.
- `is_active`: permits retirement without deleting historical references.

Authenticated users can read this table but cannot insert, update, or delete rows through the public client.

### `movement_patterns`

Each row represents one biomechanical dimension from the mapping matrix. The current table contains 40 rows.

Important fields are:

- `source_order`: stable column position in the imported matrix version.
- `code`: stable machine-readable identifier.
- `name`: complete movement-pattern label.
- `plane`: sagittal, frontal, transverse, or scapular.
- `articulation`: normalized anatomical articulation identifier.
- `action`: the modelled action, including positional qualifications where present.
- `contraction_type`: dynamic or isometric.
- `description`: current plain-language structural description.
- `is_active`: permits retirement without deleting historical mappings.

### `muscles`

The muscle catalogue contains the 40 canonical hypertrophy-model entities defined by `MUSCLE_GROUP_TAXONOMY.md`. Each row has a stable identity and code, an authored display order, a canonical name, a broad anatomical group, an optional description, and an active flag.

The catalogue is intentionally separate from movement patterns. The versioned movement-pattern-to-muscle matrix connects the two models without conflating anatomical function with exercise-specific hypertrophic stimulus.

### `movement_muscle_mapping_versions`

Each row identifies an immutable movement-pattern-to-muscle functional matrix. It stores publication state, source and documentation filenames and hashes, a normalized-payload hash, expected dimensions, non-zero-cell count, and change notes. Only one published version may be current.

The initial version is `initial_2026_08_10`:

- 40 movement patterns and 40 muscles.
- 1,600 explicit cells, including zeros.
- 112 non-zero cells.
- Source SHA-256: `c0664168df7b971c84e24d5a9cebdf04ffde3c09c5eda8726a16559e539e50e2`.
- Normalized payload SHA-256: `595631fe61e70f75cc848c8caed75f047d16301ee3a42d541b5724a3121f6bf7`.

### `movement_pattern_muscle_coefficients`

This versioned cell table links `movement_patterns` to `muscles`. Its independent `numeric(4,3)` coefficients are functional-anatomy priors: they describe whether and how materially a tracked muscle can produce a movement pattern. They are not percentages, force shares, exercise-to-muscle mappings, or hypertrophy-stimulus scores, and rows must not be normalized.

All 1,600 cells are stored explicitly. The initial cells have `methodology_only` rationale status because the accompanying README documents general evidence constraints rather than a separate written rationale for every cell.

### `exercise_muscle_mapping_versions`

Each row identifies an immutable derived exercise-to-muscle functional-composition matrix. It references the exact exercise-to-pattern and pattern-to-muscle versions used as inputs and records the composition algorithm, formula, payload hash, dimensions, nonzero-cell count, cells above one, maximum score, and publication state.

The current version is `exercise_definitions_2026_08_10` and uses `raw_sum_product_v1`:

```text
score(exercise, muscle)
= sum over movement patterns (
    exercise-pattern coefficient × pattern-muscle coefficient
  )
```

It contains 138 exercises, 40 muscles, 5,520 explicit cells, 1,152 nonzero cells, 91 cells above one, and a maximum raw score of `2.0`. Its derived payload SHA-256 is `5d2aa404f975039f337aea446bf07e3fbad6c299786858fab9c62e2f0419cdf5`.

### `exercise_muscle_coefficients`

This versioned cell table stores the raw matrix product for every exercise-muscle pair plus the number of movement-pattern paths with a nonzero product. Its scores use `numeric(10,6)` so the sum of exact three-decimal input products remains exact.

Scores are never normalized or capped and may exceed one. They are derived functional-composition features, not percentages, force shares, or hypertrophy-stimulus estimates. The complete interpretation and limitations are documented in [Exercise × Muscle Functional Composition Matrix](EXERCISE_MUSCLE_COMPOSITION.md).

### `exercise_muscle_relevance_versions`

Each row identifies an immutable published exercise-to-muscle hypertrophic-relevance matrix. It records the exact upstream movement-model versions used to constrain the exercise-specific audit, the source CSV and documentation hashes, the canonical payload hash, dimensions, nonzero-cell count, coefficient contract, and publication state.

The current `initial_2026_08_10` version contains 138 exercises, 40 muscles, 5,520 explicit cells, and 723 nonzero cells. Its values are independent authored relevance levels rather than a deterministic transformation of the functional-composition scores.

### `exercise_muscle_relevance_coefficients`

This versioned cell table stores one explicit `numeric(3,2)` coefficient for every exercise-muscle pair. Allowed values are `0`, `0.25`, `0.50`, `0.75`, and `1.00`. Values are not percentages and rows are not normalized. The full assumptions, construction method, evidence calibration, and limitations are documented in [Exercise → Muscle Hypertrophic Relevance Matrix](EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.md).

Session-history muscle pills use nonzero cells from the current relevance version so incidental anatomical contributors from the functional model are not displayed as worthwhile hypertrophy targets.

### `movement_mapping_versions`

Each row identifies a complete published matrix. The record stores its source filename, source and normalized-payload SHA-256 hashes, expected dimensions, non-zero cell count, methodology revision, publication state, and change notes.

Only one version may have `is_current = true`. Older published versions can be retained or retired without changing their coefficient rows.

The initial version is `initial_2026_08_07`:

- 140 exercises.
- 40 movement patterns.
- 5,600 total cells.
- 556 non-zero cells.
- Source SHA-256: `8bc0f6246b0939db59c668de7a95962c2b7a82d3f9445adbef4860177d2241b1`.
- Normalized payload SHA-256: `01dc8219500127aa1b78498bddbbb44d0d3c1f92b6e3de769b5fa14c8283a801`.

Those hashes remain the provenance of the originally published matrix. On 2026-08-10, the source CSV's exercise labels were normalized by removing the legacy muscle-group prefixes and changing shoulder `Press` variants to `Overhead Press`; the coefficients and stable exercise IDs did not change. The renamed CSV has source SHA-256 `29ef2b3d6395f21e3d4c1dfb9a736412f92a45b781bcd6cb767b902a901a0347`.

The current version is `exercise_definitions_2026_08_10`:

- 138 exercises derived from the 138 distinct authoritative workout-history names.
- 40 movement patterns and 5,520 total cells.
- 548 non-zero cells.
- Source SHA-256: `93cc08e6b5c4751f7e8d3b7546a2bf4ea2fc567d25a9aea1f7c85087ceaa6c27`.
- Normalized CSV payload SHA-256: `b9c35da6e826ad1666fc1893f69e3bbbe6bda524918f21ce6d34bd45f3965318`.

These hashes supersede the initially recorded hashes for this version. The reconciliation changed four CSV labels to the authoritative workout-history/catalogue names (`EZ Bar Attachment` and the explicit landmine `Barbell` qualifier); no movement coefficient changed.

This version applies the authoritative exercise-definition cleanup. The three dumbbell back-extension definitions use the no-angle survivor coefficients, and the unilateral wrist-curl definition retains its existing coefficients after absorbing the retired synonym. Renamed exercises retain their prior coefficients unchanged; no collapsed rows are averaged.

### `exercise_movement_pattern_coefficients`

This is the versioned matrix-cell table. Its primary key is:

```text
mapping_version_id + exercise_id + movement_pattern_id
```

Every cell is stored explicitly, including zero-valued cells. This distinguishes a reviewed zero from an exercise-pattern pair that was never imported and makes complete CSV-to-database reconciliation possible.

`coefficient` is an exact `numeric(4,3)` constrained to the inclusive range `0–1`. It follows the independent-coefficient methodology in [Movement-pattern contribution coefficients](MOVEMENT_PATTERN_COEFFICIENTS.md) and must never be row-normalized.

Each cell also has:

- `rationale`: the available explanation for the cell.
- `rationale_status`: `methodology_only` or `documented`.

The initial import honestly marks all cells as `methodology_only`: the general coefficient interpretation is documented, but an exercise-specific biomechanical justification has not yet been written for each individual cell.

## Workout relationship

`session_exercises.exercise_id` references the global `exercises.id` directly and is the sole performed-exercise identity. The current `exercises.name` is the sole authoritative label. All workout ownership controls remain unchanged on `session_exercises` and its parent/child tables.

## Security

All global reference tables have Row Level Security enabled.

- `authenticated`: `SELECT` only.
- `anon`: no table access.
- Public browser clients cannot alter exercises, movement patterns, muscles, versions, or source or derived coefficients.
- Workout tables retain their existing owner-scoped RLS policies.

Administrative changes to global reference data must be reviewed and applied through controlled database migrations or equivalent privileged tooling. Secret or service-role credentials must never be exposed to the PWA.

## Import and verification guarantees

The initial migration:

1. Confirmed that the database contained the expected 140 unique exercises under one pre-conversion owner.
2. Confirmed that every performed exercise referenced its existing catalogue row.
3. Parsed the CSV through the spreadsheet import workflow.
4. Confirmed 140 exercise rows, 40 pattern columns, 5,600 cells, 556 non-zero cells, unique names, and coefficients within `0–1`.
5. Stored all matrix cells and their version metadata in one database transaction.
6. Rechecked catalogue, alias, pattern, cell, non-zero-cell, and historical-link counts before committing.
7. Compared every database cell to the CSV after migration; the mismatch count was zero.

## Remaining movement-pattern work

The schema and initial data import are complete. The following product and scientific work remains:

1. Write exercise-specific biomechanical rationales and change each reviewed cell from `methodology_only` to `documented`.
2. Scientifically review the generated structural descriptions for all 40 movement patterns and add deeper plain-language explanations where useful.
3. Define an administrative draft-review-publish workflow for future matrix versions and new global exercises.
4. Add any true historical exercise aliases that should resolve during future imports; the initial alias table currently contains canonical names only.
5. Integrate movement-pattern explanations and weighted-set calculations into the app, while keeping effort, RPE/RIR, load, repetitions, user-specific ROM, and hypertrophy modelling as separate downstream dimensions.
6. Decide how future exercise variants should be represented when execution changes biomechanics materially. Issue #22 settled the equipment side: canonical equipment is recorded on each performed exercise and exercise definitions no longer encode it; merged definitions use one documented scoring source each.
