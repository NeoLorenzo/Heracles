import test from "node:test";
import assert from "node:assert/strict";
import {
  RECAP_DIRECTION,
  RECAP_SIMILAR_THRESHOLD_PERCENT,
  RECAP_STATUS,
  buildWorkoutRecap,
  calculateConservativeObservedE1rm,
  classifyRecapChange,
  formatRecapCounts,
  formatSignedPercent,
  formatRecapExerciseLabel,
  normalizeRecapRows,
  buildRecapShareModel,
  formatRecapShareText,
} from "../workout-recap.js";

// Canonical exercise names are equipment-free (issue #22); equipment comes from canonical_equipment_id.
const BENCH = { id: "bench", name: "Bench Press" };
const DB_PRESS = { id: "shoulder-press", name: "Shoulder Press" };
const DUMBBELL = 3;

let nextId = 1;

function makeSession(id, performedOn, createdAt = `${performedOn}T10:00:00Z`, gymId = 1) {
  return { id, gym_id: gymId, performed_on: performedOn, created_at: createdAt, status: "completed" };
}

function makeHistory() {
  nextId = 1;
  return { sessions: [], exercises: [], sets: [] };
}

function addExercise(history, session, exercise, { equipmentId = 7, equipmentName = null, legacyGymEquipmentId = null, legacyEquipmentText = null, sets = [], order = 1 } = {}) {
  if (!history.sessions.some((item) => item.id === session.id)) history.sessions.push(session);
  const name = equipmentId === null ? null : equipmentName ?? (equipmentId === DUMBBELL ? "Dumbbell" : `Machine ${equipmentId}`);
  const sessionExercise = {
    id: nextId++,
    session_id: session.id,
    exercise_order: order,
    exercise_id: exercise.id,
    canonical_equipment_id: equipmentId,
    gym_equipment_id: legacyGymEquipmentId,
    equipment_id: legacyEquipmentText,
    equipment: name === null ? null : { name },
    equipment_name_snapshot: name,
    exercises: { name: exercise.name },
  };
  history.exercises.push(sessionExercise);
  sets.forEach((set, index) => {
    history.sets.push({
      id: nextId++,
      session_exercise_id: sessionExercise.id,
      set_number: index + 1,
      is_warmup: false,
      reported_rir_bucket: 2,
      ...set,
    });
  });
  return sessionExercise;
}

function recapFor(history, session) {
  return buildWorkoutRecap({ session, ...history });
}

test("conservative observed e1RM is the lower of Brzycki and Epley from completed reps", () => {
  // 100 kg × 5: Brzycki 112.5, Epley 116.67 → 112.5.
  assert.equal(calculateConservativeObservedE1rm({ weight: 100, reps: 5, is_warmup: false, reported_rir_bucket: 2 }), 112.5);
  // 100 kg × 12: Brzycki 144, Epley 140 → 140.
  assert.equal(calculateConservativeObservedE1rm({ weight: 100, reps: 12, is_warmup: false, reported_rir_bucket: 1 }), 140);
  // RIR does not move the compared value: only entered load and reps do.
  assert.equal(
    calculateConservativeObservedE1rm({ weight: 100, reps: 5, is_warmup: false, reported_rir_bucket: 0 }),
    calculateConservativeObservedE1rm({ weight: 100, reps: 5, is_warmup: false, reported_rir_bucket: 3 }),
  );
});

test("conservative observed e1RM excludes warm-ups, 4+ RIR, drafts, zero loads, and reps beyond Brzycki", () => {
  assert.equal(calculateConservativeObservedE1rm({ weight: 100, reps: 5, is_warmup: true, reported_rir_bucket: null }), null);
  assert.equal(calculateConservativeObservedE1rm({ weight: 100, reps: 5, is_warmup: false, reported_rir_bucket: 4 }), null);
  assert.equal(calculateConservativeObservedE1rm({ weight: 100, reps: 5, is_warmup: false, reported_rir_bucket: null }), null);
  assert.equal(calculateConservativeObservedE1rm({ weight: 0, reps: 10, is_warmup: false, reported_rir_bucket: 1 }), null);
  assert.equal(calculateConservativeObservedE1rm({ weight: 20, reps: 40, is_warmup: false, reported_rir_bucket: 1 }), null);
});

