# Post-workout recap

## Purpose

After a workout is successfully concluded, Heracles opens a recap of what was just recorded. It answers two questions per exercise: did today's estimated strength change compared with the last comparable workout, and is it higher than every earlier comparable estimate? It is a short post-session summary, not a replacement for My Data analytics.

The recap is computed in the browser (`workout-recap.js`, rendered by `features/workout-recap.js`) from persisted, owner-scoped rows read under the existing Row Level Security policies. It adds no table, column, migration, or stored score, and it never stores the rendered recap as a new record.

## When it appears

The live-workout controller calls `onSessionConcluded` only after pending edits have been flushed and the `conclude_workout_session` RPC has succeeded. The app then replaces the finished live-workout history entry with Home and shows the recap page. If the recap cannot load (for example, the network drops right after saving), it says that the workout was saved and still offers **Done**. The recap never blocks or retries saving.

The recap reloads the session from the server and refuses to summarise a session whose status is not `completed`, so it reflects stored data rather than unsaved in-memory edits. Because it is recalculated from stored rows, a later correction to a historical session changes what a recalculated recap would show.

The recap page is not URL-backed. After a workout, **Done** returns to Home, and reloading the page also lands on Home.

Every completed session in Session History has a **View recap** button. It recalculates the recap from the stored rows at that moment, so the result reflects any later corrections to that session or to earlier ones. Opening it adds a browser history entry. **Back to Session history**, or the device's Back gesture, returns to the list at the same scroll position. Nothing is written when a recap is opened.

## Session summary

- **Date:** the stored `performed_on` workout date, plus the preset and gym names when recorded.
- **Exercises:** the number of saved exercise entries in the workout (the same count Session History shows).
- **Working sets:** completed non-warm-up sets with reported RIR 0–3 (`isAnalyticalWorkingSet`), the same definition used across the app.
- **Duration is not shown.** Heracles stores when a session was created but not when it ended, so no reliable duration exists.

## Strength comparison method

