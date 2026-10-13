export const STORAGE_PREFIX = "heracles_pending_set_";
// Prefix used before the Heracles rename. Pending edits stored under it are
// moved to STORAGE_PREFIX so unsynced sets survive the upgrade.
export const LEGACY_STORAGE_PREFIX = "lifting_ledger_pending_set_";

function getStorageKey(sessionId, setId) {
  return `${STORAGE_PREFIX}${sessionId}_${setId}`;
}

function parseEdit(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function createSessionStorage() {
  const inMemoryFallback = new Map();

  function isLocalStorageAvailable() {
    try {
      return typeof window !== "undefined" && "localStorage" in window && window.localStorage !== null;
    } catch {
      return false;
    }
  }

  function migrateLegacyPendingEdits() {
    if (!isLocalStorageAvailable()) return;
    try {
      const store = window.localStorage;
      const legacyKeys = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.startsWith(LEGACY_STORAGE_PREFIX)) legacyKeys.push(key);
      }
      for (const legacyKey of legacyKeys) {
        const legacyRaw = store.getItem(legacyKey);
        const legacyEdit = parseEdit(legacyRaw);
        const key = `${STORAGE_PREFIX}${legacyKey.slice(LEGACY_STORAGE_PREFIX.length)}`;
        const current = parseEdit(store.getItem(key));
        if (legacyEdit && (!current || (legacyEdit.version || 0) > (current.version || 0))) {
          store.setItem(key, legacyRaw);
        }
        if (legacyEdit || !legacyRaw) store.removeItem(legacyKey);
      }
    } catch {
      // Leave legacy keys in place; migration is retried on next load.
    }
  }

  migrateLegacyPendingEdits();

  return {
    savePendingSetEdit(sessionId, setId, fields) {
      if (!sessionId || !setId) return;
      const key = getStorageKey(sessionId, setId);
      const existing = this.getPendingSetEdit(sessionId, setId) || { sessionId, setId, fields: {}, version: 0 };
      const merged = {
        sessionId,
        setId,
        fields: { ...existing.fields, ...fields },
        version: (existing.version || 0) + 1,
        updatedAt: Date.now(),
      };

      if (isLocalStorageAvailable()) {
        try {
          window.localStorage.setItem(key, JSON.stringify(merged));
          return merged;
        } catch {
          // fall back to in-memory
        }
      }
      inMemoryFallback.set(key, merged);
      return merged;
    },

    getPendingSetEdit(sessionId, setId) {
      const key = getStorageKey(sessionId, setId);
      if (isLocalStorageAvailable()) {
        try {
          const raw = window.localStorage.getItem(key);
          if (raw) return JSON.parse(raw);
        } catch {
          // fallback
        }
      }
      return inMemoryFallback.get(key) || null;
    },

    getPendingSetEdits(sessionId) {
      const results = [];
      const prefix = `${STORAGE_PREFIX}${sessionId}_`;

      if (isLocalStorageAvailable()) {
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith(prefix)) {
              const raw = window.localStorage.getItem(key);
              if (raw) results.push(JSON.parse(raw));
            }
          }
          return results;
        } catch {
          // fallback
        }
      }

      for (const [key, val] of inMemoryFallback) {
        if (key.startsWith(prefix)) results.push(val);
      }
      return results;
    },

    removePendingSetEdit(sessionId, setId, version = null) {
      const key = getStorageKey(sessionId, setId);
      if (version !== null && version !== undefined) {
        const existing = this.getPendingSetEdit(sessionId, setId);
        if (!existing) return;
        if ((existing.version || 0) > version) {
          // A newer edit arrived; do not remove
          return;
        }
      }

      if (isLocalStorageAvailable()) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }
      inMemoryFallback.delete(key);
    },

    clearPendingSessionEdits(sessionId) {
      const prefix = `${STORAGE_PREFIX}${sessionId}_`;
      if (isLocalStorageAvailable()) {
        try {
          const keysToRemove = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith(prefix)) keysToRemove.push(key);
          }
          for (const key of keysToRemove) window.localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }
      for (const key of [...inMemoryFallback.keys()]) {
        if (key.startsWith(prefix)) inMemoryFallback.delete(key);
      }
    },
  };
}
