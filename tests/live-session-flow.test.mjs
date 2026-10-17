import test from "node:test";
import assert from "node:assert/strict";

// DOM mock for Node environment
class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.classList = {
      _classes: new Set(),
      add: (...cls) => cls.forEach((c) => this.classList._classes.add(c)),
      remove: (...cls) => cls.forEach((c) => this.classList._classes.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._classes.has(c)) this.classList._classes.delete(c);
          else this.classList._classes.add(c);
        } else if (force) this.classList._classes.add(c);
        else this.classList._classes.delete(c);
      },
      contains: (c) => this.classList._classes.has(c),
    };
    this.listeners = new Map();
    this._value = "";
    this._checked = false;
    this.hidden = false;
    this.disabled = false;
    this._textContent = "";
    this.parentElement = null;
  }

  get className() {
    return Array.from(this.classList._classes).join(" ");
  }
  set className(val) {
    this.classList._classes.clear();
    if (val) val.split(/\s+/).filter(Boolean).forEach((c) => this.classList._classes.add(c));
  }

  get textContent() {
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val ?? "");
  }

  get innerHTML() {
    return "";
  }
  set innerHTML(val) {
    // Basic innerHTML parsing for simple table thead markup
    this.children = [];
  }

  get value() { return this._value; }
  set value(val) { this._value = String(val ?? ""); }

  get label() { return this._label || this.getAttribute("label") || ""; }
  set label(val) { this._label = String(val ?? ""); this.setAttribute("label", this._label); }

  get checked() { return this._checked; }
  set checked(val) { this._checked = Boolean(val); }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[key] = String(val);
    }
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === "string") {
        const textNode = new MockElement("#text");
        textNode.textContent = n;
        this.children.push(textNode);
      } else if (n) {
        n.parentElement = this;
        this.children.push(n);
      }
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
    }
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const l of list) {
      l({ ...event, target: this, currentTarget: this });
    }
    return true;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const check = (el) => {
      let matches = false;
      if (selector.startsWith(".")) {
        matches = el.classList.contains(selector.slice(1));
      } else if (selector.startsWith("#")) {
        matches = el.id === selector.slice(1);
      } else if (selector.startsWith("[")) {
        const m = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/);
        if (m) {
          const attr = m[1];
          const val = m[2];
          if (attr.startsWith("data-")) {
            const key = attr.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
            matches = val !== undefined ? String(el.dataset[key]) === val : key in el.dataset;
          } else {
            matches = val !== undefined ? el.getAttribute(attr) === val : el.hasAttribute(attr);
          }
        }
      } else if (selector.includes("[")) {
        const tag = selector.split("[")[0];
        const m = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/);
        if (el.tagName.toLowerCase() === tag.toLowerCase() && m) {
          const attr = m[1];
          const val = m[2];
          matches = val !== undefined ? el.getAttribute(attr) === val : el.hasAttribute(attr);
        }
      } else {
        matches = el.tagName.toLowerCase() === selector.toLowerCase();
      }

      if (matches && el !== this) results.push(el);
      for (const child of el.children) {
        check(child);
      }
    };
    check(this);
    return results;
  }
}

globalThis.document = {
  createElement(tag) {
    return new MockElement(tag);
  },
  querySelector(sel) {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

globalThis.Event = class Event {
  constructor(type) {
    this.type = type;
  }
};

import {
  createSessionStorage,
} from "../features/session/session-storage.js";
import {
  createSessionHistoryContext,
  formatPreviousPerformanceSummary,
  formatPreviousSetBadge,
} from "../features/session/session-history-context.js";
import {
  createSessionAutosave,
  SYNC_STATE,
  SYNC_LABELS,
} from "../features/session/session-autosave.js";
import {
  createSessionRenderer,
  parseWorkoutWeightInput,
} from "../features/session/session-rendering.js";
import {
  createSessionFeature,
} from "../features/session/session-controller.js";
import {
  isBlankSet,
  isDraftSet,
  isCompletedSet,
  isAnalyticalWorkingSet,
  classifySet,
  formatSetClassification,
  SET_CLASS,
} from "../set-model.js";

test("session-storage: stores, coalesces, and retrieves pending set edits", () => {
  const storage = createSessionStorage();
  storage.clearPendingSessionEdits(100);

  // Field edits to the same set are coalesced
  storage.savePendingSetEdit(100, 1, { weight: 80 });
  storage.savePendingSetEdit(100, 1, { reps: 8 });
  storage.savePendingSetEdit(100, 1, { reported_rir_bucket: 2, rir_source: "user_entered" });

  let pending = storage.getPendingSetEdits(100);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].setId, 1);
  assert.deepEqual(pending[0].fields, {
    weight: 80,
    reps: 8,
    reported_rir_bucket: 2,
    rir_source: "user_entered",
  });

  // Multiple sets are tracked independently
  storage.savePendingSetEdit(100, 2, { weight: 82.5, reps: 6 });
  pending = storage.getPendingSetEdits(100);
  assert.equal(pending.length, 2);

  // Acknowledging committed edits removes them
  storage.removePendingSetEdit(100, 1);
  pending = storage.getPendingSetEdits(100);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].setId, 2);

  storage.clearPendingSessionEdits(100);
  assert.equal(storage.getPendingSetEdits(100).length, 0);
});

test("session-history-context: formats prior performance summary and badge", () => {
  const historyRecord = {
    sessionId: 101,
    performed_on: "2026-08-20",
    gymEquipmentId: 5,
    sets: [
      { id: 1001, set_number: 1, weight: 80, reps: 10, is_warmup: false, reported_rir_bucket: 2 },
      { id: 1002, set_number: 2, weight: 85, reps: 8, is_warmup: false, reported_rir_bucket: 1 },
      { id: 1003, set_number: 3, weight: 50, reps: 15, is_warmup: true, reported_rir_bucket: null },
    ],
  };

  const summary = formatPreviousPerformanceSummary(historyRecord, "Chest Press Machine");
  assert.equal(summary.hasHistory, true);
  assert.match(summary.heading, /Last time on this machine/);
  assert.equal(summary.setList.length, 3);
  assert.match(summary.setList[0], /80 kg × 10 · 2 RIR/);
  assert.match(summary.setList[1], /85 kg × 8 · 1 RIR/);
  assert.match(summary.setList[2], /Warm-up/);

  assert.equal(formatPreviousSetBadge(historyRecord.sets[0]), "80 × 10");
  assert.equal(formatPreviousSetBadge(historyRecord.sets[2]), "50 × 15 (W)");
});

function createHistoryQueryClient(getSessions, queryLog) {
  return {
    from(table) {
      assert.equal(table, "workout_sessions", "previous-performance lookup must be rooted in workout_sessions");
      const filters = [];
      const orders = [];
      const builder = {
        select(columns) { queryLog.push({ type: "select", columns }); return builder; },
        eq(column, value) { filters.push({ op: "eq", column, value }); return builder; },
        neq(column, value) { filters.push({ op: "neq", column, value }); return builder; },
        order(column, options) { orders.push({ column, options }); return builder; },
        limit(value) { queryLog.push({ type: "query", filters, orders, limit: value }); return builder; },
        then(resolve) {
          const session = getSessions()
            .filter((row) => filters.every(({ op, column, value }) => {
              if (column === "session_exercises.exercise_id") return row.session_exercises.some((ex) => ex.exercise_id === value);
              if (column === "session_exercises.canonical_equipment_id") return row.session_exercises.some((ex) => ex.canonical_equipment_id === value);
              return op === "eq" ? row[column] === value : row[column] !== value;
            }))
            .sort((left, right) => orders.reduce((difference, { column, options }) => {
              if (difference !== 0) return difference;
              const comparison = left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0;
              return options.ascending ? comparison : -comparison;
            }, 0))
            .slice(0, 1);
          return resolve({ data: session, error: null });
        },
      };
      return builder;
    },
  };
}

function completedHistorySession({ id, performed_on, created_at, equipmentId = 7, setWeight, exerciseRows }) {
  return {
    id,
    owner_id: "user-test",
    gym_id: 10,
    status: "completed",
    performed_on,
    created_at,
    session_exercises: exerciseRows || [{
      id: id * 10,
      exercise_id: 5,
      exercise_order: 1,
      canonical_equipment_id: equipmentId,
      exercise_sets: [{ id: id * 100, set_number: 1, weight: setWeight, reps: 8, is_warmup: false, reported_rir_bucket: 2 }],
    }],
  };
}

test("ISSUE 12 REGRESSION: consecutive A → B → C history lookup does not reuse B after A completes", async () => {
  let sessions = [completedHistorySession({ id: 2, performed_on: "2026-08-20", created_at: "2026-08-20T09:00:00Z", setWeight: 80 })];
  const queryLog = [];
  const history = createSessionHistoryContext({
    getClient: () => createHistoryQueryClient(() => sessions, queryLog),
    getUserId: () => "user-test",
  });

  const duringA = await history.fetchPreviousPerformance(10, 5, 7, 1);
  assert.equal(duringA.sessionId, 2, "Active A initially sees completed B");

  sessions = [
    completedHistorySession({ id: 1, performed_on: "2026-08-21", created_at: "2026-08-21T09:00:00Z", setWeight: 90 }),
    ...sessions,
  ];
  const duringC = await history.fetchPreviousPerformance(10, 5, 7, 3);
  assert.equal(duringC.sessionId, 1, "Later C sees newly completed A, not cached B");
  assert.equal(queryLog.filter(({ type }) => type === "query").length, 2, "Different excluded sessions use distinct cache entries");
});

