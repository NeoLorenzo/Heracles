// Deterministic starting order for preset-started workouts.
//
// The order is a product decision about where exercises sit in the session,
// not a hypertrophy claim: earlier exercises are performed while the lifter is
// fresher. The method is documented in docs/PRESET_EXERCISE_ORDER.md and must
// stay explainable from the stored order basis alone.

export const PRESET_ORDER_MODES = Object.freeze({
  BALANCED_ROTATION: "balanced_rotation",
  MUSCLE_GROUP_PRIORITY: "muscle_group_priority",
});

export const DEFAULT_PRESET_ORDER_PREFERENCE = Object.freeze({
  mode: PRESET_ORDER_MODES.BALANCED_ROTATION,
  alternateMuscleGroups: true,
  priorityGroupCodes: Object.freeze([]),
});

// Principal or major target in the exercise-to-muscle hypertrophic relevance
// matrix (coefficient 0.75 or 1.00). Used only to group exercises for ordering.
export const PRINCIPAL_TARGET_MIN_RELEVANCE = 0.75;

export const EXERCISE_ORDER_BASIS_VERSION = 1;

const MODE_VALUES = new Set(Object.values(PRESET_ORDER_MODES));

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Character-by-character (code point) comparison, matching SQL `collate "C"`,
// so the alphabetical fallback is identical on every device and in the database.
export function compareExerciseNames(a, b) {
  return compareText(String(a.name ?? ""), String(b.name ?? "")) || compareText(String(a.id), String(b.id));
}

function uniqueInOrder(values) {
  return [...new Set(values)];
}

export function normalizePresetOrderPreference(preference) {
  const mode = MODE_VALUES.has(preference?.mode) ? preference.mode : DEFAULT_PRESET_ORDER_PREFERENCE.mode;
  const alternateMuscleGroups = typeof preference?.alternateMuscleGroups === "boolean"
    ? preference.alternateMuscleGroups
    : DEFAULT_PRESET_ORDER_PREFERENCE.alternateMuscleGroups;
  const priorityGroupCodes = uniqueInOrder(
    (Array.isArray(preference?.priorityGroupCodes) ? preference.priorityGroupCodes : [])
      .filter((code) => typeof code === "string" && code !== ""),
  ).sort(compareText);
  return { mode, alternateMuscleGroups, priorityGroupCodes };
}

// Muscle groups for which an exercise has at least one principal or major
// target muscle, strongest first. Ties use the catalogue order of the groups.
export function principalMuscleGroups(mappedMuscles) {
  const byCode = new Map();
  for (const muscle of mappedMuscles ?? []) {
    const relevance = Number(muscle?.relevance);
    const code = muscle?.uiGroup?.code;
    if (!code || !(relevance >= PRINCIPAL_TARGET_MIN_RELEVANCE)) continue;
    const existing = byCode.get(code);
    if (!existing || relevance > existing.relevance) {
      byCode.set(code, {
        code,
        name: muscle.uiGroup.name ?? code,
        sourceOrder: Number(muscle.uiGroup.sourceOrder) || 0,
        relevance,
      });
    }
  }
  return [...byCode.values()].sort((a, b) => (
    b.relevance - a.relevance || a.sourceOrder - b.sourceOrder || compareText(a.code, b.code)
  ));
}

function lookupMuscles(muscleLookup, exerciseId) {
  if (!muscleLookup) return [];
  if (typeof muscleLookup.get === "function") {
    return muscleLookup.get(exerciseId)
      ?? muscleLookup.get(Number(exerciseId))
      ?? muscleLookup.get(String(exerciseId))
      ?? [];
  }
  return muscleLookup[String(exerciseId)] ?? [];
}

function orderTier(tier, previousKeys, alternate) {
  const tierKeys = new Map(tier.map((entry) => [entry.key, entry]));
  const previous = previousKeys.filter((key) => tierKeys.has(key)).map((key) => tierKeys.get(key));
  const previousSet = new Set(previous.map((entry) => entry.key));
  // `tier` is already alphabetical, so added exercises keep that stable order.
  const added = tier.filter((entry) => !previousSet.has(entry.key));

  // Exercise rotation: last time's first exercise moves to the back.
  const sequence = previous.length
    ? [...previous.slice(1), previous[0], ...added]
    : [...added];

  // Group rotation: last time's first muscle group moves to the back; groups
  // that are new to the preset follow the rotated groups.
  let groupOrder;
  if (previous.length) {
    const previousGroups = uniqueInOrder(previous.map((entry) => entry.groupKey));
    groupOrder = uniqueInOrder([
      ...previousGroups.slice(1),
      previousGroups[0],
      ...added.map((entry) => entry.groupKey),
    ]);
  } else {
    groupOrder = uniqueInOrder(sequence.map((entry) => entry.groupKey));
  }

  const queues = new Map(groupOrder.map((groupKey) => [groupKey, []]));
  for (const entry of sequence) queues.get(entry.groupKey).push(entry);

  if (!alternate) return groupOrder.flatMap((groupKey) => queues.get(groupKey));

  // Round-robin across groups; a group with more exercises finishes at the end.
  const ordered = [];
  let remaining = sequence.length;
  while (remaining > 0) {
    for (const groupKey of groupOrder) {
      const queue = queues.get(groupKey);
      if (!queue.length) continue;
      ordered.push(queue.shift());
      remaining -= 1;
    }
  }
  return ordered;
}

