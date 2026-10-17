import { createSessionStorage } from "./session-storage.js";
import { createSessionAutosave, SYNC_STATE, SYNC_LABELS } from "./session-autosave.js";
import { createSessionHistoryContext } from "./session-history-context.js";
import { createSessionRenderer } from "./session-rendering.js";
import { fetchRecentExerciseIds, fetchRecentGymIds } from "./session-recents.js";
import { isDraftSet } from "../../set-model.js";
import {
  ACTIVE_WORKOUT_CONFLICT_MESSAGE,
  isReopenedCorrection,
  reopenCompletedWorkoutSession,
} from "./session-lifecycle.js";

// Canonical equipment is owned once per user. Generic implements (Dumbbell, Barbell, ...) are offered at every
// gym; machines and unknown-model placeholders are offered where their gym availability says they are.
export function buildEquipmentByGym(gymRows, equipmentRows) {
  const byGym = new Map();
  for (const gym of gymRows || []) {
    const usable = (equipmentRows || []).filter((equipment) => (
      equipment.is_active !== false
      && (
        equipment.kind === "generic"
        || (equipment.equipment_gym_availability || []).some((availability) => String(availability.gym_id) === String(gym.id))
      )
    ));
    byGym.set(gym.id, usable.map(({ id, name, kind, is_active }) => ({ id, name, kind, is_active: is_active !== false })));
  }
  return byGym;
}

