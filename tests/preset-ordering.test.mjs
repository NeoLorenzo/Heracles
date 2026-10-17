import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PRESET_ORDER_PREFERENCE,
  PRESET_ORDER_MODES,
  PRINCIPAL_TARGET_MIN_RELEVANCE,
  compareExerciseNames,
  describeExerciseOrderBasis,
  normalizePresetOrderPreference,
  planPresetExerciseOrder,
  principalMuscleGroups,
} from "../preset-ordering.js";

const GROUPS = {
  adductors: { code: "adductors", name: "Adductors", sourceOrder: 2 },
  chest: { code: "chest", name: "Chest", sourceOrder: 6 },
  glutes: { code: "glutes", name: "Glutes", sourceOrder: 8 },
  hamstrings: { code: "hamstrings", name: "Hamstrings", sourceOrder: 9 },
  quads: { code: "quads", name: "Quads", sourceOrder: 11 },
  shoulders: { code: "shoulders", name: "Shoulders", sourceOrder: 12 },
  triceps: { code: "triceps", name: "Triceps", sourceOrder: 13 },
};

function muscle(groupCode, relevance, name = `${groupCode} muscle`) {
  return { name, relevance, uiGroup: GROUPS[groupCode] };
}

const EXERCISES = {
  legExtension: { id: 1, name: "Leg Extension (Machine)", muscles: [muscle("quads", 1)] },
  hamstringCurl: { id: 2, name: "Leg Curl (Machine) (Seated)", muscles: [muscle("hamstrings", 1)] },
  adductor: { id: 3, name: "Hip Adduction (Machine)", muscles: [muscle("adductors", 1)] },
  chestPress: { id: 10, name: "Chest Press (Machine)", muscles: [muscle("chest", 1), muscle("triceps", 0.5), muscle("shoulders", 0.5)] },
  pecFly: { id: 11, name: "Fly (Pec Deck Machine)", muscles: [muscle("chest", 1)] },
  inclinePress: { id: 12, name: "Press (Dumbbell) (Incline 30)", muscles: [muscle("chest", 1), muscle("shoulders", 0.75), muscle("triceps", 0.5)] },
  pushdown: { id: 20, name: "Pushdown (Cable) (V-Bar)", muscles: [muscle("triceps", 1)] },
  overheadExtension: { id: 21, name: "Overhead Triceps Extension (Cable)", muscles: [muscle("triceps", 1)] },
  squat: { id: 30, name: "Squat (Barbell)", muscles: [muscle("quads", 1), muscle("glutes", 0.75), muscle("adductors", 0.75)] },
  romanianDeadlift: { id: 31, name: "Romanian Deadlift (Barbell)", muscles: [muscle("hamstrings", 1), muscle("glutes", 0.75)] },
  hipThrust: { id: 32, name: "Hip Thrust (Barbell)", muscles: [muscle("glutes", 1), muscle("hamstrings", 0.25)] },
  calfRaise: { id: 33, name: "Calf Raise (Machine) (Standing)", muscles: [] },
};

const BY_ID = new Map(Object.values(EXERCISES).map((exercise) => [exercise.id, exercise]));

function lookupFor(exercises) {
  return new Map(exercises.filter((exercise) => exercise.muscles.length).map((exercise) => [exercise.id, exercise.muscles]));
}

function members(...exercises) {
  return exercises.map(({ id, name }) => ({ id, name }));
}

function previousFrom(ids, extra = {}) {
  return {
    id: 900,
    performedOn: "2026-10-12",
    presetName: "Lower",
    exercises: ids.map((id) => ({ id, name: BY_ID.get(id)?.name ?? `Exercise ${id}` })),
    ...extra,
  };
}

function plan(exercises, { previousIds = null, preference = DEFAULT_PRESET_ORDER_PREFERENCE, lookup = lookupFor(exercises), previous = null } = {}) {
  return planPresetExerciseOrder({
    exercises: members(...exercises),
    previousSession: previous ?? (previousIds ? previousFrom(previousIds) : null),
    preference,
    muscleLookup: lookup,
    presetName: "Lower",
  });
}

