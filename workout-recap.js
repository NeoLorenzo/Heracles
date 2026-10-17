import { calculateBrzycki, calculateEpley, isAnalyticalWorkingSet, usesPerDumbbellLoad } from "./set-model.js";
import {
  calculatePercentageChange,
  getEquipmentSeriesKey,
  joinDashboardData,
  selectRepresentativeSetsBySeries,
} from "./analytics.js";

// Product display rule, not a scientifically validated minimal detectable change:
// e1RM changes smaller than this (in either direction) are labelled "Similar".
export const RECAP_SIMILAR_THRESHOLD_PERCENT = 1;

export const RECAP_DIRECTION = Object.freeze({
  IMPROVED: "improved",
  SIMILAR: "similar",
  DECLINED: "declined",
});

export const RECAP_STATUS = Object.freeze({
  COMPARED: "compared",
  BASELINE: "baseline",
  NO_ESTIMATE: "no-estimate",
  NO_WORKING_SETS: "no-working-sets",
});

// The recap compares one value per exercise series: the lower of the observed
// Brzycki and Epley estimates from completed reps. It is the same key the app
// already uses to pick the representative working set, and it excludes the
// subjective reported-RIR adjustment so that only entered load and reps move it.
export function calculateConservativeObservedE1rm(set) {
  if (!isAnalyticalWorkingSet(set)) return null;
  const brzycki = calculateBrzycki(set.weight, set.reps);
  const epley = calculateEpley(set.weight, set.reps);
  if (brzycki === null || epley === null) return null;
  const value = Math.min(brzycki, epley);
  return value > 0 ? value : null;
}

// Comparable series (issue #22): the same exercise on the same canonical equipment, at any gym.
// Without recorded equipment a row is compared only with unrecorded rows at the same gym, matching
// the previous-performance context. Legacy gym-scoped equipment references are never used.
export function getRecapSeriesKey(exerciseId, canonicalEquipmentId, gymId) {
  const equipmentKey = getEquipmentSeriesKey({ equipment_id: canonicalEquipmentId });
  return equipmentKey === "equipment-unrecorded"
    ? `${exerciseId}:${equipmentKey}:gym-${gymId ?? "none"}`
    : `${exerciseId}:${equipmentKey}`;
}

export function formatRecapExerciseLabel(row) {
  return row.equipmentRecorded ? `${row.exerciseName} · ${row.equipmentName || "Recorded equipment"}` : row.exerciseName;
}

function withoutLegacyEquipment({ gym_equipment_id: _gymEquipmentId, equipment_id: _legacyEquipmentId, ...exercise }) {
  return exercise;
}

export function classifyRecapChange(changePercent, threshold = RECAP_SIMILAR_THRESHOLD_PERCENT) {
  if (!Number.isFinite(changePercent)) return null;
  if (changePercent >= threshold) return RECAP_DIRECTION.IMPROVED;
  if (changePercent <= -threshold) return RECAP_DIRECTION.DECLINED;
  return RECAP_DIRECTION.SIMILAR;
}

function compareText(a, b) {
  const left = a ?? "";
  const right = b ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
}

// Chronological order used by previous-performance context: date, creation time, then ID.
function compareSessionOrder(a, b) {
  return compareText(a.performed_on, b.performed_on)
    || compareText(a.created_at, b.created_at)
    || (Number(a.id) - Number(b.id));
}

function describeSet(entry, session) {
  return {
    value: entry.value,
    weight: Number(entry.record.weight),
    reps: Number(entry.record.reps),
    reportedRir: Number(entry.record.reported_rir_bucket),
    sessionId: session.id,
    performedOn: session.performed_on,
  };
}