test("ISSUE 12 REGRESSION: newest eligible session query orders workout sessions by date, creation time, then ID", async () => {
  const sessions = [
    completedHistorySession({ id: 1, performed_on: "2026-08-21", created_at: "2026-08-21T09:00:00Z", setWeight: 81 }),
    completedHistorySession({ id: 2, performed_on: "2026-08-22", created_at: "2026-08-22T08:00:00Z", setWeight: 82 }),
    completedHistorySession({ id: 3, performed_on: "2026-08-22", created_at: "2026-08-22T10:00:00Z", setWeight: 83 }),
    completedHistorySession({ id: 4, performed_on: "2026-08-22", created_at: "2026-08-22T10:00:00Z", setWeight: 84 }),
  ];
  const queryLog = [];
  const history = createSessionHistoryContext({ getClient: () => createHistoryQueryClient(() => sessions, queryLog), getUserId: () => "user-test" });
  const result = await history.fetchPreviousPerformance(10, 5, 7, 99);

  assert.equal(result.sessionId, 4);
  assert.equal(result.sets[0].weight, 84);
  const query = queryLog.find(({ type }) => type === "query");
  assert.deepEqual(query.orders, [
    { column: "performed_on", options: { ascending: false } },
    { column: "created_at", options: { ascending: false } },
    { column: "id", options: { ascending: false } },
  ]);
  assert.equal(query.limit, 1);
});

test("ISSUE 12 REGRESSION: equipment-filtered history chooses the matching machine and keeps selected session sets coherent", async () => {
  const sessions = [
    completedHistorySession({ id: 3, performed_on: "2026-08-23", created_at: "2026-08-23T09:00:00Z", equipmentId: 8, setWeight: 120 }),
    completedHistorySession({ id: 2, performed_on: "2026-08-22", created_at: "2026-08-22T09:00:00Z", equipmentId: 7, setWeight: 90 }),
  ];
  const queryLog = [];
  const history = createSessionHistoryContext({ getClient: () => createHistoryQueryClient(() => sessions, queryLog), getUserId: () => "user-test" });
  const machineSeven = await history.fetchPreviousPerformance(10, 5, 7, 99);
  const noEquipmentFilter = await history.fetchPreviousPerformance(10, 5, null, 98);

  assert.deepEqual({ sessionId: machineSeven.sessionId, performed_on: machineSeven.performed_on, weight: machineSeven.sets[0].weight }, { sessionId: 2, performed_on: "2026-08-22", weight: 90 });
  assert.equal(noEquipmentFilter.sessionId, 3, "No equipment ID retains the existing unrestricted matching behavior");
  const equipmentQuery = queryLog.find(({ type, filters }) => type === "query" && filters.some((filter) => filter.column === "session_exercises.canonical_equipment_id"));
  assert.ok(equipmentQuery, "Requested equipment is filtered through the matching session exercise");
});

test("ISSUE 12 REGRESSION: selected session uses its highest-order matching exercise and completed sets only", async () => {
  const session = completedHistorySession({
    id: 4, performed_on: "2026-08-22", created_at: "2026-08-22T10:00:00Z", exerciseRows: [
      { id: 40, exercise_id: 5, exercise_order: 1, canonical_equipment_id: 7, exercise_sets: [{ id: 402, set_number: 2, weight: 80, reps: 8, is_warmup: false, reported_rir_bucket: 2 }] },
      { id: 41, exercise_id: 5, exercise_order: 2, canonical_equipment_id: 7, exercise_sets: [{ id: 411, set_number: 2, weight: 95, reps: 6, is_warmup: false, reported_rir_bucket: 1 }, { id: 410, set_number: 1, weight: null, reps: null, is_warmup: false, reported_rir_bucket: null }] },
      { id: 42, exercise_id: 5, exercise_order: 2, canonical_equipment_id: 7, exercise_sets: [{ id: 421, set_number: 1, weight: 100, reps: 5, is_warmup: false, reported_rir_bucket: 1 }] },
    ],
  });
  const history = createSessionHistoryContext({ getClient: () => createHistoryQueryClient(() => [session], []), getUserId: () => "user-test" });
  const result = await history.fetchPreviousPerformance(10, 5, 7, 99);
  assert.deepEqual(result.sets.map((set) => set.id), [421], "Sets come only from the highest-order, highest-ID matching exercise");
  assert.equal(result.performed_on, "2026-08-22");
  assert.equal(result.sessionId, 4);
});