function groupOf(id) {
  return principalMuscleGroups(BY_ID.get(id).muscles)[0]?.code ?? `unmapped:${id}`;
}

function simulateSessions(exercises, count, preference) {
  const orders = [];
  let previousIds = null;
  for (let index = 0; index < count; index += 1) {
    const { exerciseIds } = plan(exercises, { previousIds, preference });
    orders.push(exerciseIds);
    previousIds = exerciseIds;
  }
  return orders;
}

test("balanced rotation moves last time's first exercise to the end (issue example)", () => {
  const lower = [EXERCISES.legExtension, EXERCISES.hamstringCurl, EXERCISES.adductor];
  const { exerciseIds, basis } = plan(lower, { previousIds: [1, 2, 3] });
  assert.deepEqual(exerciseIds, [2, 3, 1]);
  assert.equal(basis.strategy, "rotation");
  assert.deepEqual(basis.previousFirst, { id: 1, name: "Leg Extension (Machine)" });
  assert.deepEqual(basis.first, { id: 2, name: "Leg Curl (Machine) (Seated)" });

  assert.deepEqual(plan(lower, { previousIds: [2, 3, 1] }).exerciseIds, [3, 1, 2]);
  assert.deepEqual(plan(lower, { previousIds: [3, 1, 2] }).exerciseIds, [1, 2, 3]);
});

test("repeated rotation gives every exercise one turn at the front", () => {
  const lower = [EXERCISES.legExtension, EXERCISES.hamstringCurl, EXERCISES.adductor];
  for (const alternateMuscleGroups of [true, false]) {
    const orders = simulateSessions(lower, 3, { mode: PRESET_ORDER_MODES.BALANCED_ROTATION, alternateMuscleGroups });
    assert.deepEqual(new Set(orders.map((order) => order[0])), new Set([1, 2, 3]));
  }
});

test("rotation reads the order actually completed, so manual reordering feeds the next workout", () => {
  const lower = [EXERCISES.legExtension, EXERCISES.hamstringCurl, EXERCISES.adductor];
  // Heracles suggested 2, 3, 1 but the lifter moved the adductor to the front.
  assert.deepEqual(plan(lower, { previousIds: [3, 2, 1] }).exerciseIds, [2, 1, 3]);
});

test("first workout from a preset uses a stable alphabetical order, never a shuffle", () => {
  const lower = [EXERCISES.legExtension, EXERCISES.hamstringCurl, EXERCISES.adductor];
  const { exerciseIds, basis } = plan(lower, {
    preference: { mode: PRESET_ORDER_MODES.BALANCED_ROTATION, alternateMuscleGroups: false },
  });
  assert.deepEqual(exerciseIds, [3, 2, 1]);
  assert.equal(basis.strategy, "first_session_alphabetical");
  assert.equal(basis.previousSession, null);
  assert.deepEqual(basis.addedExercises, []);
});

test("alphabetical fallback compares names character by character", () => {
  const sorted = [
    { id: 2, name: "leg press" },
    { id: 3, name: "Leg Press" },
    { id: 1, name: "Leg Curl (Machine)" },
    { id: 4, name: "Leg Curl" },
  ].sort(compareExerciseNames);
  assert.deepEqual(sorted.map((exercise) => exercise.id), [4, 1, 3, 2]);
});

test("the same inputs always produce the same order regardless of input order", () => {
  const push = [EXERCISES.chestPress, EXERCISES.pecFly, EXERCISES.pushdown, EXERCISES.overheadExtension];
  const first = plan(push, { previousIds: [11, 20, 10, 21] });
  const reversed = planPresetExerciseOrder({
    exercises: members(...[...push].reverse()),
    previousSession: previousFrom([11, 20, 10, 21]),
    preference: DEFAULT_PRESET_ORDER_PREFERENCE,
    muscleLookup: lookupFor(push),
    presetName: "Lower",
  });
  assert.deepEqual(reversed, first);
  assert.deepEqual(plan(push, { previousIds: [11, 20, 10, 21] }), first);
});

