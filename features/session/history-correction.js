export function toSessionHistorySetPayload(setUpdates) {
  return setUpdates.map((set) => ({
    id: set.id,
    weight: set.weight,
    reps: set.reps,
    is_warmup: set.isWarmup,
    reported_rir_bucket: set.reportedRirBucket,
  }));
}

export async function persistSessionHistoryExerciseCorrection(client, exerciseId, equipmentId, setUpdates) {
  const { data, error } = await client.rpc("update_session_history_exercise", {
    p_session_exercise_id: exerciseId,
    p_canonical_equipment_id: equipmentId,
    p_set_updates: toSessionHistorySetPayload(setUpdates),
  });

  if (error) throw error;
  return data;
}
