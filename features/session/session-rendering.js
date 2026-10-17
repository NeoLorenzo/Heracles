import {
  formatPreviousPerformanceSummary,
  formatPreviousSetBadge,
  formatInlinePreviousSet,
} from "./session-history-context.js";
import { isCompletedSet, usesPerDumbbellLoad } from "../../set-model.js";

export function parseWorkoutWeightInput(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (value === "") return { valid: true, value: null };

  const normalizedValue = value.replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizedValue)) {
    return { valid: false, value: null };
  }

  const numericValue = Number(normalizedValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return { valid: false, value: null };
  }

  return { valid: true, value: numericValue };
}

function formatDateLong(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(year, month - 1, day));
}

function formatWeightUnit(exerciseName, equipmentName = null) {
  return usesPerDumbbellLoad({ equipmentName, exerciseName }) ? "kg per dumbbell" : "kg";
}

function createRirSelect(sessionId, set, onSetFieldChange, onSetFieldBlur) {
  const container = document.createElement("div");
  container.className = "live-rir-control";

  const rirSelect = document.createElement("select");
  rirSelect.className = "live-select rir-select";
  rirSelect.setAttribute("aria-label", `Set ${set.set_number} RIR`);

  const rirChoices = [
    ["", "—"],
    ["0", "0"],
    ["1", "1"],
    ["2", "2"],
    ["3", "3"],
    ["4", "4+"],
  ];

  for (const [val, label] of rirChoices) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    if (
      val !== "" &&
      set.reported_rir_bucket !== null &&
      set.reported_rir_bucket !== undefined &&
      Number(val) === Number(set.reported_rir_bucket)
    ) {
      opt.selected = true;
    }
    rirSelect.append(opt);
  }

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "live-rir-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `Set ${set.set_number} RIR`);

  function updateTriggerDisplay() {
    const bucket = set.reported_rir_bucket;
    if (bucket === null || bucket === undefined || bucket === "") {
      trigger.textContent = "—";
      trigger.classList.remove("has-value");
    } else {
      trigger.textContent = Number(bucket) === 4 ? "4+" : String(bucket);
      trigger.classList.add("has-value");
    }
  }
  updateTriggerDisplay();

  const menu = document.createElement("div");
  menu.className = "live-rir-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  for (const [val, label] of rirChoices) {
    const choiceBtn = document.createElement("button");
    choiceBtn.type = "button";
    choiceBtn.className = `live-rir-choice ${val === "" ? "is-clear" : ""}`;
    choiceBtn.setAttribute("role", "menuitem");
    choiceBtn.textContent = label;
    if (
      (val === "" && (set.reported_rir_bucket === null || set.reported_rir_bucket === undefined)) ||
      (val !== "" && Number(val) === Number(set.reported_rir_bucket))
    ) {
      choiceBtn.classList.add("is-selected");
    }

    choiceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const numVal = val === "" ? null : Number(val);
      set.reported_rir_bucket = numVal;
      set.rir_source = numVal !== null ? "user_entered" : null;
      rirSelect.value = val;
      updateTriggerDisplay();
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");

      onSetFieldChange(sessionId, set.id, {
        reported_rir_bucket: numVal,
        rir_source: numVal !== null ? "user_entered" : null,
      });
      onSetFieldBlur(sessionId, set.id);
    });

    menu.append(choiceBtn);
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isExpanded = trigger.getAttribute("aria-expanded") === "true";
    if (isExpanded) {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    } else {
      document.querySelectorAll(".live-rir-menu:not([hidden])").forEach((m) => {
        m.hidden = true;
        m.parentElement?.querySelector(".live-rir-trigger")?.setAttribute("aria-expanded", "false");
      });
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    }
  });

  rirSelect.addEventListener("change", () => {
    const val = rirSelect.value === "" ? null : Number(rirSelect.value);
    set.reported_rir_bucket = val;
    set.rir_source = val !== null ? "user_entered" : null;
    updateTriggerDisplay();
    onSetFieldChange(sessionId, set.id, {
      reported_rir_bucket: val,
      rir_source: val !== null ? "user_entered" : null,
    });
    onSetFieldBlur(sessionId, set.id);
  });

  container.append(trigger, menu, rirSelect);
  return container;
}