test("alternation interleaves muscle groups and keeps each exercise whole", () => {
  const push = [EXERCISES.chestPress, EXERCISES.pecFly, EXERCISES.pushdown, EXERCISES.overheadExtension];
  const { exerciseIds } = plan(push);
  // Alphabetical: Chest Press, Fly, Overhead Triceps Extension, Pushdown.
  assert.deepEqual(exerciseIds, [10, 21, 11, 20]);
  assert.equal(new Set(exerciseIds).size, exerciseIds.length, "each exercise appears exactly once");
  for (let index = 1; index < exerciseIds.length; index += 1) {
    assert.notEqual(groupOf(exerciseIds[index]), groupOf(exerciseIds[index - 1]));
  }
});

test("alternation with rotation balances both groups and exercises at the front", () => {
  const push = [EXERCISES.chestPress, EXERCISES.pecFly, EXERCISES.pushdown, EXERCISES.overheadExtension];
  const orders = simulateSessions(push, 4, DEFAULT_PRESET_ORDER_PREFERENCE);
  assert.deepEqual(orders, [
    [10, 21, 11, 20],
    [21, 11, 20, 10],
    [11, 20, 10, 21],
    [20, 10, 21, 11],
  ]);
  assert.deepEqual(new Set(orders.map((order) => order[0])), new Set([10, 11, 20, 21]));
  for (const order of orders) {
    for (let index = 1; index < order.length; index += 1) {
      assert.notEqual(groupOf(order[index]), groupOf(order[index - 1]));
    }
  }
});

test("a group with more exercises finishes at the end once the others run out", () => {
  const push = [EXERCISES.chestPress, EXERCISES.pecFly, EXERCISES.inclinePress, EXERCISES.pushdown];
  const { exerciseIds } = plan(push);
  // Alphabetical chest: Chest Press, Fly, Press; triceps: Pushdown.
  assert.deepEqual(exerciseIds, [10, 20, 11, 12]);

  const orders = simulateSessions(push, 6, DEFAULT_PRESET_ORDER_PREFERENCE);
  const leaders = orders.map((order) => groupOf(order[0]));
  assert.equal(leaders.filter((code) => code === "triceps").length, 3);
  assert.equal(leaders.filter((code) => code === "chest").length, 3);
  assert.deepEqual(new Set(orders.map((order) => order[0])), new Set([10, 11, 12, 20]));
});

test("a single muscle group is a plain exercise rotation with or without alternation", () => {
  const chest = [EXERCISES.chestPress, EXERCISES.pecFly, EXERCISES.inclinePress];
  for (const alternateMuscleGroups of [true, false]) {
    const { exerciseIds, basis } = plan(chest, {
      previousIds: [11, 12, 10],
      preference: { mode: PRESET_ORDER_MODES.BALANCED_ROTATION, alternateMuscleGroups },
    });
    assert.deepEqual(exerciseIds, [12, 10, 11]);
    assert.equal(basis.groupCount, 1);
  }
});

test("with alternation disabled, same-group exercises stay adjacent and groups rotate as blocks", () => {
  const push = [EXERCISES.chestPress, EXERCISES.pecFly, EXERCISES.inclinePress, EXERCISES.pushdown];
  const preference = { mode: PRESET_ORDER_MODES.BALANCED_ROTATION, alternateMuscleGroups: false };
  const orders = simulateSessions(push, 6, preference);
  assert.deepEqual(orders, [
    [10, 11, 12, 20],
    [20, 11, 12, 10],
    [11, 12, 10, 20],
    [20, 12, 10, 11],
    [12, 10, 11, 20],
    [20, 10, 11, 12],
  ]);
  for (const order of orders) {
    const groups = order.map(groupOf);
    const blocks = groups.filter((code, index) => index === 0 || code !== groups[index - 1]);
    assert.equal(blocks.length, new Set(groups).size, `groups stay contiguous in ${order}`);
  }
});