function issue12ControllerFixture({ concludeError = null } = {}) {
  const historyCalls = [];
  const historyContext = {
    clearCache() { historyCalls.push("clear"); },
    fetchPreviousPerformance: async () => null,
  };
  const client = {
    from(table) {
      const builder = {
        select() { return builder; }, eq() { return builder; }, neq() { return builder; }, in() { return builder; }, not() { return builder; }, order() { return builder; }, limit() { return builder; },
        maybeSingle() {
          return table === "workout_sessions"
            ? Promise.resolve({ data: { id: 999, owner_id: "user-test", gym_id: 10, status: "in_progress", performed_on: "2026-08-27" }, error: null })
            : Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
          if (table === "equipment") return resolve({ data: [], error: null });
          if (table === "session_exercises") return resolve({ data: [{ id: 101, session_id: 999, exercise_id: 5, exercise_order: 1, canonical_equipment_id: 7, exercise_sets: [{ id: 201, set_number: 1, weight: 80, reps: 8, is_warmup: false, reported_rir_bucket: 2 }] }], error: null });
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
    rpc(fn) {
      assert.equal(fn, "conclude_workout_session");
      return Promise.resolve(concludeError ? { data: null, error: concludeError } : { data: { id: 999, status: "completed" }, error: null });
    },
  };
  return {
    historyCalls,
    feature: createSessionFeature({ getClient: () => client, getUserId: () => "user-test", storage: createSessionStorage(), historyContext }),
  };
}

test("ISSUE 12 REGRESSION: successful conclusion clears history cache only after its RPC succeeds", async () => {
  const fixture = issue12ControllerFixture();
  await fixture.feature.load();
  await fixture.feature.concludeSession();
  assert.deepEqual(fixture.historyCalls, ["clear"], "A completed workout invalidates prior-history cache once");
});

test("ISSUE 12 REGRESSION: failed conclusion preserves history cache, while reset clears it", async () => {
  const failed = issue12ControllerFixture({ concludeError: new Error("RPC failed") });
  await failed.feature.load();
  await failed.feature.concludeSession();
  assert.deepEqual(failed.historyCalls, [], "A failed conclusion must not invalidate completed history");

  failed.feature.reset();
  assert.deepEqual(failed.historyCalls, ["clear"], "Feature reset releases cached history");
});

test("BUG 1 REGRESSION: sync badge updates do not replace input nodes or interrupt typing", () => {
  const container = document.createElement("div");
  const fieldChanges = [];
  const renderer = createSessionRenderer({
    container,
    onSetFieldChange: (sessionId, setId, fields) => fieldChanges.push({ sessionId, setId, fields }),
    onSetFieldBlur: () => {},
  });

  const state = {
    session: { id: 1, gym_id: 10, performed_on: "2026-08-24" },
    exercises: [
      {
        id: 101,
        exercise_id: 1,
        exercise_order: 1,
        exercises: { name: "Bench Press" },
        exercise_sets: [{ id: 501, set_number: 1, weight: null, reps: null, is_warmup: false, reported_rir_bucket: null }],
      },
    ],
    gyms: [{ id: 10, name: "Power Gym" }],
    equipmentByGym: new Map(),
    equipmentOptionsByExercise: new Map(),
    historyContextByExercise: new Map(),
    syncState: SYNC_STATE.SAVED,
    syncLabel: "Saved ✓",
  };

  renderer.renderLiveSession(state);

  const weightInput = container.querySelector(".weight-input");
  assert.ok(weightInput, "Weight input must exist in DOM");
  assert.equal(weightInput.type, "text");
  assert.equal(weightInput.inputMode, "decimal");

  // User types '8'
  weightInput.value = "8";
  weightInput.dispatchEvent(new Event("input"));
  assert.equal(fieldChanges.length, 1);
  assert.equal(fieldChanges[0].fields.weight, 8);

  // Sync state changes in background
  renderer.updateSyncBadge(SYNC_STATE.SAVING, "Saving…");
  assert.equal(container.querySelector(".live-sync-badge").textContent, "Saving…");
  // Node identity is strictly preserved!
  assert.equal(container.querySelector(".weight-input"), weightInput, "Input node must not be destroyed on sync transition");

  // User types '0' -> '80'
  weightInput.value = "80";
  weightInput.dispatchEvent(new Event("input"));
  assert.equal(fieldChanges.length, 2);
  assert.equal(fieldChanges[1].fields.weight, 80);

  // User types '.5' -> '80.5'
  weightInput.value = "80.5";
  weightInput.dispatchEvent(new Event("input"));
  assert.equal(fieldChanges.length, 3);
  assert.equal(fieldChanges[2].fields.weight, 80.5);
  assert.equal(container.querySelector(".weight-input"), weightInput, "Input node preserved continuously throughout multi-digit typing");
});

test("session-rendering: parses locale-tolerant workout weight input", () => {
  const validCases = [
    ["", null],
    ["   ", null],
    ["82", 82],
    ["82.5", 82.5],
    ["82,5", 82.5],
    [".5", 0.5],
    [",5", 0.5],
    ["1,234", 1.234],
  ];

  for (const [rawValue, expectedValue] of validCases) {
    assert.deepEqual(parseWorkoutWeightInput(rawValue), { valid: true, value: expectedValue });
  }

  for (const rawValue of ["abc", "82,5,2", "82.5.2", "82,5.2", "-5", "NaN", "Infinity"]) {
    assert.deepEqual(parseWorkoutWeightInput(rawValue), { valid: false, value: null });
  }
});

test("session-rendering: locale comma input updates valid weights and invalid input is safely restored on blur", () => {
  const container = document.createElement("div");
  const fieldChanges = [];
  const blurs = [];
  const set = { id: 501, set_number: 1, weight: 80, reps: null, is_warmup: false, reported_rir_bucket: null };
  const renderer = createSessionRenderer({
    container,
    onSetFieldChange: (sessionId, setId, fields) => fieldChanges.push({ sessionId, setId, fields }),
    onSetFieldBlur: (sessionId, setId) => blurs.push({ sessionId, setId }),
  });
  renderer.renderLiveSession({
    session: { id: 1, gym_id: 10, performed_on: "2026-08-24" },
    exercises: [{ id: 101, exercise_id: 1, exercise_order: 1, exercises: { name: "Bench Press" }, exercise_sets: [set] }],
    gyms: [{ id: 10, name: "Power Gym" }],
    equipmentByGym: new Map(), equipmentOptionsByExercise: new Map(), historyContextByExercise: new Map(),
    syncState: SYNC_STATE.SAVED, syncLabel: "Saved ✓",
  });

  const weightInput = container.querySelector(".weight-input");
  for (const [rawValue, expectedValue] of [["80.5", 80.5], ["80,5", 80.5], ["80", 80], ["", null], [".5", 0.5], [",5", 0.5]]) {
    weightInput.value = rawValue;
    weightInput.dispatchEvent(new Event("input"));
    assert.equal(fieldChanges.at(-1).fields.weight, expectedValue);
  }

  const changesBeforeInvalidInput = fieldChanges.length;
  set.weight = 80;
  for (const rawValue of ["abc", "82,5,2", "82,5.2", "-5"]) {
    weightInput.value = rawValue;
    weightInput.dispatchEvent(new Event("input"));
    assert.equal(fieldChanges.length, changesBeforeInvalidInput, `${rawValue} must not dispatch a weight change`);
    assert.equal(set.weight, 80, `${rawValue} must not replace the canonical weight`);
    assert.equal(weightInput.getAttribute("aria-invalid"), "true");
  }

  weightInput.dispatchEvent(new Event("blur"));
  assert.equal(weightInput.value, "80");
  assert.equal(weightInput.getAttribute("aria-invalid"), null);
  assert.equal(blurs.length, 1);
});

test("BUG 2 REGRESSION: field edits are PATCH updates that never erase other existing fields", async () => {
  const dbRows = new Map();
  dbRows.set(1, { id: 1, weight: null, reps: null, is_warmup: false, reported_rir_bucket: null, rir_source: null });

  const updateCalls = [];
  const mockStorage = createSessionStorage();
  const mockClient = {
    from: (table) => ({
      update: (payload) => ({
        eq: (k1, setId) => ({
          eq: (k2, userId) => ({
            select: () => {
              updateCalls.push({ payload, setId, userId });
              const existing = dbRows.get(setId) || {};
              const updated = { ...existing, ...payload };
              dbRows.set(setId, updated);
              return Promise.resolve({ data: [{ id: setId }], error: null });
            },
          }),
        }),
      }),
    }),
  };

  const autosave = createSessionAutosave({
    getClient: () => mockClient,
    getUserId: () => "user-1",
    storage: mockStorage,
  });

  // Scenario 1: Weight 80 -> save -> Reps 10 -> save -> result = 80 x 10
  autosave.queueSetEdit(100, 1, { weight: 80 }, 10);
  await autosave.flushPendingEdits(100);
  assert.equal(dbRows.get(1).weight, 80);
  assert.equal(dbRows.get(1).reps, null);

  autosave.queueSetEdit(100, 1, { reps: 10 }, 10);
  await autosave.flushPendingEdits(100);
  assert.equal(dbRows.get(1).weight, 80, "Weight must NOT be erased when saving reps");
  assert.equal(dbRows.get(1).reps, 10, "Reps must be saved");

  // Scenario 2: Reps 12 -> save -> Weight 85 -> save on set 2
  dbRows.set(2, { id: 2, weight: null, reps: null, is_warmup: false, reported_rir_bucket: null, rir_source: null });
  autosave.queueSetEdit(100, 2, { reps: 12 }, 10);
  await autosave.flushPendingEdits(100);
  assert.equal(dbRows.get(2).reps, 12);
  assert.equal(dbRows.get(2).weight, null);

  autosave.queueSetEdit(100, 2, { weight: 85 }, 10);
  await autosave.flushPendingEdits(100);
  assert.equal(dbRows.get(2).weight, 85, "Weight must be saved");
  assert.equal(dbRows.get(2).reps, 12, "Reps must NOT be erased when saving weight");

  // Scenario 3: Weight 80 + Reps 10 + RIR 1 -> result keeps all three
  dbRows.set(3, { id: 3, weight: null, reps: null, is_warmup: false, reported_rir_bucket: null, rir_source: null });
  autosave.queueSetEdit(100, 3, { weight: 80 }, 10);
  autosave.queueSetEdit(100, 3, { reps: 10 }, 10);
  autosave.queueSetEdit(100, 3, { reported_rir_bucket: 1, rir_source: "user_entered" }, 10);
  await autosave.flushPendingEdits(100);

  const row3 = dbRows.get(3);
  assert.equal(row3.weight, 80);
  assert.equal(row3.reps, 10);
  assert.equal(row3.reported_rir_bucket, 1);
  assert.equal(row3.rir_source, "user_entered");

  // Scenario 4: Debounce coalescing merges rapid edits before flush
  dbRows.set(4, { id: 4, weight: null, reps: null, is_warmup: false, reported_rir_bucket: null, rir_source: null });
  autosave.queueSetEdit(100, 4, { weight: 70 }, 200);
  autosave.queueSetEdit(100, 4, { reps: 8 }, 200);
  autosave.queueSetEdit(100, 4, { weight: 72.5 }, 200);
  await autosave.flushPendingEdits(100);

  const row4 = dbRows.get(4);
  assert.equal(row4.weight, 72.5);
  assert.equal(row4.reps, 8);
});

test("BUG 3 REGRESSION: warm-up set row completely omits RIR control", () => {
  const container = document.createElement("div");
  const fieldChanges = [];
  const renderer = createSessionRenderer({
    container,
    onSetFieldChange: (sessionId, setId, fields) => fieldChanges.push(fields),
    onSetFieldBlur: () => {},
  });

  const state = {
    session: { id: 1, gym_id: 10, performed_on: "2026-08-24" },
    exercises: [
      {
        id: 101,
        exercise_id: 1,
        exercise_order: 1,
        exercises: { name: "Bench Press" },
        exercise_sets: [
          { id: 1, set_number: 1, weight: 60, reps: 10, is_warmup: false, reported_rir_bucket: 2, rir_source: "user_entered" },
          { id: 2, set_number: 2, weight: 40, reps: 12, is_warmup: true, reported_rir_bucket: null, rir_source: null },
        ],
      },
    ],
    gyms: [{ id: 10, name: "Power Gym" }],
    equipmentByGym: new Map(),
    equipmentOptionsByExercise: new Map(),
    historyContextByExercise: new Map(),
    syncState: SYNC_STATE.SAVED,
    syncLabel: "Saved ✓",
  };

  renderer.renderLiveSession(state);

  // Set 1 (working set): RIR dropdown exists
  const row1 = container.querySelector('[data-set-id="1"]');
  assert.ok(row1.querySelector(".rir-select"), "Working set row must contain RIR dropdown");
  assert.equal(row1.querySelector(".rir-warmup-blank"), null, "Working set row must not have warmup blank");

  // Set 2 (warmup set): RIR dropdown is completely omitted
  const row2 = container.querySelector('[data-set-id="2"]');
  assert.equal(row2.querySelector(".rir-select"), null, "Warm-up set row must NOT contain RIR dropdown");
  assert.ok(row2.querySelector(".rir-warmup-blank"), "Warm-up set row must have blank placeholder");

  // Toggle Set 1 to warm-up
  const warmupCheckbox1 = row1.querySelector(".warmup-checkbox");
  warmupCheckbox1.checked = true;
  warmupCheckbox1.dispatchEvent(new Event("change"));

  assert.equal(row1.querySelector(".rir-select"), null, "RIR select removed immediately upon toggling to warm-up");
  assert.ok(row1.querySelector(".rir-warmup-blank"), "Blank placeholder added");
  assert.deepEqual(fieldChanges[0], {
    is_warmup: true,
    reported_rir_bucket: null,
    rir_source: null,
  });

  // Toggle Set 1 back to working set
  warmupCheckbox1.checked = false;
  warmupCheckbox1.dispatchEvent(new Event("change"));

  const reappearedSelect = row1.querySelector(".rir-select");
  assert.ok(reappearedSelect, "RIR dropdown reappears when toggled back to working set");
  assert.equal(reappearedSelect.value, "", "Reappeared RIR select must be blank (not 0)");
  assert.deepEqual(fieldChanges[1], {
    is_warmup: false,
    reported_rir_bucket: null,
    rir_source: null,
  });
});

test("BUG 4 REGRESSION: equipment options list is exercise-specific", () => {
  const container = document.createElement("div");
  const renderer = createSessionRenderer({
    container,
    onEquipmentChange: () => {},
  });

  const equipmentOptionsByExercise = new Map();
  // Exercise 1 (Chest Press) has used Machine A (#10) and Machine B (#20)
  equipmentOptionsByExercise.set(1, [
    { id: 10, name: "Chest Press Matrix #1", is_active: true },
    { id: 20, name: "Chest Press Matrix #2", is_active: true },
  ]);
  // Exercise 2 (Leg Extension) has used Machine C (#30)
  equipmentOptionsByExercise.set(2, [
    { id: 30, name: "Leg Extension Hammer Strength", is_active: true },
  ]);

  const equipmentByGym = new Map();
  equipmentByGym.set(100, [
    { id: 10, name: "Chest Press Matrix #1", is_active: true },
    { id: 20, name: "Chest Press Matrix #2", is_active: true },
    { id: 30, name: "Leg Extension Hammer Strength", is_active: true },
    { id: 40, name: "Lat Pulldown Dual Cable", is_active: true },
  ]);

  const state = {
    session: { id: 1, gym_id: 100, performed_on: "2026-08-24" },
    exercises: [
      { id: 501, exercise_id: 1, exercise_order: 1, canonical_equipment_id: 10, exercises: { name: "Chest Press" }, exercise_sets: [] },
      { id: 502, exercise_id: 2, exercise_order: 2, canonical_equipment_id: 30, exercises: { name: "Leg Extension" }, exercise_sets: [] },
    ],
    gyms: [{ id: 100, name: "Sussex Gym" }],
    equipmentByGym,
    equipmentOptionsByExercise,
    historyContextByExercise: new Map(),
    syncState: SYNC_STATE.SAVED,
    syncLabel: "Saved ✓",
  };

  renderer.renderLiveSession(state);

  const card1 = container.querySelector('[data-session-exercise-id="501"]');
  const select1 = card1.querySelector(".live-equipment-select");
  const optGroup1 = select1.querySelector('optgroup[label="Used with this exercise"]');
  const optTexts1 = optGroup1.querySelectorAll("option").map((o) => o.textContent);
  assert.deepEqual(optTexts1, ["Chest Press Matrix #1", "Chest Press Matrix #2"]);
  assert.equal(optTexts1.includes("Leg Extension Hammer Strength"), false, "Chest Press must not list Leg Extension machine in primary exercise options");

  const card2 = container.querySelector('[data-session-exercise-id="502"]');
  const select2 = card2.querySelector(".live-equipment-select");
  const optGroup2 = select2.querySelector('optgroup[label="Used with this exercise"]');
  const optTexts2 = optGroup2.querySelectorAll("option").map((o) => o.textContent);
  assert.deepEqual(optTexts2, ["Leg Extension Hammer Strength"]);
  assert.equal(optTexts2.includes("Chest Press Matrix #1"), false, "Leg Extension must not list Chest Press machine in primary exercise options");
});

test("BUG 5 REGRESSION: cancel active workout aborts autosave, clears pending storage, and invokes cancel RPC", async () => {
  let rpcCalls = [];
  let navPages = [];
  let cancelledSessionId = null;
  const syncTransitions = [];

  const mockStorage = createSessionStorage();
  mockStorage.savePendingSetEdit(999, 1, { weight: 100 });

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() {
        if (table === "gyms") {
          return Promise.resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        }
        if (table === "equipment") {
          return Promise.resolve({ data: [], error: null });
        }
        if (table === "session_exercises") {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-24" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update() { return builder; },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: true, error: null });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
    onNavigate: (page) => navPages.push(page),
    onSessionCancelled: (sessionId) => {
      cancelledSessionId = sessionId;
    },
    onSyncStateChange: (state, label) => syncTransitions.push({ state, label }),
  });

  await feature.load();
  assert.ok(feature.getActiveSession(), "Active session is loaded");

  // Call cancel
  await feature.cancelSession();

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, "cancel_workout_session");
  assert.deepEqual(rpcCalls[0].params, { p_session_id: 999 });

  assert.equal(mockStorage.getPendingSetEdits(999).length, 0, "Pending local edits cleared on cancellation");
  assert.equal(feature.getActiveSession(), null, "Active session cleared in-memory");
  assert.equal(cancelledSessionId, 999, "onSessionCancelled callback received session id");
  assert.equal(navPages.includes("home"), true, "Navigated home upon cancellation");
  assert.ok(syncTransitions.some(({ state, label }) => (
    state === SYNC_STATE.SAVED && label === SYNC_LABELS[SYNC_STATE.SAVED]
  )), "Autosave abort forwards the canonical saved transition");
});

test("BUG 5 REGRESSION: cancellation failure preserves pending local mutations and keeps session active without navigating home", async () => {
  let rpcCalls = [];
  let navPages = [];
  let cancelledSessionId = null;

  const mockStorage = createSessionStorage();
  mockStorage.savePendingSetEdit(999, 1, { weight: 100, reps: 8 });

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() {
        if (table === "gyms") {
          return Promise.resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        }
        if (table === "equipment") {
          return Promise.resolve({ data: [], error: null });
        }
        if (table === "session_exercises") {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-24" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update() { return builder; },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: null, error: new Error("Network connection dropped") });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
    onNavigate: (page) => navPages.push(page),
    onSessionCancelled: (sessionId) => {
      cancelledSessionId = sessionId;
    },
  });

  await feature.load();
  assert.ok(feature.getActiveSession(), "Active session is loaded");

  // Attempt cancel (which fails on server)
  await feature.cancelSession();

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, "cancel_workout_session");

  // 1. Pending mutations must still exist in local storage!
  const pending = mockStorage.getPendingSetEdits(999);
  assert.equal(pending.length, 1, "Pending local edits must NOT be cleared when cancellation RPC fails");
  assert.deepEqual(pending[0].fields, { weight: 100, reps: 8 });

  // 2. Active session remains open and usable in memory!
  assert.ok(feature.getActiveSession(), "Active session must remain loaded when cancellation fails");
  assert.equal(feature.getActiveSession().id, 999);

  // 3. No callback or navigation to Home occurs!
  assert.equal(cancelledSessionId, null, "onSessionCancelled callback must not be invoked on failure");
  assert.equal(navPages.includes("home"), false, "Must not navigate home when cancellation fails");
});

test("session-recents: resolves deterministic recent exercise and gym IDs from completed sessions", async () => {
  const { fetchRecentExerciseIds, fetchRecentGymIds } = await import("../features/session/session-recents.js");

  const mockSessionExercises = [
    { exercise_id: "ex-1", workout_sessions: { id: 3, performed_on: "2026-08-25" } },
    { exercise_id: "ex-2", workout_sessions: { id: 3, performed_on: "2026-08-25" } },
    { exercise_id: "ex-3", workout_sessions: { id: 2, performed_on: "2026-08-20" } },
    { exercise_id: "ex-1", workout_sessions: { id: 2, performed_on: "2026-08-20" } },
    { exercise_id: "ex-4", workout_sessions: { id: 1, performed_on: "2026-08-15" } },
    { exercise_id: "ex-5", workout_sessions: { id: 1, performed_on: "2026-08-15" } },
  ];

  const mockWorkoutSessions = [
    { id: 3, gym_id: "gym-b", performed_on: "2026-08-25", status: "completed" },
    { id: 2, gym_id: "gym-a", performed_on: "2026-08-20", status: "completed" },
    { id: 1, gym_id: "gym-c", performed_on: "2026-08-15", status: "completed" },
  ];

  const mockClient = {
    from: (table) => {
      let limitCount = 50;
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        order: () => builder,
        limit: (n) => {
          limitCount = n;
          return builder;
        },
        then: (resolve) => {
          if (table === "session_exercises") {
            return resolve({ data: mockSessionExercises, error: null });
          }
          if (table === "workout_sessions") {
            return resolve({ data: mockWorkoutSessions, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };

  const exerciseIds = await fetchRecentExerciseIds(mockClient, "user-1", 8);
  // ex-1 and ex-2 from session 3, ex-3 from session 2 (ex-1 skipped as duplicate), ex-4 and ex-5 from session 1
  assert.deepEqual(exerciseIds, ["ex-1", "ex-2", "ex-3", "ex-4", "ex-5"]);

  const gymIds = await fetchRecentGymIds(mockClient, "user-1", 3);
  assert.deepEqual(gymIds, ["gym-b", "gym-a", "gym-c"]);
});

test("session-history-context: formatInlinePreviousSet formats barbell, dumbbell, and warmup sets", async () => {
  const { formatInlinePreviousSet } = await import("../features/session/session-history-context.js");

  // Barbell working set
  assert.equal(
    formatInlinePreviousSet({ weight: 100, reps: 8, reported_rir_bucket: 1, is_warmup: false }, "Bench Press"),
    "100 kg × 8 @ 1 RIR"
  );

  // Dumbbell working set (per dumbbell notation)
  assert.equal(
    formatInlinePreviousSet({ weight: 22.5, reps: 12, reported_rir_bucket: 0, is_warmup: false }, "Lateral Raise (Dumbbell)"),
    "22.5 kg per dumbbell × 12 @ 0 RIR"
  );

  // 4+ RIR working set
  assert.equal(
    formatInlinePreviousSet({ weight: 50, reps: 15, reported_rir_bucket: 4, is_warmup: false }, "Leg Extension"),
    "50 kg × 15 @ 4+ RIR"
  );

  // Warmup set
  assert.equal(
    formatInlinePreviousSet({ weight: 60, reps: 5, is_warmup: true }, "Squat"),
    "60 kg × 5 (Warm-up)"
  );

  // Null/missing previous set
  assert.equal(formatInlinePreviousSet(null, "Bench Press"), null);
});

test("session-rendering: renders empty state when session has no exercises", async () => {
  const { createSessionRenderer } = await import("../features/session/session-rendering.js");

  const container = new MockElement("div");
  const renderer = createSessionRenderer({
    container,
    onSetFieldChange: () => {},
    onSetFieldBlur: () => {},
    onAddSet: () => {},
    onRemoveSet: () => {},
    onAddExercise: () => {},
    onRemoveExercise: () => {},
    onReorderExercise: () => {},
    onEquipmentChange: () => {},
    onCreateEquipment: () => {},
    onConcludeSession: () => {},
    onCancelSession: () => {},
  });

  renderer.renderLiveSession({
    session: { id: 1, gym_id: 1, source_preset_name: "Empty Session", performed_on: "2026-08-27" },
    exercises: [],
    gyms: [{ id: 1, name: "Iron Gym" }],
    equipmentByGym: new Map(),
    equipmentOptionsByExercise: new Map(),
    historyContextByExercise: new Map(),
    syncLabel: "Saved ✓",
    syncState: "saved",
    errorMessage: null,
    isConcluding: false,
  });

  const emptyCard = container.querySelector(".live-session-empty");
  assert.ok(emptyCard, "Empty workout state must be rendered when there are no exercises");
  const concludeBtn = container.querySelector(".conclude-session-button");
  assert.equal(concludeBtn.disabled, true, "Finish workout button must be disabled when no completed sets exist");
});

test("session-rendering: Finish workout button is disabled until at least one set is completed", async () => {
  const { createSessionRenderer } = await import("../features/session/session-rendering.js");

  const container = new MockElement("div");
  const renderer = createSessionRenderer({
    container,
    onSetFieldChange: () => {},
    onSetFieldBlur: () => {},
    onAddSet: () => {},
    onRemoveSet: () => {},
    onAddExercise: () => {},
    onRemoveExercise: () => {},
    onReorderExercise: () => {},
    onEquipmentChange: () => {},
    onCreateEquipment: () => {},
    onConcludeSession: () => {},
    onCancelSession: () => {},
  });

  // State with blank / incomplete set
  const stateWithBlankSet = {
    session: { id: 1, gym_id: 1, source_preset_name: "Test Workout", performed_on: "2026-08-27" },
    exercises: [
      {
        id: 10,
        exercise_id: "ex-1",
        exercise_order: 1,
        exercise_name: "Overhead Press",
        exercise_sets: [
          { id: 100, set_number: 1, weight: null, reps: null, reported_rir_bucket: null, is_warmup: false },
        ],
      },
    ],
    gyms: [{ id: 1, name: "Iron Gym" }],
    equipmentByGym: new Map(),
    equipmentOptionsByExercise: new Map(),
    historyContextByExercise: new Map(),
    syncLabel: "Saved ✓",
    syncState: "saved",
    errorMessage: null,
    isConcluding: false,
  };

  renderer.renderLiveSession(stateWithBlankSet);
  let concludeBtn = container.querySelector(".conclude-session-button");
  assert.equal(concludeBtn.disabled, true, "Finish button must be disabled when all sets are incomplete");

  // State with a completed working set (weight, reps, RIR)
  const stateWithCompletedSet = {
    ...stateWithBlankSet,
    exercises: [
      {
        ...stateWithBlankSet.exercises[0],
        exercise_sets: [
          { id: 100, set_number: 1, weight: 60, reps: 8, reported_rir_bucket: 2, is_warmup: false },
        ],
      },
    ],
  };

  renderer.renderLiveSession(stateWithCompletedSet);
  concludeBtn = container.querySelector(".conclude-session-button");
  assert.equal(concludeBtn.disabled, false, "Finish button must be enabled when at least one set is completed");
  assert.equal(concludeBtn.textContent, "Finish workout");
});

// =========================================================================
// ISSUE 1 REGRESSION TESTS: Prevent session conclusion on failed autosave
// =========================================================================

test("ISSUE 1 REGRESSION: failed autosave prevents session conclusion, keeps pending local edits intact, and does NOT call conclude_workout_session RPC", async () => {
  let rpcCalls = [];
  let concludedSessionId = null;

  const mockStorage = createSessionStorage();
  mockStorage.savePendingSetEdit(999, 100, { weight: 85, reps: 8, reported_rir_bucket: 2 });

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-27" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        return {
          eq: () => ({
            eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
          }),
        };
      },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        if (table === "equipment") return resolve({ data: [], error: null });
        if (table === "session_exercises") {
          return resolve({
            data: [
              {
                id: 50,
                session_id: 999,
                exercise_order: 1,
                exercise_id: 1,
                canonical_equipment_id: null,
                exercises: { id: 1, name: "Bench Press" },
                workout_sessions: { id: 999, performed_on: "2026-08-27" },
                exercise_sets: [
                  { id: 100, set_number: 1, weight: 80, reps: 8, is_warmup: false, reported_rir_bucket: 2, rir_source: "user_entered" },
                ],
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: { id: 999, status: "completed" }, error: null });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
    onSessionConcluded: (id) => {
      concludedSessionId = id;
    },
  });

  await feature.load();
  assert.ok(feature.getActiveSession(), "Active session is loaded");

  // Attempt to conclude session while pending write fails to sync
  await feature.concludeSession();

  // 1. Server-side conclusion RPC must NOT be called!
  const calledConcludeRpc = rpcCalls.some((c) => c.fn === "conclude_workout_session");
  assert.equal(calledConcludeRpc, false, "conclude_workout_session RPC must NOT be called when flush fails");

  // 2. Pending local edits must remain intact in storage!
  const pendingEdits = mockStorage.getPendingSetEdits(999);
  assert.equal(pendingEdits.length, 1, "Pending local edits must remain intact in storage");
  assert.deepEqual(pendingEdits[0].fields, { weight: 85, reps: 8, reported_rir_bucket: 2 });

  // 3. Active session remains active in memory
  assert.ok(feature.getActiveSession(), "Active session must remain active in memory");
  assert.equal(concludedSessionId, null, "onSessionConcluded must not be fired on failure");
});

test("ISSUE 1 REGRESSION: successful flush allows session conclusion, calls conclude_workout_session RPC, and clears pending local edits", async () => {
  let rpcCalls = [];
  let concludedSessionId = null;

  const mockStorage = createSessionStorage();
  mockStorage.savePendingSetEdit(999, 100, { weight: 85, reps: 8, reported_rir_bucket: 2 });

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-27" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        return {
          eq: () => ({
            eq: () => ({ select: () => Promise.resolve({ data: [{ id: 100 }], error: null }) }),
          }),
        };
      },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        if (table === "equipment") return resolve({ data: [], error: null });
        if (table === "session_exercises") {
          return resolve({
            data: [
              {
                id: 50,
                session_id: 999,
                exercise_order: 1,
                exercise_id: 1,
                canonical_equipment_id: null,
                exercises: { id: 1, name: "Bench Press" },
                workout_sessions: { id: 999, performed_on: "2026-08-27" },
                exercise_sets: [
                  { id: 100, set_number: 1, weight: 80, reps: 8, is_warmup: false, reported_rir_bucket: 2, rir_source: "user_entered" },
                ],
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: { id: 999, status: "completed" }, error: null });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
    onSessionConcluded: (id) => {
      concludedSessionId = id;
    },
  });

  await feature.load();
  await feature.concludeSession();

  // 1. Conclusion RPC was called
  const calledConcludeRpc = rpcCalls.some((c) => c.fn === "conclude_workout_session");
  assert.equal(calledConcludeRpc, true, "conclude_workout_session RPC must be called on successful flush");

  // 2. Pending storage is cleared
  assert.equal(mockStorage.getPendingSetEdits(999).length, 0, "Pending edits cleared after conclusion confirmation");

  // 3. Active session cleared in memory and callback invoked
  assert.equal(feature.getActiveSession(), null, "Active session cleared after conclusion");
  assert.equal(concludedSessionId, 999, "onSessionConcluded callback invoked with session ID");
});

// =========================================================================
// ISSUE 2 REGRESSION TESTS: Autosave debounce state machine & generation races
// =========================================================================

test("ISSUE 2 REGRESSION: natural debounce fires without calling flushPendingEdits and transitions cleanly to SAVED", async () => {
  const dbRows = new Map();
  const mockStorage = createSessionStorage();
  const mockClient = {
    from: () => ({
      update: (payload) => ({
        eq: (k1, setId) => ({
          eq: (k2, userId) => ({
            select: () => {
            dbRows.set(setId, { ...(dbRows.get(setId) || {}), ...payload });
            return Promise.resolve({ data: [{ id: setId }], error: null });
            },
          }),
        }),
      }),
    }),
  };

  const autosave = createSessionAutosave({
    getClient: () => mockClient,
    getUserId: () => "user-1",
    storage: mockStorage,
  });

  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVED);

  // Queue edit with small debounce
  autosave.queueSetEdit(100, 1, { weight: 90 }, 15);
  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVING, "Sync state immediately enters SAVING on edit");

  // Wait for natural debounce timer to fire and complete WITHOUT calling flushPendingEdits
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVED, "Natural debounce completion transitions sync state to SAVED");
  assert.equal(mockStorage.getPendingSetEdits(100).length, 0, "Pending local storage is clean");
  assert.equal(dbRows.get(1).weight, 90, "Database row updated correctly");
});

test("ISSUE 2 REGRESSION: multiple overlapping edits to different sets do not emit SAVED prematurely", async () => {
  const dbRows = new Map();
  const mockStorage = createSessionStorage();
  const mockClient = {
    from: () => ({
      update: (payload) => ({
        eq: (k1, setId) => ({
          eq: (k2, userId) => ({
            select: () => {
            dbRows.set(setId, { ...(dbRows.get(setId) || {}), ...payload });
            return Promise.resolve({ data: [{ id: setId }], error: null });
            },
          }),
        }),
      }),
    }),
  };

  const autosave = createSessionAutosave({
    getClient: () => mockClient,
    getUserId: () => "user-1",
    storage: mockStorage,
  });

  // Set 1 debounce is 15ms, Set 2 debounce is 60ms
  autosave.queueSetEdit(100, 1, { weight: 80 }, 15);
  autosave.queueSetEdit(100, 2, { weight: 90 }, 60);

  // After 30ms, Set 1 has completed, but Set 2 is still pending
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVING, "State remains SAVING while Set 2 is still pending");

  // After 80ms total, Set 2 has completed as well
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVED, "State transitions to SAVED only when all sets are clean");
  assert.equal(mockStorage.getPendingSetEdits(100).length, 0);
});

