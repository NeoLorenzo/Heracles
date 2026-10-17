import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MockNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.className = "";
    this.id = "";
    this.type = "";
    this._text = "";
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  append(...nodes) {
    for (const node of nodes) this.children.push(typeof node === "string" ? createTextNode(node) : node);
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get("click")?.({ type: "click" });
  }

  findAll(predicate, found = []) {
    for (const child of this.children) {
      if (predicate(child)) found.push(child);
      child.findAll?.(predicate, found);
    }
    return found;
  }

  findByClass(className) {
    return this.findAll((node) => String(node.className).split(/\s+/).includes(className));
  }
}

function createTextNode(text) {
  const node = new MockNode("#text");
  node._text = String(text);
  return node;
}

globalThis.document = {
  createElement: (tagName) => new MockNode(tagName),
  createTextNode,
};

const { createWorkoutRecapFeature, describeRecapRow } = await import("../features/workout-recap.js");

function createQuery(table, log, responses) {
  const query = { table, filters: [], select: null, range: null };
  log.push(query);
  const chain = {
    select(columns) { query.select = columns; return chain; },
    eq(column, value) { query.filters.push(["eq", column, value]); return chain; },
    lte(column, value) { query.filters.push(["lte", column, value]); return chain; },
    in(column, value) { query.filters.push(["in", column, value]); return chain; },
    order() { return chain; },
    range(from, to) { query.range = [from, to]; return Promise.resolve(responses[table](query)); },
    maybeSingle() { return Promise.resolve(responses[table](query)); },
  };
  return chain;
}

function createSupabase(responses) {
  const log = [];
  return { log, client: { from: (table) => createQuery(table, log, responses) } };
}

const currentSession = {
  id: 9,
  gym_id: 1,
  performed_on: "2026-10-17",
  created_at: "2026-10-17T09:00:00Z",
  status: "completed",
  source_preset_name: "Push",
  gyms: { name: "Home Gym" },
  session_exercises: [{
    id: 90,
    session_id: 9,
    exercise_order: 1,
    exercise_id: "bench",
    canonical_equipment_id: 7,
    equipment_name_snapshot: "Smith Machine",
    equipment: { name: "Smith Machine" },
    exercises: { name: "Chest Press" },
    exercise_sets: [
      { id: 900, session_exercise_id: 90, set_number: 1, weight: 60, reps: 8, is_warmup: true, reported_rir_bucket: null },
      { id: 901, session_exercise_id: 90, set_number: 2, weight: 105, reps: 5, is_warmup: false, reported_rir_bucket: 2 },
    ],
  }],
};

const historyRow = {
  id: 80,
  session_id: 8,
  exercise_order: 1,
  exercise_id: "bench",
  canonical_equipment_id: 7,
  equipment_name_snapshot: "Smith Machine",
  equipment: { name: "Smith Machine" },
  exercises: { name: "Chest Press" },
  // Recorded at another gym: canonical equipment is comparable across gyms.
  workout_sessions: { id: 8, gym_id: 2, performed_on: "2026-10-10", created_at: "2026-10-10T09:00:00Z", status: "completed" },
  exercise_sets: [{ id: 800, session_exercise_id: 80, set_number: 1, weight: 100, reps: 5, is_warmup: false, reported_rir_bucket: 2 }],
};

