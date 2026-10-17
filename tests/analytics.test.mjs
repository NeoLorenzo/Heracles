import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateExerciseSources,
  calculateExposureTrend,
  calculateMuscleExposure,
  calculatePercentageChange,
  compareRecentPeriods,
  createLinearScale,
  createBucketKeys,
  filterByRange,
  getEquipmentSeriesKey,
  getDateRange,
  getRepeatedExercises,
  joinDashboardData,
  selectRepresentativeSets,
  selectRepresentativeSetsBySeries,
  workingSets,
} from "../analytics.js";

const groups = [
  { code: "chest", name: "Chest", sourceOrder: 1, muscles: [] },
  { code: "shoulders", name: "Shoulders", sourceOrder: 2, muscles: [] },
  { code: "triceps", name: "Triceps", sourceOrder: 3, muscles: [] },
];

const lookup = new Map([[1, [
  { name: "Sternocostal", relevance: 1, uiGroup: groups[0] },
  { name: "Clavicular", relevance: 0.75, uiGroup: groups[0] },
  { name: "Pec Minor", relevance: 0.25, uiGroup: groups[0] },
  { name: "Anterior Deltoid", relevance: 0.5, uiGroup: groups[1] },
  { name: "Triceps Long Head", relevance: 0.75, uiGroup: groups[2] },
]]]);

const set = (overrides = {}) => ({
  id: 1,
  session_id: 10,
  performed_on: "2026-08-10",
  exercise_id: 1,
  exercise_name: "Press",
  is_warmup: false,
  reported_rir_bucket: 0,
  weight: 100,
  reps: 8,
  estimated_1rm_low: null,
  estimated_1rm_high: null,
  ...overrides,
});

test("joins dashboard records and applies canonical RIR working-set classification", () => {
  const records = joinDashboardData(
    [{ id: 10, performed_on: "2026-08-10" }],
    [{ id: 20, session_id: 10, exercise_id: 1, exercises: { name: "Press" } }],
    [{ id: 1, session_exercise_id: 20, is_warmup: true, reported_rir_bucket: null }, { id: 2, session_exercise_id: 20, is_warmup: false, reported_rir_bucket: 3 }, { id: 3, session_exercise_id: 20, is_warmup: false, reported_rir_bucket: 0, weight: null, reps: null }, { id: 4, session_exercise_id: 20, is_warmup: false, reported_rir_bucket: 4 }],
  );
  assert.equal(records.length, 4);
  assert.deepEqual(workingSets(records).map((record) => record.id), [2]);
});

test("keeps canonical equipment identity separate from historical display provenance", () => {
  const [record] = joinDashboardData(
    [{ id: 10, performed_on: "2026-08-10" }],
    [{ id: 20, session_id: 10, exercise_id: 1, exercises: { name: "Press" }, gym_equipment_id: 42, equipment_name_snapshot: "Prime Leg Extension" }],
    [{ id: 1, session_exercise_id: 20, is_warmup: false }],
  );
  assert.equal(record.equipment_id, 42);
  assert.equal(record.equipment_name, "Prime Leg Extension");
  assert.equal(getEquipmentSeriesKey(record), "equipment-42");
});

test("keeps same-named equipment IDs in separate progression series", () => {
  const records = [
    set({ id: 1, session_id: 10, equipment_id: 42, equipment_name: "Prime" }),
    set({ id: 2, session_id: 11, equipment_id: 42, equipment_name: "Prime" }),
    set({ id: 3, session_id: 10, equipment_id: 43, equipment_name: "Prime" }),
    set({ id: 4, session_id: 11, equipment_id: 43, equipment_name: "Prime" }),
  ];
  assert.deepEqual(selectRepresentativeSetsBySeries(records, 1).map(getEquipmentSeriesKey), ["equipment-42", "equipment-42", "equipment-43", "equipment-43"]);
});

test("calculates independent detailed exposure and max-child UI group exposure", () => {
  const result = calculateMuscleExposure([set(), set({ id: 2 })], lookup, groups);
  assert.equal(result.detailedExposure.get("Sternocostal"), 2);
  assert.equal(result.detailedExposure.get("Clavicular"), 1.5);
  assert.equal(result.groupExposure.get("chest"), 2);
  assert.notEqual(result.groupExposure.get("chest"), 4);
});