test("priority mode places exercises that mainly train a priority group first and rotates each part", () => {
  const legs = [EXERCISES.legExtension, EXERCISES.hamstringCurl, EXERCISES.romanianDeadlift, EXERCISES.squat];
  const preference = {
    mode: PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY,
    alternateMuscleGroups: false,
    priorityGroupCodes: ["hamstrings"],
  };
  const first = plan(legs, { preference });
  // Priority (hamstrings): Leg Curl, Romanian Deadlift. Rest: Leg Extension, Squat.
  assert.deepEqual(first.exerciseIds, [2, 31, 1, 30]);
  assert.equal(first.basis.priorityExerciseCount, 2);

  const second = plan(legs, { preference, previousIds: first.exerciseIds });
  assert.deepEqual(second.exerciseIds, [31, 2, 30, 1]);
  assert.deepEqual(second.basis.previousFirst, { id: 2, name: "Leg Curl (Machine) (Seated)" });
});

test("priority uses the documented principal-target threshold, including major targets", () => {
  assert.equal(PRINCIPAL_TARGET_MIN_RELEVANCE, 0.75);
  const glutes = [EXERCISES.squat, EXERCISES.hipThrust, EXERCISES.hamstringCurl];
  const { exerciseIds, basis } = plan(glutes, {
    preference: { mode: PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY, alternateMuscleGroups: false, priorityGroupCodes: ["glutes"] },
  });
  // Squat lists glutes at 0.75 (major target), so it is a priority exercise.
  assert.deepEqual(exerciseIds, [32, 30, 2]);
  assert.equal(basis.priorityExerciseCount, 2);

  // Hip thrust lists hamstrings at only 0.25, so it is not a hamstring priority exercise.
  const hamstrings = plan(glutes, {
    preference: { mode: PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY, alternateMuscleGroups: false, priorityGroupCodes: ["hamstrings"] },
  });
  assert.deepEqual(hamstrings.exerciseIds, [2, 32, 30]);
});

test("priority groups alternate among themselves before the non-priority groups", () => {
  const session = [EXERCISES.hamstringCurl, EXERCISES.romanianDeadlift, EXERCISES.hipThrust, EXERCISES.legExtension, EXERCISES.adductor];
  const { exerciseIds } = plan(session, {
    preference: { mode: PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY, alternateMuscleGroups: true, priorityGroupCodes: ["glutes", "hamstrings"] },
  });
  // Priority tier: Hip Thrust (glutes), Leg Curl (hamstrings), Romanian Deadlift (hamstrings, its strongest priority group).
  // Rest: Hip Adduction (adductors), Leg Extension (quads).
  assert.deepEqual(exerciseIds, [32, 2, 31, 3, 1]);
});

test("an exercise with several principal groups is assigned to its strongest, then catalogue-first, group", () => {
  assert.deepEqual(principalMuscleGroups(EXERCISES.squat.muscles).map((group) => group.code), ["quads", "adductors", "glutes"]);
  assert.deepEqual(
    principalMuscleGroups([muscle("triceps", 1, "a"), muscle("chest", 1, "b"), muscle("chest", 0.5, "c"), muscle("shoulders", 0.5)])
      .map((group) => group.code),
    ["chest", "triceps"],
  );
});