function roundPercent(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

/**
 * Builds a post-workout recap from persisted, owner-scoped rows.
 *
 * @param {object} input
 * @param {object} input.session  The completed session being summarised.
 * @param {object[]} input.sessions  Completed sessions (may include the current one).
 * @param {object[]} input.exercises  session_exercises rows for the current and historical sessions.
 * @param {object[]} input.sets  exercise_sets rows for those session_exercises.
 */
export function buildWorkoutRecap({ session, sessions = [], exercises = [], sets = [] }) {
  const sessionById = new Map(sessions.map((item) => [item.id, item]));
  sessionById.set(session.id, session);
  const allSessions = [...sessionById.values()].filter((item) => item.performed_on);
  const canonicalExercises = exercises.map(withoutLegacyEquipment);
  // joinDashboardData exposes canonical_equipment_id as the record's equipment_id.
  const records = joinDashboardData(allSessions, canonicalExercises, sets);
  const recordSeriesKey = (record) => getRecapSeriesKey(record.exercise_id, record.equipment_id, sessionById.get(record.session_id)?.gym_id);
  const isPrior = (sessionId) => {
    const other = sessionById.get(sessionId);
    return Boolean(other) && other.id !== session.id && other.status === "completed" && compareSessionOrder(other, session) < 0;
  };

  const currentExercises = canonicalExercises
    .filter((exercise) => exercise.session_id === session.id)
    .sort((a, b) => (a.exercise_order ?? 0) - (b.exercise_order ?? 0) || Number(a.id) - Number(b.id));

  const rows = [];
  const rowByKey = new Map();
  for (const exercise of currentExercises) {
    const exerciseName = exercise.exercises?.name ?? exercise.exercise_name ?? "Exercise";
    const canonicalEquipmentId = exercise.canonical_equipment_id ?? null;
    const key = getRecapSeriesKey(exercise.exercise_id, canonicalEquipmentId, session.gym_id);
    if (rowByKey.has(key)) continue;
    const equipmentName = exercise.equipment?.name ?? exercise.equipment_name_snapshot ?? null;
    const perDumbbell = usesPerDumbbellLoad({ equipmentName, exerciseName });
    const row = {
      key,
      exerciseId: exercise.exercise_id,
      exerciseName,
      equipmentName,
      equipmentRecorded: canonicalEquipmentId !== null && canonicalEquipmentId !== "",
      perDumbbell,
      unit: perDumbbell ? "kg per dumbbell" : "kg",
    };
    rowByKey.set(key, row);
    rows.push(row);
  }

  const workingSetCountBySeries = new Map();
  for (const record of records) {
    if (record.session_id !== session.id || !isAnalyticalWorkingSet(record)) continue;
    const key = recordSeriesKey(record);
    workingSetCountBySeries.set(key, (workingSetCountBySeries.get(key) ?? 0) + 1);
  }

  // One representative working set per (series, session), chosen exactly as the
  // My Data strength progression chooses it; only the current and prior sessions count.
  const eligibleRecords = records.filter((record) => record.session_id === session.id || isPrior(record.session_id));
  const entriesBySeries = new Map();
  for (const exerciseId of new Set(rows.map((row) => row.exerciseId))) {
    for (const record of selectRepresentativeSetsBySeries(eligibleRecords, exerciseId)) {
      const key = recordSeriesKey(record);
      if (!rowByKey.has(key)) continue;
      const value = calculateConservativeObservedE1rm(record);
      if (value === null) continue;
      const list = entriesBySeries.get(key) ?? [];
      list.push({ value, record, key, sessionId: record.session_id });
      entriesBySeries.set(key, list);
    }
  }

  const counts = { improved: 0, similar: 0, declined: 0, newBests: 0, baselines: 0, unavailable: 0 };
  const exerciseRows = rows.map((row) => {
    const workingSetCount = workingSetCountBySeries.get(row.key) ?? 0;
    const entries = entriesBySeries.get(row.key) ?? [];
    const currentEntry = entries.find((entry) => entry.sessionId === session.id) ?? null;
    const priorEntries = entries
      .filter((entry) => entry.sessionId !== session.id)
      .sort((a, b) => compareSessionOrder(sessionById.get(a.sessionId), sessionById.get(b.sessionId)));
    const base = { ...row, workingSetCount, current: null, previous: null, priorBest: null, changePercent: null, direction: null, isNewBest: false, bestChangePercent: null };

    if (workingSetCount === 0) {
      counts.unavailable += 1;
      return { ...base, status: RECAP_STATUS.NO_WORKING_SETS };
    }
    if (!currentEntry) {
      counts.unavailable += 1;
      return { ...base, status: RECAP_STATUS.NO_ESTIMATE };
    }
    const current = describeSet(currentEntry, session);
    if (!priorEntries.length) {
      counts.baselines += 1;
      return { ...base, current, status: RECAP_STATUS.BASELINE };
    }

    const previousEntry = priorEntries[priorEntries.length - 1];
    const previous = describeSet(previousEntry, sessionById.get(previousEntry.sessionId));
    const bestEntry = priorEntries.reduce((best, entry) => (
      entry.value > best.value
      || (entry.value === best.value && compareSessionOrder(sessionById.get(entry.sessionId), sessionById.get(best.sessionId)) > 0)
        ? entry
        : best
    ));
    const priorBest = describeSet(bestEntry, sessionById.get(bestEntry.sessionId));
    const changePercent = roundPercent(calculatePercentageChange(current.value, previous.value));
    const direction = classifyRecapChange(changePercent);
    const isNewBest = current.value > priorBest.value;
    counts[direction] += 1;
    if (isNewBest) counts.newBests += 1;
    return {
      ...base,
      status: RECAP_STATUS.COMPARED,
      current,
      previous,
      priorBest,
      changePercent,
      direction,
      isNewBest,
      bestChangePercent: roundPercent(calculatePercentageChange(current.value, priorBest.value)),
    };
  });

  const workingSetCount = sets.filter((set) => (
    currentExercises.some((exercise) => exercise.id === set.session_exercise_id) && isAnalyticalWorkingSet(set)
  )).length;

  return {
    sessionId: session.id,
    performedOn: session.performed_on,
    gymName: session.gyms?.name ?? session.gym_name ?? null,
    presetName: session.source_preset_name ?? null,
    exerciseCount: currentExercises.length,
    workingSetCount,
    exercises: exerciseRows,
    counts,
  };
}

export function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return null;
  const magnitude = Math.abs(value).toFixed(1);
  if (value > 0) return `+${magnitude}%`;
  if (value < 0) return `−${magnitude}%`;
  return "0.0%";
}

