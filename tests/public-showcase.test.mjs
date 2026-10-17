import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DISPLAY_GROUP_ORDER,
  E1RM_PERSPECTIVES,
  MUSCLE_GROUP_BY_HEADER,
  UI_MUSCLE_GROUPS,
  buildExerciseMuscleLookup,
  estimateSet,
  exampleActivityLevels,
  exampleProgressionRanges,
  formulaText,
  orderExercisesForDisplay,
  parseRelevanceCsv,
  weightedSetsForOneSet,
} from "../features/public-showcase.js";
import { ACTIVITY_WEEKS } from "../features/activity-heatmap.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const relevanceMatrix = async () => parseRelevanceCsv(await read("EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE_CANONICAL.csv"));
const muscleCode = (header) => header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

test("public matrix explorer parses the canonical relevance source without reinterpreting it", async () => {
  const matrix = await relevanceMatrix();
  assert.equal(matrix.exercises.length, 116);
  assert.equal(matrix.muscles.length, 40);
  assert.equal(matrix.exercises.length * matrix.muscles.length, 4640);
  const allowed = new Set([0, 0.25, 0.5, 0.75, 1]);
  for (const exercise of matrix.exercises) {
    assert.equal(exercise.values.length, 40, exercise.name);
    for (const value of exercise.values) assert.ok(allowed.has(value), `${exercise.name} has undocumented coefficient ${value}`);
  }
  assert.equal(orderExercisesForDisplay(matrix).length, 116, "display ordering must neither drop nor duplicate exercises");
});

