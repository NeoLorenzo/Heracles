import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionStorage,
  LEGACY_STORAGE_PREFIX,
  STORAGE_PREFIX,
} from "../features/session/session-storage.js";

function createMockLocalStorage(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    keys() { return [...data.keys()]; },
  };
}

function withLocalStorage(localStorage, fn) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  try {
    return fn();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
}

const edit = (version, weight) => JSON.stringify({
  sessionId: "s1",
  setId: "a",
  fields: { weight },
  version,
  updatedAt: 1,
});

test("pending set edits use the Heracles storage prefix", () => {
  assert.equal(STORAGE_PREFIX, "heracles_pending_set_");
  const localStorage = createMockLocalStorage();
  withLocalStorage(localStorage, () => {
    createSessionStorage().savePendingSetEdit("s1", "a", { weight: 50 });
  });
  assert.deepEqual(localStorage.keys(), ["heracles_pending_set_s1_a"]);
});

test("legacy pending set edits are migrated without data loss", () => {
  const localStorage = createMockLocalStorage({
    [`${LEGACY_STORAGE_PREFIX}s1_a`]: edit(3, 60),
    unrelated_key: "keep",
  });

  const recovered = withLocalStorage(localStorage, () => createSessionStorage().getPendingSetEdits("s1"));

  assert.equal(recovered.length, 1);
  assert.deepEqual(recovered[0].fields, { weight: 60 });
  assert.equal(recovered[0].version, 3);
  assert.deepEqual(localStorage.keys().sort(), ["heracles_pending_set_s1_a", "unrelated_key"]);
});

test("legacy migration keeps the newer edit when both prefixes exist", () => {
  const localStorage = createMockLocalStorage({
    [`${LEGACY_STORAGE_PREFIX}s1_a`]: edit(2, 40),
    [`${STORAGE_PREFIX}s1_a`]: edit(5, 70),
  });

  const recovered = withLocalStorage(localStorage, () => createSessionStorage().getPendingSetEdit("s1", "a"));

  assert.equal(recovered.version, 5);
  assert.deepEqual(recovered.fields, { weight: 70 });
  assert.deepEqual(localStorage.keys(), [`${STORAGE_PREFIX}s1_a`]);
});

test("legacy migration leaves unreadable legacy entries in place", () => {
  const localStorage = createMockLocalStorage({ [`${LEGACY_STORAGE_PREFIX}s1_a`]: "{not json" });

  withLocalStorage(localStorage, () => createSessionStorage());

  assert.deepEqual(localStorage.keys(), [`${LEGACY_STORAGE_PREFIX}s1_a`]);
});