test("classifies changes with a symmetric 1% similar band", () => {
  assert.equal(RECAP_SIMILAR_THRESHOLD_PERCENT, 1);
  assert.equal(classifyRecapChange(1), RECAP_DIRECTION.IMPROVED);
  assert.equal(classifyRecapChange(0.9), RECAP_DIRECTION.SIMILAR);
  assert.equal(classifyRecapChange(0), RECAP_DIRECTION.SIMILAR);
  assert.equal(classifyRecapChange(-0.9), RECAP_DIRECTION.SIMILAR);
  assert.equal(classifyRecapChange(-1), RECAP_DIRECTION.DECLINED);
  assert.equal(classifyRecapChange(null), null);
  assert.equal(classifyRecapChange(Number.NaN), null);
});

test("first-ever exercise is a baseline, never a delta or a personal best", () => {
  const history = makeHistory();
  const today = makeSession(10, "2026-10-17");
  addExercise(history, today, BENCH, { sets: [{ weight: 100, reps: 5 }] });

  const recap = recapFor(history, today);
  assert.equal(recap.exercises.length, 1);
  const [row] = recap.exercises;
  assert.equal(row.status, RECAP_STATUS.BASELINE);
  assert.equal(row.current.value, 112.5);
  assert.equal(row.previous, null);
  assert.equal(row.changePercent, null);
  assert.equal(row.direction, null);
  assert.equal(row.isNewBest, false);
  assert.deepEqual(recap.counts, { improved: 0, similar: 0, declined: 0, newBests: 0, baselines: 1, unavailable: 0 });
});

test("compares against the latest prior comparable session and separates new bests from last-session improvements", () => {
  const history = makeHistory();
  const older = makeSession(1, "2026-09-01");
  const previous = makeSession(2, "2026-10-01");
  const today = makeSession(3, "2026-10-17");
  addExercise(history, older, BENCH, { sets: [{ weight: 120, reps: 5 }] }); // 135 best
  addExercise(history, previous, BENCH, { sets: [{ weight: 100, reps: 5 }] }); // 112.5
  addExercise(history, today, BENCH, { sets: [{ weight: 105, reps: 5 }] }); // 118.13 (rounded)

  const [row] = recapFor(history, today).exercises;
  assert.equal(row.status, RECAP_STATUS.COMPARED);
  assert.equal(row.previous.sessionId, 2);
  assert.equal(row.previous.value, 112.5);
  assert.equal(row.direction, RECAP_DIRECTION.IMPROVED);
  assert.equal(row.changePercent, 5);
  assert.equal(row.isNewBest, false, "beating the last session is not automatically a personal best");
  assert.equal(row.priorBest.sessionId, 1);
  assert.equal(row.priorBest.value, 135);
  assert.ok(row.bestChangePercent < 0);
});

test("flags a genuine new best only when the current estimate exceeds every prior comparable estimate", () => {
  const history = makeHistory();
  const older = makeSession(1, "2026-09-01");
  const previous = makeSession(2, "2026-10-01");
  const today = makeSession(3, "2026-10-17");
  addExercise(history, older, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, previous, BENCH, { sets: [{ weight: 102.5, reps: 5 }] });
  addExercise(history, today, BENCH, { sets: [{ weight: 102.5, reps: 6 }] });

  const recap = recapFor(history, today);
  const [row] = recap.exercises;
  assert.equal(row.isNewBest, true);
  assert.equal(row.priorBest.sessionId, 2);
  assert.ok(row.bestChangePercent > 0);
  assert.equal(recap.counts.newBests, 1);

  // Equalling the prior best is not a new best.
  const tie = makeHistory();
  addExercise(tie, older, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  addExercise(tie, today, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  const [tieRow] = recapFor(tie, today).exercises;
  assert.equal(tieRow.isNewBest, false);
  assert.equal(tieRow.direction, RECAP_DIRECTION.SIMILAR);
  assert.equal(tieRow.changePercent, 0);
});

test("reports declines and small changes as similar", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = makeSession(2, "2026-10-17");
  addExercise(history, previous, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, { sets: [{ weight: 95, reps: 5 }] });
  const [declined] = recapFor(history, today).exercises;
  assert.equal(declined.direction, RECAP_DIRECTION.DECLINED);
  assert.equal(declined.changePercent, -5);

  const small = makeHistory();
  addExercise(small, previous, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  addExercise(small, today, BENCH, { sets: [{ weight: 100.5, reps: 5 }] });
  const [similar] = recapFor(small, today).exercises;
  assert.equal(similar.direction, RECAP_DIRECTION.SIMILAR);
  assert.equal(similar.changePercent, 0.5);
  assert.equal(similar.isNewBest, true, "a small gain above every prior estimate is still a new best");
});

test("warm-ups and 4+ RIR sets never count as working sets or comparison inputs", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = makeSession(2, "2026-10-17");
  addExercise(history, previous, BENCH, {
    sets: [
      { weight: 140, reps: 5, is_warmup: true, reported_rir_bucket: null },
      { weight: 130, reps: 5, reported_rir_bucket: 4 },
      { weight: 100, reps: 5 },
    ],
  });
  addExercise(history, today, BENCH, {
    sets: [
      { weight: 150, reps: 3, is_warmup: true, reported_rir_bucket: null },
      { weight: 105, reps: 5 },
    ],
  });

  const recap = recapFor(history, today);
  const [row] = recap.exercises;
  assert.equal(recap.workingSetCount, 1);
  assert.equal(row.workingSetCount, 1);
  assert.equal(row.previous.weight, 100);
  assert.equal(row.current.weight, 105);
  assert.equal(row.isNewBest, true);
});

test("an exercise with only warm-ups or 4+ RIR sets has no comparison", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = makeSession(2, "2026-10-17");
  addExercise(history, previous, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, {
    sets: [
      { weight: 60, reps: 10, is_warmup: true, reported_rir_bucket: null },
      { weight: 80, reps: 10, reported_rir_bucket: 4 },
    ],
  });

  const recap = recapFor(history, today);
  assert.equal(recap.exercises[0].status, RECAP_STATUS.NO_WORKING_SETS);
  assert.equal(recap.exercises[0].changePercent, null);
  assert.equal(recap.counts.unavailable, 1);
  assert.equal(formatRecapCounts(recap.counts), "No e1RM comparisons available for this workout");
});