test("ISSUE 2 REGRESSION (GENERATIONS/RACES): newer edit to same set while earlier edit is in flight preserves newer edit and does not emit SAVED prematurely", async () => {
  let resolveFirstUpdate;
  const firstUpdateDeferred = new Promise((resolve) => {
    resolveFirstUpdate = resolve;
  });

  let updateCallCount = 0;
  const mockStorage = createSessionStorage();
  const mockClient = {
    from: () => ({
      update: (payload) => ({
        eq: (k1, setId) => ({
          eq: (k2, userId) => ({
            select: async () => {
            updateCallCount++;
            if (updateCallCount === 1) {
              // Pause first request in flight
              await firstUpdateDeferred;
            }
            return { data: [{ id: setId }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const autosave = createSessionAutosave({
    getClient: () => mockClient,
    getUserId: () => "user-1",
    storage: mockStorage,
  });

  // 1. User types edit A: weight 80 (debounce 10ms)
  autosave.queueSetEdit(100, 1, { weight: 80 }, 10);

  // Wait 18ms for debounce timer to fire and start request A (now suspended in flight)
  await new Promise((resolve) => setTimeout(resolve, 18));
  assert.equal(updateCallCount, 1, "First update request is now in flight");

  // 2. Before request A resolves, user types edit B to same set: reps 10
  autosave.queueSetEdit(100, 1, { reps: 10 }, 40);

  // 3. Now let request A complete on the server
  resolveFirstUpdate();
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Request A succeeded, BUT stored edit B has a newer generation/version!
  const pendingAfterA = mockStorage.getPendingSetEdits(100);
  assert.equal(pendingAfterA.length, 1, "Newer edit B must NOT be erased from storage when older request A finishes");
  assert.equal(pendingAfterA[0].fields.reps, 10, "Edit B reps remain pending in storage");
  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVING, "Sync state must NOT become SAVED while newer edit B is pending");

  // 4. Wait for edit B debounce and persist to finish
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(mockStorage.getPendingSetEdits(100).length, 0, "All edits successfully cleared after B persists");
  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVED, "State transitions to SAVED after newest generation finishes");
});

test("ISSUE 2 REGRESSION: network failure during debounce transitions to FAILED and retains local edit", async () => {
  const mockStorage = createSessionStorage();
  const mockClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({ select: () => Promise.resolve({ data: null, error: new Error("500 Internal Server Error") }) }),
        }),
      }),
    }),
  };

  const autosave = createSessionAutosave({
    getClient: () => mockClient,
    getUserId: () => "user-1",
    storage: mockStorage,
  });

  autosave.queueSetEdit(100, 1, { weight: 80 }, 10);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(autosave.getSyncState(), SYNC_STATE.FAILED, "State transitions to FAILED on network failure");
  assert.equal(mockStorage.getPendingSetEdits(100).length, 1, "Failed edit is retained in pending storage");
});

test("ISSUE 11 REGRESSION: error-free zero-row update retains the durable pending edit and fails flush", async () => {
  const mockStorage = createSessionStorage();
  mockStorage.savePendingSetEdit(100, 1, { weight: 80, reps: 6 });
  const mockClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
  };
  const autosave = createSessionAutosave({
    getClient: () => mockClient,
    getUserId: () => "user-1",
    storage: mockStorage,
  });

  assert.equal(await autosave.flushPendingEdits(100), false);
  assert.deepEqual(mockStorage.getPendingSetEdits(100)[0].fields, { weight: 80, reps: 6 });
  assert.equal(autosave.getSyncState(), SYNC_STATE.FAILED);
});

// =========================================================================
// ISSUE 15 REGRESSION TESTS: durable recovery and reconnection
// =========================================================================

function installIssue15Browser(online) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const listeners = new Map();
  const mockWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
    },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: online } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: mockWindow });
  return {
    window: mockWindow,
    setOnline(value) { globalThis.navigator.onLine = value; },
    restore() {
      if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
      else delete globalThis.navigator;
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else delete globalThis.window;
    },
  };
}

