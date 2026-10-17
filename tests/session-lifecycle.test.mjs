import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACTIVE_WORKOUT_CONFLICT_MESSAGE,
  deleteCompletedWorkoutSession,
  describeSessionForDeletion,
  isReopenedCorrection,
  reopenCompletedWorkoutSession,
} from "../features/session/session-lifecycle.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Minimal DOM mock: enough for the session renderer's header, empty state, and footer.
class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => ((force ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
  }

  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) if (node && typeof node !== "string") this.children.push(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    const found = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (className ? child.classes.has(className) : child.tagName === selector.toUpperCase()) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

globalThis.document = {
  createElement: (tag) => new MockElement(tag),
  createDocumentFragment: () => new MockElement("#fragment"),
  querySelector: () => null,
  querySelectorAll: () => [],
};

const { createSessionFeature } = await import("../features/session/session-controller.js");
const { createSessionRenderer } = await import("../features/session/session-rendering.js");

test("deleting a completed session is one owner-scoped RPC", async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; } };

  assert.equal(await deleteCompletedWorkoutSession(client, 41), true);
  assert.deepEqual(calls, [{ name: "delete_completed_workout_session", args: { p_session_id: 41 } }]);

  const failure = new Error("Only completed workout sessions can be deleted.");
  await assert.rejects(
    deleteCompletedWorkoutSession({ rpc: async () => ({ data: null, error: failure }) }, 41),
    failure,
  );
});

test("reopening maps the active-workout conflict to a clear message and passes other errors through", async () => {
  const calls = [];
  const reopened = await reopenCompletedWorkoutSession({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { id: 7, status: "in_progress" }, error: null };
    },
  }, 7);
  assert.deepEqual(calls, [{ name: "reopen_workout_session", args: { p_session_id: 7 } }]);
  assert.equal(reopened.status, "in_progress");

  await assert.rejects(
    reopenCompletedWorkoutSession({ rpc: async () => ({ data: null, error: { code: "55000", message: "busy" } }) }, 7),
    new Error(ACTIVE_WORKOUT_CONFLICT_MESSAGE),
  );
  const other = { code: "22023", message: "This session contains historical entries the live workout editor cannot finish unchanged." };
  await assert.rejects(
    reopenCompletedWorkoutSession({ rpc: async () => ({ data: null, error: other }) }, 7),
    (error) => error === other,
  );
});

function createMarkerClient(result, filters = []) {
  return {
    from(table) {
      const builder = {
        select(columns) { filters.push({ table, columns }); return builder; },
        eq(column, value) { filters.push({ column, value }); return builder; },
        maybeSingle: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
      };
      return builder;
    },
  };
}

test("a reopened correction is recognized by its owner-scoped snapshot row", async () => {
  const filters = [];
  assert.equal(await isReopenedCorrection(createMarkerClient({ data: { session_id: 7 }, error: null }, filters), "user-1", 7), true);
  assert.deepEqual(filters, [
    { table: "workout_session_reopen_snapshots", columns: "session_id" },
    { column: "session_id", value: 7 },
    { column: "owner_id", value: "user-1" },
  ]);
  assert.equal(await isReopenedCorrection(createMarkerClient({ data: null, error: null }), "user-1", 7), false);
});

test("a failed correction lookup falls back to a normal workout instead of breaking the live session", async () => {
  assert.equal(await isReopenedCorrection(createMarkerClient({ data: null, error: { code: "42P01" } }), "user-1", 7), false);
  assert.equal(await isReopenedCorrection(createMarkerClient(new Error("offline")), "user-1", 7), false);
});

test("the delete confirmation identifies the workout being removed", () => {
  const session = { performed_on: "2026-08-01", gyms: { name: "Iron Gym" }, session_exercises: [{}, {}] };
  assert.equal(describeSessionForDeletion(session, (iso) => `on ${iso}`), "Iron Gym · on 2026-08-01 · 2 exercises");
  assert.equal(
    describeSessionForDeletion({ performed_on: "2026-08-02", session_exercises: [{}] }),
    "Gym · 2026-08-02 · 1 exercise",
  );
});