test("working sets that cannot produce an estimate are reported without fabricating a delta", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = makeSession(2, "2026-10-17");
  addExercise(history, previous, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, { sets: [{ weight: 0, reps: 12 }] });
  const [row] = recapFor(history, today).exercises;
  assert.equal(row.status, RECAP_STATUS.NO_ESTIMATE);
  assert.equal(row.workingSetCount, 1);
  assert.equal(row.direction, null);
});

test("only the same exercise on the same equipment identity is comparable", () => {
  const history = makeHistory();
  const otherMachine = makeSession(1, "2026-10-10");
  const sameMachine = makeSession(2, "2026-10-01");
  const today = makeSession(3, "2026-10-17");
  addExercise(history, otherMachine, BENCH, { equipmentId: 8, sets: [{ weight: 200, reps: 5 }] });
  addExercise(history, sameMachine, BENCH, { equipmentId: 7, sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, { equipmentId: 7, sets: [{ weight: 100, reps: 5 }] });

  const [row] = recapFor(history, today).exercises;
  assert.equal(row.previous.sessionId, 2, "a newer session on another machine is not the comparable previous session");
  assert.equal(row.priorBest.sessionId, 2, "a heavier session on another machine is not a prior best");
  assert.equal(row.direction, RECAP_DIRECTION.SIMILAR);
});

test("mismatched equipment yields a baseline instead of a cross-machine delta", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = makeSession(2, "2026-10-17");
  addExercise(history, previous, BENCH, { equipmentId: 8, sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, { equipmentId: 7, sets: [{ weight: 110, reps: 5 }] });
  const [row] = recapFor(history, today).exercises;
  assert.equal(row.status, RECAP_STATUS.BASELINE);
  assert.equal(row.isNewBest, false);
});

test("the same exercise on two machines in one workout produces two separately compared rows", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = makeSession(2, "2026-10-17");
  addExercise(history, previous, BENCH, { equipmentId: 7, sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, { equipmentId: 7, order: 1, sets: [{ weight: 105, reps: 5 }] });
  addExercise(history, today, BENCH, { equipmentId: 8, order: 2, sets: [{ weight: 60, reps: 5 }] });
  const recap = recapFor(history, today);
  assert.equal(recap.exerciseCount, 2);
  assert.deepEqual(recap.exercises.map((row) => row.status), [RECAP_STATUS.COMPARED, RECAP_STATUS.BASELINE]);
  assert.deepEqual(recap.exercises.map((row) => row.equipmentName), ["Machine 7", "Machine 8"]);
});

test("sessions after the recapped session never count as previous or prior best", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const recapped = makeSession(2, "2026-10-10");
  const later = makeSession(3, "2026-10-17");
  const sameDayLater = makeSession(4, "2026-10-10", "2026-10-10T18:00:00Z");
  addExercise(history, previous, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, recapped, BENCH, { sets: [{ weight: 105, reps: 5 }] });
  addExercise(history, later, BENCH, { sets: [{ weight: 150, reps: 5 }] });
  addExercise(history, sameDayLater, BENCH, { sets: [{ weight: 140, reps: 5 }] });
  const [row] = recapFor(history, recapped).exercises;
  assert.equal(row.previous.sessionId, 1);
  assert.equal(row.isNewBest, true);
});

