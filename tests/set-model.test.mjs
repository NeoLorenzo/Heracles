import assert from "node:assert/strict";
import test from "node:test";

import {
  SET_CLASS,
  calculateBrzycki,
  calculateEpley,
  calculateRirE1rmEstimates,
  classifySet,
  formatSetClassification,
  isAnalyticalWorkingSet,
  isBlankSet,
  isCompletedSet,
  isDraftSet,
  isWorkingSet,
} from "../set-model.js";

test("identifies blank set slots", () => {
  assert.equal(isBlankSet({ weight: null, reps: null, reported_rir_bucket: null }), true);
  assert.equal(isBlankSet({ weight: "", reps: "", reported_rir_bucket: "" }), true);
  assert.equal(isBlankSet({ weight: 50, reps: null, reported_rir_bucket: null }), false);
});

test("identifies draft sets", () => {
  assert.equal(isDraftSet({ weight: 50, reps: null, reported_rir_bucket: null }), true);
  assert.equal(isDraftSet({ weight: 50, reps: 8, reported_rir_bucket: null, is_warmup: false }), true);
  assert.equal(isDraftSet({ weight: null, reps: 8, reported_rir_bucket: 2, is_warmup: false }), true);
  assert.equal(isDraftSet({ weight: null, reps: null, reported_rir_bucket: null }), false);
  assert.equal(isDraftSet({ weight: 50, reps: 8, reported_rir_bucket: 2, is_warmup: false }), false);
});

test("identifies completed sets for warmup and working sets", () => {
  assert.equal(isCompletedSet({ weight: 50, reps: 8, is_warmup: true, reported_rir_bucket: null }), true);
  assert.equal(isCompletedSet({ weight: 50, reps: 8, is_warmup: true, reported_rir_bucket: 1 }), false);
  assert.equal(isCompletedSet({ weight: 50, reps: 8, is_warmup: false, reported_rir_bucket: 2 }), true);
  assert.equal(isCompletedSet({ weight: 50, reps: 8, is_warmup: false, reported_rir_bucket: 4 }), true);
  assert.equal(isCompletedSet({ weight: 50, reps: 8, is_warmup: false, reported_rir_bucket: null }), false);
});

test("classifies warm-up, RIR 0-3 working, and 4+ high-RIR sets", () => {
  assert.equal(classifySet({ is_warmup: true, reported_rir_bucket: null, weight: 50, reps: 8 }), SET_CLASS.WARMUP);
  for (const rir of [0, 1, 2, 3]) {
    assert.equal(classifySet({ is_warmup: false, reported_rir_bucket: rir, weight: 100, reps: 8 }), SET_CLASS.WORKING);
  }
  assert.equal(classifySet({ is_warmup: false, reported_rir_bucket: 4, weight: 100, reps: 8 }), SET_CLASS.HIGH_RIR);
  assert.equal(classifySet({ weight: null, reps: null, reported_rir_bucket: null }), SET_CLASS.BLANK);
  assert.equal(classifySet({ weight: 80, reps: null, reported_rir_bucket: null }), SET_CLASS.DRAFT);
});

test("only completed RIR 0-3 sets qualify for analytics", () => {
  assert.equal(isAnalyticalWorkingSet({ is_warmup: false, reported_rir_bucket: 2, weight: 100, reps: 8 }), true);
  assert.equal(isAnalyticalWorkingSet({ is_warmup: true, reported_rir_bucket: null, weight: 100, reps: 8 }), false);
  assert.equal(isAnalyticalWorkingSet({ is_warmup: false, reported_rir_bucket: 4, weight: 100, reps: 8 }), false);
  assert.equal(isAnalyticalWorkingSet({ is_warmup: false, reported_rir_bucket: 0, weight: null, reps: null }), false);
  assert.equal(isAnalyticalWorkingSet({ is_warmup: false, reported_rir_bucket: 2, weight: 100, reps: null }), false);
});

test("formats classification labels correctly", () => {
  assert.equal(formatSetClassification({ is_warmup: false, reported_rir_bucket: 1, weight: 80, reps: 8 }), "1 RIR · Working set");
  assert.equal(formatSetClassification({ is_warmup: true, reported_rir_bucket: null, weight: 40, reps: 10 }), "Warm-up");
  assert.equal(formatSetClassification({ is_warmup: false, reported_rir_bucket: 4, weight: 80, reps: 8 }), "4+ RIR — not counted as a working set");
  assert.equal(formatSetClassification({ weight: null, reps: null, reported_rir_bucket: null }), "Blank set slot");
  assert.equal(formatSetClassification({ weight: 80, reps: null, reported_rir_bucket: null }), "Draft set");
});

test("calculates four exact Brzycki and Epley values with RIR applied only to the adjusted pair", () => {
  const result = calculateRirE1rmEstimates({ is_warmup: false, reported_rir_bucket: 2, weight: 100, reps: 8 });
  assert.deepEqual(result, {
    observedBrzycki: calculateBrzycki(100, 8),
    observedEpley: calculateEpley(100, 8),
    adjustedBrzycki: calculateBrzycki(100, 10),
    adjustedEpley: calculateEpley(100, 10),
  });
});

test("zero RIR keeps observed and adjusted formula identities coincident", () => {
  const result = calculateRirE1rmEstimates({ is_warmup: false, reported_rir_bucket: 0, weight: 80, reps: 6 });
  assert.equal(result.observedBrzycki, result.adjustedBrzycki);
  assert.equal(result.observedEpley, result.adjustedEpley);
});

test("4+ RIR cannot produce a finite progression estimate", () => {
  assert.equal(calculateRirE1rmEstimates({ is_warmup: false, reported_rir_bucket: 4, weight: 100, reps: 8 }), null);
});

test("ISSUE 22: the recorded equipment decides per-dumbbell loads once names omit equipment", async () => {
  const { usesPerDumbbellLoad } = await import("../set-model.js");
  assert.equal(usesPerDumbbellLoad({ equipmentName: "Dumbbell", exerciseName: "Lateral Raise (Seated)" }), true);
  assert.equal(usesPerDumbbellLoad({ equipmentName: " dumbbell ", exerciseName: "Chest Press (Incline 30)" }), true);
  assert.equal(usesPerDumbbellLoad({ equipmentName: "Barbell", exerciseName: "Chest Press (Incline 30)" }), false);
  assert.equal(usesPerDumbbellLoad({ equipmentName: "Machine (unknown model) — Gym One", exerciseName: "Leg Extension" }), false);
  assert.equal(usesPerDumbbellLoad({ equipmentName: null, exerciseName: "Lateral Raise (Seated)" }), false);
  assert.equal(usesPerDumbbellLoad({ equipmentName: null, exerciseName: "Lateral Raise (Dumbbell) (Seated)" }), true, "older names that state the implement are honoured");
  assert.equal(usesPerDumbbellLoad({ equipmentName: null, exerciseName: "Split Squats (Dumbbells)" }), true);
});