function issue15FeatureFixture({ online = true, update, onSyncStateChange } = {}) {
  const browser = installIssue15Browser(online);
  const storage = createSessionStorage();
  storage.savePendingSetEdit(999, 201, { weight: 90 });
  const updates = [];
  const client = {
    from(table) {
      const builder = {
        select() { return builder; }, eq() { return builder; }, in() { return builder; },
        not() { return builder; }, neq() { return builder; }, order() { return builder; }, limit() { return builder; },
        maybeSingle() {
          return table === "workout_sessions"
            ? Promise.resolve({ data: { id: 999, gym_id: 10, status: "in_progress" }, error: null })
            : Promise.resolve({ data: [], error: null });
        },
        update(payload) {
          updates.push(payload);
          return { eq: () => ({ eq: () => ({ select: () => update ? update(payload) : Promise.resolve({ data: [{ id: 201 }], error: null }) }) }) };
        },
        then(resolve) {
          if (table === "session_exercises") {
            return resolve({ data: [{ id: 101, session_id: 999, exercise_id: 5, exercise_order: 1, exercise_sets: [{ id: 201, weight: 80, reps: 8, is_warmup: false }] }], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
  const feature = createSessionFeature({
    getClient: () => client,
    getUserId: () => "user-test",
    storage,
    historyContext: { clearCache() {}, fetchPreviousPerformance: async () => ({ sets: [] }) },
    onSyncStateChange,
  });
  return { browser, storage, updates, feature };
}

test("ISSUE 9 REGRESSION: session controller forwards autosave sync transitions to its external callback", async () => {
  const onlineTransitions = [];
  const onlineFixture = issue15FeatureFixture({
    onSyncStateChange: (state, label) => onlineTransitions.push({ state, label }),
  });
  try {
    await onlineFixture.feature.load();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(onlineTransitions.some(({ state, label }) => (
      state === SYNC_STATE.SAVING && label === SYNC_LABELS[SYNC_STATE.SAVING]
    )));
    assert.ok(onlineTransitions.some(({ state, label }) => (
      state === SYNC_STATE.SAVED && label === SYNC_LABELS[SYNC_STATE.SAVED]
    )));
  } finally { onlineFixture.browser.restore(); }

  const offlineTransitions = [];
  const offlineFixture = issue15FeatureFixture({
    online: false,
    onSyncStateChange: (state, label) => offlineTransitions.push({ state, label }),
  });
  try {
    await offlineFixture.feature.load();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(offlineTransitions.some(({ state, label }) => (
      state === SYNC_STATE.OFFLINE && label === SYNC_LABELS[SYNC_STATE.OFFLINE]
    )));
  } finally { offlineFixture.browser.restore(); }

  const failedTransitions = [];
  const failedFixture = issue15FeatureFixture({
    update: () => Promise.resolve({ data: null, error: new Error("Persistence failed") }),
    onSyncStateChange: (state, label) => failedTransitions.push({ state, label }),
  });
  try {
    await failedFixture.feature.load();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(failedTransitions.some(({ state, label }) => (
      state === SYNC_STATE.FAILED && label === SYNC_LABELS[SYNC_STATE.FAILED]
    )));
  } finally { failedFixture.browser.restore(); }
});

test("ISSUE 15 REGRESSION: online resume overlays and retries durable pending edits", async () => {
  let resolveUpdate;
  const updatePromise = new Promise((resolve) => { resolveUpdate = resolve; });
  const fixture = issue15FeatureFixture({ update: () => updatePromise });
  try {
    await fixture.feature.load();
    assert.equal(fixture.feature.getActiveExercises()[0].exercise_sets[0].weight, 90);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.feature.getActiveExercises().length, 1);
    assert.deepEqual(fixture.updates[0], { weight: 90 });
    resolveUpdate({ data: [{ id: 201 }], error: null });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.storage.getPendingSetEdits(999).length, 0);
  } finally { fixture.browser.restore(); }
});

test("ISSUE 15 REGRESSION: offline resume preserves durable edits and reconnection retries them", async () => {
  const fixture = issue15FeatureFixture({ online: false });
  try {
    await fixture.feature.load();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.feature.getActiveExercises()[0].exercise_sets[0].weight, 90);
    assert.equal(fixture.updates.length, 0);
    assert.equal(fixture.storage.getPendingSetEdits(999).length, 1);
    fixture.browser.setOnline(true);
    fixture.browser.window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(fixture.updates[0], { weight: 90 });
    assert.equal(fixture.storage.getPendingSetEdits(999).length, 0);
  } finally { fixture.browser.restore(); }
});

test("ISSUE 15 REGRESSION: recovery preserves a newer generation queued while the retry is in flight", async () => {
  let resolveUpdate;
  let calls = 0;
  const fixture = issue15FeatureFixture({ update: () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { resolveUpdate = resolve; });
    return Promise.resolve({ data: [{ id: 201 }], error: null });
  } });
  try {
    await fixture.feature.load();
    await new Promise((resolve) => setTimeout(resolve, 5));
    fixture.storage.savePendingSetEdit(999, 201, { reps: 10 });
    resolveUpdate({ data: { id: 201 }, error: null });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.storage.getPendingSetEdits(999).length, 1);
    assert.deepEqual(fixture.storage.getPendingSetEdits(999)[0].fields, { weight: 90, reps: 10 });
    fixture.browser.window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.storage.getPendingSetEdits(999).length, 0);
  } finally { fixture.browser.restore(); }
});