function createControllerFixture({ session, rpcResult = { data: true, error: null } } = {}) {
  const rpcCalls = [];
  const navigations = [];
  const cancelled = [];
  const concluded = [];
  const selects = [];
  let currentSession = session ?? null;
  const reopenedSessionIds = new Set(currentSession?.reopened ? [currentSession.id] : []);

  const client = {
    from(table) {
      const builder = {
        select(columns) { selects.push({ table, columns }); return builder; },
        eq() { return builder; },
        in() { return builder; },
        not() { return builder; },
        limit() { return builder; },
        order() {
          if (table === "gyms") return Promise.resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          if (table === "workout_sessions") return Promise.resolve({ data: currentSession, error: null });
          if (table === "workout_session_reopen_snapshots") {
            return Promise.resolve({
              data: currentSession && reopenedSessionIds.has(currentSession.id) ? { session_id: currentSession.id } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
    rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "reopen_workout_session" && !rpcResult.error) {
        currentSession = { id: args.p_session_id, gym_id: 10, status: "in_progress", performed_on: "2026-08-01" };
        reopenedSessionIds.add(args.p_session_id);
      }
      return Promise.resolve(rpcResult);
    },
  };

  const feature = createSessionFeature({
    getClient: () => client,
    getUserId: () => "user-test",
    historyContext: { clearCache() {}, fetchPreviousPerformance: async () => ({ sets: [] }) },
    ensureExerciseCatalogue: () => Promise.resolve([]),
    onNavigate: (page) => navigations.push(page),
    onSessionCancelled: (id, details) => cancelled.push({ id, details }),
    onSessionConcluded: (id, details) => concluded.push({ id, details }),
  });

  return { feature, rpcCalls, navigations, cancelled, concluded, selects };
}

const reopenedSession = {
  id: 77,
  gym_id: 10,
  status: "in_progress",
  performed_on: "2026-08-01",
  reopened: true,
};

test("loading the active session looks up and exposes the reopened-correction marker", async () => {
  const fixture = createControllerFixture({ session: reopenedSession });
  await fixture.feature.load();

  assert.ok(fixture.selects.some(({ table }) => table === "workout_session_reopen_snapshots"));
  assert.equal(fixture.feature.getActiveSession().is_history_correction, true);

  const normal = createControllerFixture({ session: { id: 5, gym_id: 10, status: "in_progress", performed_on: "2026-10-17" } });
  await normal.feature.load();
  assert.equal(normal.feature.getActiveSession().is_history_correction, false);
});

test("reopening from history uses the RPC, loads the correction, and opens the live workout", async () => {
  const fixture = createControllerFixture();
  await fixture.feature.load();
  assert.equal(fixture.feature.getActiveSession(), null);

  const session = await fixture.feature.reopenSession(77);

  assert.deepEqual(fixture.rpcCalls, [{ name: "reopen_workout_session", args: { p_session_id: 77 } }]);
  assert.equal(session.id, 77);
  assert.equal(session.is_history_correction, true);
  assert.deepEqual(fixture.navigations, ["live-session"]);
});

test("reopening is refused locally while another workout is active", async () => {
  const fixture = createControllerFixture({ session: { id: 5, gym_id: 10, status: "in_progress", performed_on: "2026-10-17" } });
  await fixture.feature.load();

  await assert.rejects(fixture.feature.reopenSession(77), new Error(ACTIVE_WORKOUT_CONFLICT_MESSAGE));
  assert.deepEqual(fixture.rpcCalls, [], "no reopen request is sent while a workout is active");
  assert.equal(fixture.feature.getActiveSession().id, 5);
});

test("a failed reopen surfaces the server error and does not open the live workout", async () => {
  const failure = { code: "22023", message: "Only completed workout sessions can be reopened." };
  const fixture = createControllerFixture({ rpcResult: { data: null, error: failure } });
  await fixture.feature.load();

  await assert.rejects(fixture.feature.reopenSession(77), (error) => error === failure);
  assert.deepEqual(fixture.navigations, []);
  assert.equal(fixture.feature.getActiveSession(), null);
});

test("discarding a correction reports the restored completed session and returns to history", async () => {
  const fixture = createControllerFixture({ session: reopenedSession });
  await fixture.feature.load();

  await fixture.feature.cancelSession();

  assert.deepEqual(fixture.rpcCalls, [{ name: "cancel_workout_session", args: { p_session_id: 77 } }]);
  assert.deepEqual(fixture.cancelled, [{ id: 77, details: { restoredCompletedSession: true } }]);
  assert.deepEqual(fixture.navigations, ["session-history"]);
  assert.equal(fixture.feature.getActiveSession(), null);
});

test("cancelling a normal workout still returns home without the restored flag", async () => {
  const fixture = createControllerFixture({ session: { id: 5, gym_id: 10, status: "in_progress", performed_on: "2026-10-17" } });
  await fixture.feature.load();

  await fixture.feature.cancelSession();

  assert.deepEqual(fixture.cancelled, [{ id: 5, details: { restoredCompletedSession: false } }]);
  assert.deepEqual(fixture.navigations, ["home"]);
});

test("finishing a correction tells the app it was a history correction", async () => {
  const fixture = createControllerFixture({ session: reopenedSession });
  await fixture.feature.load();

  await fixture.feature.concludeSession();

  assert.deepEqual(fixture.rpcCalls, [{ name: "conclude_workout_session", args: { p_session_id: 77 } }]);
  assert.deepEqual(fixture.concluded, [{ id: 77, details: { wasHistoryCorrection: true } }]);
});

function renderSession(session) {
  const container = new MockElement("div");
  const noop = () => {};
  const renderer = createSessionRenderer({
    container,
    onSetFieldChange: noop,
    onSetFieldBlur: noop,
    onAddSet: noop,
    onRemoveSet: noop,
    onAddExercise: noop,
    onRemoveExercise: noop,
    onReorderExercise: noop,
    onEquipmentChange: noop,
    onCreateEquipment: noop,
    onConcludeSession: noop,
    onCancelSession: noop,
  });
  renderer.renderLiveSession({
    session,
    exercises: [],
    gyms: [{ id: 10, name: "Gym A" }],
    equipmentByGym: new Map(),
    equipmentOptionsByExercise: new Map(),
    historyContextByExercise: new Map(),
    syncLabel: "Saved ✓",
    syncState: "saved",
    errorMessage: "",
    isConcluding: false,
  });
  return container;
}

test("the live workout makes a historical correction explicit", () => {
  const correction = renderSession({ id: 77, gym_id: 10, performed_on: "2026-08-01", is_history_correction: true });
  assert.match(correction.querySelector(".live-correction-notice").textContent, /Correcting a completed workout from/);
  assert.equal(correction.querySelector(".cancel-session-button").textContent, "Discard corrections");
  assert.equal(correction.querySelector(".conclude-session-button").textContent, "Save corrections");

  const normal = renderSession({ id: 5, gym_id: 10, performed_on: "2026-10-17" });
  assert.equal(normal.querySelector(".live-correction-notice"), null);
  assert.equal(normal.querySelector(".cancel-session-button").textContent, "Cancel workout");
  assert.equal(normal.querySelector(".conclude-session-button").textContent, "Finish workout");
});

test("Session History exposes delete and reopen only for completed sessions, with a confirmation dialog", async () => {
  const [app, html, serviceWorker, packageJson] = await Promise.all([
    read("app.js"),
    read("index.html"),
    read("service-worker.js"),
    read("package.json"),
  ]);

  assert.match(app, /if \(session\.status === "completed"\) disclosure\.append\(createSessionLifecycleActions\(session, item\)\)/);
  assert.match(app, /reopenButton\.disabled = Boolean\(activeWorkoutSession\)/);
  assert.match(app, /liveSessionFeature\.reopenSession\(session\.id\)/);
  assert.match(app, /deleteSessionModal\.showModal\(\)/);
  assert.match(app, /deleteSessionDescription\.textContent = description/);
  assert.match(app, /await deleteCompletedWorkoutSession\(supabaseClient, session\.id\)/);
  assert.match(app, /showPage\(restoredCompletedSession \? "session-history" : "home"\)/);
  // A saved correction returns to Session History; a normal conclusion opens the post-workout recap (#77).
  assert.match(app, /if \(wasHistoryCorrection\) \{[\s\S]*?resetSessionResults\(\);\s*showPage\("session-history"\);\s*\} else \{\s*showWorkoutRecap\(concludedSessionId\);/);
  // The quick per-exercise correction remains available.
  assert.match(app, /showExerciseEditor\(item, exercise, performedOn\)/);

  assert.match(html, /<dialog id="delete-session-modal"/);
  assert.match(html, /id="delete-session-description"/);
  assert.match(html, /id="confirm-delete-session-button" class="danger-button"/);
  assert.match(serviceWorker, /"\/features\/session\/session-lifecycle\.js"/);
  assert.match(packageJson, /node --check features\/session\/session-lifecycle\.js/);
});

test("the lifecycle migration is owner-scoped, invoker-rights, and restores rather than deletes reopened history", async () => {
  const migration = await read("supabase/migrations/20261018110000_add_completed_session_delete_and_reopen.sql");

  assert.match(migration, /create table public\.workout_session_reopen_snapshots/);
  assert.match(migration, /foreign key \(session_id, owner_id\)\s+references public\.workout_sessions\(id, owner_id\)\s+on delete cascade/);
  assert.match(migration, /alter table public\.workout_session_reopen_snapshots enable row level security/);
  assert.match(migration, /grant select, insert, delete on public\.workout_session_reopen_snapshots to authenticated/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.equal((migration.match(/security invoker/g) ?? []).length, 4);
  assert.equal((migration.match(/set search_path = ''/g) ?? []).length, 4);
  assert.match(migration, /grant execute on function public\.delete_completed_workout_session\(bigint\) to authenticated/);
  assert.match(migration, /grant execute on function public\.reopen_workout_session\(bigint\) to authenticated/);
  assert.match(migration, /revoke all on function public\.reopen_workout_session\(bigint\) from public, anon/);
  assert.match(migration, /errcode = '55000'/);
  assert.match(migration, /when unique_violation/);
  assert.match(migration, /overriding system value/);
  assert.match(migration, /after update of status on public\.workout_sessions/);
  assert.match(migration, /Only in-progress workout sessions can be cancelled\./);
  assert.match(migration, /This session references a retired exercise and cannot be reopened\./);
  assert.match(migration, /references an exercise that has since been retired/);
  assert.match(migration, /'canonical_equipment_id', null/);
  assert.doesNotMatch(migration, /create_or_get_gym_equipment/);

  const restoreIndex = migration.indexOf("from public.workout_session_reopen_snapshots\n  where session_id = p_session_id");
  const normalDeleteIndex = migration.indexOf("delete from public.workout_sessions\n    where id = p_session_id and owner_id = session_owner_id and status = 'in_progress'");
  assert.ok(restoreIndex > 0 && normalDeleteIndex > restoreIndex, "cancel checks for a reopen snapshot before deleting");
});