test("loads the persisted completed session and owner-scoped comparable history", async () => {
  const container = new MockNode("div");
  const { client, log } = createSupabase({
    workout_sessions: () => ({ data: currentSession, error: null }),
    session_exercises: () => ({ data: [historyRow], error: null }),
  });
  const feature = createWorkoutRecapFeature({ getClient: () => client, getUserId: () => "user-1", container });

  const recap = await feature.show(9);

  assert.equal(recap.exercises[0].changePercent, 5);
  const [sessionQuery, historyQuery] = log;
  assert.equal(sessionQuery.table, "workout_sessions");
  assert.deepEqual(sessionQuery.filters, [["eq", "owner_id", "user-1"], ["eq", "id", 9]]);
  assert.doesNotMatch(sessionQuery.select, /estimated_1rm|tonnage|volume/);
  for (const select of [sessionQuery.select]) {
    assert.match(select, /canonical_equipment_id, equipment_name_snapshot, equipment\(name\)/);
    assert.doesNotMatch(select, /gym_equipment_id|[ (]equipment_id/);
  }
  assert.equal(historyQuery.table, "session_exercises");
  assert.deepEqual(historyQuery.filters, [
    ["eq", "owner_id", "user-1"],
    ["eq", "workout_sessions.status", "completed"],
    ["lte", "workout_sessions.performed_on", "2026-10-17"],
    ["in", "exercise_id", ["bench"]],
  ]);
  assert.match(historyQuery.select, /workout_sessions!inner\(id, gym_id, performed_on, created_at, status\)/);
  assert.match(historyQuery.select, /canonical_equipment_id/);
  assert.doesNotMatch(historyQuery.select, /gym_equipment_id|[ (]equipment_id/);
  assert.match(sessionQuery.select, /^id, gym_id, /);

  const text = container.textContent;
  assert.match(text, /Workout complete/);
  assert.match(text, /Home Gym · 1 exercise · 1 working set/);
  assert.match(text, /Chest Press · Smith Machine/);
  assert.doesNotMatch(text, /Equipment not recorded/);
  assert.match(text, /1 improved · 1 new best/);
  assert.match(text, /\+5\.0% Improved · e1RM vs last comparable session/);
  assert.match(text, /New best/);
  assert.match(text, /How these comparisons work/);
  assert.match(text, /not a measured 1RM/);
  assert.match(text, /does not give this workout a score/);
  assert.doesNotMatch(text, /tonnage|volume load|score: \d/i);
  const changeLine = container.findByClass("workout-recap-change")[0];
  assert.ok(String(changeLine.className).includes("change-positive"));
});

test("pages through long comparable histories", async () => {
  const container = new MockNode("div");
  const many = Array.from({ length: 1000 }, (_, index) => ({ ...historyRow, id: 1000 + index }));
  const { client, log } = createSupabase({
    workout_sessions: () => ({ data: currentSession, error: null }),
    session_exercises: (query) => ({ data: query.range[0] === 0 ? many : [historyRow], error: null }),
  });
  const feature = createWorkoutRecapFeature({ getClient: () => client, getUserId: () => "user-1", container });
  await feature.show(9);
  assert.deepEqual(log.filter((query) => query.table === "session_exercises").map((query) => query.range), [[0, 999], [1000, 1999]]);
});

test("refuses to recap a session that is not completed and keeps a Done exit", async () => {
  const container = new MockNode("div");
  let done = 0;
  const { client } = createSupabase({
    workout_sessions: () => ({ data: { ...currentSession, status: "in_progress" }, error: null }),
    session_exercises: () => { throw new Error("history must not load"); },
  });
  const feature = createWorkoutRecapFeature({ getClient: () => client, getUserId: () => "user-1", container, onDone: () => { done += 1; } });
  assert.equal(await feature.show(9), null);
  assert.match(container.textContent, /Your workout was saved, but the recap could not be loaded: This workout has not been completed/);
  const [doneButton] = container.findByClass("workout-recap-done");
  doneButton.click();
  assert.equal(done, 1);
});

test("a stale recap request never overwrites a newer one", async () => {
  const container = new MockNode("div");
  let resolveFirst;
  let calls = 0;
  const client = {
    from: (table) => createQuery(table, [], {
      workout_sessions: () => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => { resolveFirst = () => resolve({ data: currentSession, error: null }); });
        return { data: { ...currentSession, source_preset_name: "Second" }, error: null };
      },
      session_exercises: () => ({ data: [], error: null }),
    }),
  };
  const feature = createWorkoutRecapFeature({ getClient: () => client, getUserId: () => "user-1", container });
  const first = feature.show(9);
  await feature.show(9);
  resolveFirst();
  assert.equal(await first, null);
  assert.match(container.textContent, /Second/);
});

test("describes baseline, unavailable, and dumbbell rows without fabricated deltas", () => {
  const baseline = describeRecapRow({
    status: "baseline",
    unit: "kg per dumbbell",
    equipmentRecorded: false,
    current: { value: 29.33, weight: 22, reps: 10, reportedRir: 2 },
  });
  assert.equal(baseline.change, null);
  assert.match(baseline.lines.join(" "), /e1RM 29\.33? kg per dumbbell from 22 kg per dumbbell × 10 reps/);
  assert.match(baseline.lines.join(" "), /baseline/);

  const unavailable = describeRecapRow({ status: "no-working-sets", unit: "kg" });
  assert.equal(unavailable.change, null);
  assert.match(unavailable.lines[0], /No RIR 0–3 working sets/);
});