export function createSessionRenderer(options) {
  const {
    container,
    onSetFieldChange,
    onSetFieldBlur,
    onAddSet,
    onRemoveSet,
    onAddExercise,
    onRemoveExercise,
    onReorderExercise,
    onEquipmentChange,
    onCreateEquipment,
    onConcludeSession,
    onCancelSession,
  } = options;

  // Global dismiss for menus
  if (typeof document !== "undefined" && !document._sessionMenuDismissBound && typeof document.addEventListener === "function") {
    document.addEventListener("click", (e) => {
      const openRir = document.querySelectorAll(".live-rir-menu:not([hidden])");
      for (const m of openRir) {
        if (!m.parentElement?.contains(e.target)) {
          m.hidden = true;
          m.parentElement?.querySelector(".live-rir-trigger")?.setAttribute("aria-expanded", "false");
        }
      }
      const openExMenus = document.querySelectorAll(".live-exercise-menu:not([hidden])");
      for (const m of openExMenus) {
        if (!m.parentElement?.contains(e.target)) {
          m.hidden = true;
          m.parentElement?.querySelector(".live-exercise-menu-button")?.setAttribute("aria-expanded", "false");
        }
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const openMenus = document.querySelectorAll(".live-rir-menu:not([hidden]), .live-exercise-menu:not([hidden])");
        for (const m of openMenus) {
          m.hidden = true;
          m.parentElement?.querySelector("button[aria-expanded='true']")?.setAttribute("aria-expanded", "false");
        }
      }
    });
    document._sessionMenuDismissBound = true;
  }

  return {
    updateSyncBadge(syncState, syncLabel) {
      if (!container) return;
      const badge = container.querySelector(".live-sync-badge");
      if (badge) {
        badge.className = `live-sync-badge sync-state-${syncState || "saved"}`;
        badge.textContent = syncLabel || "Saved ✓";
      }
    },

    updateErrorMessage(errorMessage) {
      if (!container) return;
      let errorBanner = container.querySelector(".live-error-banner");
      if (errorMessage) {
        if (!errorBanner) {
          const header = container.querySelector(".live-session-header");
          if (header) {
            errorBanner = document.createElement("div");
            errorBanner.className = "live-error-banner";
            errorBanner.setAttribute("role", "alert");
            header.append(errorBanner);
          }
        }
        if (errorBanner) {
          errorBanner.textContent = errorMessage;
          errorBanner.hidden = false;
        }
      } else if (errorBanner) {
        errorBanner.remove();
      }
    },

    renderLiveSession(state) {
      if (!container) return;
      container.replaceChildren();

      const {
        session,
        exercises,
        gyms,
        equipmentByGym,
        equipmentOptionsByExercise,
        historyContextByExercise,
        syncLabel,
        syncState,
        errorMessage,
        isConcluding,
      } = state;

      const currentGym = gyms.find((g) => String(g.id) === String(session.gym_id));
      const gymName = currentGym ? currentGym.name : "Gym";
      const sessionTitle = session.source_preset_name || "Live Workout";

      // Top in-page header
      const header = document.createElement("header");
      header.className = "live-session-header";

      const titleRow = document.createElement("div");
      titleRow.className = "live-session-title-row";

      const titleLockup = document.createElement("div");
      titleLockup.className = "live-session-title-lockup";

      const title = document.createElement("h1");
      title.className = "live-session-title";
      title.textContent = sessionTitle;
      title.setAttribute("data-page-heading-anchor", "");

      const meta = document.createElement("p");
      meta.className = "live-session-meta";
      meta.textContent = `${gymName} · ${formatDateLong(session.performed_on)}`;

      titleLockup.append(title, meta);

      const syncBadge = document.createElement("span");
      syncBadge.className = `live-sync-badge sync-state-${syncState || "saved"}`;
      syncBadge.textContent = syncLabel || "Saved ✓";
      syncBadge.setAttribute("role", "status");
      syncBadge.setAttribute("aria-live", "polite");

      titleRow.append(titleLockup, syncBadge);
      header.append(titleRow);

      if (errorMessage) {
        const errorBanner = document.createElement("div");
        errorBanner.className = "live-error-banner";
        errorBanner.setAttribute("role", "alert");
        errorBanner.textContent = errorMessage;
        header.append(errorBanner);
      }

      container.append(header);

      const sortedExercises = [...exercises].sort((a, b) => a.exercise_order - b.exercise_order);

      // Check if session is completely empty
      if (sortedExercises.length === 0) {
        const emptyState = document.createElement("div");
        emptyState.className = "live-session-empty";

        const emptyIcon = document.createElement("div");
        emptyIcon.className = "live-empty-icon";
        emptyIcon.setAttribute("aria-hidden", "true");
        emptyIcon.textContent = "🏋️";

        const emptyTitle = document.createElement("h2");
        emptyTitle.className = "live-empty-title";
        emptyTitle.textContent = "No exercises yet";

        const emptyDesc = document.createElement("p");
        emptyDesc.className = "live-empty-desc";
        emptyDesc.textContent = "Add an exercise to start logging this workout.";

        const emptyAddBtn = document.createElement("button");
        emptyAddBtn.type = "button";
        emptyAddBtn.className = "primary-button add-exercise-button";
        emptyAddBtn.textContent = "+ Add exercise";
        emptyAddBtn.addEventListener("click", onAddExercise);

        emptyState.append(emptyIcon, emptyTitle, emptyDesc, emptyAddBtn);
        container.append(emptyState);
      } else {
        // Exercise cards list
        const exerciseList = document.createElement("div");
        exerciseList.className = "live-exercise-list";

        sortedExercises.forEach((exercise, index) => {
          const exerciseCard = document.createElement("section");
          exerciseCard.className = "live-exercise-card";
          exerciseCard.dataset.sessionExerciseId = exercise.id;

          const cardHeader = document.createElement("div");
          cardHeader.className = "live-exercise-card-header";

          const exerciseHeading = document.createElement("h2");
          exerciseHeading.className = "live-exercise-name";
          exerciseHeading.textContent = exercise.exercises?.name || exercise.exercise_name || "Exercise";

          // Overflow menu for exercise actions
          const menuWrapper = document.createElement("div");
          menuWrapper.className = "live-exercise-menu-wrapper";

          const menuBtn = document.createElement("button");
          menuBtn.type = "button";
          menuBtn.className = "icon-button live-exercise-menu-button";
          menuBtn.textContent = "•••";
          menuBtn.title = `Options for ${exerciseHeading.textContent}`;
          menuBtn.setAttribute("aria-label", `Exercise options for ${exerciseHeading.textContent}`);
          menuBtn.setAttribute("aria-haspopup", "menu");
          menuBtn.setAttribute("aria-expanded", "false");

          const menuDropdown = document.createElement("div");
          menuDropdown.className = "live-exercise-menu";
          menuDropdown.setAttribute("role", "menu");
          menuDropdown.hidden = true;

          const upButton = document.createElement("button");
          upButton.type = "button";
          upButton.className = "live-menu-item live-order-up";
          upButton.setAttribute("role", "menuitem");
          upButton.textContent = "↑ Move up";
          upButton.setAttribute("aria-label", `Move ${exerciseHeading.textContent} up`);
          upButton.disabled = index === 0;
          upButton.addEventListener("click", () => {
            menuDropdown.hidden = true;
            menuBtn.setAttribute("aria-expanded", "false");
            onReorderExercise(exercise.id, "up");
          });

          const downButton = document.createElement("button");
          downButton.type = "button";
          downButton.className = "live-menu-item live-order-down";
          downButton.setAttribute("role", "menuitem");
          downButton.textContent = "↓ Move down";
          downButton.setAttribute("aria-label", `Move ${exerciseHeading.textContent} down`);
          downButton.disabled = index === sortedExercises.length - 1;
          downButton.addEventListener("click", () => {
            menuDropdown.hidden = true;
            menuBtn.setAttribute("aria-expanded", "false");
            onReorderExercise(exercise.id, "down");
          });

          const removeButton = document.createElement("button");
          removeButton.type = "button";
          removeButton.className = "live-menu-item live-exercise-remove danger-item";
          removeButton.setAttribute("role", "menuitem");
          removeButton.textContent = "Remove exercise";
          removeButton.setAttribute("aria-label", `Remove ${exerciseHeading.textContent}`);
          removeButton.addEventListener("click", () => {
            menuDropdown.hidden = true;
            menuBtn.setAttribute("aria-expanded", "false");
            onRemoveExercise(exercise.id);
          });

          menuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isExpanded = menuBtn.getAttribute("aria-expanded") === "true";
            if (isExpanded) {
              menuDropdown.hidden = true;
              menuBtn.setAttribute("aria-expanded", "false");
            } else {
              const allMenus = document.querySelectorAll(".live-exercise-menu:not([hidden])");
              for (const m of allMenus) {
                m.hidden = true;
                m.parentElement?.querySelector(".live-exercise-menu-button")?.setAttribute("aria-expanded", "false");
              }
              menuDropdown.hidden = false;
              menuBtn.setAttribute("aria-expanded", "true");
            }
          });

          menuDropdown.append(upButton, downButton, removeButton);
          menuWrapper.append(menuBtn, menuDropdown);
          cardHeader.append(exerciseHeading, menuWrapper);
          exerciseCard.append(cardHeader);

          // Equipment Selector
          const currentEquipmentName = exercise.equipment?.name || exercise.equipment_name_snapshot || null;
          const equipmentRow = document.createElement("div");
          equipmentRow.className = "live-equipment-picker-row";

          const equipmentLabel = document.createElement("label");
          equipmentLabel.className = "live-equipment-label";
          equipmentLabel.textContent = "Machine / Equipment";

          const equipmentSelect = document.createElement("select");
          equipmentSelect.className = "live-equipment-select";
          equipmentSelect.setAttribute("aria-label", `Equipment for ${exerciseHeading.textContent}`);

          const noneOption = document.createElement("option");
          noneOption.value = "";
          noneOption.textContent = "— Select machine / equipment —";
          equipmentSelect.append(noneOption);

          const exerciseEquip = equipmentOptionsByExercise?.get(exercise.exercise_id) || [];
          const historicalEquipList = exerciseEquip.filter((eq) => eq.is_active !== false);
          const historicalIds = new Set(historicalEquipList.map((eq) => String(eq.id)));

          const otherGymEquip = (equipmentByGym.get(session.gym_id) || [])
            .filter((eq) => eq.is_active && !historicalIds.has(String(eq.id)));

          if (historicalEquipList.length > 0) {
            const optGroupHistorical = document.createElement("optgroup");
            optGroupHistorical.label = "Used with this exercise";
            for (const eq of historicalEquipList) {
              const option = document.createElement("option");
              option.value = String(eq.id);
              option.textContent = eq.name;
              if (String(exercise.canonical_equipment_id) === String(eq.id)) {
                option.selected = true;
              }
              optGroupHistorical.append(option);
            }
            equipmentSelect.append(optGroupHistorical);
          }

          if (otherGymEquip.length > 0) {
            const optGroupOther = document.createElement("optgroup");
            optGroupOther.label = historicalEquipList.length > 0 ? "Other equipment at this gym" : "Equipment at this gym";
            for (const eq of otherGymEquip) {
              const option = document.createElement("option");
              option.value = String(eq.id);
              option.textContent = eq.name;
              if (String(exercise.canonical_equipment_id) === String(eq.id)) {
                option.selected = true;
              }
              optGroupOther.append(option);
            }
            equipmentSelect.append(optGroupOther);
          }

          if (
            exercise.canonical_equipment_id &&
            !historicalIds.has(String(exercise.canonical_equipment_id)) &&
            !otherGymEquip.some((eq) => String(eq.id) === String(exercise.canonical_equipment_id))
          ) {
            const option = document.createElement("option");
            option.value = String(exercise.canonical_equipment_id);
            option.textContent = exercise.equipment?.name || exercise.equipment_name_snapshot || "Current machine";
            option.selected = true;
            equipmentSelect.append(option);
          }

          const addOption = document.createElement("option");
          addOption.value = "__ADD_NEW__";
          addOption.textContent = "+ Add new machine…";
          equipmentSelect.append(addOption);

          equipmentSelect.addEventListener("change", (e) => {
            if (e.target.value === "__ADD_NEW__") {
              const newName = window.prompt("Enter the machine model or equipment name (an existing name is reused):");
              if (newName && newName.trim()) {
                onCreateEquipment(exercise.id, session.gym_id, newName.trim());
              } else {
                equipmentSelect.value = exercise.canonical_equipment_id ? String(exercise.canonical_equipment_id) : "";
              }
            } else {
              const selectedId = e.target.value ? Number(e.target.value) : null;
              onEquipmentChange(exercise.id, selectedId);
            }
          });

          equipmentLabel.append(equipmentSelect);
          equipmentRow.append(equipmentLabel);
          exerciseCard.append(equipmentRow);

          // Collapsible Previous Performance Summary
          const historyInfo = historyContextByExercise.get(exercise.id);
          const historySummary = formatPreviousPerformanceSummary(historyInfo, exerciseHeading.textContent, currentEquipmentName);

          const historyCard = document.createElement("div");
          historyCard.className = `live-history-callout ${historySummary.hasHistory ? "has-history" : "no-history"}`;

          if (historySummary.hasHistory) {
            const historyToggle = document.createElement("button");
            historyToggle.type = "button";
            historyToggle.className = "live-history-toggle";
            historyToggle.setAttribute("aria-expanded", "false");

            const historyHeading = document.createElement("strong");
            historyHeading.className = "live-history-heading";
            historyHeading.textContent = historySummary.heading;

            const arrowIcon = document.createElement("span");
            arrowIcon.className = "live-history-arrow";
            arrowIcon.setAttribute("aria-hidden", "true");
            arrowIcon.textContent = "›";

            historyToggle.append(historyHeading, arrowIcon);
            historyCard.append(historyToggle);

            if (historySummary.setList.length > 0) {
              const historySetList = document.createElement("ul");
              historySetList.className = "live-history-sets";
              historySetList.hidden = true;
              for (const setText of historySummary.setList) {
                const li = document.createElement("li");
                li.textContent = setText;
                historySetList.append(li);
              }
              historyCard.append(historySetList);

              historyToggle.addEventListener("click", () => {
                const expanded = historyToggle.getAttribute("aria-expanded") === "true";
                historyToggle.setAttribute("aria-expanded", String(!expanded));
                historySetList.hidden = expanded;
              });
            }
          } else {
            const historyHeading = document.createElement("span");
            historyHeading.className = "live-history-heading";
            historyHeading.textContent = historySummary.heading;
            historyCard.append(historyHeading);
          }
          exerciseCard.append(historyCard);

          // Sets Container (Mobile-first card/grid layout)
          const setsContainer = document.createElement("div");
          setsContainer.className = "live-sets-container";

          const setsList = document.createElement("div");
          setsList.className = "live-sets-list";

          const sortedSets = [...(exercise.exercise_sets || [])].sort((a, b) => a.set_number - b.set_number);

          sortedSets.forEach((set, setIdx) => {
            const row = document.createElement("div");
            row.className = `live-set-row ${set.is_warmup ? "is-warmup-set" : ""}`;
            row.dataset.setId = set.id;

            // Set Top Bar: Set number + Warm-up toggle + Delete button
            const setHeader = document.createElement("div");
            setHeader.className = "live-set-header";

            const setNum = document.createElement("span");
            setNum.className = "cell-set-num live-set-num";
            setNum.textContent = `Set ${set.set_number}`;

            const setHeaderActions = document.createElement("div");
            setHeaderActions.className = "live-set-header-actions";

            // Warm-up toggle
            const warmupLabel = document.createElement("label");
            warmupLabel.className = `live-warmup-toggle ${set.is_warmup ? "is-active" : ""}`;

            const warmupCheckbox = document.createElement("input");
            warmupCheckbox.type = "checkbox";
            warmupCheckbox.className = "live-checkbox warmup-checkbox";
            warmupCheckbox.setAttribute("aria-label", `Set ${set.set_number} warm-up`);
            warmupCheckbox.checked = set.is_warmup === true;

            const warmupText = document.createElement("span");
            warmupText.textContent = "Warm-up";

            warmupLabel.append(warmupCheckbox, warmupText);

            // Delete set action
            const removeSetBtn = document.createElement("button");
            removeSetBtn.type = "button";
            removeSetBtn.className = "icon-button delete-set-btn";
            removeSetBtn.textContent = "×";
            removeSetBtn.title = `Delete Set ${set.set_number}`;
            removeSetBtn.setAttribute("aria-label", `Delete Set ${set.set_number}`);
            removeSetBtn.addEventListener("click", () => onRemoveSet(exercise.id, set.id));

            setHeaderActions.append(warmupLabel, removeSetBtn);
            setHeader.append(setNum, setHeaderActions);
            row.append(setHeader);

            // 3-Column Inputs Grid
            const inputGrid = document.createElement("div");
            inputGrid.className = "live-set-inputs-grid";

            // Weight input
            const weightCol = document.createElement("div");
            weightCol.className = "live-set-field col-weight";

            const weightLabel = document.createElement("label");
            weightLabel.className = "live-field-label";
            weightLabel.textContent = `Weight (${formatWeightUnit(exerciseHeading.textContent, currentEquipmentName)})`;

            const weightInput = document.createElement("input");
            weightInput.type = "text";
            weightInput.inputMode = "decimal";
            weightInput.placeholder = "—";
            weightInput.className = "live-input weight-input";
            weightInput.setAttribute("aria-label", `Set ${set.set_number} weight`);
            weightInput.value = set.weight !== null && set.weight !== undefined ? set.weight : "";
            weightInput.addEventListener("input", () => {
              const parsed = parseWorkoutWeightInput(weightInput.value);
              if (!parsed.valid) {
                weightInput.setAttribute("aria-invalid", "true");
                return;
              }

              weightInput.removeAttribute("aria-invalid");
              set.weight = parsed.value;
              onSetFieldChange(session.id, set.id, { weight: parsed.value });
            });
            weightInput.addEventListener("blur", () => {
              if (!parseWorkoutWeightInput(weightInput.value).valid) {
                weightInput.value = set.weight !== null && set.weight !== undefined ? set.weight : "";
                weightInput.removeAttribute("aria-invalid");
              }
              onSetFieldBlur(session.id, set.id);
            });

            weightCol.append(weightLabel, weightInput);

            // Reps input
            const repsCol = document.createElement("div");
            repsCol.className = "live-set-field col-reps";

            const repsLabel = document.createElement("label");
            repsLabel.className = "live-field-label";
            repsLabel.textContent = "Reps";

            const repsInput = document.createElement("input");
            repsInput.type = "number";
            repsInput.inputMode = "numeric";
            repsInput.step = "1";
            repsInput.min = "0";
            repsInput.placeholder = "—";
            repsInput.className = "live-input reps-input";
            repsInput.setAttribute("aria-label", `Set ${set.set_number} reps`);
            repsInput.value = set.reps !== null && set.reps !== undefined ? set.reps : "";
            repsInput.addEventListener("input", () => {
              const val = repsInput.value === "" ? null : Number(repsInput.value);
              set.reps = val;
              onSetFieldChange(session.id, set.id, { reps: val });
            });
            repsInput.addEventListener("blur", () => {
              onSetFieldBlur(session.id, set.id);
            });

            repsCol.append(repsLabel, repsInput);

            // RIR input
            const rirCol = document.createElement("div");
            rirCol.className = "live-set-field col-rir";

            const rirLabel = document.createElement("label");
            rirLabel.className = "live-field-label";
            rirLabel.textContent = "RIR";

            const rirSlot = document.createElement("div");
            rirSlot.className = "live-rir-slot";

            function renderRirSlot() {
              rirSlot.replaceChildren();
              if (!set.is_warmup) {
                rirSlot.append(createRirSelect(session.id, set, onSetFieldChange, onSetFieldBlur));
              } else {
                const blankSpan = document.createElement("span");
                blankSpan.className = "rir-warmup-blank";
                blankSpan.textContent = "—";
                blankSpan.setAttribute("aria-label", "RIR not applicable for warm-up");
                rirSlot.append(blankSpan);
              }
            }
            renderRirSlot();

            rirCol.append(rirLabel, rirSlot);
            inputGrid.append(weightCol, repsCol, rirCol);
            row.append(inputGrid);

            // Warmup change handler
            warmupCheckbox.addEventListener("change", () => {
              const isWarmup = warmupCheckbox.checked;
              set.is_warmup = isWarmup;
              set.reported_rir_bucket = null;
              set.rir_source = null;
              row.classList.toggle("is-warmup-set", isWarmup);
              warmupLabel.classList.toggle("is-active", isWarmup);

              renderRirSlot();

              onSetFieldChange(session.id, set.id, {
                is_warmup: isWarmup,
                reported_rir_bucket: null,
                rir_source: null,
              });
              onSetFieldBlur(session.id, set.id);
            });

            // Inline previous performance display
            const prevSet = historyInfo?.sets?.[setIdx] || null;
            const inlinePrevText = formatInlinePreviousSet(prevSet, exerciseHeading.textContent, currentEquipmentName);

            const prevRow = document.createElement("div");
            prevRow.className = `live-set-previous cell-prev col-prev ${inlinePrevText ? "has-previous" : "no-previous"}`;
            if (inlinePrevText) {
              const prevLabelSpan = document.createElement("span");
              prevLabelSpan.className = "live-prev-tag";
              prevLabelSpan.textContent = "Last:";
              const prevValueSpan = document.createElement("span");
              prevValueSpan.className = "live-prev-val";
              prevValueSpan.textContent = inlinePrevText;
              prevRow.append(prevLabelSpan, " ", prevValueSpan);
            } else {
              prevRow.textContent = "No previous set";
            }
            row.append(prevRow);

            setsList.append(row);
          });

          setsContainer.append(setsList);

          const addSetBtn = document.createElement("button");
          addSetBtn.type = "button";
          addSetBtn.className = "secondary-button add-set-button";
          addSetBtn.textContent = "+ Add set";
          addSetBtn.addEventListener("click", () => onAddSet(exercise.id));
          setsContainer.append(addSetBtn);

          exerciseCard.append(setsContainer);
          exerciseList.append(exerciseCard);
        });

        container.append(exerciseList);
      }

      // Check if at least 1 completed set exists in the session to enable Finish workout
      const hasCompletedSet = sortedExercises.some((ex) =>
        (ex.exercise_sets || []).some(isCompletedSet)
      );

      // Bottom footer actions
      const footerActions = document.createElement("footer");
      footerActions.className = "live-session-footer";

      const leftActions = document.createElement("div");
      leftActions.className = "live-footer-left";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "text-button danger-link cancel-session-button";
      cancelBtn.textContent = "Cancel workout";
      cancelBtn.addEventListener("click", onCancelSession);
      leftActions.append(cancelBtn);

      const rightActions = document.createElement("div");
      rightActions.className = "live-footer-right";

      const addExerciseBtn = document.createElement("button");
      addExerciseBtn.type = "button";
      addExerciseBtn.className = "secondary-button add-exercise-button";
      addExerciseBtn.textContent = "+ Add exercise";
      addExerciseBtn.addEventListener("click", onAddExercise);

      const concludeBtn = document.createElement("button");
      concludeBtn.type = "button";
      concludeBtn.className = "primary-button conclude-session-button";
      concludeBtn.textContent = isConcluding ? "Finishing…" : "Finish workout";
      concludeBtn.disabled = isConcluding || !hasCompletedSet;
      if (!hasCompletedSet) {
        concludeBtn.title = "Log at least one completed set to finish this workout.";
      }
      concludeBtn.addEventListener("click", onConcludeSession);

      rightActions.append(addExerciseBtn, concludeBtn);
      footerActions.append(leftActions, rightActions);
      container.append(footerActions);
    },
  };
}
