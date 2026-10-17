import { DEFAULT_PRESET_ORDER_PREFERENCE, PRESET_ORDER_MODES } from "../preset-ordering.js";

export function createPresetOrderSettingsFeature(options) {
  const { getClient, getUserId } = options;

  const form = document.querySelector("#preset-order-form");
  const priorityFieldset = document.querySelector("#preset-order-priority-groups");
  const groupOptions = document.querySelector("#preset-order-group-options");
  const alternateInput = document.querySelector("#preset-order-alternate");
  const status = document.querySelector("#preset-order-status");
  const saveButton = document.querySelector("#save-preset-order");

  let muscleGroups = [];
  let loadToken = 0;
  let isSaving = false;

  function modeInputs() {
    return form ? [...form.querySelectorAll('input[name="preset-order-mode"]')] : [];
  }

  function selectedMode() {
    return modeInputs().find((input) => input.checked)?.value ?? DEFAULT_PRESET_ORDER_PREFERENCE.mode;
  }

  function selectedGroupIds() {
    if (!groupOptions) return [];
    return [...groupOptions.querySelectorAll("input[data-muscle-group-id]:checked")].map((input) => Number(input.dataset.muscleGroupId));
  }

  function syncPriorityVisibility() {
    if (priorityFieldset) priorityFieldset.hidden = selectedMode() !== PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY;
  }

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function renderGroups(selectedIds) {
    if (!groupOptions) return;
    groupOptions.replaceChildren(...muscleGroups.map((group) => {
      const label = document.createElement("label");
      label.className = "preset-order-group";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.muscleGroupId = String(group.id);
      input.checked = selectedIds.has(String(group.id));
      const name = document.createElement("span");
      name.textContent = group.name;
      label.append(input, name);
      return label;
    }));
  }

  function applyPreference({ mode, alternateMuscleGroups, priorityGroupIds }) {
    for (const input of modeInputs()) input.checked = input.value === mode;
    if (alternateInput) alternateInput.checked = alternateMuscleGroups;
    renderGroups(new Set(priorityGroupIds.map(String)));
    syncPriorityVisibility();
  }

  async function load() {
    const supabase = getClient();
    const userId = getUserId();
    if (!form || !supabase || !userId) return;
    const token = ++loadToken;
    if (saveButton) saveButton.disabled = true;
    setStatus("Loading your workout order preference…");

    const [groupsResult, settingsResult, priorityResult] = await Promise.all([
      supabase.from("ui_muscle_groups").select("id, code, name, source_order").order("source_order", { ascending: true }),
      supabase.from("user_settings").select("preset_order_mode, preset_order_alternate_muscle_groups").eq("owner_id", userId).maybeSingle(),
      supabase.from("user_priority_muscle_groups").select("ui_muscle_group_id").eq("owner_id", userId),
    ]);
    if (token !== loadToken || userId !== getUserId()) return;

    const error = groupsResult.error || settingsResult.error || priorityResult.error;
    if (error) {
      setStatus(`Could not load your workout order preference: ${error.message}`);
      return;
    }

    muscleGroups = groupsResult.data ?? [];
    const mode = Object.values(PRESET_ORDER_MODES).includes(settingsResult.data?.preset_order_mode)
      ? settingsResult.data.preset_order_mode
      : DEFAULT_PRESET_ORDER_PREFERENCE.mode;
    applyPreference({
      mode,
      alternateMuscleGroups: typeof settingsResult.data?.preset_order_alternate_muscle_groups === "boolean"
        ? settingsResult.data.preset_order_alternate_muscle_groups
        : DEFAULT_PRESET_ORDER_PREFERENCE.alternateMuscleGroups,
      priorityGroupIds: (priorityResult.data ?? []).map((row) => row.ui_muscle_group_id),
    });
    setStatus("");
    if (saveButton) saveButton.disabled = false;
  }

  async function save() {
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId || isSaving) return;
    const mode = selectedMode();
    const priorityGroupIds = selectedGroupIds();
    if (mode === PRESET_ORDER_MODES.MUSCLE_GROUP_PRIORITY && priorityGroupIds.length === 0) {
      setStatus("Choose at least one priority muscle group.");
      return;
    }

    isSaving = true;
    if (saveButton) saveButton.disabled = true;
    setStatus("Saving workout order…");
    const { error } = await supabase.rpc("save_preset_order_preference", {
      p_mode: mode,
      p_alternate_muscle_groups: alternateInput ? alternateInput.checked : DEFAULT_PRESET_ORDER_PREFERENCE.alternateMuscleGroups,
      p_priority_muscle_group_ids: priorityGroupIds,
    });
    isSaving = false;
    if (saveButton) saveButton.disabled = false;
    if (userId !== getUserId()) return;
    setStatus(error
      ? `Could not save workout order: ${error.message}`
      : "Saved. Your next workout from a preset uses this order.");
  }

  for (const input of modeInputs()) input.addEventListener("change", syncPriorityVisibility);
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void save();
    });
  }

  return {
    load,
    reset() {
      loadToken += 1;
      muscleGroups = [];
      applyPreference({
        mode: DEFAULT_PRESET_ORDER_PREFERENCE.mode,
        alternateMuscleGroups: DEFAULT_PRESET_ORDER_PREFERENCE.alternateMuscleGroups,
        priorityGroupIds: [],
      });
      setStatus("");
      if (saveButton) saveButton.disabled = true;
    },
  };
}
