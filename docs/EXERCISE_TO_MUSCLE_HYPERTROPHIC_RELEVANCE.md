# Exercise → Muscle Hypertrophic Relevance Matrix

## Purpose

This matrix converts the project's anatomical movement model into a **first-pass estimate of worthwhile hypertrophic involvement for each exercise**.

It is designed to solve the problem that a muscle can be anatomically capable of contributing to a movement without receiving enough loading for that contribution to be useful in a hypertrophy-focused app. For example, pectoralis major can contribute to some shoulder actions present in a lat pulldown, but a lat pulldown should not therefore be treated like meaningful chest training.

The final matrix contains the exact 138-exercise catalogue and the project's 40 muscle entities.

## Coefficient contract

Each value is an independent **Exercise–Muscle Hypertrophic Relevance coefficient** under the assumption of one sufficiently hard set, normal intended technique, and a normal/full useful range of motion.

| Value | Meaning |
|---:|---|
| `1.00` | Principal hypertrophy target |
| `0.75` | Major target / very substantial contribution |
| `0.50` | Substantial secondary contribution |
| `0.25` | Small but worthwhile contribution |
| `0` | Do not count as meaningful hypertrophic stimulus |

The values are **not percentages**, are not normalized, and are not measurements of actual muscle growth. A row can contain multiple `1.00` values.

These coefficients describe the *exercise*, not the quality of a particular logged set. Variables such as RIR, load progression, set count, execution quality, and fatigue should be modelled separately downstream.

## Construction method

The mapping was built in three stages:

1. **Exercise → Movement Pattern matrix**
   - Defines the dynamic and materially loaded isometric actions present in each exercise.

2. **Movement Pattern → Muscle Function matrix**
   - Defines which tracked muscles are anatomically capable of producing those actions.

3. **Exercise-specific hypertrophy audit**
   - Removes anatomically possible but practically incidental muscles.
   - Adjusts relative relevance for joint position, muscle length, biarticular interference, exercise support, resistance geometry, and available longitudinal hypertrophy evidence.

The movement-pattern model therefore constrains the final mapping but does not mechanically determine it.

## Important corrections made by this layer

- **Lat pulldowns:** pectoralis major and pectoralis minor are not counted merely because they can contribute to some component shoulder/scapular actions.
- **Squat/leg-press patterns:** hamstrings are not given meaningful hypertrophy credit simply because they are anatomical hip extensors.
- **Hip thrusts:** hamstrings are not treated as major targets despite their hip-extension function.
- **Leg curls:** seated curls give greater relevance to the biarticular hamstrings than prone curls.
- **Triceps extensions:** overhead variants give maximal relevance to the long head; neutral-arm pushdowns give the long head less credit.
- **Lateral raises:** dumbbell variants include more upper-trapezius relevance than cable variants.
- **Supported rows:** externally supported exercises do not receive the erector-spinae credit assigned to genuinely unsupported bent-over rows.
- **Chest flies vs pulldowns:** the sternocostal pectoralis can receive `1.00` on a pec fly while receiving `0` on a pulldown.

## Exercise assumptions

The following catalogue-specific assumptions were supplied explicitly:

- `Back Extensions (Dumbbell)` = 45° hyperextension bench.
- `Dips (Machine)` = chest-focused seated dip machine.
- `Overhead Press (Landmine) (Barbell) (Kneeling)` = unilateral one-arm landmine press.
- `Row (Dumbbell) (Bent Over) (Unilateral)` = non-working hand/arm supported on a bench or rack.
- Generic incline machine presses are treated as moderate incline presses, approximately 30–45°.

Machine mappings describe the generic exercise geometry rather than any particular manufacturer unless the catalogue explicitly defines a unique movement.

## Selected longitudinal evidence used for calibration

- Maeo et al. — seated vs prone leg curl and individual hamstring hypertrophy:
  https://pubmed.ncbi.nlm.nih.gov/33009197/

- Maeo et al. — overhead vs neutral-arm elbow extension and triceps-head hypertrophy:
  https://pubmed.ncbi.nlm.nih.gov/35819335/

- Kinoshita et al. — standing vs seated calf raises and gastrocnemius/soleus hypertrophy:
  https://pubmed.ncbi.nlm.nih.gov/38156065/

- Kubo et al. — squat depth and hypertrophy of gluteal, adductor and thigh musculature:
  https://pubmed.ncbi.nlm.nih.gov/31230110/

- Plotkin et al. — squat vs hip-thrust hypertrophy:
  https://pubmed.ncbi.nlm.nih.gov/37877099/

- Kassiano et al. — squat vs leg-extension hypertrophy:
  https://pubmed.ncbi.nlm.nih.gov/41379528/

- Larsen et al. — dumbbell vs cable lateral-raise hypertrophy:
  https://pubmed.ncbi.nlm.nih.gov/40692697/

- Attarieh et al. — preacher vs Bayesian cable curl regional hypertrophy:
  https://pubmed.ncbi.nlm.nih.gov/40082069/

## Current limitation

This remains a **modelled estimate of worthwhile hypertrophic relevance**, not a direct measurement of stimulus.

There is no scientifically validated method for converting every logged resistance-training exercise into a precise numerical quantity of future muscle growth. The matrix should therefore be used as a disciplined, auditable approximation rather than presented as biological ground truth.

Future high-quality longitudinal evidence can revise individual exercise–muscle coefficients without changing the underlying architecture.

## Provenance and versioning

The authoritative source is `EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.csv`. It remains the unchanged provenance of the 138-exercise versions.

Issue #22 removed equipment from exercise identity. The current published version covers 116 canonical exercises (4,640 cells); each canonical exercise keeps the authored row of its documented scoring source unchanged, as recorded in `docs/scientific/issue-22-canonical-exercise-identity.json`. `EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE_CANONICAL.csv` is that projection (no coefficient edited) and is what the public relevance-matrix explorer loads.

The initial published version contains:

- 138 exercises;
- 40 muscles;
- 5,520 explicit cells, including zeroes;
- 723 nonzero cells;
- 141 cells at `0.25`;
- 178 cells at `0.50`;
- 218 cells at `0.75`;
- 186 cells at `1.00`.

Source-text SHA-256 (UTF-8 BOM retained; CRLF normalized to LF before hashing): `506cd478b08fa1289cf2c9263e92aa68296a92e82380919321f708a54d72c3b8`.

The source-checksum metadata was corrected in September 2026 after Linux CI exposed that the originally documented value matched neither the committed bytes nor BOM, line-ending, or final-newline normalization variants. Repository history confirms that the authoritative CSV blob has been unchanged since it and this documentation were introduced together on 2026-08-10; this correction changes provenance metadata only, not any exercise–muscle coefficient.

Canonical payload SHA-256: `ea447d03fdc8284768512a47fb713a5670bfd7f507155df8bbf3337285b3de3f`.

Published versions are immutable. A coefficient correction, catalogue change, or evidence-led revision must create a new version rather than silently rewriting the current one.