test("exercises without a principal-target mapping are non-priority and alternate as their own group", () => {
  const session = [EXERCISES.hamstringCurl, EXERCISES.calfRaise, EXERCISES.legExtension];
  const lookup = lookupFor(session);
  lookup.set(EXERCISES.legExtension.id, [muscle("quads", 0.5)]);
  const { exerciseIds, basis } = plan(session, {
    lookup,
    preference: { mode: PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY, alternateMuscleGroups: true, priorityGroupCodes: ["calves", "quads"] },
  });
  assert.deepEqual(exerciseIds, [33, 2, 1]);
  assert.equal(basis.priorityExerciseCount, 0);
  assert.deepEqual(basis.unmappedExercises.map((exercise) => exercise.id), [33, 1]);
  const text = describeExerciseOrderBasis(basis).join(" ");
  assert.match(text, /no principal-target muscle mapping, so each is treated as non-priority and alternated as its own group/);
  assert.match(text, /None of this preset's exercises mainly train calves and quads/);
});

test("exercises added since the last workout go after last time's exercises", () => {
  const push = [EXERCISES.chestPress, EXERCISES.pecFly, EXERCISES.pushdown, EXERCISES.legExtension];
  const preference = { mode: PRESET_ORDER_MODES.BALANCED_ROTATION, alternateMuscleGroups: false };
  // Last time: Fly, Pushdown. Since then: Chest Press (chest) and Leg Extension (new group).
  const { exerciseIds, basis } = plan(push, { previousIds: [11, 20], preference });
  assert.deepEqual(exerciseIds, [20, 11, 10, 1]);
  assert.deepEqual(basis.addedExercises.map((exercise) => exercise.id), [10, 1]);
  assert.match(describeExerciseOrderBasis(basis).join(" "), /Added since then: Chest Press \(Machine\) and Leg Extension \(Machine\)/);
});

test("exercises removed from the preset are dropped from the order", () => {
  const lower = [EXERCISES.legExtension, EXERCISES.adductor];
  const { exerciseIds, basis } = plan(lower, { previousIds: [2, 1, 3] });
  assert.deepEqual(exerciseIds, [3, 1]);
  assert.deepEqual(basis.removedExercises.map((exercise) => exercise.id), [2]);
  assert.deepEqual(basis.previousFirst, { id: 1, name: "Leg Extension (Machine)" });
});

test("a previous workout sharing no current exercises falls back to alphabetical order", () => {
  const lower = [EXERCISES.legExtension, EXERCISES.adductor];
  const { exerciseIds, basis } = plan(lower, { previousIds: [2], preference: { alternateMuscleGroups: false } });
  assert.deepEqual(exerciseIds, [3, 1]);
  assert.equal(basis.strategy, "no_overlap_alphabetical");
});

test("repeated exercises in the previous workout count once, at their first position", () => {
  const lower = [EXERCISES.legExtension, EXERCISES.hamstringCurl, EXERCISES.adductor];
  assert.deepEqual(plan(lower, { previousIds: [1, 2, 1, 3] }).exerciseIds, [2, 3, 1]);
});

test("preference normalization falls back to balanced rotation with alternation on", () => {
  assert.deepEqual(normalizePresetOrderPreference(null), {
    mode: "balanced_rotation",
    alternateMuscleGroups: true,
    priorityGroupCodes: [],
  });
  assert.deepEqual(normalizePresetOrderPreference({ mode: "random", alternateMuscleGroups: "no", priorityGroupCodes: ["quads", "chest", "quads", 4] }), {
    mode: "balanced_rotation",
    alternateMuscleGroups: true,
    priorityGroupCodes: ["chest", "quads"],
  });
});

test("the explanation states what the order does without outcome claims", () => {
  const lower = [EXERCISES.legExtension, EXERCISES.hamstringCurl, EXERCISES.adductor];
  const { basis } = plan(lower, { previousIds: [1, 2, 3] });
  const lines = describeExerciseOrderBasis(basis, { formatDate: () => "Mon 12 Oct" });
  assert.equal(
    lines[0],
    "Rotated from your last Lower workout (Mon 12 Oct): Leg Extension (Machine) went first last time, so Leg Curl (Machine) (Seated) goes first today.",
  );
  assert.ok(lines.some((line) => /does not fully separate it/.test(line)));
  assert.ok(lines.some((line) => /rotates from the order you actually complete/.test(line)));

  const priority = plan(lower, {
    preference: { mode: PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY, alternateMuscleGroups: false, priorityGroupCodes: ["hamstrings"] },
  });
  priority.basis.priorityGroups = [{ code: "hamstrings", name: "Hamstrings" }];
  const priorityText = describeExerciseOrderBasis(priority.basis);
  assert.equal(priorityText[0], "Hamstrings is a priority, so exercises that mainly train it come first — placed earlier in the workout, while you're fresher.");
  assert.match(priorityText.join(" "), /No completed Lower workout yet, so exercises start in alphabetical order/);
  assert.match(priorityText.join(" "), /kept together/);

  const allText = [...lines, ...priorityText].join(" ");
  assert.doesNotMatch(allText, /hypertroph|growth|gains|stimulus|more muscle/i);
});

test("unknown or server-generated bases are explained honestly", () => {
  assert.deepEqual(describeExerciseOrderBasis(null), []);
  assert.deepEqual(describeExerciseOrderBasis({ version: 99, strategy: "rotation" }), []);
  assert.deepEqual(describeExerciseOrderBasis({ version: 1, strategy: "server_alphabetical" }), [
    "Exercises start in alphabetical order. You can reorder them at any time.",
  ]);
});

test("a one-exercise preset has nothing to rotate or alternate", () => {
  const { exerciseIds, basis } = plan([EXERCISES.legExtension], { previousIds: [1] });
  assert.deepEqual(exerciseIds, [1]);
  const text = describeExerciseOrderBasis(basis);
  assert.match(text.join(" "), /one exercise, so there is no order to rotate/);
  assert.doesNotMatch(text.join(" "), /alternate/);
});

function createOrderInputClient(tables) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, filters: [], orders: [], limit: null };
      queries.push(query);
      const result = () => Promise.resolve(tables[table] ?? { data: null, error: null });
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order(column, options) { query.orders.push([column, options?.ascending]); return builder; },
        limit(count) { query.limit = count; return builder; },
        maybeSingle: result,
        then(resolve, reject) { return result().then(resolve, reject); },
      };
      return builder;
    },
  };
}

