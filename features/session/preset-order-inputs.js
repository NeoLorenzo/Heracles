import { planPresetExerciseOrder } from "../../preset-ordering.js";

function throwIfError(result, label) {
  if (result?.error) throw new Error(`Could not load ${label}: ${result.error.message ?? result.error}`);
  return result?.data ?? null;
}

/**
 * Loads the owner's preset, ordering preference, and most recent completed
 * session from the same preset, then plans the starting order.
 *
 * Rotation reads the order the previous session was actually completed in, so
 * manual reordering during a live workout feeds the next rotation.
 */
export async function preparePresetExerciseOrder({ supabase, userId, presetId, ensureExerciseMuscleLookup }) {
  const [presetResult, settingsResult, priorityResult, previousResult, muscleLookup] = await Promise.all([
    supabase
      .from("workout_presets")
      .select("id, name, workout_preset_exercises(exercise_id, exercises(id, name))")
      .eq("id", presetId)
      .eq("owner_id", userId)
      .maybeSingle(),
    supabase
      .from("user_settings")
      .select("preset_order_mode, preset_order_alternate_muscle_groups")
      .eq("owner_id", userId)
      .maybeSingle(),
    supabase
      .from("user_priority_muscle_groups")
      .select("ui_muscle_group_id, ui_muscle_groups(code, name, source_order)")
      .eq("owner_id", userId),
    supabase
      .from("workout_sessions")
      .select("id, performed_on, source_preset_name, session_exercises(exercise_id, exercise_order, exercises(id, name))")
      .eq("owner_id", userId)
      .eq("source_preset_id", presetId)
      .eq("status", "completed")
      .order("performed_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ensureExerciseMuscleLookup ? ensureExerciseMuscleLookup() : Promise.resolve(null),
  ]);

  const preset = throwIfError(presetResult, "the preset");
  if (!preset) throw new Error("Preset not found.");
  const settings = throwIfError(settingsResult, "your workout order preference");
  const priorityRows = throwIfError(priorityResult, "your priority muscle groups") ?? [];
  const previous = throwIfError(previousResult, "your previous workout from this preset");

  const priorityGroups = priorityRows
    .map((row) => row.ui_muscle_groups)
    .filter((group) => group?.code)
    .sort((a, b) => (a.source_order ?? 0) - (b.source_order ?? 0))
    .map((group) => ({ code: group.code, name: group.name ?? group.code }));

  const exercises = (preset.workout_preset_exercises ?? []).map((membership) => ({
    id: membership.exercise_id,
    name: membership.exercises?.name ?? "",
  }));

  const previousSession = previous
    ? {
      id: previous.id,
      performedOn: previous.performed_on,
      presetName: previous.source_preset_name,
      exercises: [...(previous.session_exercises ?? [])]
        .sort((a, b) => a.exercise_order - b.exercise_order)
        .map((exercise) => ({ id: exercise.exercise_id, name: exercise.exercises?.name ?? "" })),
    }
    : null;

  return planPresetExerciseOrder({
    exercises,
    previousSession,
    preference: {
      mode: settings?.preset_order_mode,
      alternateMuscleGroups: settings?.preset_order_alternate_muscle_groups,
      priorityGroupCodes: priorityGroups.map((group) => group.code),
    },
    muscleLookup,
    priorityGroups,
    presetName: preset.name,
  });
}