test("app opens the recap only after a successful conclusion and Done returns Home", async () => {
  const read = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const [app, html, serviceWorker, packageJson, controller] = await Promise.all([
    read("app.js"),
    read("index.html"),
    read("service-worker.js"),
    read("package.json"),
    read("features/session/session-controller.js"),
  ]);
  // A saved history correction (#5) returns to Session History instead of opening a recap.
  assert.match(app, /onSessionConcluded: \(concludedSessionId, \{ wasHistoryCorrection = false \} = \{\}\) => \{[\s\S]*?if \(wasHistoryCorrection\) \{[\s\S]*?\} else \{\n      showWorkoutRecap\(concludedSessionId\);\n    \}[\s\S]*?\},\n  onSessionCancelled/);
  // Cancelling never opens a recap; a discarded correction (#5) returns to Session History.
  assert.match(app, /onSessionCancelled: \(_sessionId, \{ restoredCompletedSession = false \} = \{\}\) => \{[\s\S]*?showPage\(restoredCompletedSession \? "session-history" : "home"\);/);
  assert.doesNotMatch(app.slice(app.indexOf("onSessionCancelled:"), app.indexOf("onSessionCancelled:") + 600), /showWorkoutRecap/);
  assert.match(app, /onDone: \(origin\) => \{[\s\S]*?origin === RECAP_ORIGIN\.HISTORY && window\.history\.state\?\.workoutRecap\) window\.history\.back\(\);[\s\S]*?showPage\(origin === RECAP_ORIGIN\.HISTORY \? "session-history" : "home"\);/);
  assert.match(app, /function showWorkoutRecap\(sessionId\) \{\n  synchronizeSignedInPageUrl\("home", \{ replace: true \}\);\n  showPage\("workout-recap", \{ updateHistory: false \}\);\n  void workoutRecapFeature\.show\(sessionId\);/);
  const signedInPageSet = app.slice(app.indexOf("const URL_BACKED_SIGNED_IN_PAGES"), app.indexOf("const loadingView"));
  assert.doesNotMatch(signedInPageSet, /workout-recap/);
  assert.match(app, /liveSessionFeature\.reset\(\);\n  workoutRecapFeature\.reset\(\);/);
  // The conclusion RPC still runs before the callback, so the recap cannot interrupt saving.
  assert.match(controller, /rpc\("conclude_workout_session"[\s\S]*if \(error\) throw error;[\s\S]*onSessionConcluded\(concludedSessionId, \{ wasHistoryCorrection \}\)/);
  assert.match(html, /<section id="workout-recap-page" class="page-panel workout-recap-page" data-page-panel="workout-recap" hidden>/);
  assert.match(html, /id="workout-recap-container"/);
  assert.match(serviceWorker, /"\/features\/workout-recap\.js"/);
  assert.match(serviceWorker, /"\/workout-recap\.js"/);
  assert.match(serviceWorker, /"\/features\/workout-recap-card\.js"/);
  assert.match(packageJson, /node --check features\/workout-recap\.js && node --check features\/workout-recap-card\.js && node --check workout-recap\.js/);
});

test("Session History offers a recap for completed sessions without storing anything", async () => {
  const app = (await readFile(new URL("../app.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(app, /if \(session\.status === "completed"\) disclosure\.append\(createSessionRecapAction\(session\)\);/);
  assert.match(app, /button\.textContent = "View recap";\n  button\.addEventListener\("click", \(\) => showWorkoutRecapFromHistory\(session\.id\)\);/);
  const opener = app.slice(app.indexOf("function showWorkoutRecapFromHistory"), app.indexOf("function updateContextualNavTitle"));
  assert.match(opener, /window\.history\.pushState\(\{ page: "session-history", workoutRecap: sessionId \}, "", window\.location\.href\);/);
  assert.match(opener, /showPage\("workout-recap", \{ updateHistory: false \}\);\n  void workoutRecapFeature\.show\(sessionId, \{ origin: RECAP_ORIGIN\.HISTORY \}\);/);
  assert.doesNotMatch(opener, /\.from\(|\.rpc\(|\.insert\(|\.update\(/);
});

function shareHarness(navigatorStub, { file = new File(["png"], "card.png", { type: "image/png" }) } = {}) {
  const container = new MockNode("div");
  const downloads = [];
  const { client } = createSupabase({
    workout_sessions: () => ({ data: currentSession, error: null }),
    session_exercises: () => ({ data: [historyRow], error: null }),
  });
  const feature = createWorkoutRecapFeature({
    getClient: () => client,
    getUserId: () => "user-1",
    container,
    getNavigator: () => navigatorStub,
    renderShareCard: async () => file,
    downloadFile: (saved) => { downloads.push(saved.name); return true; },
  });
  return { container, downloads, feature };
}

async function clickShare(container) {
  const [share] = container.findByClass("workout-recap-share");
  share.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return container.findByClass("workout-recap-share-status")[0].textContent;
}

test("Share sends the image card and text through the system share sheet when files are supported", async () => {
  const shared = [];
  const navigatorStub = { canShare: ({ files }) => files.length === 1, share: async (data) => { shared.push(data); } };
  const { container, feature } = shareHarness(navigatorStub);
  await feature.show(9);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await clickShare(container), "");
  assert.equal(shared.length, 1);
  assert.equal(shared[0].files[0].name, "card.png");
  assert.equal(shared[0].title, "Heracles workout recap — Push");
  assert.match(shared[0].text, /Chest Press · Smith Machine: New best · \+5\.0% e1RM vs last comparable session/);
  assert.match(shared[0].text, /Not a measured max\.$/);
  assert.doesNotMatch(shared[0].text, /Home Gym|tonnage|volume/);
});

test("Share falls back to text, treats a dismissed sheet as no error, and saves plus copies without a share sheet", async () => {
  const textOnly = [];
  const textHarness = shareHarness({ share: async (data) => { textOnly.push(data); } });
  await textHarness.feature.show(9);
  await clickShare(textHarness.container);
  assert.equal(textOnly.length, 1);
  assert.equal(textOnly[0].files, undefined);

  const dismissed = shareHarness({ share: async () => { throw Object.assign(new Error("dismissed"), { name: "AbortError" }); } });
  await dismissed.feature.show(9);
  assert.equal(await clickShare(dismissed.container), "");
  assert.deepEqual(dismissed.downloads, []);

  const copied = [];
  const fallback = shareHarness({ clipboard: { writeText: async (text) => { copied.push(text); } } });
  await fallback.feature.show(9);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await clickShare(fallback.container), "Recap image saved and recap text copied.");
  assert.deepEqual(fallback.downloads, ["card.png"]);
  assert.match(copied[0], /^Heracles workout recap — Push · /);
});

test("a recap opened from Session History says so and returns there", async () => {
  const container = new MockNode("div");
  const origins = [];
  const { client } = createSupabase({
    workout_sessions: () => ({ data: currentSession, error: null }),
    session_exercises: () => ({ data: [historyRow], error: null }),
  });
  const feature = createWorkoutRecapFeature({
    getClient: () => client,
    getUserId: () => "user-1",
    container,
    renderShareCard: async () => null,
    onDone: (origin) => origins.push(origin),
  });
  await feature.show(9, { origin: "history" });
  assert.match(container.textContent, /^Workout recap · /);
  assert.doesNotMatch(container.textContent, /Workout complete/);
  const [back] = container.findByClass("workout-recap-done");
  assert.equal(back.textContent, "Back to Session history");
  back.click();
  await feature.show(9);
  container.findByClass("workout-recap-done")[0].click();
  assert.deepEqual(origins, ["history", "completion"]);
});

test("a workout with no saved exercises offers no share action", async () => {
  const container = new MockNode("div");
  const { client } = createSupabase({
    workout_sessions: () => ({ data: { ...currentSession, session_exercises: [] }, error: null }),
    session_exercises: () => ({ data: [], error: null }),
  });
  const feature = createWorkoutRecapFeature({ getClient: () => client, getUserId: () => "user-1", container, renderShareCard: async () => null });
  await feature.show(9);
  assert.equal(container.findByClass("workout-recap-share").length, 0);
  assert.match(container.textContent, /No exercises were saved in this workout\./);
});