export function formatRecapCounts(counts) {
  const parts = [];
  if (counts.improved) parts.push(`${counts.improved} improved`);
  if (counts.newBests) parts.push(`${counts.newBests} new ${counts.newBests === 1 ? "best" : "bests"}`);
  if (counts.similar) parts.push(`${counts.similar} similar`);
  if (counts.declined) parts.push(`${counts.declined} declined`);
  if (counts.baselines) parts.push(`${counts.baselines} ${counts.baselines === 1 ? "baseline" : "baselines"}`);
  return parts.length ? parts.join(" · ") : "No e1RM comparisons available for this workout";
}

/**
 * Converts nested Supabase rows (session → session_exercises → exercise_sets,
 * plus historical session_exercises with an embedded workout_sessions row)
 * into the flat arrays accepted by buildWorkoutRecap.
 */
export function normalizeRecapRows(sessionRow, historyRows = []) {
  const { session_exercises: currentExercises = [], ...session } = sessionRow;
  const sessions = new Map([[session.id, session]]);
  const exercises = new Map();
  const sets = new Map();
  const addExercise = (exercise, sessionId) => {
    const { exercise_sets: exerciseSets = [], workout_sessions: _embeddedSession, ...rest } = exercise;
    exercises.set(rest.id, { ...rest, session_id: rest.session_id ?? sessionId });
    for (const set of exerciseSets ?? []) sets.set(set.id, { ...set, session_exercise_id: set.session_exercise_id ?? rest.id });
  };
  for (const exercise of currentExercises ?? []) addExercise(exercise, session.id);
  for (const row of historyRows) {
    const embedded = row.workout_sessions;
    if (!embedded || embedded.status !== "completed") continue;
    if (!sessions.has(embedded.id)) sessions.set(embedded.id, embedded);
    // Persisted rows of the current session always come from the session query itself.
    if (embedded.id === session.id) continue;
    addExercise(row, embedded.id);
  }
  return { session, sessions: [...sessions.values()], exercises: [...exercises.values()], sets: [...sets.values()] };
}

