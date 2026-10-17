import { usesPerDumbbellLoad } from "./set-model.js";

export function calculateRelativeOneRepMaxRange(low, high, bodyWeightKg) {
  const lowValue = Number(low);
  const highValue = Number(high);
  const bodyWeight = Number(bodyWeightKg);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue <= 0 || highValue < lowValue) return null;
  if (!Number.isFinite(bodyWeight) || bodyWeight <= 0) return null;
  return { low: lowValue / bodyWeight, high: highValue / bodyWeight };
}

export function resolveOneRepMaxEstimates(estimates, bodyWeightKg, { relativeEnabled = false, exerciseName = "", equipmentName = null } = {}) {
  if (!estimates) return null;
  const entries = Object.entries(estimates);
  if (entries.some(([, value]) => !Number.isFinite(Number(value)))) return null;
  const perDumbbell = usesPerDumbbellLoad({ equipmentName, exerciseName });
  if (!relativeEnabled) {
    return { available: true, relative: false, values: Object.fromEntries(entries.map(([key, value]) => [key, Number(value)])), unit: perDumbbell ? "kg per dumbbell" : "kg" };
  }
  const bodyWeight = Number(bodyWeightKg);
  if (!Number.isFinite(bodyWeight) || bodyWeight <= 0) {
    return { available: false, relative: true, reason: "Relative e1RM unavailable — no body weight for this date." };
  }
  return {
    available: true,
    relative: true,
    values: Object.fromEntries(entries.map(([key, value]) => [key, Number(value) / bodyWeight])),
    unit: perDumbbell ? "× BW per dumbbell" : "× BW",
  };
}

export function resolveOneRepMaxRange({
  low,
  high,
  performedOn,
  exerciseName = "",
  equipmentName = null,
  relativeEnabled = false,
  weightByDate = new Map(),
}) {
  const lowValue = Number(low);
  const highValue = Number(high);
  if (low === null || high === null || !Number.isFinite(lowValue) || !Number.isFinite(highValue)) return null;
  const perDumbbell = usesPerDumbbellLoad({ equipmentName, exerciseName });
  if (!relativeEnabled) {
    return { available: true, relative: false, low: lowValue, high: highValue, unit: perDumbbell ? "kg per dumbbell" : "kg" };
  }
  const relativeRange = calculateRelativeOneRepMaxRange(lowValue, highValue, weightByDate.get(performedOn));
  if (!relativeRange) {
    return { available: false, relative: true, reason: "Relative e1RM unavailable — no body weight for this date." };
  }
  return { available: true, relative: true, ...relativeRange, unit: perDumbbell ? "× BW per dumbbell" : "× BW" };
}

export function getOneRepMaxMidpoint(range) {
  return range?.available ? (range.low + range.high) / 2 : null;
}

export function getEffectiveRelativeMode(storedEnabled, hasBodyWeight) {
  return Boolean(storedEnabled && hasBodyWeight);
}