test("credits one compound set independently across UI groups", () => {
  const result = calculateMuscleExposure([set()], lookup, groups);
  assert.equal(result.groupExposure.get("chest"), 1);
  assert.equal(result.groupExposure.get("shoulders"), 0.5);
  assert.equal(result.groupExposure.get("triceps"), 0.75);
});

test("attributes exercise sources as working sets times max-child group relevance", () => {
  const sources = calculateExerciseSources([set(), set({ id: 2 })], lookup, "chest");
  assert.deepEqual(sources, [{ exercise_id: 1, exercise_name: "Press", value: 2 }]);
});

test("filters four- and eight-week ranges and creates ordered Monday buckets", () => {
  const now = new Date("2026-08-10T12:00:00Z");
  const fourWeeks = getDateRange("4w", now);
  const eightWeeks = getDateRange("8w", now);
  assert.equal(fourWeeks.start.toISOString().slice(0, 10), "2026-07-20");
  assert.equal(eightWeeks.start.toISOString().slice(0, 10), "2026-06-22");
  assert.deepEqual(createBucketKeys(fourWeeks), ["2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"]);
  assert.deepEqual(filterByRange([
    { performed_on: "2026-07-19" },
    { performed_on: "2026-07-20" },
    { performed_on: "2026-08-10" },
  ], fourWeeks), [{ performed_on: "2026-07-20" }, { performed_on: "2026-08-10" }]);
});