// =========================================================================
// ISSUE 3 REGRESSION TESTS: Atomic structural live-workout mutations
// =========================================================================

test("ISSUE 3 REGRESSION: addExerciseToActiveSession calls atomic add_session_exercise RPC and reloads canonical state", async () => {
  let rpcCalls = [];
  const mockStorage = createSessionStorage();

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-27" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        return {
          eq: () => ({
            eq: () => ({ select: () => Promise.resolve({ data: [{ id: 100 }], error: null }) }),
          }),
        };
      },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        if (table === "equipment") return resolve({ data: [], error: null });
        if (table === "session_exercises") {
          return resolve({
            data: [
              {
                id: 101,
                session_id: 999,
                exercise_order: 1,
                exercise_id: 5,
                canonical_equipment_id: null,
                exercises: { id: 5, name: "Incline Press" },
                workout_sessions: { id: 999, performed_on: "2026-08-27" },
                exercise_sets: [
                  { id: 201, set_number: 1, weight: 70, reps: 8, is_warmup: false, reported_rir_bucket: 2 },
                ],
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      if (fn === "add_session_exercise") {
        return Promise.resolve({
          data: { id: 101, session_id: 999, exercise_order: 1, exercise_id: 5, initial_set_id: 201 },
          error: null,
        });
      }
      return Promise.resolve({ data: true, error: null });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
  });

  await feature.load();
  await feature.addExercise(5);

  const addCall = rpcCalls.find((c) => c.fn === "add_session_exercise");
  assert.ok(addCall, "add_session_exercise RPC was called");
  assert.deepEqual(addCall.params, {
    p_session_id: 999,
    p_exercise_id: 5,
    p_equipment_id: null,
  });
});

test("ISSUE 3 REGRESSION: removeExercise calls remove_session_exercise RPC; preserves pending edits on failure and clears on success", async () => {
  let rpcCalls = [];
  let shouldRpcFail = true;
  const mockStorage = createSessionStorage();
  mockStorage.savePendingSetEdit(999, 201, { weight: 70 });

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-27" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        return {
          eq: () => ({
            eq: () => ({ select: () => Promise.resolve({ data: [{ id: 100 }], error: null }) }),
          }),
        };
      },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        if (table === "equipment") return resolve({ data: [], error: null });
        if (table === "session_exercises") {
          return resolve({
            data: [
              {
                id: 101,
                session_id: 999,
                exercise_order: 1,
                exercise_id: 5,
                canonical_equipment_id: null,
                exercises: { id: 5, name: "Incline Press" },
                workout_sessions: { id: 999, performed_on: "2026-08-27" },
                exercise_sets: [
                  { id: 201, set_number: 1, weight: 70, reps: 8, is_warmup: false, reported_rir_bucket: 2 },
                ],
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      if (fn === "remove_session_exercise") {
        if (shouldRpcFail) {
          return Promise.resolve({ data: null, error: new Error("RPC execution failed") });
        }
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
  });

  await feature.load();

  // 1. Remove fails: pending edits must be preserved
  await feature.removeExercise(101);
  assert.equal(mockStorage.getPendingSetEdits(999).length, 1, "Pending edits preserved when removeExercise RPC fails");

  // 2. Remove succeeds: pending edits cleared
  shouldRpcFail = false;
  await feature.removeExercise(101);
  assert.equal(mockStorage.getPendingSetEdits(999).length, 0, "Pending edits cleared when removeExercise RPC succeeds");
});

test("ISSUE 3 REGRESSION: removeSet calls remove_exercise_set RPC; preserves pending edits on failure and clears on success", async () => {
  let rpcCalls = [];
  let shouldRpcFail = true;
  const mockStorage = createSessionStorage();
  mockStorage.savePendingSetEdit(999, 201, { weight: 70 });

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-27" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        return {
          eq: () => ({
            eq: () => ({ select: () => Promise.resolve({ data: [{ id: 100 }], error: null }) }),
          }),
        };
      },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        if (table === "equipment") return resolve({ data: [], error: null });
        if (table === "session_exercises") {
          return resolve({
            data: [
              {
                id: 101,
                session_id: 999,
                exercise_order: 1,
                exercise_id: 5,
                canonical_equipment_id: null,
                exercises: { id: 5, name: "Incline Press" },
                workout_sessions: { id: 999, performed_on: "2026-08-27" },
                exercise_sets: [
                  { id: 201, set_number: 1, weight: 70, reps: 8, is_warmup: false, reported_rir_bucket: 2 },
                ],
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      if (fn === "remove_exercise_set") {
        if (shouldRpcFail) {
          return Promise.resolve({ data: null, error: new Error("RPC execution failed") });
        }
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
  });

  await feature.load();

  // 1. Remove set fails: pending edits preserved
  await feature.removeSet(101, 201);
  assert.equal(mockStorage.getPendingSetEdits(999).length, 1, "Pending set edit preserved when remove_exercise_set fails");

  // 2. Remove set succeeds: pending edits cleared
  shouldRpcFail = false;
  await feature.removeSet(101, 201);
  assert.equal(mockStorage.getPendingSetEdits(999).length, 0, "Pending set edit cleared when remove_exercise_set succeeds");
});

test("ISSUE 1 REGRESSION: starting concludeActiveSession() locks out concurrent mutations while RPC is in flight", async () => {
  let rpcCalls = [];
  let resolveConcludeRpc;
  const concludeDeferred = new Promise((resolve) => {
    resolveConcludeRpc = resolve;
  });

  const mockStorage = createSessionStorage();

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-27" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        return {
          eq: () => ({
            eq: () => ({ select: () => Promise.resolve({ data: [{ id: 100 }], error: null }) }),
          }),
        };
      },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        if (table === "equipment") return resolve({ data: [], error: null });
        if (table === "session_exercises") {
          return resolve({
            data: [
              {
                id: 50,
                session_id: 999,
                exercise_order: 1,
                exercise_id: 1,
                canonical_equipment_id: null,
                exercises: { id: 1, name: "Bench Press" },
                workout_sessions: { id: 999, performed_on: "2026-08-27" },
                exercise_sets: [
                  { id: 100, set_number: 1, weight: 80, reps: 8, is_warmup: false, reported_rir_bucket: 2, rir_source: "user_entered" },
                ],
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: async (fn, params) => {
      rpcCalls.push({ fn, params });
      if (fn === "conclude_workout_session") {
        await concludeDeferred;
        return { data: { id: 999, status: "completed" }, error: null };
      }
      return { data: true, error: null };
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
  });

  await feature.load();

  // Start conclusion asynchronously (will block in RPC)
  const conclusionPromise = feature.concludeSession();
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Verify conclusion RPC is in flight
  assert.ok(rpcCalls.some((c) => c.fn === "conclude_workout_session"), "conclude_workout_session RPC is in flight");

  // Attempt concurrent mutations while conclusion is in progress
  await feature.addExercise(5);
  await feature.removeSet(50, 100);
  await feature.addSet(50);
  await feature.removeExercise(50);

  // Storage must not have any new edits queued
  assert.equal(mockStorage.getPendingSetEdits(999).length, 0, "No pending edits allowed while conclusion is in progress");

  // Now resolve conclusion RPC
  resolveConcludeRpc();
  await conclusionPromise;

  // Verify conclusion finalized cleanly
  assert.equal(feature.getActiveSession(), null, "Session concluded");
  assert.equal(mockStorage.getPendingSetEdits(999).length, 0, "Storage is clean");
});

test("ISSUE 3 REGRESSION: structural deletion of set while autosave is in flight discards late completion/failure without recreating pending state", async () => {
  let resolveInFlightAutosave;
  const inFlightDeferred = new Promise((resolve) => {
    resolveInFlightAutosave = resolve;
  });

  let rpcCalls = [];
  const mockStorage = createSessionStorage();

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-27" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        return {
          eq: () => ({
            eq: async () => {
              // Pause update in flight
              await inFlightDeferred;
              // Simulate server rejecting update because row was deleted
              return { data: null, error: new Error("Row not found") };
            },
          }),
        };
      },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        if (table === "equipment") return resolve({ data: [], error: null });
        if (table === "session_exercises") {
          return resolve({
            data: [
              {
                id: 50,
                session_id: 999,
                exercise_order: 1,
                exercise_id: 1,
                canonical_equipment_id: null,
                exercises: { id: 1, name: "Bench Press" },
                workout_sessions: { id: 999, performed_on: "2026-08-27" },
                exercise_sets: [
                  { id: 100, set_number: 1, weight: 80, reps: 8, is_warmup: false, reported_rir_bucket: 2 },
                ],
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: true, error: null });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
  });

  await feature.load();

  // 1. Queue set edit with small debounce to initiate autosave
  mockStorage.savePendingSetEdit(999, 100, { weight: 85 });
  const autosave = createSessionAutosave({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
  });

  autosave.queueSetEdit(999, 100, { weight: 85 }, 10);
  await new Promise((resolve) => setTimeout(resolve, 20)); // autosave request is now in flight

  // 2. While autosave is in flight, delete the set
  autosave.discardPendingSet(999, 100);
  await feature.removeSet(50, 100);

  // 3. Now let the in-flight autosave fail on the server
  resolveInFlightAutosave();
  await new Promise((resolve) => setTimeout(resolve, 20));

  // 4. Verify that the failed obsolete autosave did NOT recreate pending storage or leave sync state failed
  assert.equal(mockStorage.getPendingSetEdits(999).length, 0, "Obsolete edit must not be recreated in storage");
  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVED, "Sync state must remain SAVED and not transition to FAILED");
});

test("ISSUE 3 REGRESSION: structural deletion of exercise with in-flight set autosaves discards late completion without recreating pending state", async () => {
  let resolveInFlightAutosave;
  const inFlightDeferred = new Promise((resolve) => {
    resolveInFlightAutosave = resolve;
  });

  let rpcCalls = [];
  const mockStorage = createSessionStorage();

  function createQueryBuilder(table) {
    const builder = {
      _data: [],
      select() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (table === "workout_sessions") {
          return Promise.resolve({
            data: { id: 999, gym_id: 10, status: "in_progress", performed_on: "2026-08-27" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        return {
          eq: () => ({
            eq: async () => {
              await inFlightDeferred;
              return { data: null, error: new Error("Row not found / Cascade deleted") };
            },
          }),
        };
      },
      delete() { return builder; },
      insert() { return builder; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (table === "gyms") return resolve({ data: [{ id: 10, name: "Gym A" }], error: null });
        if (table === "equipment") return resolve({ data: [], error: null });
        if (table === "session_exercises") {
          return resolve({
            data: [
              {
                id: 50,
                session_id: 999,
                exercise_order: 1,
                exercise_id: 1,
                canonical_equipment_id: null,
                exercises: { id: 1, name: "Bench Press" },
                workout_sessions: { id: 999, performed_on: "2026-08-27" },
                exercise_sets: [
                  { id: 100, set_number: 1, weight: 80, reps: 8, is_warmup: false, reported_rir_bucket: 2 },
                  { id: 101, set_number: 2, weight: 85, reps: 6, is_warmup: false, reported_rir_bucket: 1 },
                ],
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table) => createQueryBuilder(table),
    rpc: (fn, params) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: true, error: null });
    },
  };

  const feature = createSessionFeature({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
    ensureExerciseCatalogue: () => Promise.resolve([]),
  });

  await feature.load();

  const autosave = createSessionAutosave({
    getClient: () => mockClient,
    getUserId: () => "user-test",
    storage: mockStorage,
  });

  // 1. Queue autosaves for Set 100 and Set 101
  autosave.queueSetEdit(999, 100, { weight: 90 }, 10);
  autosave.queueSetEdit(999, 101, { weight: 95 }, 10);
  await new Promise((resolve) => setTimeout(resolve, 20)); // Both in flight

  // 2. Delete the entire exercise while autosaves are in flight
  autosave.discardPendingSet(999, 100);
  autosave.discardPendingSet(999, 101);
  await feature.removeExercise(50);

  // 3. Resolve in-flight updates with server failures
  resolveInFlightAutosave();
  await new Promise((resolve) => setTimeout(resolve, 20));

  // 4. Verify clean storage and SAVED state
  assert.equal(mockStorage.getPendingSetEdits(999).length, 0, "No pending edits recreated for deleted exercise sets");
  assert.equal(autosave.getSyncState(), SYNC_STATE.SAVED, "Sync state remains SAVED");
});

test("ISSUE 22: canonical equipment matches previous performance across gyms; unrecorded equipment stays gym-scoped", async () => {
  const otherGymSession = { ...completedHistorySession({ id: 6, performed_on: "2026-08-25", created_at: "2026-08-25T09:00:00Z", setWeight: 22 }), gym_id: 11 };
  const queryLog = [];
  const history = createSessionHistoryContext({ getClient: () => createHistoryQueryClient(() => [otherGymSession], queryLog), getUserId: () => "user-test" });

  const sameEquipmentElsewhere = await history.fetchPreviousPerformance(10, 5, 7, 99);
  assert.equal(sameEquipmentElsewhere.sessionId, 6, "the same canonical equipment at another gym is the previous performance");
  assert.equal(sameEquipmentElsewhere.equipmentId, 7);
  const equipmentQuery = queryLog.filter(({ type }) => type === "query")[0];
  assert.equal(equipmentQuery.filters.some(({ column }) => column === "gym_id"), false, "equipment lookups are not scoped to the gym");
  assert.ok(equipmentQuery.filters.some(({ column, value }) => column === "session_exercises.canonical_equipment_id" && value === 7));

  const unrecorded = await history.fetchPreviousPerformance(10, 5, null, 98);
  assert.equal(unrecorded, null, "without equipment the lookup stays at the current gym");
  const gymQuery = queryLog.filter(({ type }) => type === "query")[1];
  assert.ok(gymQuery.filters.some(({ column, value }) => column === "gym_id" && value === 10));
});

test("ISSUE 22: generic implements are offered at every gym and machines only where available", async () => {
  const { buildEquipmentByGym } = await import("../features/session/session-controller.js");
  const byGym = buildEquipmentByGym(
    [{ id: 1, name: "Gym One" }, { id: 2, name: "Gym Two" }],
    [
      { id: 7, name: "Dumbbell", kind: "generic", is_active: true, equipment_gym_availability: [] },
      { id: 8, name: "Matrix G3-S71", kind: "machine", is_active: true, equipment_gym_availability: [{ gym_id: 1 }, { gym_id: 2 }] },
      { id: 9, name: "Smith Machine (unknown model) — Gym One", kind: "unknown_model", is_active: true, equipment_gym_availability: [{ gym_id: 1 }] },
      { id: 10, name: "Retired Machine", kind: "machine", is_active: false, equipment_gym_availability: [{ gym_id: 2 }] },
    ],
  );
  assert.deepEqual(byGym.get(1).map(({ name }) => name), ["Dumbbell", "Matrix G3-S71", "Smith Machine (unknown model) — Gym One"]);
  assert.deepEqual(byGym.get(2).map(({ name }) => name), ["Dumbbell", "Matrix G3-S71"]);
  assert.equal(byGym.get(1)[0].id, byGym.get(2)[0].id, "the generic implement keeps one identity at both gyms");
});

test("ISSUE 22: previous-set text labels dumbbell loads per dumbbell from the recorded equipment", async () => {
  const { formatInlinePreviousSet } = await import("../features/session/session-history-context.js");
  const previous = { weight: 14, reps: 12, reported_rir_bucket: 1, is_warmup: false };
  assert.equal(formatInlinePreviousSet(previous, "Lateral Raise (Seated)", "Dumbbell"), "14 kg per dumbbell × 12 @ 1 RIR");
  assert.equal(formatInlinePreviousSet(previous, "Lateral Raise (Seated)", "Cable (unknown model) — Gym One"), "14 kg × 12 @ 1 RIR");
});