test("an earlier session on the same date is prior; non-completed sessions are ignored", () => {
  const history = makeHistory();
  const morning = makeSession(1, "2026-10-17", "2026-10-17T07:00:00Z");
  const inProgress = { ...makeSession(2, "2026-10-16"), status: "in_progress" };
  const evening = makeSession(3, "2026-10-17", "2026-10-17T19:00:00Z");
  addExercise(history, morning, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, inProgress, BENCH, { sets: [{ weight: 200, reps: 5 }] });
  addExercise(history, evening, BENCH, { sets: [{ weight: 100, reps: 5 }] });
  const [row] = recapFor(history, evening).exercises;
  assert.equal(row.previous.sessionId, 1);
  assert.equal(row.priorBest.sessionId, 1);
});

test("dumbbell units come from the recorded equipment and compare the weight of one dumbbell", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = makeSession(2, "2026-10-17");
  addExercise(history, previous, DB_PRESS, { equipmentId: DUMBBELL, sets: [{ weight: 20, reps: 10 }] });
  addExercise(history, today, DB_PRESS, { equipmentId: DUMBBELL, sets: [{ weight: 22, reps: 10 }] });
  const [row] = recapFor(history, today).exercises;
  assert.equal(row.perDumbbell, true);
  assert.equal(row.unit, "kg per dumbbell");
  assert.equal(row.equipmentRecorded, true);
  assert.equal(formatRecapExerciseLabel(row), "Shoulder Press · Dumbbell");
  assert.equal(row.current.weight, 22, "stored per-dumbbell weight is never doubled");
  assert.equal(row.previous.weight, 20);
  // 22 × 10 → Brzycki 29.33, Epley 29.33; never computed from a combined 44 kg pair.
  assert.ok(row.current.value < 30);
  assert.equal(row.direction, RECAP_DIRECTION.IMPROVED);

  // The same canonical exercise on a machine is not per dumbbell and is a separate series.
  addExercise(history, today, DB_PRESS, { equipmentId: 9, equipmentName: "Shoulder Press Machine", order: 2, sets: [{ weight: 50, reps: 10 }] });
  const machineRow = recapFor(history, today).exercises[1];
  assert.equal(machineRow.unit, "kg");
  assert.equal(machineRow.status, RECAP_STATUS.BASELINE);
  assert.equal(formatRecapExerciseLabel(machineRow), "Shoulder Press · Shoulder Press Machine");
});