test("all-time range begins at the first session and trends stay chronological", () => {
  const range = getDateRange("all", new Date("2026-08-10T12:00:00Z"), [
    { performed_on: "2026-05-20" }, { performed_on: "2026-02-01" },
  ]);
  assert.equal(range.start.toISOString().slice(0, 10), "2026-02-01");
  assert.deepEqual(createBucketKeys(range), ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  assert.deepEqual(calculateExposureTrend([set({ performed_on: "2026-08-10" })], lookup, "chest", range).at(-1), { key: "2026-08", value: 1 });
});

test("compares current four weeks with the previous four and preserves previous zero", () => {
  const sessions = [{ id: 1, performed_on: "2026-06-16" }, { id: 2, performed_on: "2026-08-10" }];
  const comparison = compareRecentPeriods(sessions, [set()], lookup, new Date("2026-08-10T12:00:00Z"), groups);
  assert.equal(comparison.available, true);
  assert.equal(comparison.groups.find((group) => group.code === "chest").previous, 0);
  assert.equal(comparison.groups.find((group) => group.code === "chest").delta, 1);
});

test("recent comparison reports insufficient history", () => {
  const result = compareRecentPeriods([{ id: 1, performed_on: "2026-08-01" }], [set()], lookup, new Date("2026-08-10T12:00:00Z"), groups);
  assert.deepEqual(result, { available: false });
});

test("representative set uses observed conservative ordering and is not boosted by RIR", () => {
  const records = [
    set({ id: 1, weight: 120, reps: 4 }),
    set({ id: 2, weight: 100, reps: 8, reported_rir_bucket: 3 }),
    set({ id: 3, weight: 105, reps: 6, reported_rir_bucket: 0 }),
    set({ id: 4, weight: 150, reps: 2, estimated_1rm_low: 160, estimated_1rm_high: 165, is_warmup: true }),
    set({ id: 5, session_id: 11, performed_on: "2026-08-03", weight: 110, reps: 6 }),
    set({ id: 6, session_id: 11, performed_on: "2026-08-03", weight: 110, reps: 7 }),
  ];
  assert.deepEqual(selectRepresentativeSets(records, 1).map((record) => record.id), [6, 1]);
});

test("progression eligibility requires working sets in at least two sessions", () => {
  const records = [
    set({ id: 1, exercise_name: "Repeated", session_id: 10 }),
    set({ id: 2, exercise_name: "Repeated", session_id: 11 }),
    set({ id: 3, exercise_id: 2, exercise_name: "One off", session_id: 12 }),
    set({ id: 4, exercise_id: 3, exercise_name: "Warm-up only", session_id: 13, is_warmup: true }),
  ];
  assert.deepEqual(getRepeatedExercises(records), [{ exercise_id: 1, exercise_name: "Repeated" }]);
});

test("keys exercise analytics by canonical ID even when display labels collide", () => {
  const records = [
    set({ id: 1, exercise_id: 1, exercise_name: "Current label", session_id: 10 }),
    set({ id: 2, exercise_id: 1, exercise_name: "Current label", session_id: 11 }),
    set({ id: 3, exercise_id: 2, exercise_name: "Current label", session_id: 12 }),
  ];
  assert.deepEqual(getRepeatedExercises(records), [{ exercise_id: 1, exercise_name: "Current label" }]);
  assert.deepEqual(selectRepresentativeSets(records, 1).map((record) => record.id), [1, 2]);
});

test("progression chooses a representative set per session and equipment series", () => {
  const records = [
    set({ id: 1, equipment_id: "Machine A", weight: 90 }),
    set({ id: 2, equipment_id: "Machine A", weight: 100 }),
    set({ id: 3, equipment_id: "Machine B", weight: 80 }),
    set({ id: 4, session_id: 11, performed_on: "2026-08-11", equipment_id: "Machine A", weight: 105 }),
  ];
  assert.deepEqual(selectRepresentativeSetsBySeries(records, 1).map((record) => record.id), [2, 3, 4]);
});

test("handles missing RPE, e1RM, and exercise mappings without inventing values", () => {
  const records = [set({ rpe: null }), set({ id: 2, exercise_id: 99, exercise_name: "Unknown" })];
  const result = calculateMuscleExposure(records, lookup, groups);
  assert.equal(records[0].rpe, null);
  assert.equal(records[0].estimated_1rm_low, null);
  assert.deepEqual([...result.unmappedExercises], [[99, "Unknown"]]);
});

test("dashboard source contains no tonnage calculation", async () => {
  const source = await readFile(new URL("../analytics.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /weight\s*\*\s*(?:reps|record\.reps)|(?:reps|record\.reps)\s*\*\s*weight/i);
});

test("creates a readable linear scale for estimated one-rep-max charts", () => {
  const scale = createLinearScale([33, 88, 94, 97, 100]);
  assert.ok(scale.minimum <= 33);
  assert.ok(scale.maximum >= 100);
  assert.ok(scale.ticks.length >= 4);
  assert.equal(scale.position(scale.minimum), 0);
  assert.equal(scale.position(scale.maximum), 100);
  assert.ok(scale.position(88) > scale.position(33));
});

test("calculates recent percentage changes without infinite zero-baseline values", () => {
  assert.equal(calculatePercentageChange(15, 8), 87.5);
  assert.equal(calculatePercentageChange(6, 8), -25);
  assert.equal(calculatePercentageChange(8, 8), 0);
  assert.equal(calculatePercentageChange(5, 0), null);
});

test("ISSUE 22: one exercise performed with Dumbbell at several gyms forms one progression series", () => {
  const records = joinDashboardData(
    [{ id: 10, performed_on: "2026-08-10" }, { id: 11, performed_on: "2026-08-17" }],
    [
      { id: 20, session_id: 10, exercise_id: 1, exercises: { name: "Lateral Raise (Seated)" }, gym_equipment_id: 42, canonical_equipment_id: 7, equipment: { name: "Dumbbell" }, equipment_name_snapshot: "Dumbbell" },
      { id: 21, session_id: 11, exercise_id: 1, exercises: { name: "Lateral Raise (Seated)" }, gym_equipment_id: 43, canonical_equipment_id: 7, equipment: { name: "Dumbbell" }, equipment_name_snapshot: "Dumbbell" },
    ],
    [
      { id: 1, session_exercise_id: 20, is_warmup: false, reported_rir_bucket: 1, weight: 12, reps: 12 },
      { id: 2, session_exercise_id: 21, is_warmup: false, reported_rir_bucket: 1, weight: 14, reps: 10 },
    ],
  );
  assert.deepEqual([...new Set(records.map(getEquipmentSeriesKey))], ["equipment-7"]);
  assert.deepEqual(selectRepresentativeSetsBySeries(records, 1).map(getEquipmentSeriesKey), ["equipment-7", "equipment-7"]);
});

test("ISSUE 22: series labels use the current canonical name so corrected placeholders relabel history", () => {
  const [record] = joinDashboardData(
    [{ id: 10, performed_on: "2026-08-10" }],
    [{ id: 20, session_id: 10, exercise_id: 1, exercises: { name: "Leg Extension" }, gym_equipment_id: null, canonical_equipment_id: 9, equipment: { name: "Matrix G3-S71" }, equipment_name_snapshot: null }],
    [{ id: 1, session_exercise_id: 20, is_warmup: false }],
  );
  assert.equal(record.equipment_id, 9);
  assert.equal(record.equipment_name, "Matrix G3-S71");
});
