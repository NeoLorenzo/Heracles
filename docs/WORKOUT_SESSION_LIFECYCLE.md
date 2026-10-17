# Workout session lifecycle

A `workout_sessions` row is either `in_progress` or `completed`. A partial unique index allows at most one `in_progress` session per owner. Only `completed` sessions feed analytics, previous-performance context, equipment defaults, recent-exercise lists, and the Kleos strength export.

## Transitions

| From | Action | RPC | Result |
| --- | --- | --- | --- |
| — | Start a workout | `start_or_resume_workout_session` | New `in_progress` session, or the existing one is resumed. |
| `in_progress` | Finish workout / Save corrections | `conclude_workout_session` | `completed`. Blank set slots and exercises without sets are pruned; partially entered drafts are rejected. |
| `in_progress` (normal) | Cancel workout | `cancel_workout_session` | The session and its exercises and sets are deleted. |
| `in_progress` (reopened) | Discard corrections | `cancel_workout_session` | The pre-correction snapshot is restored and the session returns to `completed`. Nothing is deleted. |
| `completed` | Delete workout (Session History) | `delete_completed_workout_session` | The session is deleted; its exercises and sets cascade. |
| `completed` | Edit as workout (Session History) | `reopen_workout_session` | The session is snapshotted and returns to `in_progress` in the live-workout editor. |

Every RPC is `security invoker` with an empty `search_path`, runs under Row Level Security, and resolves the session only by `id` **and** the caller's `auth.uid()`. Another owner's session is reported as not found (`42501`). `anon` cannot execute any of them.

## Deleting a completed session

Session History shows **Delete workout** on each completed session. A confirmation dialog names the gym, date, and exercise count before anything is removed. The RPC accepts only `completed` sessions; an in-progress workout is cancelled from the live workout instead. Exercises and sets are removed by the existing owner-scoped `ON DELETE CASCADE` keys, so no other session is touched. Referenced canonical equipment, gyms, presets, and global exercises are not deleted.

Deletion is permanent. Analytics, Session History, and previous-performance context stop including the session once it is gone.

## Reopening a completed session for correction

Session History shows **Edit as workout** on each completed session. It is disabled while another workout is in progress, and the RPC refuses with `55000` in that case (including a concurrent start or reopen that wins the single in-progress slot). The session then opens in the normal live-workout editor, so exercise add/remove/reorder, set add/remove, equipment correction, and weight/reps/warm-up/RIR editing all use the same code and RPCs as a live workout. There is no second editing model.

The live workout shows that it is correcting a completed workout from the original date, and its actions read **Save corrections** and **Discard corrections**.

### What reopening changes and preserves

- The session keeps its `id`, `performed_on`, `created_at`, gym, and preset provenance. There is no separate completion timestamp in the schema, so finishing again does not move the workout in time. Changing the workout date or gym is not supported.
- While reopened, the session is `in_progress`, so it is temporarily excluded from analytics, previous-performance context, and the Kleos export, exactly like any other unfinished workout. It reappears with its corrected data once saved, or with its original data once discarded.
- Equipment defaults and previous-performance context during the correction come from the owner's other completed sessions; they can include sessions dated after the one being corrected.

### Snapshot and discard

Before the status change, `reopen_workout_session` stores the exact completed session, exercise, and set rows (including identity values, the canonical `exercise_id` and `canonical_equipment_id` with its `equipment_name_snapshot`, provenance such as `rir_source`, and legacy fields such as `rpe`, drop-set/superset flags, and the pre-#22 `gym_equipment_id` and `equipment_id` text) in `workout_session_reopen_snapshots`. That table is owner-scoped with RLS, keyed one-to-one to the session through the owner-composite foreign key, and cascades away with the session.

`cancel_workout_session` checks for a snapshot first. If one exists, it deletes the correction-time exercises and sets, re-inserts the original rows with their original IDs, restores the session fields, and sets the session back to `completed`. Generated e1RM columns are recalculated from the restored inputs and therefore match. Discarding a correction can never destroy the history that was reopened. A normal in-progress workout with no snapshot is still deleted, as before.

The snapshot is not a foreign-key reference, so the `ON DELETE RESTRICT` that protects referenced equipment does not cover equipment named only by the snapshot. The app has no equipment-delete action, but the API allows an owner to delete their own equipment. If the original session's `canonical_equipment_id` (or legacy `gym_equipment_id`) row was deleted during the correction, the restored exercise keeps its `equipment_name_snapshot` and the link is cleared, because the row no longer exists.

History references active canonical exercises only (issue #22). A restore never points a session at a retired exercise: if an exercise in the original was retired while the session was reopened (for example by a later catalogue-merge migration, which repoints live rows but not snapshots), discarding is refused (`22023`) and nothing changes. The correction stays in progress and can still be saved.

When a reopened session reaches `completed` by any path (`conclude_workout_session`, or a direct status update), a trigger discards its snapshot, so the corrected data becomes canonical.

### Sessions that cannot be reopened

Finishing runs `conclude_workout_session`, which prunes blank sets and exercises without sets and rejects incomplete drafts. Some historical records do not meet those live-workout rules, for example a set with no recorded weight, or an exercise with no sets. Reopening such a session and saving it unchanged would silently alter or discard history, so `reopen_workout_session` refuses it (`22023`). It also refuses a session that still references a retired exercise. Those sessions can still be corrected with the per-exercise **Edit** form in Session History, or deleted.

## Quick per-exercise correction

The existing per-exercise **Edit** form in Session History remains available for completed sessions. It changes the legacy equipment ID text and the existing sets' weight, reps, warm-up state, and RIR through the atomic `update_session_history_exercise` RPC, without reopening the session.