export function createSessionFeature(options) {
  const {
    getClient,
    getUserId,
    ensureExerciseCatalogue,
    onNavigate,
    onSessionConcluded,
    onSessionCancelled,
    onSyncStateChange,
    liveContainer,
    wizardModal,
  } = options;

  const storage = options.storage || createSessionStorage();
  const historyContext = options.historyContext || createSessionHistoryContext({
    getClient,
    getUserId,
  });

  let activeSession = null;
  let activeExercises = [];
  let gyms = [];
  let equipmentByGym = new Map();
  let equipmentOptionsByExercise = new Map();
  let historyContextByExercise = new Map();
  let syncState = SYNC_STATE.SAVED;
  let syncLabel = SYNC_LABELS[SYNC_STATE.SAVED];
  let errorMessage = "";
  let isConcluding = false;
  let renderer = null;

  // Wizard state
  let selectedGymId = null;
  let selectedPresetId = null;

  const autosave = createSessionAutosave({
    getClient,
    getUserId,
    storage,
    onSyncStateChange: (state, label) => {
      syncState = state;
      syncLabel = label;
      if (renderer) {
        renderer.updateSyncBadge(state, label);
      }
      onSyncStateChange?.(state, label);
    },
  });

  function handleOnline() {
    if (activeSession) {
      void autosave.retryPendingWrites(activeSession.id);
    }
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", handleOnline);
  }

  function renderCurrent() {
    if (renderer && activeSession) {
      renderer.renderLiveSession({
        session: activeSession,
        exercises: activeExercises,
        gyms,
        equipmentByGym,
        equipmentOptionsByExercise,
        historyContextByExercise,
        syncState,
        syncLabel,
        errorMessage,
        isConcluding,
      });
    }
  }

  renderer = createSessionRenderer({
    container: liveContainer,
    onSetFieldChange: (sessionId, setId, fields) => {
      if (isConcluding) return;
      errorMessage = "";
      if (renderer) {
        renderer.updateErrorMessage("");
      }
      // Update in-memory state
      for (const ex of activeExercises) {
        const targetSet = (ex.exercise_sets || []).find((s) => s.id === setId);
        if (targetSet) {
          Object.assign(targetSet, fields);
          break;
        }
      }
      autosave.queueSetEdit(sessionId, setId, fields);
    },
    onSetFieldBlur: (sessionId, setId) => {
      if (isConcluding) return;
      void autosave.flushPendingEdits(sessionId);
    },
    onAddSet: async (sessionExerciseId) => {
      if (isConcluding) return;
      await addSet(sessionExerciseId);
    },
    onRemoveSet: async (sessionExerciseId, setId) => {
      if (isConcluding) return;
      await removeSet(sessionExerciseId, setId);
    },
    onAddExercise: () => {
      if (isConcluding) return;
      openAddExercisePicker();
    },
    onRemoveExercise: async (sessionExerciseId) => {
      if (isConcluding) return;
      await removeExercise(sessionExerciseId);
    },
    onReorderExercise: async (sessionExerciseId, direction) => {
      if (isConcluding) return;
      await reorderExercise(sessionExerciseId, direction);
    },
    onEquipmentChange: async (sessionExerciseId, equipmentId) => {
      if (isConcluding) return;
      await changeEquipment(sessionExerciseId, equipmentId);
    },
    onCreateEquipment: async (sessionExerciseId, gymId, name) => {
      if (isConcluding) return;
      await createEquipment(sessionExerciseId, gymId, name);
    },
    onConcludeSession: async () => {
      if (isConcluding) return;
      await concludeActiveSession();
    },
    onCancelSession: () => {
      if (isConcluding) return;
      openCancelConfirmation();
    },
  });

  async function loadGyms(force = false) {
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId) return [];
    if (gyms.length && !force) return gyms;

    const [gymResult, equipResult] = await Promise.all([
      supabase.from("gyms").select("id, name, created_at").eq("owner_id", userId).order("name", { ascending: true }),
      supabase
        .from("equipment")
        .select("id, name, kind, is_active, equipment_gym_availability(gym_id)")
        .eq("owner_id", userId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
    ]);

    if (gymResult.data) gyms = gymResult.data;
    if (equipResult.data) {
      equipmentByGym = buildEquipmentByGym(gyms, equipResult.data);
    }
    return gyms;
  }

  async function loadEquipmentOptionsForExercises() {
    if (!activeSession || !activeExercises.length) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId) return;

    equipmentOptionsByExercise.clear();
    const uniqueExerciseIds = [...new Set(activeExercises.map((e) => e.exercise_id))];

    try {
      const { data, error } = await supabase
        .from("session_exercises")
        .select(`
          exercise_id,
          canonical_equipment_id,
          equipment_name_snapshot,
          equipment(id, name, kind, is_active),
          workout_sessions!inner(
            id,
            owner_id,
            gym_id,
            performed_on,
            status,
            created_at
          )
        `)
        .eq("workout_sessions.owner_id", userId)
        .eq("workout_sessions.gym_id", activeSession.gym_id)
        .eq("workout_sessions.status", "completed")
        .in("exercise_id", uniqueExerciseIds)
        .not("canonical_equipment_id", "is", null)
        .order("performed_on", { foreignTable: "workout_sessions", ascending: false })
        .order("created_at", { foreignTable: "workout_sessions", ascending: false })
        .order("id", { foreignTable: "workout_sessions", ascending: false });

      if (!error && data) {
        for (const exId of uniqueExerciseIds) {
          const exerciseRows = data.filter((row) => row.exercise_id === exId);
          const seenIds = new Set();
          const options = [];
          for (const row of exerciseRows) {
            if (!row.canonical_equipment_id || seenIds.has(row.canonical_equipment_id)) continue;
            seenIds.add(row.canonical_equipment_id);
            const eq = row.equipment;
            if (eq && eq.is_active) {
              options.push({ id: eq.id, name: eq.name, kind: eq.kind, is_active: true });
            } else if (eq?.name || row.equipment_name_snapshot) {
              options.push({ id: row.canonical_equipment_id, name: eq?.name || row.equipment_name_snapshot, is_active: false });
            }
          }
          equipmentOptionsByExercise.set(exId, options);
        }
      }
    } catch {
      // Fallback
    }
  }

  async function loadActiveSession() {
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId) return null;

    const { data: sessionData, error: sessionError } = await supabase
      .from("workout_sessions")
      .select("id, owner_id, gym_id, performed_on, status, source_preset_id, source_preset_name, created_at")
      .eq("owner_id", userId)
      .eq("status", "in_progress")
      .limit(1)
      .maybeSingle();

    if (sessionError || !sessionData) {
      activeSession = null;
      activeExercises = [];
      return null;
    }

    // A reopened completed session is a correction of history, not a new workout.
    activeSession = {
      ...sessionData,
      is_history_correction: await isReopenedCorrection(supabase, userId, sessionData.id),
    };
    await loadGyms();

    const { data: exerciseData, error: exerciseError } = await supabase
      .from("session_exercises")
      .select(`
        id,
        session_id,
        exercise_order,
        exercise_id,
        canonical_equipment_id,
        equipment_name_snapshot,
        equipment(id, name, kind),
        exercises(id, name),
        exercise_sets(
          id,
          set_number,
          weight,
          reps,
          is_warmup,
          reported_rir_bucket,
          rir_source
        )
      `)
      .eq("session_id", activeSession.id)
      .eq("owner_id", userId)
      .order("exercise_order", { ascending: true });

    if (exerciseError) {
      errorMessage = `Could not load workout exercises: ${exerciseError.message}`;
      return activeSession;
    }

    activeExercises = exerciseData || [];

    // Reconcile pending local edits
    const pendingEdits = storage.getPendingSetEdits(activeSession.id);
    for (const pending of pendingEdits) {
      for (const ex of activeExercises) {
        const set = (ex.exercise_sets || []).find((s) => s.id === pending.setId);
        if (set) {
          Object.assign(set, pending.fields);
        }
      }
    }

    // Recover durable edits without delaying rendering of the recovered workout.
    if (pendingEdits.length > 0) {
      const sessionId = activeSession.id;
      // Yield once so load() can finish presenting the recovered workout first.
      setTimeout(() => {
        if (activeSession && activeSession.id === sessionId) {
          void autosave.retryPendingWrites(sessionId);
        }
      }, 0);
    }

    // Load exercise-specific equipment options and history context
    await Promise.all([
      loadEquipmentOptionsForExercises(),
      refreshHistoryContext(),
    ]);

    renderCurrent();
    return activeSession;
  }

  async function refreshHistoryContext() {
    if (!activeSession) return;
    historyContextByExercise.clear();
    const promises = activeExercises.map(async (ex) => {
      const history = await historyContext.fetchPreviousPerformance(
        activeSession.gym_id,
        ex.exercise_id,
        ex.canonical_equipment_id,
        activeSession.id
      );
      historyContextByExercise.set(ex.id, history);
    });
    await Promise.all(promises);
  }

  async function addSet(sessionExerciseId) {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    const exercise = activeExercises.find((e) => e.id === sessionExerciseId);
    if (!exercise) return;

    const currentSets = exercise.exercise_sets || [];
    const nextSetNumber = currentSets.length + 1;

    try {
      const { data, error } = await supabase
        .from("exercise_sets")
        .insert({
          owner_id: userId,
          session_exercise_id: sessionExerciseId,
          set_number: nextSetNumber,
          weight: null,
          reps: null,
          is_warmup: false,
          reported_rir_bucket: null,
          rir_source: null,
        })
        .select()
        .single();

      if (error) throw error;
      currentSets.push(data);
      renderCurrent();
    } catch (error) {
      errorMessage = `Could not add set: ${error.message}`;
      await loadActiveSession();
      renderCurrent();
    }
  }

  async function removeSet(sessionExerciseId, setId) {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    try {
      const { error: rpcError } = await supabase.rpc("remove_exercise_set", {
        p_set_id: setId,
      });

      if (rpcError) throw rpcError;

      // Discard pending edits from autosave and storage after RPC succeeds
      autosave.discardPendingSet(activeSession.id, setId);
    } catch (error) {
      errorMessage = `Could not delete set: ${error.message}`;
      renderCurrent();
      return;
    }

    try {
      await loadActiveSession();
    } catch (error) {
      errorMessage = `Set deleted, but could not refresh workout: ${error.message}`;
      renderCurrent();
    }
  }

  async function addExerciseToActiveSession(exerciseId) {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    try {
      const { data, error: rpcError } = await supabase.rpc("add_session_exercise", {
        p_session_id: activeSession.id,
        p_exercise_id: exerciseId,
        p_equipment_id: null,
      });

      if (rpcError) throw rpcError;
    } catch (error) {
      errorMessage = `Could not add exercise: ${error.message}`;
      renderCurrent();
      return;
    }

    try {
      await loadActiveSession();
    } catch (error) {
      errorMessage = `Exercise added, but could not refresh workout: ${error.message}`;
      renderCurrent();
    }
  }

  async function removeExercise(sessionExerciseId) {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    const exercise = activeExercises.find((e) => e.id === sessionExerciseId);
    if (!exercise) return;

    const hasData = (exercise.exercise_sets || []).some((s) => s.weight !== null || s.reps !== null);
    if (hasData) {
      const confirmDelete = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(`Remove ${exercise.exercises?.name || "this exercise"} and its entered data?`)
        : true;
      if (!confirmDelete) return;
    }

    try {
      const { error: rpcError } = await supabase.rpc("remove_session_exercise", {
        p_session_exercise_id: sessionExerciseId,
      });

      if (rpcError) throw rpcError;

      // Discard all child sets from autosave and storage after deletion RPC succeeds
      for (const set of exercise.exercise_sets || []) {
        autosave.discardPendingSet(activeSession.id, set.id);
      }
    } catch (error) {
      errorMessage = `Could not remove exercise: ${error.message}`;
      renderCurrent();
      return;
    }

    try {
      await loadActiveSession();
    } catch (error) {
      errorMessage = `Exercise removed, but could not refresh workout: ${error.message}`;
      renderCurrent();
    }
  }

  async function reorderExercise(sessionExerciseId, direction) {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    const sorted = [...activeExercises].sort((a, b) => a.exercise_order - b.exercise_order);
    const currentIndex = sorted.findIndex((e) => e.id === sessionExerciseId);
    if (currentIndex === -1) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;

    const temp = sorted[currentIndex];
    sorted[currentIndex] = sorted[targetIndex];
    sorted[targetIndex] = temp;

    const newOrderIds = sorted.map((e) => e.id);

    try {
      const { error } = await supabase.rpc("reorder_session_exercises", {
        p_session_id: activeSession.id,
        p_exercise_ids: newOrderIds,
      });

      if (error) throw error;
      await loadActiveSession();
    } catch (error) {
      errorMessage = `Could not reorder exercises: ${error.message}`;
      await loadActiveSession();
      renderCurrent();
    }
  }

  async function changeEquipment(sessionExerciseId, equipmentId) {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    const exercise = activeExercises.find((e) => e.id === sessionExerciseId);
    if (!exercise) return;

    let snapshotName = null;
    let selectedEquipment = null;
    if (equipmentId) {
      const gymEquips = equipmentByGym.get(activeSession.gym_id) || [];
      const historicalEquips = equipmentOptionsByExercise.get(exercise.exercise_id) || [];
      selectedEquipment = [...gymEquips, ...historicalEquips].find((item) => item.id === equipmentId) || null;
      snapshotName = selectedEquipment ? selectedEquipment.name : null;
    }

    try {
      const { error } = await supabase
        .from("session_exercises")
        .update({
          canonical_equipment_id: equipmentId,
          equipment_name_snapshot: snapshotName,
        })
        .eq("id", sessionExerciseId)
        .eq("owner_id", userId);

      if (error) throw error;

      exercise.canonical_equipment_id = equipmentId;
      exercise.equipment_name_snapshot = snapshotName;
      exercise.equipment = selectedEquipment
        ? { id: selectedEquipment.id, name: selectedEquipment.name, kind: selectedEquipment.kind ?? null }
        : null;

      const history = await historyContext.fetchPreviousPerformance(
        activeSession.gym_id,
        exercise.exercise_id,
        equipmentId,
        activeSession.id
      );
      historyContextByExercise.set(exercise.id, history);
      renderCurrent();
    } catch (error) {
      errorMessage = `Could not update equipment: ${error.message}`;
      renderCurrent();
    }
  }

  async function createEquipment(sessionExerciseId, gymId, name) {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    try {
      const { data, error } = await supabase.rpc("create_or_get_equipment", {
        p_name: name,
        p_gym_id: gymId,
      });
      if (error) throw error;

      await loadGyms(true);
      await loadEquipmentOptionsForExercises();
      await changeEquipment(sessionExerciseId, data.id);
    } catch (error) {
      errorMessage = `Could not create machine: ${error.message}`;
      renderCurrent();
    }
  }

  async function concludeActiveSession() {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    // Check for draft sets locally first
    const hasLocalDraft = activeExercises.some((ex) => (ex.exercise_sets || []).some(isDraftSet));
    if (hasLocalDraft) {
      errorMessage = "Cannot conclude session: complete or remove partially entered draft sets first.";
      renderCurrent();
      return;
    }

    isConcluding = true;
    errorMessage = "";
    renderCurrent();

    try {
      // 1. Flush pending autosaves
      const flushSuccess = await autosave.flushPendingEdits(activeSession.id);
      const remainingPending = storage.getPendingSetEdits(activeSession.id);
      if (!flushSuccess || remainingPending.length > 0) {
        throw new Error(
          autosave.getSyncState() === SYNC_STATE.OFFLINE
            ? "Cannot conclude session while offline. Changes are saved on this device."
            : "Cannot conclude session: one or more changes failed to save to the server."
        );
      }

      // 2. Call server-side atomic conclusion
      const { data, error } = await supabase.rpc("conclude_workout_session", {
        p_session_id: activeSession.id,
      });

      if (error) throw error;

      // Only clear storage if no pending edits were added
      const postRpcPending = storage.getPendingSetEdits(activeSession.id);
      if (postRpcPending.length === 0) {
        storage.clearPendingSessionEdits(activeSession.id);
      }

      const concludedSessionId = activeSession.id;
      const wasHistoryCorrection = activeSession.is_history_correction === true;
      historyContext.clearCache();
      activeSession = null;
      activeExercises = [];
      historyContextByExercise.clear();
      equipmentOptionsByExercise.clear();
      isConcluding = false;

      if (onSessionConcluded) {
        onSessionConcluded(concludedSessionId, { wasHistoryCorrection });
      }
    } catch (error) {
      isConcluding = false;
      errorMessage = error.message.includes("incomplete drafts")
        ? "Cannot conclude session: one or more sets are incomplete drafts. Please complete or delete them."
        : `Could not conclude session: ${error.message}`;
      renderCurrent();
    }
  }

  function getCancelCopy() {
    if (activeSession?.is_history_correction) {
      return {
        title: "Discard these corrections?",
        message: "The completed workout will be restored exactly as it was before you reopened it.",
        keep: "Keep editing",
        confirm: "Discard corrections",
      };
    }
    return {
      title: "Cancel this workout?",
      message: "Your in-progress workout session and all logged set data will be discarded.",
      keep: "Keep workout",
      confirm: "Cancel workout",
    };
  }

  function openCancelConfirmation() {
    if (isConcluding) return;
    const copy = getCancelCopy();
    const cancelModal = typeof document !== "undefined" ? document.querySelector("#cancel-workout-modal") : null;
    if (cancelModal) {
      const keepBtn = cancelModal.querySelector("#keep-workout-button");
      const confirmBtn = cancelModal.querySelector("#confirm-cancel-workout-button");
      const titleEl = cancelModal.querySelector("#cancel-workout-title");
      const messageEl = cancelModal.querySelector(".cancel-workout-message");
      if (titleEl) titleEl.textContent = copy.title;
      if (messageEl) messageEl.textContent = copy.message;
      if (keepBtn) keepBtn.textContent = copy.keep;
      if (confirmBtn) confirmBtn.textContent = copy.confirm;

      if (keepBtn) {
        keepBtn.onclick = () => {
          cancelModal.close();
        };
      }
      if (confirmBtn) {
        confirmBtn.onclick = async () => {
          cancelModal.close();
          await cancelActiveWorkoutSession();
        };
      }
      cancelModal.showModal();
    } else {
      const confirmed = window.confirm(`${copy.title} ${copy.message}`);
      if (confirmed) {
        void cancelActiveWorkoutSession();
      }
    }
  }

  async function cancelActiveWorkoutSession() {
    if (isConcluding) return;
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || !activeSession) return;

    const targetSessionId = activeSession.id;
    // The server restores a reopened completed session instead of deleting it.
    const restoredCompletedSession = activeSession.is_history_correction === true;

    // 1. Abort pending autosave timers and requests immediately so no delayed write fires during cancellation
    autosave.abort();

    // 2. Invoke server cancellation RPC while preserving local pending mutations
    try {
      const { error } = await supabase.rpc("cancel_workout_session", {
        p_session_id: targetSessionId,
      });

      if (error) throw error;

      // 3. Only after successful RPC confirmation:
      // - clear local pending mutations for the session
      storage.clearPendingSessionEdits(targetSessionId);

      // - clear active in-memory state
      activeSession = null;
      activeExercises = [];
      historyContextByExercise.clear();
      equipmentOptionsByExercise.clear();
      errorMessage = "";

      if (liveContainer) liveContainer.replaceChildren();

      if (onSessionCancelled) {
        onSessionCancelled(targetSessionId, { restoredCompletedSession });
      }
      if (onNavigate) {
        onNavigate(restoredCompletedSession ? "session-history" : "home");
      }
    } catch (error) {
      // 4. If cancellation fails:
      // - do NOT clear locally persisted workout edits
      // - keep the active workout open
      // - restore retained edits to the existing autosave reconciliation path
      // - surface an error to the user
      errorMessage = restoredCompletedSession
        ? `Could not discard corrections: ${error.message}`
        : `Could not cancel workout: ${error.message}`;
      if (activeSession && activeSession.id === targetSessionId) {
        await autosave.retryPendingWrites(targetSessionId);
      }
      renderCurrent();
    }
  }

  async function openAddExercisePicker() {
    const modal = document.querySelector("#add-exercise-modal");
    const searchInput = document.querySelector("#add-exercise-search");
    const resultsList = document.querySelector("#add-exercise-results");
    const closeBtn = document.querySelector("#close-add-exercise-modal");

    if (!modal || !resultsList) return;

    const supabase = getClient();
    const userId = getUserId();

    const [catalogue, recentExerciseIds] = await Promise.all([
      ensureExerciseCatalogue(),
      fetchRecentExerciseIds(supabase, userId, 8),
    ]);

    function createExerciseItem(ex) {
      const li = document.createElement("li");
      li.className = "catalogue-exercise-item";

      const span = document.createElement("span");
      span.className = "catalogue-exercise-name";
      span.textContent = ex.name;

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "secondary-button compact catalogue-add-btn";
      addBtn.textContent = "+ Add";
      addBtn.setAttribute("aria-label", `Add ${ex.name}`);

      addBtn.addEventListener("click", () => {
        addBtn.textContent = "Added ✓";
        addBtn.classList.add("is-added");
        void addExerciseToActiveSession(ex.id);
        window.setTimeout(() => {
          addBtn.textContent = "+ Add";
          addBtn.classList.remove("is-added");
        }, 1500);
      });

      li.append(span, addBtn);
      return li;
    }

    function renderList(query = "") {
      const frag = document.createDocumentFragment();
      const trimmed = query.trim().toLowerCase();

      if (trimmed) {
        const matches = catalogue.filter((ex) => ex.name.toLowerCase().includes(trimmed));
        if (matches.length === 0) {
          const noRes = document.createElement("li");
          noRes.className = "catalogue-no-results";
          noRes.textContent = `No exercises match “${query}”`;
          frag.append(noRes);
        } else {
          for (const ex of matches) {
            frag.append(createExerciseItem(ex));
          }
        }
      } else {
        const recentExercises = (recentExerciseIds || [])
          .map((id) => catalogue.find((ex) => ex.id === id))
          .filter(Boolean);

        if (recentExercises.length > 0) {
          const recentHeader = document.createElement("li");
          recentHeader.className = "catalogue-section-header";
          recentHeader.textContent = "Recent";
          frag.append(recentHeader);

          for (const ex of recentExercises) {
            frag.append(createExerciseItem(ex));
          }

          const allHeader = document.createElement("li");
          allHeader.className = "catalogue-section-header";
          allHeader.textContent = "All exercises";
          frag.append(allHeader);
        }

        for (const ex of catalogue) {
          frag.append(createExerciseItem(ex));
        }
      }

      resultsList.replaceChildren(frag);
    }

    renderList();
    if (searchInput) {
      searchInput.value = "";
      searchInput.oninput = () => renderList(searchInput.value);
    }
    if (closeBtn) {
      closeBtn.onclick = () => modal.close();
    }
    modal.showModal();
    searchInput?.focus();
  }

  // Wizard Methods
  async function openCreationWizard() {
    selectedGymId = null;
    selectedPresetId = null;
    await loadGyms(true);
    await showWizardGymStep();
  }

  async function showWizardGymStep() {
    if (!wizardModal) return;
    wizardModal.replaceChildren();

    const supabase = getClient();
    const userId = getUserId();
    const recentGymIds = await fetchRecentGymIds(supabase, userId, 3);

    const container = document.createElement("div");
    container.className = "session-wizard-card wizard-gym-card";

    const title = document.createElement("h2");
    title.textContent = "Select Gym";

    const desc = document.createElement("p");
    desc.className = "wizard-desc";
    desc.textContent = "Choose your gym context to automatically match machines and track gym-specific history.";

    container.append(title, desc);

    function createGymButton(gym) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wizard-gym-button";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = gym.name;

      const arrowSpan = document.createElement("span");
      arrowSpan.className = "wizard-gym-arrow";
      arrowSpan.setAttribute("aria-hidden", "true");
      arrowSpan.textContent = "›";

      btn.append(nameSpan, arrowSpan);
      btn.addEventListener("click", () => {
        selectedGymId = gym.id;
        showWizardPresetStep();
      });
      li.append(btn);
      return li;
    }

    const recentGyms = (recentGymIds || [])
      .map((id) => gyms.find((g) => g.id === id))
      .filter(Boolean);

    if (recentGyms.length > 0 && gyms.length > 1) {
      const recentHeading = document.createElement("h3");
      recentHeading.className = "wizard-section-title";
      recentHeading.textContent = "Recent";
      container.append(recentHeading);

      const recentList = document.createElement("ul");
      recentList.className = "wizard-gym-list";
      for (const gym of recentGyms) {
        recentList.append(createGymButton(gym));
      }
      container.append(recentList);

      const allHeading = document.createElement("h3");
      allHeading.className = "wizard-section-title";
      allHeading.textContent = "All Gyms";
      container.append(allHeading);
    }

    const gymList = document.createElement("ul");
    gymList.className = "wizard-gym-list";
    for (const gym of gyms) {
      gymList.append(createGymButton(gym));
    }
    container.append(gymList);

    // De-emphasized Add New Gym section
    const addGymSection = document.createElement("div");
    addGymSection.className = "wizard-add-gym-section";

    const toggleNewGymBtn = document.createElement("button");
    toggleNewGymBtn.type = "button";
    toggleNewGymBtn.className = "text-button wizard-toggle-add-gym";
    toggleNewGymBtn.textContent = "+ Add new gym";

    const newGymForm = document.createElement("form");
    newGymForm.className = "wizard-new-gym-form";
    newGymForm.hidden = true;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Enter gym name…";
    input.required = true;
    input.className = "live-input";

    const formActions = document.createElement("div");
    formActions.className = "wizard-form-actions";

    const addGymBtn = document.createElement("button");
    addGymBtn.type = "submit";
    addGymBtn.className = "primary-button compact";
    addGymBtn.textContent = "Add Gym";

    const cancelAddGymBtn = document.createElement("button");
    cancelAddGymBtn.type = "button";
    cancelAddGymBtn.className = "text-button";
    cancelAddGymBtn.textContent = "Cancel";
    cancelAddGymBtn.addEventListener("click", () => {
      newGymForm.hidden = true;
      newGymForm.reset();
      toggleNewGymBtn.hidden = false;
    });

    toggleNewGymBtn.addEventListener("click", () => {
      toggleNewGymBtn.hidden = true;
      newGymForm.hidden = false;
      input.focus();
    });

    formActions.append(addGymBtn, cancelAddGymBtn);
    newGymForm.append(input, formActions);

    newGymForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      const { data, error } = await supabase
        .from("gyms")
        .insert({ owner_id: userId, name: val })
        .select()
        .single();
      if (data) {
        await loadGyms(true);
        selectedGymId = data.id;
        showWizardPresetStep();
      }
    });

    addGymSection.append(toggleNewGymBtn, newGymForm);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "text-button wizard-close-btn";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => wizardModal.close());

    container.append(addGymSection, closeBtn);
    wizardModal.replaceChildren(container);
    if (!wizardModal.open) wizardModal.showModal();
  }

  async function showWizardPresetStep() {
    if (!wizardModal) return;
    wizardModal.replaceChildren();

    const container = document.createElement("div");
    container.className = "session-wizard-card wizard-preset-card";

    const title = document.createElement("h2");
    title.textContent = "Select Workout";

    const desc = document.createElement("p");
    desc.className = "wizard-desc";
    desc.textContent = "Start from an existing preset or build from scratch.";

    const supabase = getClient();
    const userId = getUserId();
    const { data: presets } = await supabase
      .from("workout_presets")
      .select("id, name, workout_preset_exercises(exercise_id, set_count)")
      .eq("owner_id", userId)
      .order("name", { ascending: true });

    const presetList = document.createElement("ul");
    presetList.className = "wizard-preset-list";

    for (const preset of presets || []) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wizard-preset-button";

      const infoDiv = document.createElement("div");
      infoDiv.className = "wizard-preset-info";

      const name = document.createElement("strong");
      name.className = "wizard-preset-name";
      name.textContent = preset.name;

      const count = document.createElement("span");
      count.className = "wizard-preset-count";
      const exCount = (preset.workout_preset_exercises || []).length;
      count.textContent = `${exCount} ${exCount === 1 ? "exercise" : "exercises"}`;

      infoDiv.append(name, count);

      const arrowSpan = document.createElement("span");
      arrowSpan.className = "wizard-preset-arrow";
      arrowSpan.setAttribute("aria-hidden", "true");
      arrowSpan.textContent = "›";

      btn.append(infoDiv, arrowSpan);
      btn.addEventListener("click", () => {
        selectedPresetId = preset.id;
        void createSessionAndLaunch(selectedGymId, selectedPresetId);
      });
      li.append(btn);
      presetList.append(li);
    }

    const scratchBtn = document.createElement("button");
    scratchBtn.type = "button";
    scratchBtn.className = "secondary-button wizard-scratch-button";
    scratchBtn.textContent = "Start empty workout";
    scratchBtn.addEventListener("click", () => {
      void createSessionAndLaunch(selectedGymId, null);
    });

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "text-button wizard-back-btn";
    backBtn.textContent = "← Back to Gyms";
    backBtn.addEventListener("click", () => void showWizardGymStep());

    container.append(title, desc, presetList, scratchBtn, backBtn);
    wizardModal.replaceChildren(container);
  }

  async function reopenCompletedSession(sessionId) {
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId) throw new Error("You are no longer signed in.");
    // The server enforces this too; checking first avoids a doomed request.
    if (activeSession) throw new Error(ACTIVE_WORKOUT_CONFLICT_MESSAGE);

    await reopenCompletedWorkoutSession(supabase, sessionId);
    historyContext.clearCache();
    const session = await loadActiveSession();
    if (onNavigate) onNavigate("live-session");
    return session;
  }

  async function createSessionAndLaunch(gymId, presetId) {
    const supabase = getClient();
    if (!supabase) return;

    if (wizardModal && wizardModal.open) wizardModal.close();

    try {
      const { data, error } = await supabase.rpc("start_or_resume_workout_session", {
        p_gym_id: gymId,
        p_preset_id: presetId,
      });

      if (error) throw error;
      await loadActiveSession();
      if (onNavigate) onNavigate("live-session");
    } catch (error) {
      alert(`Could not start workout: ${error.message}`);
    }
  }

  return {
    getActiveSession() {
      return activeSession;
    },
    getActiveExercises() {
      return activeExercises;
    },
    getErrorMessage() {
      return errorMessage;
    },
    async load() {
      return await loadActiveSession();
    },
    openStartWizard(presetId = null, presetName = null) {
      if (activeSession) {
        if (onNavigate) onNavigate("live-session");
      } else {
        void openCreationWizard();
      }
    },
    async addExercise(exerciseId) {
      await addExerciseToActiveSession(exerciseId);
    },
    async removeExercise(sessionExerciseId) {
      await removeExercise(sessionExerciseId);
    },
    async addSet(sessionExerciseId) {
      await addSet(sessionExerciseId);
    },
    async removeSet(sessionExerciseId, setId) {
      await removeSet(sessionExerciseId, setId);
    },
    async concludeSession() {
      await concludeActiveSession();
    },
    async cancelSession() {
      await cancelActiveWorkoutSession();
    },
    async reopenSession(sessionId) {
      return await reopenCompletedSession(sessionId);
    },
    reset() {
      historyContext.clearCache();
      activeSession = null;
      activeExercises = [];
      gyms = [];
      equipmentByGym.clear();
      equipmentOptionsByExercise.clear();
      historyContextByExercise.clear();
      errorMessage = "";
      isConcluding = false;
      if (wizardModal && wizardModal.open) wizardModal.close();
      if (liveContainer) liveContainer.replaceChildren();
    },
  };
}