function exerciseRef(entry) {
  return { id: entry.id, name: entry.name };
}

/**
 * Plans the starting order of a preset-started workout.
 *
 * @param {object} input
 * @param {{id: number|string, name: string}[]} input.exercises Current preset exercises.
 * @param {null|{id, performedOn, presetName, exercises: {id, name}[]}} input.previousSession
 *   Most recent completed session started from the same preset, with its
 *   exercises in the order actually performed.
 * @param {object} input.preference Ordering preference (see normalizePresetOrderPreference).
 * @param {Map|object} input.muscleLookup exercise id → mapped muscles with relevance and uiGroup.
 * @param {{code, name}[]} [input.priorityGroups] Display names for the priority group codes.
 * @param {string|null} [input.presetName] Current preset name, used in the explanation.
 * @returns {{exerciseIds: Array<number|string>, basis: object|null}}
 */
export function planPresetExerciseOrder({
  exercises,
  previousSession = null,
  preference = DEFAULT_PRESET_ORDER_PREFERENCE,
  muscleLookup = null,
  priorityGroups = [],
  presetName = null,
}) {
  const settings = normalizePresetOrderPreference(preference);
  const isPriorityMode = settings.mode === PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY;
  const priorityCodes = new Set(isPriorityMode ? settings.priorityGroupCodes : []);

  const seen = new Set();
  const members = [];
  for (const exercise of exercises ?? []) {
    if (exercise?.id === null || exercise?.id === undefined) continue;
    const key = String(exercise.id);
    if (seen.has(key)) continue;
    seen.add(key);
    members.push({ id: exercise.id, name: String(exercise.name ?? "") });
  }
  members.sort(compareExerciseNames);
  if (!members.length) return { exerciseIds: [], basis: null };

  const entries = members.map((exercise) => {
    const key = String(exercise.id);
    const groups = principalMuscleGroups(lookupMuscles(muscleLookup, exercise.id));
    const priorityGroup = groups.find((group) => priorityCodes.has(group.code)) ?? null;
    const group = priorityGroup ?? groups[0] ?? null;
    return {
      id: exercise.id,
      key,
      name: exercise.name,
      isMapped: groups.length > 0,
      isPriority: Boolean(priorityGroup),
      groupKey: group ? `group:${group.code}` : `exercise:${key}`,
    };
  });
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));

  const previousExercises = [];
  const previousSeen = new Set();
  for (const exercise of previousSession?.exercises ?? []) {
    if (exercise?.id === null || exercise?.id === undefined) continue;
    const key = String(exercise.id);
    if (previousSeen.has(key)) continue;
    previousSeen.add(key);
    previousExercises.push({ key, id: exercise.id, name: String(exercise.name ?? "") });
  }
  const previousKeys = previousExercises.map((exercise) => exercise.key).filter((key) => byKey.has(key));
  const hasRotation = previousKeys.length > 0;

  const tiers = isPriorityMode
    ? [entries.filter((entry) => entry.isPriority), entries.filter((entry) => !entry.isPriority)]
    : [entries];
  const ordered = tiers.flatMap((tier) => orderTier(tier, previousKeys, settings.alternateMuscleGroups));

  const leadingTier = tiers.find((tier) => tier.length > 0);
  const leadingTierKeys = new Set(leadingTier.map((entry) => entry.key));
  const leadingPreviousKey = previousKeys.find((key) => leadingTierKeys.has(key)) ?? null;
  const previousKeySet = new Set(previousKeys);

  let strategy = "first_session_alphabetical";
  if (hasRotation) strategy = "rotation";
  else if (previousSession) strategy = "no_overlap_alphabetical";

  const priorityNameByCode = new Map((priorityGroups ?? []).map((group) => [group.code, group.name]));

  const basis = {
    version: EXERCISE_ORDER_BASIS_VERSION,
    mode: settings.mode,
    alternateMuscleGroups: settings.alternateMuscleGroups,
    principalTargetMinRelevance: PRINCIPAL_TARGET_MIN_RELEVANCE,
    strategy,
    presetName: presetName ?? previousSession?.presetName ?? null,
    exerciseCount: entries.length,
    groupCount: new Set(entries.map((entry) => entry.groupKey)).size,
    previousSession: previousSession
      ? {
        id: previousSession.id ?? null,
        performedOn: previousSession.performedOn ?? null,
        presetName: previousSession.presetName ?? null,
      }
      : null,
    previousFirst: leadingPreviousKey ? exerciseRef(byKey.get(leadingPreviousKey)) : null,
    first: exerciseRef(ordered[0]),
    addedExercises: hasRotation
      ? entries.filter((entry) => !previousKeySet.has(entry.key)).map(exerciseRef)
      : [],
    removedExercises: previousExercises
      .filter((exercise) => !byKey.has(exercise.key))
      .map((exercise) => ({ id: exercise.id, name: exercise.name })),
    unmappedExercises: entries.filter((entry) => !entry.isMapped).map(exerciseRef),
    priorityGroups: isPriorityMode
      ? settings.priorityGroupCodes.map((code) => ({ code, name: priorityNameByCode.get(code) ?? code }))
      : [],
    priorityExerciseCount: isPriorityMode ? tiers[0].length : 0,
  };

  return { exerciseIds: ordered.map((entry) => entry.id), basis };
}