test("canonical equipment is comparable across gyms", () => {
  const history = makeHistory();
  const otherGym = makeSession(1, "2026-10-01", undefined, 2);
  const today = makeSession(2, "2026-10-17", undefined, 1);
  addExercise(history, otherGym, BENCH, { equipmentId: 7, sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, { equipmentId: 7, sets: [{ weight: 105, reps: 5 }] });
  const [row] = recapFor(history, today).exercises;
  assert.equal(row.status, RECAP_STATUS.COMPARED);
  assert.equal(row.previous.sessionId, 1);
  assert.equal(row.isNewBest, true);
});

test("unrecorded equipment is compared only with unrecorded equipment at the same gym", () => {
  const history = makeHistory();
  const sameGym = makeSession(1, "2026-09-01", undefined, 1);
  const otherGym = makeSession(2, "2026-10-01", undefined, 2);
  const recordedSameGym = makeSession(3, "2026-10-05", undefined, 1);
  const today = makeSession(4, "2026-10-17", undefined, 1);
  addExercise(history, sameGym, BENCH, { equipmentId: null, sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, otherGym, BENCH, { equipmentId: null, sets: [{ weight: 150, reps: 5 }] });
  addExercise(history, recordedSameGym, BENCH, { equipmentId: 7, sets: [{ weight: 140, reps: 5 }] });
  addExercise(history, today, BENCH, { equipmentId: null, sets: [{ weight: 105, reps: 5 }] });
  const [row] = recapFor(history, today).exercises;
  assert.equal(row.equipmentRecorded, false);
  assert.equal(formatRecapExerciseLabel(row), "Bench Press");
  assert.equal(row.previous.sessionId, 1);
  assert.equal(row.priorBest.sessionId, 1);
  assert.equal(row.isNewBest, true);
});

test("legacy gym-scoped equipment references never decide comparability", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = makeSession(2, "2026-10-17");
  // Same legacy gym equipment and text, different canonical equipment: not comparable.
  addExercise(history, previous, BENCH, { equipmentId: 8, legacyGymEquipmentId: 70, legacyEquipmentText: "Rack", sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, { equipmentId: 7, legacyGymEquipmentId: 70, legacyEquipmentText: "Rack", sets: [{ weight: 105, reps: 5 }] });
  assert.equal(recapFor(history, today).exercises[0].status, RECAP_STATUS.BASELINE);

  // Missing canonical equipment never falls back to the legacy references.
  const legacyOnly = makeHistory();
  addExercise(legacyOnly, previous, BENCH, { equipmentId: 7, sets: [{ weight: 100, reps: 5 }] });
  addExercise(legacyOnly, today, BENCH, { equipmentId: null, legacyGymEquipmentId: 7, legacyEquipmentText: "7", sets: [{ weight: 105, reps: 5 }] });
  const [row] = recapFor(legacyOnly, today).exercises;
  assert.equal(row.equipmentRecorded, false);
  assert.equal(row.status, RECAP_STATUS.BASELINE);
});

test("summary counts exercises and completed working sets of the recapped session only", () => {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = { ...makeSession(2, "2026-10-17"), gyms: { name: "Home Gym" }, source_preset_name: "Push" };
  addExercise(history, previous, BENCH, { sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }] });
  addExercise(history, today, BENCH, { sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 4 }, { weight: 60, reps: 8, is_warmup: true, reported_rir_bucket: null }] });
  addExercise(history, today, DB_PRESS, { equipmentId: DUMBBELL, order: 2, sets: [{ weight: 20, reps: 10 }] });
  const recap = recapFor(history, today);
  assert.equal(recap.performedOn, "2026-10-17");
  assert.equal(recap.gymName, "Home Gym");
  assert.equal(recap.presetName, "Push");
  assert.equal(recap.exerciseCount, 2);
  assert.equal(recap.workingSetCount, 3);
  assert.deepEqual(recap.exercises.map((row) => row.exerciseName), [BENCH.name, DB_PRESS.name]);
});

test("formats signed percentages and transparent counts without a composite score", () => {
  assert.equal(formatSignedPercent(3.24), "+3.2%");
  assert.equal(formatSignedPercent(-8), "−8.0%");
  assert.equal(formatSignedPercent(0), "0.0%");
  assert.equal(formatSignedPercent(null), null);
  assert.equal(
    formatRecapCounts({ improved: 2, similar: 1, declined: 1, newBests: 1, baselines: 2, unavailable: 0 }),
    "2 improved · 1 new best · 1 similar · 1 declined · 2 baselines",
  );
});

test("normalizes nested Supabase rows and ignores non-completed history", () => {
  const sessionRow = {
    id: 5,
    performed_on: "2026-10-17",
    created_at: "2026-10-17T09:00:00Z",
    status: "completed",
    session_exercises: [{
      id: 50,
      exercise_order: 1,
      exercise_id: "bench",
      canonical_equipment_id: 7,
      equipment: { name: "Machine 7" },
      exercises: { name: BENCH.name },
      exercise_sets: [{ id: 500, set_number: 1, weight: 105, reps: 5, is_warmup: false, reported_rir_bucket: 2 }],
    }],
  };
  const historyRows = [
    {
      id: 40, session_id: 4, exercise_order: 1, exercise_id: "bench", canonical_equipment_id: 7, equipment: { name: "Machine 7" }, exercises: { name: BENCH.name },
      workout_sessions: { id: 4, performed_on: "2026-10-10", created_at: "2026-10-10T09:00:00Z", status: "completed" },
      exercise_sets: [{ id: 400, set_number: 1, weight: 100, reps: 5, is_warmup: false, reported_rir_bucket: 2 }],
    },
    {
      id: 41, session_id: 6, exercise_order: 1, exercise_id: "bench", canonical_equipment_id: 7, equipment: { name: "Machine 7" }, exercises: { name: BENCH.name },
      workout_sessions: { id: 6, performed_on: "2026-10-12", created_at: "2026-10-12T09:00:00Z", status: "in_progress" },
      exercise_sets: [{ id: 410, set_number: 1, weight: 300, reps: 5, is_warmup: false, reported_rir_bucket: 2 }],
    },
    {
      id: 50, session_id: 5, exercise_order: 1, exercise_id: "bench", canonical_equipment_id: 7, equipment: { name: "Machine 7" }, exercises: { name: BENCH.name },
      workout_sessions: { id: 5, performed_on: "2026-10-17", created_at: "2026-10-17T09:00:00Z", status: "completed" },
      exercise_sets: [{ id: 500, set_number: 1, weight: 105, reps: 5, is_warmup: false, reported_rir_bucket: 2 }],
    },
  ];
  const normalized = normalizeRecapRows(sessionRow, historyRows);
  assert.equal(normalized.session.session_exercises, undefined);
  assert.deepEqual(normalized.sessions.map((session) => session.id).sort(), [4, 5]);
  assert.deepEqual(normalized.exercises.map((exercise) => exercise.id).sort(), [40, 50]);
  assert.equal(normalized.sets.find((set) => set.id === 500).session_exercise_id, 50);

  const recap = buildWorkoutRecap(normalized);
  assert.equal(recap.workingSetCount, 1);
  assert.equal(recap.exercises[0].previous.sessionId, 4);
  assert.equal(recap.exercises[0].changePercent, 5);
});

