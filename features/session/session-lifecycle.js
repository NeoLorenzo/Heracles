// Session-level lifecycle actions available from Session History for completed workouts.
// Both are single owner-scoped RPCs; the database enforces ownership, status, and the
// one-in-progress-session invariant.

export const ACTIVE_WORKOUT_CONFLICT_MESSAGE = "Finish or cancel your active workout before editing a completed session.";

export async function deleteCompletedWorkoutSession(client, sessionId) {
  const { error } = await client.rpc("delete_completed_workout_session", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return true;
}

export async function reopenCompletedWorkoutSession(client, sessionId) {
  const { data, error } = await client.rpc("reopen_workout_session", {
    p_session_id: sessionId,
  });
  if (error) {
    if (error.code === "55000") throw new Error(ACTIVE_WORKOUT_CONFLICT_MESSAGE);
    throw error;
  }
  return data;
}

// A reopened session has a pre-correction snapshot row. This only drives labels and navigation:
// the server restores reopened history on cancel regardless, so a failed lookup (for example
// before the snapshot table is deployed) safely falls back to the normal live-workout copy.
export async function isReopenedCorrection(client, userId, sessionId) {
  try {
    const { data, error } = await client
      .from("workout_session_reopen_snapshots")
      .select("session_id")
      .eq("session_id", sessionId)
      .eq("owner_id", userId)
      .maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

export function describeSessionForDeletion(session, formatDate) {
  const gymName = session?.gyms?.name ?? "Gym";
  const exerciseCount = session?.session_exercises?.length ?? 0;
  const date = formatDate ? formatDate(session.performed_on) : session?.performed_on;
  return `${gymName} · ${date} · ${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`;
}