const SHARE_CARD_ROW_LIMIT = 6;

function shareRowName(row, duplicateNames) {
  if (row.equipmentRecorded) return formatRecapExerciseLabel(row);
  return duplicateNames.has(row.exerciseName) ? `${row.exerciseName} · equipment not recorded` : row.exerciseName;
}

function shareRowDetail(row) {
  const estimate = (value) => `${Math.round(value * 10) / 10} ${row.unit}`;
  if (row.status === RECAP_STATUS.COMPARED) {
    const versus = `${formatSignedPercent(row.changePercent)} e1RM vs last comparable session`;
    return `${versus} (${estimate(row.current.value)}, was ${estimate(row.previous.value)})`;
  }
  if (row.status === RECAP_STATUS.BASELINE) return `First comparable session · e1RM ${estimate(row.current.value)}`;
  if (row.status === RECAP_STATUS.NO_ESTIMATE) return "No e1RM available";
  return "No RIR 0–3 working sets";
}

function shareRowTone(row) {
  if (row.status !== RECAP_STATUS.COMPARED) return "neutral";
  if (row.direction === RECAP_DIRECTION.IMPROVED) return "positive";
  if (row.direction === RECAP_DIRECTION.DECLINED) return "negative";
  return "neutral";
}

/**
 * Describes what a shared recap contains. The gym name and set-level detail are
 * deliberately left out; every estimate stays labelled as e1RM.
 */
export function buildRecapShareModel(recap, { rowLimit = SHARE_CARD_ROW_LIMIT } = {}) {
  const nameCounts = new Map();
  for (const row of recap.exercises) nameCounts.set(row.exerciseName, (nameCounts.get(row.exerciseName) ?? 0) + 1);
  const duplicateNames = new Set([...nameCounts].filter(([, count]) => count > 1).map(([name]) => name));
  // New bests first, then the rest in workout order, so a short card keeps the highlights.
  const ordered = recap.exercises
    .map((row, index) => ({ row, index }))
    .sort((a, b) => Number(b.row.isNewBest) - Number(a.row.isNewBest) || a.index - b.index)
    .map(({ row }) => row);
  const rows = ordered.map((row) => ({
    name: shareRowName(row, duplicateNames),
    detail: shareRowDetail(row),
    tone: shareRowTone(row),
    badge: row.isNewBest ? "New best" : null,
  }));
  return {
    title: recap.presetName || "Workout recap",
    date: recap.performedOn,
    stats: `${recap.exerciseCount} ${recap.exerciseCount === 1 ? "exercise" : "exercises"} · ${recap.workingSetCount} ${recap.workingSetCount === 1 ? "working set" : "working sets"}`,
    counts: formatRecapCounts(recap.counts),
    rows: rows.slice(0, rowLimit),
    hiddenRowCount: Math.max(0, rows.length - rowLimit),
    footnote: "e1RM = estimated 1RM: the lower of Brzycki and Epley from completed reps. Not a measured max.",
  };
}

export function formatRecapShareText(model, formattedDate = model.date) {
  const lines = [
    `Heracles workout recap — ${model.title} · ${formattedDate}`,
    model.stats,
    model.counts,
    "",
    ...model.rows.map((row) => `${row.name}: ${row.badge ? `${row.badge} · ` : ""}${row.detail}`),
  ];
  if (model.hiddenRowCount) lines.push(`+ ${model.hiddenRowCount} more ${model.hiddenRowCount === 1 ? "exercise" : "exercises"}`);
  lines.push("", model.footnote);
  return lines.join("\n");
}
