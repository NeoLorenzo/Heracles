import { calculateBrzycki, calculateEpley, isAnalyticalWorkingSet } from "./set-model.js";

export const DASHBOARD_RANGES = Object.freeze({
  "4w": { label: "4 weeks", weeks: 4, bucket: "week" },
  "8w": { label: "8 weeks", weeks: 8, bucket: "week" },
  "12w": { label: "12 weeks", weeks: 12, bucket: "week" },
  "6m": { label: "6 months", months: 6, bucket: "month" },
  all: { label: "All time", bucket: "month" },
});

const DAY_MS = 86_400_000;

function dateOnly(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(value, days) {
  return new Date(value.getTime() + days * DAY_MS);
}

function startOfWeek(value) {
  const date = dateOnly(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDays(date, -mondayOffset);
}

function startOfMonth(value) {
  const date = dateOnly(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(value, months) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

export function getDateRange(rangeKey, now = new Date(), sessions = []) {
  const range = DASHBOARD_RANGES[rangeKey] ?? DASHBOARD_RANGES["8w"];
  const end = dateOnly(now);
  if (range.weeks) {
    return {
      key: rangeKey,
      start: startOfWeek(addDays(end, -(range.weeks - 1) * 7)),
      end,
      bucket: "week",
      periodWeeks: range.weeks,
    };
  }
  if (range.months) {
    return {
      key: rangeKey,
      start: addMonths(startOfMonth(end), -(range.months - 1)),
      end,
      bucket: "month",
      periodWeeks: null,
    };
  }
  const validDates = sessions.map((session) => session.performed_on).filter(Boolean).sort();
  return {
    key: "all",
    start: validDates.length ? dateOnly(validDates[0]) : null,
    end,
    bucket: "month",
    periodWeeks: null,
  };
}

export function filterByRange(items, range, dateField = "performed_on") {
  if (!range.start) return [];
  const start = isoDate(range.start);
  const end = isoDate(range.end);
  return items.filter((item) => item[dateField] >= start && item[dateField] <= end);
}

export function joinDashboardData(sessions, exercises, sets) {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  return sets.flatMap((set) => {
    const exercise = exerciseById.get(set.session_exercise_id);
    const session = exercise ? sessionById.get(exercise.session_id) : null;
    if (!exercise || !session?.performed_on) return [];
    return [{
      ...set,
      session_id: session.id,
      performed_on: session.performed_on,
      exercise_id: exercise.exercise_id,
      exercise_name: exercise.exercises?.name ?? exercise.exercise_name,
      // Progression identity is the canonical equipment (issue #22); the current canonical name labels the series.
      equipment_id: exercise.canonical_equipment_id ?? exercise.gym_equipment_id ?? exercise.equipment_id ?? null,
      equipment_name: exercise.equipment?.name ?? exercise.equipment_name_snapshot ?? exercise.equipment_id ?? null,
    }];
  });
}

export function workingSets(records) {
  return records.filter(isAnalyticalWorkingSet);
}

export function getGroupCatalogue(exerciseMuscleLookup) {
  const groups = new Map();
  for (const muscles of exerciseMuscleLookup.values()) {
    for (const muscle of muscles) {
      const group = groups.get(muscle.uiGroup.code) ?? {
        code: muscle.uiGroup.code,
        name: muscle.uiGroup.name,
        sourceOrder: muscle.uiGroup.sourceOrder,
        muscles: new Map(),
      };
      group.muscles.set(muscle.name, { name: muscle.name, sourceOrder: muscle.sourceOrder });
      groups.set(group.code, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, muscles: [...group.muscles.values()].sort((a, b) => a.sourceOrder - b.sourceOrder) }))
    .sort((a, b) => a.sourceOrder - b.sourceOrder);
}

function relevanceForGroup(muscles, groupCode) {
  let relevance = 0;
  for (const muscle of muscles ?? []) {
    if (muscle.uiGroup.code === groupCode) relevance = Math.max(relevance, Number(muscle.relevance) || 0);
  }
  return relevance;
}

export function calculateMuscleExposure(records, exerciseMuscleLookup, groupCatalogue = getGroupCatalogue(exerciseMuscleLookup)) {
  const groupExposure = new Map(groupCatalogue.map((group) => [group.code, 0]));
  const groupRawSets = new Map(groupCatalogue.map((group) => [group.code, 0]));
  const detailedExposure = new Map();
  const unmappedExercises = new Map();

  for (const record of workingSets(records)) {
    const muscles = exerciseMuscleLookup.get(record.exercise_id);
    if (!muscles?.length) {
      unmappedExercises.set(record.exercise_id, record.exercise_name);
      continue;
    }
    const perSetGroups = new Map();
    for (const muscle of muscles) {
      const relevance = Number(muscle.relevance);
      if (!Number.isFinite(relevance) || relevance <= 0) continue;
      detailedExposure.set(muscle.name, (detailedExposure.get(muscle.name) ?? 0) + relevance);
      perSetGroups.set(muscle.uiGroup.code, Math.max(perSetGroups.get(muscle.uiGroup.code) ?? 0, relevance));
    }
    for (const [groupCode, relevance] of perSetGroups) {
      groupExposure.set(groupCode, (groupExposure.get(groupCode) ?? 0) + relevance);
      groupRawSets.set(groupCode, (groupRawSets.get(groupCode) ?? 0) + 1);
    }
  }

  return { groupExposure, groupRawSets, detailedExposure, unmappedExercises };
}

export function calculateExerciseSources(records, exerciseMuscleLookup, groupCode) {
  const exposure = new Map();
  for (const record of workingSets(records)) {
    const relevance = relevanceForGroup(exerciseMuscleLookup.get(record.exercise_id), groupCode);
    if (relevance > 0) {
      const source = exposure.get(record.exercise_id) ?? { exercise_id: record.exercise_id, exercise_name: record.exercise_name, value: 0 };
      source.value += relevance;
      source.exercise_name = record.exercise_name;
      exposure.set(record.exercise_id, source);
    }
  }
  return [...exposure.values()]
    .sort((a, b) => b.value - a.value || a.exercise_name.localeCompare(b.exercise_name) || String(a.exercise_id).localeCompare(String(b.exercise_id)));
}

function bucketKey(date, bucket) {
  const parsed = dateOnly(date);
  return bucket === "week" ? isoDate(startOfWeek(parsed)) : isoDate(startOfMonth(parsed)).slice(0, 7);
}

export function createBucketKeys(range) {
  if (!range.start) return [];
  const keys = [];
  if (range.bucket === "week") {
    for (let cursor = startOfWeek(range.start); cursor <= range.end; cursor = addDays(cursor, 7)) keys.push(isoDate(cursor));
  } else {
    for (let cursor = startOfMonth(range.start); cursor <= range.end; cursor = addMonths(cursor, 1)) keys.push(isoDate(cursor).slice(0, 7));
  }
  return keys;
}

export function calculateExposureTrend(records, exerciseMuscleLookup, groupCode, range) {
  const values = new Map(createBucketKeys(range).map((key) => [key, 0]));
  for (const record of workingSets(filterByRange(records, range))) {
    const relevance = relevanceForGroup(exerciseMuscleLookup.get(record.exercise_id), groupCode);
    const key = bucketKey(record.performed_on, range.bucket);
    if (relevance > 0 && values.has(key)) values.set(key, values.get(key) + relevance);
  }
  return [...values].map(([key, value]) => ({ key, value }));
}

export function summarizeTraining(sessions, records, range) {
  const periodSessions = filterByRange(sessions, range);
  const periodSets = workingSets(filterByRange(records, range));
  const exercises = new Set(periodSets.map((set) => set.exercise_id));
  let weeks = range.periodWeeks;
  if (!weeks && periodSessions.length) {
    const dates = periodSessions.map((session) => dateOnly(session.performed_on).getTime());
    weeks = Math.max(1, (Math.max(...dates) - Math.min(...dates) + DAY_MS) / (7 * DAY_MS));
  }
  return {
    sessions: periodSessions.length,
    workingSets: periodSets.length,
    exercises: exercises.size,
    averageSessionsPerWeek: weeks ? periodSessions.length / weeks : 0,
  };
}

function comparePerformanceSets(a, b) {
  const observedPair = (set) => {
    const brzycki = calculateBrzycki(set.weight, set.reps);
    const epley = calculateEpley(set.weight, set.reps);
    return brzycki === null || epley === null
      ? null
      : { conservative: Math.min(brzycki, epley), optimistic: Math.max(brzycki, epley) };
  };
  const aPair = observedPair(a);
  const bPair = observedPair(b);
  if (aPair !== null || bPair !== null) {
    if (aPair === null) return -1;
    if (bPair === null) return 1;
    if (aPair.conservative !== bPair.conservative) return aPair.conservative - bPair.conservative;
    if (aPair.optimistic !== bPair.optimistic) return aPair.optimistic - bPair.optimistic;
  }
  const aLoad = Number(a.weight);
  const bLoad = Number(b.weight);
  const validALoad = Number.isFinite(aLoad) ? aLoad : -Infinity;
  const validBLoad = Number.isFinite(bLoad) ? bLoad : -Infinity;
  if (validALoad !== validBLoad) return validALoad - validBLoad;
  return (Number(a.reps) || 0) - (Number(b.reps) || 0);
}

export function selectRepresentativeSets(records, exerciseId) {
  const bySession = new Map();
  for (const record of workingSets(records).filter((item) => String(item.exercise_id) === String(exerciseId))) {
    const selected = bySession.get(record.session_id);
    // Rank only observed completed performance: conservative formula, optimistic formula, load, then reps.
    if (!selected || comparePerformanceSets(record, selected) > 0) bySession.set(record.session_id, record);
  }
  return [...bySession.values()].sort((a, b) => a.performed_on.localeCompare(b.performed_on));
}

export function getEquipmentSeriesKey(record) {
  const equipmentId = record?.equipment_id;
  return equipmentId === null || equipmentId === undefined || equipmentId === ""
    ? "equipment-unrecorded"
    : `equipment-${String(equipmentId)}`;
}

export function selectRepresentativeSetsBySeries(records, exerciseId) {
  const bySessionAndSeries = new Map();
  for (const record of workingSets(records).filter((item) => String(item.exercise_id) === String(exerciseId))) {
    const seriesKey = getEquipmentSeriesKey(record);
    const key = `${seriesKey}:${record.session_id}`;
    const selected = bySessionAndSeries.get(key);
    // Each machine receives its own representative working set within a session.
    if (!selected || comparePerformanceSets(record, selected) > 0) bySessionAndSeries.set(key, record);
  }
  return [...bySessionAndSeries.values()].sort((a, b) => (
    a.performed_on.localeCompare(b.performed_on)
    || getEquipmentSeriesKey(a).localeCompare(getEquipmentSeriesKey(b))
  ));
}

export function getRepeatedExercises(records, minimumSessions = 2) {
  const sessionsByExercise = new Map();
  for (const record of workingSets(records)) {
    const entry = sessionsByExercise.get(record.exercise_id) ?? { exercise_id: record.exercise_id, exercise_name: record.exercise_name, sessions: new Set() };
    entry.sessions.add(record.session_id);
    entry.exercise_name = record.exercise_name;
    sessionsByExercise.set(record.exercise_id, entry);
  }
  return [...sessionsByExercise.values()]
    .filter((entry) => entry.sessions.size >= minimumSessions)
    .map(({ sessions, ...exercise }) => exercise)
    .sort((a, b) => a.exercise_name.localeCompare(b.exercise_name) || String(a.exercise_id).localeCompare(String(b.exercise_id)));
}

export function chooseDefaultExercise(records) {
  const stats = new Map();
  for (const record of workingSets(records)) {
    const stat = stats.get(record.exercise_id) ?? { exercise_id: record.exercise_id, exercise_name: record.exercise_name, sessions: new Set(), latest: "" };
    stat.sessions.add(record.session_id);
    if (record.performed_on > stat.latest) stat.latest = record.performed_on;
    stat.exercise_name = record.exercise_name;
    stats.set(record.exercise_id, stat);
  }
  const candidates = [...stats.values()].filter((stat) => stat.sessions.size >= 2);
  return candidates.sort((a, b) => b.sessions.size - a.sessions.size || b.latest.localeCompare(a.latest) || a.exercise_name.localeCompare(b.exercise_name) || String(a.exercise_id).localeCompare(String(b.exercise_id)))[0]?.exercise_id ?? null;
}

export function compareRecentPeriods(sessions, records, exerciseMuscleLookup, now = new Date(), groupCatalogue = getGroupCatalogue(exerciseMuscleLookup)) {
  const end = dateOnly(now);
  const current = { start: addDays(end, -27), end };
  const previous = { start: addDays(end, -55), end: addDays(end, -28) };
  const validSessionDates = sessions.map((session) => session.performed_on).filter(Boolean).sort();
  if (!validSessionDates.length || validSessionDates[0] > isoDate(previous.start)) return { available: false };
  const currentSessions = filterByRange(sessions, current);
  const previousSessions = filterByRange(sessions, previous);
  const currentRecords = filterByRange(records, current);
  const previousRecords = filterByRange(records, previous);
  const currentExposure = calculateMuscleExposure(currentRecords, exerciseMuscleLookup, groupCatalogue).groupExposure;
  const previousExposure = calculateMuscleExposure(previousRecords, exerciseMuscleLookup, groupCatalogue).groupExposure;
  return {
    available: true,
    sessions: { current: currentSessions.length, previous: previousSessions.length, delta: currentSessions.length - previousSessions.length },
    workingSets: {
      current: workingSets(currentRecords).length,
      previous: workingSets(previousRecords).length,
      delta: workingSets(currentRecords).length - workingSets(previousRecords).length,
    },
    groups: groupCatalogue.map((group) => ({
      code: group.code,
      name: group.name,
      current: currentExposure.get(group.code) ?? 0,
      previous: previousExposure.get(group.code) ?? 0,
      delta: (currentExposure.get(group.code) ?? 0) - (previousExposure.get(group.code) ?? 0),
    })),
  };
}

function niceStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, Number.EPSILON)));
  const normalized = value / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export function createLinearScale(values, targetTickCount = 5) {
  const finite = values.map(Number).filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  const rawMinimum = Math.min(...finite);
  const rawMaximum = Math.max(...finite);
  const rawSpread = rawMaximum - rawMinimum;
  const padding = Math.max(rawSpread * 0.1, rawMaximum * 0.05, 1);
  const step = niceStep((rawSpread + padding * 2) / Math.max(targetTickCount - 1, 1));
  const minimum = Math.max(0, Math.floor((rawMinimum - padding) / step) * step);
  const maximum = Math.max(minimum + step, Math.ceil((rawMaximum + padding) / step) * step);
  const ticks = [];
  for (let value = minimum; value <= maximum + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return {
    minimum,
    maximum,
    ticks,
    position(value) {
      return ((Number(value) - minimum) / (maximum - minimum)) * 100;
    },
  };
}

export function calculatePercentageChange(current, previous) {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) return null;
  return ((currentValue - previousValue) / previousValue) * 100;
}
