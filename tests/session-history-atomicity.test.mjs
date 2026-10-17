import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  persistSessionHistoryExerciseCorrection,
  toSessionHistorySetPayload,
} from "../features/session/history-correction.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Session History correction is submitted as one RPC with canonical field names", async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: {
          id: 44,
          canonical_equipment_id: 7,
          equipment_name_snapshot: "Prime Leg Extension P-105",
          sets: [{ id: 101, weight: 80, reps: 10, is_warmup: false, reported_rir_bucket: 2 }],
        },
        error: null,
      };
    },
  };
  const setUpdates = [{ id: 101, weight: 80, reps: 10, isWarmup: false, reportedRirBucket: 2 }];

  const saved = await persistSessionHistoryExerciseCorrection(
    client,
    44,
    7,
    setUpdates,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "update_session_history_exercise");
  assert.deepEqual(calls[0].args, {
    p_session_exercise_id: 44,
    p_canonical_equipment_id: 7,
    p_set_updates: [{
      id: 101,
      weight: 80,
      reps: 10,
      is_warmup: false,
      reported_rir_bucket: 2,
    }],
  });
  assert.equal(saved.canonical_equipment_id, 7);
  assert.equal(saved.equipment_name_snapshot, "Prime Leg Extension P-105");
});

test("a failed correction remains one failed persistence operation with no fallback writes", async () => {
  let rpcCalls = 0;
  const expectedError = new Error("child set rejected");
  const client = {
    rpc: async () => {
      rpcCalls += 1;
      return { data: null, error: expectedError };
    },
  };

  await assert.rejects(
    persistSessionHistoryExerciseCorrection(
      client,
      44,
      null,
      [{ id: 999, weight: 80, reps: 10, isWarmup: false, reportedRirBucket: 2 }],
    ),
    expectedError,
  );
  assert.equal(rpcCalls, 1);
});

test("set payload conversion preserves nulls and warm-up semantics", () => {
  assert.deepEqual(toSessionHistorySetPayload([
    { id: 1, weight: null, reps: null, isWarmup: true, reportedRirBucket: null },
    { id: 2, weight: 50, reps: 8, isWarmup: false, reportedRirBucket: 1 },
  ]), [
    { id: 1, weight: null, reps: null, is_warmup: true, reported_rir_bucket: null },
    { id: 2, weight: 50, reps: 8, is_warmup: false, reported_rir_bucket: 1 },
  ]);
});

test("Session History save no longer performs sibling browser-side table updates", async () => {
  const app = await read("app.js");
  const start = app.indexOf("async function saveExerciseChanges");
  const end = app.indexOf("function formatOneRepMaxRange", start);
  const saveFunction = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(saveFunction, /persistSessionHistoryExerciseCorrection/);
  assert.doesNotMatch(saveFunction, /\.from\("session_exercises"\)/);
  assert.doesNotMatch(saveFunction, /\.from\("exercise_sets"\)/);
  assert.doesNotMatch(saveFunction, /Promise\.all/);
});

test("atomic correction migration validates the complete child set before any mutation", async () => {
  const migration = await read("supabase/migrations/20260906145000_make_session_history_corrections_atomic.sql");
  const exactSetValidation = migration.indexOf("Submitted set IDs do not exactly match the current exercise sets.");
  const firstExerciseMutation = migration.indexOf("update public.session_exercises");
  const firstSetMutation = migration.indexOf("update public.exercise_sets es");

  assert.ok(exactSetValidation > 0);
  assert.ok(firstExerciseMutation > exactSetValidation);
  assert.ok(firstSetMutation > exactSetValidation);
  assert.match(migration, /for update of se/i);
  assert.match(migration, /from public\.exercise_sets es[\s\S]*for update;/i);
  assert.match(migration, /Duplicate set IDs are not allowed\./);
  assert.match(migration, /ws\.status = 'completed'/);
  assert.match(migration, /grant execute on function public\.update_session_history_exercise\(bigint, text, jsonb\) to authenticated;/);
  assert.match(migration, /estimated_1rm_brzycki_rir_adjusted/);
  assert.match(migration, /estimated_1rm_epley_rir_adjusted/);
});

test("issue #22 correction function selects owned canonical equipment and validates before any mutation", async () => {
  const migration = await read("supabase/migrations/20261017130000_canonical_equipment_identity.sql");
  const start = migration.indexOf("create function public.update_session_history_exercise(");
  const end = migration.indexOf("$$;", start);
  const body = migration.slice(start, end);

  assert.ok(start > 0 && end > start);
  assert.match(body, /p_canonical_equipment_id bigint/);
  const equipmentValidation = body.indexOf("Equipment not found or not owned by the current user.");
  const exactSetValidation = body.indexOf("Submitted set IDs do not exactly match the current exercise sets.");
  const firstExerciseMutation = body.indexOf("update public.session_exercises");
  const firstSetMutation = body.indexOf("update public.exercise_sets es");
  assert.ok(equipmentValidation > 0 && exactSetValidation > equipmentValidation);
  assert.ok(firstExerciseMutation > exactSetValidation);
  assert.ok(firstSetMutation > exactSetValidation);
  assert.doesNotMatch(body, /set equipment_id = /, "the legacy free-text equipment field is no longer written");
  assert.match(body, /when p_canonical_equipment_id is not distinct from target_exercise\.canonical_equipment_id\s+then target_exercise\.equipment_name_snapshot/);
  assert.match(migration, /grant execute on function public\.update_session_history_exercise\(bigint, bigint, jsonb\) to authenticated;/);
});