test("order inputs come from the owner's preset, preference and latest completed session from the same preset", async () => {
  const { preparePresetExerciseOrder } = await import("../features/session/preset-order-inputs.js");
  const lower = [EXERCISES.legExtension, EXERCISES.hamstringCurl, EXERCISES.adductor];
  const client = createOrderInputClient({
    workout_presets: {
      data: {
        id: 7,
        name: "Lower",
        workout_preset_exercises: lower.map(({ id, name }) => ({ exercise_id: id, exercises: { id, name } })),
      },
      error: null,
    },
    user_settings: { data: { preset_order_mode: "balanced_rotation", preset_order_alternate_muscle_groups: false }, error: null },
    user_priority_muscle_groups: { data: [], error: null },
    workout_sessions: {
      data: {
        id: 55,
        performed_on: "2026-10-12",
        source_preset_name: "Lower",
        // Completed after a manual reorder: stored out of insertion order.
        session_exercises: [
          { exercise_id: 1, exercise_order: 3, exercises: { id: 1, name: EXERCISES.legExtension.name } },
          { exercise_id: 3, exercise_order: 1, exercises: { id: 3, name: EXERCISES.adductor.name } },
          { exercise_id: 2, exercise_order: 2, exercises: { id: 2, name: EXERCISES.hamstringCurl.name } },
        ],
      },
      error: null,
    },
  });

  const { exerciseIds, basis } = await preparePresetExerciseOrder({
    supabase: client,
    userId: "user-1",
    presetId: 7,
    ensureExerciseMuscleLookup: async () => lookupFor(lower),
  });

  assert.deepEqual(exerciseIds, [2, 1, 3]);
  assert.equal(basis.previousSession.id, 55);
  assert.equal(basis.alternateMuscleGroups, false);
  assert.equal(basis.presetName, "Lower");

  const sessionsQuery = client.queries.find((query) => query.table === "workout_sessions");
  assert.deepEqual(sessionsQuery.filters, [["owner_id", "user-1"], ["source_preset_id", 7], ["status", "completed"]]);
  assert.deepEqual(sessionsQuery.orders, [["performed_on", false], ["created_at", false], ["id", false]]);
  assert.equal(sessionsQuery.limit, 1);
  for (const table of ["workout_presets", "user_settings", "user_priority_muscle_groups"]) {
    assert.ok(client.queries.find((query) => query.table === table).filters.some(([column, value]) => column === "owner_id" && value === "user-1"));
  }
});

