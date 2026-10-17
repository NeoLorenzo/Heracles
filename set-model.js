export const SET_CLASS = Object.freeze({
  WARMUP: "warmup",
  WORKING: "working",
  HIGH_RIR: "high_rir",
  DRAFT: "draft",
  BLANK: "blank",
});

function hasValue(val) {
  return val !== null && val !== undefined && val !== "";
}

export function isBlankSet(set) {
  if (!set) return true;
  return !hasValue(set.weight) && !hasValue(set.reps) && !hasValue(set.reported_rir_bucket);
}

export function isCompletedSet(set) {
  if (!set) return false;
  if (set.weight === null || set.reps === null) return false;
  if (set.weight !== undefined) {
    const load = Number(set.weight);
    if (!Number.isFinite(load) || load < 0) return false;
  }
  if (set.reps !== undefined) {
    const repetitions = Number(set.reps);
    if (!Number.isInteger(repetitions) || repetitions < 0) return false;
  }

  if (set.is_warmup === true) {
    return !hasValue(set.reported_rir_bucket);
  }

  if (!hasValue(set.reported_rir_bucket)) return false;
  const rir = Number(set.reported_rir_bucket);
  return Number.isInteger(rir) && rir >= 0 && rir <= 4;
}

export function isDraftSet(set) {
  return !isBlankSet(set) && !isCompletedSet(set);
}

export function classifySet(set) {
  if (isBlankSet(set)) return SET_CLASS.BLANK;
  if (isDraftSet(set)) return SET_CLASS.DRAFT;
  if (set?.is_warmup === true) return SET_CLASS.WARMUP;
  return Number(set?.reported_rir_bucket) === 4 ? SET_CLASS.HIGH_RIR : SET_CLASS.WORKING;
}

export function isWorkingSet(set) {
  if (set?.is_warmup === true) return false;
  return Number(set?.reported_rir_bucket) !== 4;
}

export function isAnalyticalWorkingSet(set) {
  return isCompletedSet(set) && isWorkingSet(set);
}

export function formatSetClassification(set) {
  const classification = classifySet(set);
  if (classification === SET_CLASS.BLANK) return "Blank set slot";
  if (classification === SET_CLASS.DRAFT) return "Draft set";
  if (classification === SET_CLASS.WARMUP) return "Warm-up";
  if (classification === SET_CLASS.HIGH_RIR) return "4+ RIR — not counted as a working set";
  return `${Number(set.reported_rir_bucket)} RIR · Working set`;
}

function roundTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateBrzycki(weight, reps) {
  const load = Number(weight);
  const repetitions = Number(reps);
  if (!Number.isFinite(load) || load < 0 || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 36) return null;
  return roundTwo(load * 36 / (37 - repetitions));
}

export function calculateEpley(weight, reps) {
  const load = Number(weight);
  const repetitions = Number(reps);
  if (!Number.isFinite(load) || load < 0 || !Number.isInteger(repetitions) || repetitions < 1) return null;
  return roundTwo(load * (1 + repetitions / 30));
}

export function calculateRirE1rmEstimates(set) {
  if (!isAnalyticalWorkingSet(set)) return null;
  const rir = Number(set.reported_rir_bucket);
  if (!Number.isInteger(rir) || rir < 0 || rir > 3) return null;
  const observedBrzycki = calculateBrzycki(set.weight, set.reps);
  const observedEpley = calculateEpley(set.weight, set.reps);
  const adjustedBrzycki = calculateBrzycki(set.weight, Number(set.reps) + rir);
  const adjustedEpley = calculateEpley(set.weight, Number(set.reps) + rir);
  if ([observedBrzycki, observedEpley, adjustedBrzycki, adjustedEpley].some((value) => value === null)) return null;
  return { observedBrzycki, observedEpley, adjustedBrzycki, adjustedEpley };
}

// Dumbbell loads are always entered and displayed per dumbbell. The recorded equipment decides this;
// exercise names that still state the implement (older records, static examples) are honoured too.
export function usesPerDumbbellLoad({ equipmentName = null, exerciseName = null } = {}) {
  if (typeof equipmentName === "string" && equipmentName.trim().toLowerCase() === "dumbbell") return true;
  return /\(Dumbbells?\)/i.test(exerciseName ?? "");
}