function shareFixture() {
  const history = makeHistory();
  const previous = makeSession(1, "2026-10-01");
  const today = { ...makeSession(2, "2026-10-17"), gyms: { name: "Secret Street Gym" }, source_preset_name: "Push A" };
  addExercise(history, previous, BENCH, { equipmentId: 7, sets: [{ weight: 100, reps: 5 }] });
  addExercise(history, previous, DB_PRESS, { equipmentId: DUMBBELL, sets: [{ weight: 20, reps: 10 }] });
  addExercise(history, today, BENCH, { equipmentId: 7, order: 1, sets: [{ weight: 95, reps: 5 }] });
  addExercise(history, today, BENCH, { equipmentId: 8, order: 2, sets: [{ weight: 60, reps: 5 }] });
  addExercise(history, today, DB_PRESS, { equipmentId: DUMBBELL, order: 3, sets: [{ weight: 22, reps: 10 }] });
  return recapFor(history, today);
}

test("share model leads with new bests, keeps e1RM labels, and omits the gym", () => {
  const model = buildRecapShareModel(shareFixture());
  assert.equal(model.title, "Push A");
  assert.equal(model.stats, "3 exercises · 3 working sets");
  assert.deepEqual(model.rows.map((row) => row.badge), ["New best", null, null]);
  assert.equal(model.rows[0].name, "Shoulder Press · Dumbbell");
  assert.equal(model.rows[0].tone, "positive");
  assert.equal(model.rows[0].detail, "+10.0% e1RM vs last comparable session (29.3 kg per dumbbell, was 26.7 kg per dumbbell)");
  // The same exercise on two machines is disambiguated by equipment.
  assert.equal(model.rows[1].name, `${BENCH.name} · Machine 7`);
  assert.equal(model.rows[1].tone, "negative");
  assert.equal(model.rows[2].name, `${BENCH.name} · Machine 8`);
  assert.match(model.rows[2].detail, /^First comparable session · e1RM/);
  assert.match(model.footnote, /estimated 1RM/);
  assert.doesNotMatch(JSON.stringify(model), /Secret Street Gym|tonnage|volume/i);
});

test("share card is limited to the highlights while the text lists every exercise", () => {
  const recap = shareFixture();
  const card = buildRecapShareModel(recap, { rowLimit: 2 });
  assert.equal(card.rows.length, 2);
  assert.equal(card.hiddenRowCount, 1);
  const text = formatRecapShareText(buildRecapShareModel(recap, { rowLimit: Infinity }), "17 Oct 2026");
  const lines = text.split("\n");
  assert.equal(lines[0], "Heracles workout recap — Push A · 17 Oct 2026");
  assert.equal(lines[1], "3 exercises · 3 working sets");
  assert.ok(lines.includes("Shoulder Press · Dumbbell: New best · +10.0% e1RM vs last comparable session (29.3 kg per dumbbell, was 26.7 kg per dumbbell)"));
  assert.ok(lines.some((line) => line.startsWith("Bench Press · Machine 8: First comparable session")));
  assert.ok(!text.includes("more exercise"));
  assert.ok(formatRecapShareText(card).split("\n").includes("+ 1 more exercise"));
  assert.ok(text.endsWith("Not a measured max."));
});