test("order inputs apply saved priority groups and surface load errors", async () => {
  const { preparePresetExerciseOrder } = await import("../features/session/preset-order-inputs.js");
  const legs = [EXERCISES.legExtension, EXERCISES.hamstringCurl];
  const tables = {
    workout_presets: {
      data: { id: 8, name: "Legs", workout_preset_exercises: legs.map(({ id, name }) => ({ exercise_id: id, exercises: { id, name } })) },
      error: null,
    },
    user_settings: { data: { preset_order_mode: "muscle_group_priority", preset_order_alternate_muscle_groups: true }, error: null },
    user_priority_muscle_groups: { data: [{ ui_muscle_group_id: 9, ui_muscle_groups: { code: "quads", name: "Quads", source_order: 11 } }], error: null },
    workout_sessions: { data: null, error: null },
  };
  const { exerciseIds, basis } = await preparePresetExerciseOrder({
    supabase: createOrderInputClient(tables),
    userId: "user-1",
    presetId: 8,
    ensureExerciseMuscleLookup: async () => lookupFor(legs),
  });
  assert.deepEqual(exerciseIds, [1, 2]);
  assert.deepEqual(basis.priorityGroups, [{ code: "quads", name: "Quads" }]);
  assert.equal(basis.strategy, "first_session_alphabetical");

  await assert.rejects(
    preparePresetExerciseOrder({
      supabase: createOrderInputClient({ ...tables, user_settings: { data: null, error: { message: "offline" } } }),
      userId: "user-1",
      presetId: 8,
    }),
    /Could not load your workout order preference: offline/,
  );
});

test("the workout-order preference defaults to balanced rotation with alternation on, and docs no longer describe a shuffle", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const [html, readme, migration] = await Promise.all([
    read("index.html"),
    read("README.md"),
    read("supabase/migrations/20261018120000_order_preset_workouts.sql"),
  ]);
  assert.match(html, /name="preset-order-mode" value="balanced_rotation" checked/);
  assert.match(html, /id="preset-order-alternate" type="checkbox" checked/);
  assert.match(html, /Alternate exercises between muscle groups/);
  assert.match(html, /relevance 0\.75 or 1\.00/);
  assert.doesNotMatch(html, /shuffle/i);
  assert.doesNotMatch(readme, /randomizes exercise order/);
  assert.match(readme, /docs\/PRESET_EXERCISE_ORDER\.md/);
  assert.doesNotMatch(migration.replace(/--.*$/gm, ""), /random\s*\(/i);
  assert.match(migration, /add column preset_order_alternate_muscle_groups boolean not null default true/);
  assert.match(migration, /add column preset_order_mode text not null default 'balanced_rotation'/);
  // Issue #22: preset exercises keep defaulting to canonical equipment, never legacy gym equipment.
  assert.match(migration, /select se_hist\.canonical_equipment_id/);
  assert.match(migration, /left join public\.equipment e/);
  assert.doesNotMatch(migration.replace(/--.*$/gm, ""), /gym_equipment/);
  assert.match(migration, /create trigger issue78_after_issue22_equipment_undo/);
});

test("ordering reads muscle groups from the current relevance version only", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /ensureExerciseMuscleLookup: \(\) => ensureExerciseMuscleLookup\(supabaseClient\)/);
  const lookup = app.slice(app.indexOf("async function ensureExerciseMuscleLookup"));
  assert.match(lookup, /\.from\("exercise_muscle_relevance_versions"\)[\s\S]*?\.eq\("is_current", true\)/);
  assert.match(lookup, /\.eq\("mapping_version_id", version\.id\)/);
});