**Comparable series.** The recap has one row per exercise and canonical equipment in the workout, following the canonical equipment identity rule in the [design rules](DESIGN_RULES.md) (issue #22). A row is compared with the same `exercise_id` on the same `canonical_equipment_id` at **any gym**, because canonical equipment is one record per real piece of equipment. The equipment key reuses the My Data series helper (`getEquipmentSeriesKey`). The legacy gym-scoped `gym_equipment_id` and the legacy `equipment_id` text are never read or used as a fallback. A row with no recorded equipment is compared only with earlier rows at the **same gym** that also have no equipment recorded. This matches the gym scoping the previous-performance context applies when equipment is missing. A different machine or implement for the same exercise is never compared.

**Labels.** Exercise names are equipment-free, so each row is labelled with its recorded equipment, for example `Chest Press · Smith Machine`. The current canonical equipment name is used, with the session's snapshot name as fallback. A row without equipment shows the exercise name plus "Equipment not recorded".

**Representative set.** For each series in each session, the recap uses the representative RIR 0–3 working set chosen by `selectRepresentativeSetsBySeries`, the same selection used by the strength progression. Warm-ups and `4+` RIR sets are excluded.

**Compared value.** The lower of the two observed estimates from completed reps:

- Brzycki: `weight × 36 ÷ (37 − reps)`
- Epley: `weight × (1 + reps ÷ 30)`
- compared value: `min(Brzycki, Epley)`, in kg (kg per dumbbell when the recorded equipment is a dumbbell, as decided by `usesPerDumbbellLoad`)

This is the same key used to rank representative sets. It is used because:

- it is one existing, explainable value rather than an average of different formulas;
- it excludes the reported-RIR adjustment, so only entered load and reps move the comparison and a change in subjective RIR reporting cannot create an apparent strength change;
- it is the more conservative of the two observed formulas.

The other three progression values (observed Epley or Brzycki, and both RIR-adjusted variants) are still shown in My Data. The recap does not replace them. A set that cannot produce an estimate is reported as unavailable, not as zero. This covers zero load and repetition counts outside Brzycki's existing validity limit of 36 reps. The relative (`× BW`) e1RM preference does not apply to the recap. Percent changes compare absolute estimates, so body-weight changes do not move them.

**Last comparable session.** The most recent earlier completed session that has an estimate in the same series. Sessions are ordered by `performed_on`, then `created_at`, then ID, as in the previous-performance context. This is not necessarily the previous workout. Sessions after the recapped one, and sessions that are not completed, never count.

**Change.** `(today − last) ÷ last × 100`, rounded to 0.1 %, with the existing `calculatePercentageChange` helper. Both absolute estimates are shown next to the percentage.

**Similar band.** A change smaller than **1 %** in either direction is labelled **Similar**. At or above +1 % it is **Improved**, and at or below −1 % it is **Declined**. This is a Heracles product display rule chosen to avoid presenting tiny estimate differences as progress or regression. It is not a scientifically validated minimal detectable change, and the in-app method note says so.

**New best.** Today's compared value is strictly higher than every earlier comparable estimate. Equalling the previous best is not a new best. Improving on the last session is reported separately and is not automatically a new best. A small gain can be both **Similar** to the last session and a **New best** when it exceeds every earlier estimate. The first session in a series is a **baseline**, never a new best.

**Colour and text.** Improved, declined, and similar changes use the app's fixed green, red, and neutral meaning. Each also carries an explicit signed percentage and a text label, so colour is never the only signal.

## Interpretation and limits

- e1RM is a calculated estimate, not a measured 1RM. Session-to-session changes can come from fatigue, rep ranges, technique, or equipment setup. They do not prove hypertrophy or a true strength change.
- Brzycki and Epley diverge at higher repetitions. Comparing sets with very different rep counts compares estimates from different parts of those formulas.
- Comparability depends on equipment being recorded consistently.
- Dumbbell weights and estimates are always per dumbbell. The recorded equipment decides this, so the same exercise done on a machine is in kg, in its own series.

## Workout score decision

The first slice deliberately shows **no workout score**. It shows only a transparent count of the rows below, such as `2 improved · 1 new best · 1 similar`. A composite score would merge different exercises, equipment, and rep ranges into one falsely precise number, and it could reward PR-chasing or junk volume. The recap also never uses weight × reps, tonnage, or volume load. A heuristic score or a separate, clearly labelled subjective session rating may be considered later only if its inputs and purpose can be explained under the [design rules](DESIGN_RULES.md).

## Sharing

**Share** sends a recap the user chooses to share. Heracles creates no public link, uploads nothing, and stores no share record. Two forms are prepared when the recap renders, so the device's share sheet opens straight from the tap:

- **Image card:** a 1080 × 1350 PNG (`features/workout-recap-card.js`) drawn locally on a canvas in the signed-in colour tokens. It leads with new bests, then the other rows in workout order, and fits up to six exercises. Any rows that don't fit are summarised as "+ N more exercises".
- **Text:** every exercise row, as plain text.

Where the browser can share files, both go to the system share sheet. Where it can only share text, the text is shared. Without a share sheet, the image is downloaded and the text is copied to the clipboard. Closing the share sheet is not treated as an error.

Shared output keeps the same labels and units as the screen: signed e1RM percentages, "kg per dumbbell" for dumbbell exercises, and baselines. It ends with the note "e1RM = estimated 1RM … Not a measured max." For privacy it leaves out the gym name. Recorded equipment stays next to each exercise, for example `Chest Press · Smith Machine`, because the exercise name alone no longer says how the lift was done. It never includes tonnage, volume load, or a score.

## Not yet implemented

- Highlights beyond per-exercise rows and the counts, such as returning to an exercise after a long gap.
- Reopening a recap with the browser's Forward button after going back. Forward returns to Session History instead.