function joinNames(names) {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function defaultFormatDate(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  if (!year || !month || !day) return String(isoDate);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" })
    .format(new Date(year, month - 1, day));
}

function namesOf(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => String(item?.name ?? ""))
    .filter((name) => name !== "");
}

/**
 * Plain-language explanation of a stored order basis, one sentence per line.
 * Unknown or missing bases produce no explanation rather than a guess.
 */
export function describeExerciseOrderBasis(basis, { formatDate = defaultFormatDate } = {}) {
  if (!basis || typeof basis !== "object") return [];
  if (basis.strategy === "server_alphabetical") {
    return ["Exercises start in alphabetical order. You can reorder them at any time."];
  }
  if (basis.version !== EXERCISE_ORDER_BASIS_VERSION) return [];

  const lines = [];
  const previous = basis.previousSession;
  const presetName = basis.presetName ?? previous?.presetName ?? null;
  const presetLabel = presetName ? `${presetName} ` : "";
  const dateLabel = previous?.performedOn ? ` (${formatDate(previous.performedOn)})` : "";
  const isPriorityMode = basis.mode === PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY;

  if (isPriorityMode) {
    const groupNames = namesOf(basis.priorityGroups);
    const groupLabel = joinNames(groupNames);
    if (!groupNames.length) {
      lines.push("No priority muscle groups are selected, so no exercises are moved forward.");
    } else if (basis.priorityExerciseCount > 0) {
      lines.push(
        `${groupLabel} ${groupNames.length === 1 ? "is a priority" : "are priorities"}, so exercises that mainly train ${groupNames.length === 1 ? "it" : "them"} come first — placed earlier in the workout, while you're fresher.`,
      );
    } else {
      lines.push(`None of this preset's exercises mainly train ${groupLabel}, so no exercises are moved forward.`);
    }
  }

  if (basis.exerciseCount === 1) {
    lines.push("This preset has one exercise, so there is no order to rotate.");
  } else if (basis.strategy === "rotation") {
    const previousFirst = basis.previousFirst?.name;
    const first = basis.first?.name;
    if (previousFirst && first && previousFirst !== first) {
      lines.push(`Rotated from your last ${presetLabel}workout${dateLabel}: ${previousFirst} went first last time, so ${first} goes first today.`);
    } else {
      lines.push(`Rotated from your last ${presetLabel}workout${dateLabel}: the exercise that went first last time moves to the back.`);
    }
  } else if (basis.strategy === "no_overlap_alphabetical") {
    lines.push(`None of the exercises from your last ${presetLabel}workout${dateLabel} are still in this preset, so exercises start in alphabetical order.`);
  } else {
    lines.push(`No completed ${presetName ? `${presetName} workout` : "workout from this preset"} yet, so exercises start in alphabetical order.`);
  }

  const added = namesOf(basis.addedExercises);
  if (added.length) {
    lines.push(`Added since then: ${joinNames(added)}. New exercises go after last time's exercises for the same muscle group.`);
  }
  const removed = namesOf(basis.removedExercises);
  if (removed.length) {
    lines.push(`No longer in this preset, so left out: ${joinNames(removed)}.`);
  }

  if (basis.exerciseCount > 1) {
    if (!basis.alternateMuscleGroups) {
      lines.push("Exercises for the same muscle group are kept together.");
    } else if (basis.groupCount > 1) {
      lines.push("Exercises alternate between muscle groups where possible, and all sets of an exercise stay together. Compound exercises also work other muscles, so this spreads fatigue but does not fully separate it.");
    } else {
      lines.push("All exercises share one main muscle group, so there is nothing to alternate.");
    }
  }

  const unmapped = namesOf(basis.unmappedExercises);
  if (unmapped.length) {
    const treatment = [
      isPriorityMode ? "treated as non-priority" : null,
      basis.alternateMuscleGroups && basis.exerciseCount > 1 ? "alternated as its own group" : null,
    ].filter(Boolean);
    lines.push(
      `${joinNames(unmapped)} ${unmapped.length === 1 ? "has" : "have"} no principal-target muscle mapping${treatment.length ? `, so ${unmapped.length === 1 ? "it is" : "each is"} ${treatment.join(" and ")}` : ""}.`,
    );
  }

  lines.push("You can reorder freely; your next workout from this preset rotates from the order you actually complete.");
  return lines;
}