test("public muscle-group presentation mirrors the ui_muscle_groups migration", async () => {
  const [matrix, migration] = await Promise.all([
    relevanceMatrix(),
    read("supabase/migrations/20260810191604_add_ui_muscle_groups.sql"),
  ]);
  const groups = new Map([...migration.matchAll(/\((\d+), '([a-z_]+)', '([^']+)'\)/g)].map(([, order, code, name]) => [code, { code, name, sourceOrder: Number(order) }]));
  assert.equal(groups.size, 13);
  assert.deepEqual(Object.fromEntries(Object.entries(UI_MUSCLE_GROUPS)), Object.fromEntries(groups));
  assert.deepEqual([...DISPLAY_GROUP_ORDER].sort(), [...groups.keys()].sort());

  const expectedGroupByMuscle = new Map([...migration.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map(([, muscle, group]) => [muscle, group]));
  assert.equal(expectedGroupByMuscle.size, 40);
  assert.deepEqual(Object.keys(MUSCLE_GROUP_BY_HEADER).sort(), [...matrix.muscles].sort());
  for (const header of matrix.muscles) {
    assert.equal(MUSCLE_GROUP_BY_HEADER[header], expectedGroupByMuscle.get(muscleCode(header)), header);
  }
});

test("public weighted-set example uses the dashboard's highest-child-coefficient rule", async () => {
  const lookup = buildExerciseMuscleLookup(await relevanceMatrix());
  const groups = weightedSetsForOneSet(lookup, "Chest Press (Incline 30)", { weight: 32.5, reps: 7, rir: 1 });
  assert.deepEqual(groups.map(({ code, value }) => [code, value]), [["chest", 1], ["shoulders", 0.75], ["triceps", 0.75]]);
  assert.deepEqual(weightedSetsForOneSet(lookup, "Chest Press (Incline 30)", { weight: 32.5, reps: 7, rir: 4 }), [], "4+ RIR sets are not working sets");
});

test("public estimate lab reproduces the app's four e1RM values and refusals", () => {
  const hero = estimateSet({ weight: 32.5, reps: 7, rir: 1 });
  assert.equal(hero.available, true);
  assert.equal(hero.classification, "1 RIR · Working set");
  assert.deepEqual(hero.values, { observedBrzycki: 39, observedEpley: 40.08, adjustedBrzycki: 40.34, adjustedEpley: 41.17 });
  assert.equal(formulaText("observedBrzycki", 32.5, 7, 1), "32.5 × 36 ÷ (37 − 7)");
  assert.equal(formulaText("adjustedEpley", 32.5, 7, 1), "32.5 × (1 + 8 ÷ 30)");
  assert.equal(E1RM_PERSPECTIVES.length, 4);

  const highRir = estimateSet({ weight: 100, reps: 8, rir: 4 });
  assert.equal(highRir.available, false);
  assert.equal(highRir.classification, "4+ RIR — not counted as a working set");
  assert.match(highRir.reason, /open-ended/);

  const outsideDomain = estimateSet({ weight: 100, reps: 35, rir: 3 });
  assert.equal(outsideDomain.available, false);
  assert.match(outsideDomain.reason, /1–36 repetition domain/);
});

test("public illustrative charts derive from the same models as the app", () => {
  const ranges = exampleProgressionRanges();
  assert.ok(ranges.length >= 2);
  for (const range of ranges) {
    assert.equal(range.low, Math.min(...Object.values(range.estimates)));
    assert.equal(range.high, Math.max(...Object.values(range.estimates)));
  }
  const levels = exampleActivityLevels();
  assert.equal(levels.length, ACTIVITY_WEEKS * 7);
  assert.ok(levels.every((level) => Number.isInteger(level) && level >= 0 && level <= 4));
});

test("public page labels example data and wires every sign-in call to action", async () => {
  const [html, app, serviceWorker] = await Promise.all([read("index.html"), read("app.js"), read("service-worker.js")]);
  const publicHome = html.slice(html.indexOf('<div id="public-home">'), html.indexOf('<section id="public-document-page"'));
  assert.match(publicHome, /Screens show illustrative example data\./);
  assert.match(publicHome, /Illustrative example data\./);
  assert.ok((publicHome.match(/data-sign-in/g) ?? []).length >= 2);
  assert.match(app, /signInButtons = \[[^\]]*document\.querySelectorAll\("\[data-sign-in\]"\)/);
  assert.match(html, /<script type="module" src="\.\/features\/public-showcase\.js\?v=\d+"><\/script>/);
  assert.ok(serviceWorker.includes(`"/${html.match(/src="\.\/(features\/public-showcase\.js\?v=\d+)"/)[1]}"`));
  assert.ok(serviceWorker.includes('"/EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE_CANONICAL.csv"'));
  assert.doesNotMatch(publicHome, /\btonnage (?:of|=|:)\s*\d/i, "the public page must not present a tonnage figure");
});

test("ISSUE 22: the canonical relevance source is the authored source projected through the documented scoring sources", async () => {
  const [authored, canonical, decision] = await Promise.all([
    read("EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.csv").then(parseRelevanceCsv),
    relevanceMatrix(),
    read("docs/scientific/issue-22-canonical-exercise-identity.json").then(JSON.parse),
  ]);
  assert.deepEqual(canonical.muscles, authored.muscles);
  const authoredByName = new Map(authored.exercises.map((exercise) => [exercise.name, exercise.values]));
  // Issue #3 added the bench-supported pushdown after the CSV was published; it inherits the cable pushdown row.
  authoredByName.set("Pushdown (Cable) (Bench Supported)", authoredByName.get("Pushdown (Cable) (EZ bar)"));
  const canonicalByName = new Map(canonical.exercises.map((exercise) => [exercise.name, exercise.values]));
  assert.equal(decision.canonicalExercises.length, canonical.exercises.length);
  for (const { canonicalName, scoringSource } of decision.canonicalExercises) {
    assert.deepEqual(canonicalByName.get(canonicalName), authoredByName.get(scoringSource), canonicalName);
  }
  for (const name of canonicalByName.keys()) {
    assert.doesNotMatch(name, /\((Dumbbells?|Barbell|EZ Bar|Machine|Cable|Cable Machine|Smith Machine|T-Bar|Bodyweight|Plate Loaded)\)/, name);
  }
});

test("ISSUE 22: the public page uses only canonical exercise names", async () => {
  const [html, decision] = await Promise.all([
    read("index.html"),
    read("docs/scientific/issue-22-canonical-exercise-identity.json").then(JSON.parse),
  ]);
  const canonicalNames = new Set(decision.canonicalExercises.map(({ canonicalName }) => canonicalName));
  for (const previousName of decision.canonicalExercises.flatMap(({ merged }) => merged.map(({ previousName }) => previousName))) {
    if (canonicalNames.has(previousName)) continue;
    assert.equal(html.includes(previousName), false, `index.html still shows ${previousName}`);
  }
  for (const [, pick] of html.matchAll(/data-matrix-pick="([^"]+)"/g)) {
    assert.ok(canonicalNames.has(pick), `${pick} is a canonical exercise`);
  }
});
