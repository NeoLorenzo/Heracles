import { canonicalizeBodyWeightObservations, formatBodyWeightDate, parseBodyWeightCsv } from "../body-weight.js";
import { resolveOneRepMaxRange } from "../relative-e1rm.js";
import { createBodyCircumferenceFeature } from "./body-circumference.js";

const BODY_WEIGHT_RPC_PAGE_SIZE = 1000;

function formatOneRepMaxValue(value, relative) {
  return Number(value).toLocaleString(undefined, relative
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 });
}

async function sha256Hex(value) {
  const bytes = value instanceof ArrayBuffer ? value : new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeBodyWeightSeries(rows) {
  const measuredWeights = new Map(rows
    .filter((item) => (item.provenance ?? item.kind) === "measured")
    .map((item) => [item.measured_on, Number(item.weight_kg)]));
  return rows.map((item) => ({
    ...item,
    provenance: item.provenance ?? item.kind,
    previous_weight_kg: item.previous_weight_kg ?? measuredWeights.get(item.previous_measured_on) ?? null,
    next_weight_kg: item.next_weight_kg ?? measuredWeights.get(item.next_measured_on) ?? null,
  }));
}

async function fetchBodyWeightDailySeries(supabase) {
  const rows = [];
  for (let from = 0; ; from += BODY_WEIGHT_RPC_PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc("body_weight_daily_series")
      .range(from, from + BODY_WEIGHT_RPC_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < BODY_WEIGHT_RPC_PAGE_SIZE) return rows;
  }
}

export function createBodyWeightFeature(options) {
  const { getClient, getUserId, onInvalidateE1rmPresentations } = options;
  const bodyCircumferenceFeature = createBodyCircumferenceFeature({ getClient, getUserId });

  // DOM elements lookup
  const bodyWeightFile = document.querySelector("#body-weight-file");
  const bodyWeightImportForm = document.querySelector("#body-weight-import-form");
  const bodyWeightImportButton = document.querySelector("#body-weight-import-button");
  const bodyWeightPreview = document.querySelector("#body-weight-preview");
  const bodyWeightImportStatus = document.querySelector("#body-weight-import-status");
  const bodyWeightCount = document.querySelector("#body-weight-count");
  const bodyWeightCoverage = document.querySelector("#body-weight-coverage");
  const bodyWeightLastImported = document.querySelector("#body-weight-last-imported");
  const deleteBodyWeightButton = document.querySelector("#delete-body-weight");
  const relativeE1rmEnabledInput = document.querySelector("#relative-e1rm-enabled");
  const relativeE1rmStatus = document.querySelector("#relative-e1rm-status");

  // Feature-local state
  let pendingBodyWeightImport = null;
  let bodyWeightUserState = createEmptyBodyWeightUserState();

  // Register event listeners if DOM elements exist
  if (bodyWeightFile) {
    bodyWeightFile.addEventListener("change", previewBodyWeightFile);
  }
  if (bodyWeightImportForm) {
    bodyWeightImportForm.addEventListener("submit", importBodyWeightFile);
  }
  if (deleteBodyWeightButton) {
    deleteBodyWeightButton.addEventListener("click", deleteBodyWeightData);
  }
  if (relativeE1rmEnabledInput) {
    relativeE1rmEnabledInput.addEventListener("change", saveRelativeE1rmSetting);
  }

  function createEmptyBodyWeightUserState() {
    return {
      userId: null,
      loaded: false,
      loading: null,
      dailySeries: [],
      weightByDate: new Map(),
      hasBodyWeight: false,
      storedRelativeEnabled: false,
      effectiveRelativeEnabled: false,
    };
  }

  function resetBodyWeightUserState() {
    bodyWeightUserState = createEmptyBodyWeightUserState();
    if (relativeE1rmEnabledInput) {
      relativeE1rmEnabledInput.checked = false;
      relativeE1rmEnabledInput.disabled = true;
    }
    if (relativeE1rmStatus) {
      relativeE1rmStatus.textContent = "";
    }
  }

  async function previewBodyWeightFile() {
    pendingBodyWeightImport = null;
    if (bodyWeightImportButton) bodyWeightImportButton.disabled = true;
    if (bodyWeightPreview) bodyWeightPreview.hidden = true;
    const file = bodyWeightFile?.files?.[0];
    if (!file) return;
    try {
      const [text, bytes] = await Promise.all([file.text(), file.arrayBuffer()]);
      const parsed = parseBodyWeightCsv(text);
      pendingBodyWeightImport = {
        file,
        parsed,
        sourceSha256: await sha256Hex(bytes),
        canonicalSha256: await sha256Hex(canonicalizeBodyWeightObservations(parsed.observations)),
      };
      const { preview } = parsed;
      if (bodyWeightPreview) {
        bodyWeightPreview.textContent = `${preview.count.toLocaleString()} measured observations · ${formatBodyWeightDate(preview.earliestMeasuredOn)} to ${formatBodyWeightDate(preview.latestMeasuredOn)} · ${preview.interpolatedDayCount.toLocaleString()} missing dates will be interpolated`;
        bodyWeightPreview.hidden = false;
      }
      if (bodyWeightImportStatus) {
        bodyWeightImportStatus.textContent = "File validated. Review the preview, then import.";
      }
      if (bodyWeightImportButton) bodyWeightImportButton.disabled = false;
    } catch (error) {
      if (bodyWeightImportStatus) {
        bodyWeightImportStatus.textContent = `Could not validate CSV: ${error.message}`;
      }
    }
  }

  async function importBodyWeightFile(event) {
    event.preventDefault();
    const supabase = getClient();
    const activeUserId = getUserId();
    if (!pendingBodyWeightImport || !supabase || !activeUserId) return;
    if (bodyWeightImportButton) bodyWeightImportButton.disabled = true;
    if (bodyWeightImportStatus) bodyWeightImportStatus.textContent = "Importing measurements…";
    const { file, parsed, sourceSha256, canonicalSha256 } = pendingBodyWeightImport;
    const { error } = await supabase.rpc("import_body_weight", {
      p_source_file_name: file.name,
      p_source_sha256: sourceSha256,
      p_canonical_sha256: canonicalSha256,
      p_rows: parsed.observations.map((item) => ({ source_row: item.sourceRow, measured_on: item.measuredOn, weight_kg: item.weightKg })),
    });
    if (error) {
      if (bodyWeightImportStatus) {
        bodyWeightImportStatus.textContent = `Import failed: ${error.message}`;
      }
      if (bodyWeightImportButton) bodyWeightImportButton.disabled = false;
      return;
    }
    if (bodyWeightImportStatus) {
      bodyWeightImportStatus.textContent = `Imported ${parsed.preview.count.toLocaleString()} measured observations.`;
    }
    pendingBodyWeightImport = null;
    if (bodyWeightFile) bodyWeightFile.value = "";
    if (bodyWeightPreview) bodyWeightPreview.hidden = true;
    resetBodyWeightUserState();
    await ensureBodyWeightUserState(true);
    onInvalidateE1rmPresentations();
    await loadBodyWeightSummary();
  }

  async function deleteBodyWeightData() {
    const supabase = getClient();
    const activeUserId = getUserId();
    if (!supabase || !activeUserId || !window.confirm("Delete all of your body-weight measurements and body-weight import history? Your workouts and other data will not be changed.")) return;
    if (deleteBodyWeightButton) deleteBodyWeightButton.disabled = true;
    if (bodyWeightImportStatus) bodyWeightImportStatus.textContent = "Deleting body-weight data…";
    const { error } = await supabase.rpc("delete_body_weight_data");
    if (bodyWeightImportStatus) {
      bodyWeightImportStatus.textContent = error ? `Deletion failed: ${error.message}` : "Your body-weight dataset has been deleted.";
    }
    if (error) {
      if (deleteBodyWeightButton) deleteBodyWeightButton.disabled = false;
      return;
    }
    resetBodyWeightUserState();
    await ensureBodyWeightUserState(true);
    onInvalidateE1rmPresentations();
    await loadBodyWeightSummary();
  }

  async function ensureBodyWeightUserState(force = false) {
    const supabase = getClient();
    const requestedUserId = getUserId();
    if (!requestedUserId || !supabase) return createEmptyBodyWeightUserState();
    void bodyCircumferenceFeature.ensureState(force).catch(() => {});
    if (!force && bodyWeightUserState.loaded && bodyWeightUserState.userId === requestedUserId) return bodyWeightUserState;
    if (!force && bodyWeightUserState.loading && bodyWeightUserState.userId === requestedUserId) return bodyWeightUserState.loading;

    const loading = (async () => {
      const [seriesResult, settingsResult] = await Promise.all([
        fetchBodyWeightDailySeries(supabase),
        supabase.from("user_settings").select("relative_e1rm_enabled").eq("owner_id", requestedUserId).maybeSingle(),
      ]);
      if (settingsResult.error) throw settingsResult.error;
      if (requestedUserId !== getUserId()) return createEmptyBodyWeightUserState();
      const dailySeries = normalizeBodyWeightSeries(seriesResult);
      const hasBodyWeight = dailySeries.length > 0;
      const storedRelativeEnabled = settingsResult.data?.relative_e1rm_enabled === true;
      bodyWeightUserState = {
        userId: requestedUserId,
        loaded: true,
        loading: null,
        dailySeries,
        weightByDate: new Map(dailySeries.map((item) => [item.measured_on, Number(item.weight_kg)])),
        hasBodyWeight,
        storedRelativeEnabled,
        effectiveRelativeEnabled: hasBodyWeight && storedRelativeEnabled,
      };
      renderRelativeE1rmSetting(bodyWeightUserState);
      return bodyWeightUserState;
    })();
    bodyWeightUserState = { ...createEmptyBodyWeightUserState(), userId: requestedUserId, loading };
    return loading;
  }

  function renderRelativeE1rmSetting(state = bodyWeightUserState) {
    if (relativeE1rmEnabledInput) {
      relativeE1rmEnabledInput.disabled = !state.hasBodyWeight;
      relativeE1rmEnabledInput.checked = state.hasBodyWeight && state.storedRelativeEnabled;
    }
    if (relativeE1rmStatus) {
      if (!state.hasBodyWeight) relativeE1rmStatus.textContent = "Import body-weight data to enable relative estimated 1RM.";
      else if (!relativeE1rmStatus.textContent.startsWith("Could not")) relativeE1rmStatus.textContent = "";
    }
  }

  async function saveRelativeE1rmSetting() {
    const supabase = getClient();
    const activeUserId = getUserId();
    if (!supabase || !activeUserId || !bodyWeightUserState.hasBodyWeight) {
      renderRelativeE1rmSetting();
      return;
    }
    const requestedUserId = activeUserId;
    const enabled = relativeE1rmEnabledInput ? relativeE1rmEnabledInput.checked : false;
    if (relativeE1rmEnabledInput) relativeE1rmEnabledInput.disabled = true;
    if (relativeE1rmStatus) relativeE1rmStatus.textContent = "Saving preference…";
    const { error } = await supabase.from("user_settings").upsert({
      owner_id: requestedUserId,
      relative_e1rm_enabled: enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id" });
    if (error || requestedUserId !== getUserId()) {
      if (relativeE1rmStatus) {
        relativeE1rmStatus.textContent = `Could not save preference: ${error?.message ?? "Your session changed."}`;
      }
      renderRelativeE1rmSetting();
      return;
    }
    bodyWeightUserState.storedRelativeEnabled = enabled;
    bodyWeightUserState.effectiveRelativeEnabled = enabled && bodyWeightUserState.hasBodyWeight;
    if (relativeE1rmStatus) {
      relativeE1rmStatus.textContent = enabled ? "Relative estimated 1RM enabled." : "Absolute estimated 1RM enabled.";
    }
    if (relativeE1rmEnabledInput) relativeE1rmEnabledInput.disabled = false;
    onInvalidateE1rmPresentations();
  }

  async function loadBodyWeightSummary() {
    const supabase = getClient();
    const requestedUserId = getUserId();
    if (!requestedUserId || !supabase) return;
    void bodyCircumferenceFeature.ensureState().catch(() => {});
    const [bodyWeightState, countResult, firstResult, lastResult, importResult] = await Promise.all([
      ensureBodyWeightUserState(),
      supabase.from("body_weight_measurements").select("id", { count: "exact", head: true }).eq("owner_id", requestedUserId),
      supabase.from("body_weight_measurements").select("measured_on").eq("owner_id", requestedUserId).order("measured_on", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("body_weight_measurements").select("measured_on").eq("owner_id", requestedUserId).order("measured_on", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("data_imports").select("imported_at").eq("owner_id", requestedUserId).eq("import_kind", "body_weight").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const error = countResult.error ?? firstResult.error ?? lastResult.error ?? importResult.error;
    if (error) {
      if (bodyWeightImportStatus) {
        bodyWeightImportStatus.textContent = `Could not load body-weight status: ${error.message}`;
      }
      return;
    }
    const count = countResult.count ?? 0;
    if (bodyWeightCount) bodyWeightCount.textContent = count.toLocaleString();
    if (bodyWeightCoverage) {
      bodyWeightCoverage.textContent = count ? `${formatBodyWeightDate(firstResult.data.measured_on)} to ${formatBodyWeightDate(lastResult.data.measured_on)}` : "No data";
    }
    if (bodyWeightLastImported) {
      bodyWeightLastImported.textContent = importResult.data?.imported_at
        ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(importResult.data.imported_at))
        : "Never imported";
    }
    if (deleteBodyWeightButton) deleteBodyWeightButton.disabled = count === 0;
    renderRelativeE1rmSetting(bodyWeightState);
  }

  return {
    ensureState(force = false) {
      return ensureBodyWeightUserState(force);
    },
    getState() {
      return {
        loaded: bodyWeightUserState.loaded,
        dailySeries: bodyWeightUserState.dailySeries,
        weightByDate: new Map(bodyWeightUserState.weightByDate),
        hasBodyWeight: bodyWeightUserState.hasBodyWeight,
        storedRelativeEnabled: bodyWeightUserState.storedRelativeEnabled,
        effectiveRelativeEnabled: bodyWeightUserState.effectiveRelativeEnabled,
      };
    },
    loadSummary() {
      return loadBodyWeightSummary();
    },
    reset() {
      resetBodyWeightUserState();
      bodyCircumferenceFeature.reset();
    },
    resolveOneRepMaxRange({ low, high, exerciseName, equipmentName = null, performedOn }) {
      return resolveOneRepMaxRange({
        low,
        high,
        exerciseName,
        equipmentName,
        performedOn,
        relativeEnabled: bodyWeightUserState.effectiveRelativeEnabled,
        weightByDate: bodyWeightUserState.weightByDate,
      });
    },
    formatOneRepMaxRange(low, high, exerciseName = "", performedOn = null, equipmentName = null) {
      const range = resolveOneRepMaxRange({
        low,
        high,
        exerciseName,
        equipmentName,
        performedOn,
        relativeEnabled: bodyWeightUserState.effectiveRelativeEnabled,
        weightByDate: bodyWeightUserState.weightByDate,
      });
      if (!range) return null;
      if (!range.available) return range.reason;
      const lowLabel = Number(range.low).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const highLabel = Number(range.high).toLocaleString(undefined, { maximumFractionDigits: 2 });
      return lowLabel === highLabel
        ? `Estimated 1RM ${lowLabel} ${range.unit}`
        : `Estimated 1RM ${lowLabel}–${highLabel} ${range.unit}`;
    }
  };
}
