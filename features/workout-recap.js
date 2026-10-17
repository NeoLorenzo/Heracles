import {
  RECAP_DIRECTION,
  RECAP_SIMILAR_THRESHOLD_PERCENT,
  RECAP_STATUS,
  buildRecapShareModel,
  buildWorkoutRecap,
  formatRecapCounts,
  formatRecapExerciseLabel,
  formatRecapShareText,
  formatSignedPercent,
  normalizeRecapRows,
} from "../workout-recap.js";
import { renderRecapShareCard } from "./workout-recap-card.js";

export const RECAP_ORIGIN = Object.freeze({
  COMPLETION: "completion",
  HISTORY: "history",
});

const HISTORY_BATCH_SIZE = 1000;

const SET_COLUMNS = "id, session_exercise_id, set_number, weight, reps, is_warmup, reported_rir_bucket";
// Comparability uses canonical equipment only (issue #22); legacy gym-scoped equipment columns are not read.
const EXERCISE_COLUMNS = "id, session_id, exercise_order, exercise_id, canonical_equipment_id, equipment_name_snapshot, equipment(name), exercises(name)";

export const RECAP_SESSION_SELECT = `id, gym_id, performed_on, created_at, status, source_preset_name, gyms(name), session_exercises(${EXERCISE_COLUMNS}, exercise_sets(${SET_COLUMNS}))`;
export const RECAP_HISTORY_SELECT = `${EXERCISE_COLUMNS}, workout_sessions!inner(id, gym_id, performed_on, created_at, status), exercise_sets(${SET_COLUMNS})`;

function formatDate(isoDate, options = { dateStyle: "medium" }) {
  if (!isoDate) return "";
  const [year, month, day] = String(isoDate).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day));
}

function formatShortDate(isoDate) {
  return formatDate(isoDate, { day: "numeric", month: "short" });
}

function formatNumber(value, digits = 1) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function formatEstimate(value, unit) {
  return `${formatNumber(value)} ${unit}`;
}

function formatSourceSet(entry, unit) {
  return `${formatNumber(entry.weight, 2)} ${unit} × ${entry.reps} ${entry.reps === 1 ? "rep" : "reps"} · ${entry.reportedRir} RIR`;
}

function directionClass(direction) {
  if (direction === RECAP_DIRECTION.IMPROVED) return "change-positive";
  if (direction === RECAP_DIRECTION.DECLINED) return "change-negative";
  return "change-neutral";
}

function directionLabel(direction) {
  if (direction === RECAP_DIRECTION.IMPROVED) return "Improved";
  if (direction === RECAP_DIRECTION.DECLINED) return "Declined";
  return "Similar";
}

function element(tagName, className, textContent) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

export function describeRecapRow(row) {
  const lines = [];
  let change = null;
  if (row.status === RECAP_STATUS.NO_WORKING_SETS) {
    lines.push("No RIR 0–3 working sets, so there is no e1RM to compare.");
  } else if (row.status === RECAP_STATUS.NO_ESTIMATE) {
    lines.push("Working sets were recorded, but none can produce an e1RM (zero load, or more than 36 reps).");
  } else if (row.status === RECAP_STATUS.BASELINE) {
    lines.push(`e1RM ${formatEstimate(row.current.value, row.unit)} from ${formatSourceSet(row.current, row.unit)}.`);
    lines.push(row.equipmentRecorded
      ? "First comparable session on this equipment. Today's estimate is your baseline."
      : "First comparable session with equipment not recorded. Today's estimate is your baseline.");
  } else {
    change = {
      direction: row.direction,
      label: directionLabel(row.direction),
      value: formatSignedPercent(row.changePercent),
      context: `e1RM vs last comparable session (${formatShortDate(row.previous.performedOn)})`,
    };
    lines.push(`e1RM ${formatEstimate(row.current.value, row.unit)} from ${formatSourceSet(row.current, row.unit)}; last time ${formatEstimate(row.previous.value, row.unit)}.`);
    lines.push(row.isNewBest
      ? `New best e1RM: ${formatSignedPercent(row.bestChangePercent)} above your previous best of ${formatEstimate(row.priorBest.value, row.unit)} (${formatShortDate(row.priorBest.performedOn)}).`
      : `Best before this workout: ${formatEstimate(row.priorBest.value, row.unit)} (${formatShortDate(row.priorBest.performedOn)}).`);
  }
  return { change, lines };
}

export function createWorkoutRecapFeature(options) {
  const {
    getClient,
    getUserId,
    container,
    onDone,
    tokenSource = null,
    renderShareCard = renderRecapShareCard,
    getNavigator = () => (typeof navigator === "undefined" ? null : navigator),
    downloadFile = downloadFileInBrowser,
  } = options;
  let requestId = 0;
  let origin = RECAP_ORIGIN.COMPLETION;
  let sharePayload = null;

  async function fetchHistoryRows(supabase, userId, session, exerciseIds) {
    if (!exerciseIds.length) return [];
    const rows = [];
    for (let from = 0; ; from += HISTORY_BATCH_SIZE) {
      const { data, error } = await supabase
        .from("session_exercises")
        .select(RECAP_HISTORY_SELECT)
        .eq("owner_id", userId)
        .eq("workout_sessions.status", "completed")
        .lte("workout_sessions.performed_on", session.performed_on)
        .in("exercise_id", exerciseIds)
        .order("id", { ascending: true })
        .range(from, from + HISTORY_BATCH_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < HISTORY_BATCH_SIZE) return rows;
    }
  }

  async function loadRecap(sessionId) {
    const supabase = getClient();
    const userId = getUserId();
    if (!supabase || !userId) throw new Error("You are signed out.");
    const { data: sessionRow, error } = await supabase
      .from("workout_sessions")
      .select(RECAP_SESSION_SELECT)
      .eq("owner_id", userId)
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!sessionRow) throw new Error("This workout could not be found.");
    // The recap only describes persisted, completed data.
    if (sessionRow.status !== "completed") throw new Error("This workout has not been completed.");
    const exerciseIds = [...new Set((sessionRow.session_exercises ?? []).map((exercise) => exercise.exercise_id))];
    const historyRows = await fetchHistoryRows(supabase, userId, sessionRow, exerciseIds);
    return buildWorkoutRecap(normalizeRecapRows(sessionRow, historyRows));
  }

  function renderShell(statusText) {
    const header = element("header", "data-header workout-recap-header");
    const copy = document.createElement("div");
    const eyebrow = element("p", "eyebrow", origin === RECAP_ORIGIN.HISTORY ? "Workout recap" : "Workout complete");
    const heading = element("h1", null, "Workout recap");
    heading.id = "workout-recap-title";
    copy.append(eyebrow, heading);
    if (statusText) {
      const status = element("p", "page-lede workout-recap-status", statusText);
      status.setAttribute("role", "status");
      copy.append(status);
    }
    header.append(copy);
    return { header, eyebrow, heading, copy };
  }

  async function shareRecap(status) {
    if (!sharePayload) return;
    const { title, text, file } = sharePayload;
    const browser = getNavigator();
    status.textContent = "";
    try {
      if (file && typeof browser?.canShare === "function" && browser.canShare({ files: [file] })) {
        await browser.share({ files: [file], title, text });
        return;
      }
      if (typeof browser?.share === "function") {
        await browser.share({ title, text });
        return;
      }
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (error?.name === "AbortError") return;
    }
    // No usable share sheet: save the image and copy the text instead.
    let copied = false;
    try {
      if (typeof browser?.clipboard?.writeText === "function") {
        await browser.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }
    const saved = file ? downloadFile(file) !== false : false;
    status.textContent = saved && copied
      ? "Recap image saved and recap text copied."
      : saved
        ? "Recap image saved."
        : copied
          ? "Recap text copied."
          : "Sharing is not available in this browser.";
  }

  function renderActions({ shareable = false } = {}) {
    const actions = element("div", "workout-recap-actions");
    const fromHistory = origin === RECAP_ORIGIN.HISTORY;
    const done = element("button", "primary-button workout-recap-done", fromHistory ? "Back to Session history" : "Done");
    done.type = "button";
    const doneOrigin = origin;
    done.addEventListener("click", () => onDone?.(doneOrigin));
    actions.append(done);
    if (shareable) {
      const share = element("button", "secondary-button workout-recap-share", "Share");
      share.type = "button";
      const status = element("p", "workout-recap-share-status");
      status.setAttribute("role", "status");
      share.addEventListener("click", () => {
        void shareRecap(status);
      });
      actions.append(share, status);
    }
    return actions;
  }

  // Shared output is prepared up front: share sheets must open directly from the tap.
  function prepareSharePayload(recap, currentRequest) {
    const formattedDate = formatDate(recap.performedOn);
    const textModel = buildRecapShareModel(recap, { rowLimit: Infinity });
    sharePayload = {
      title: `Heracles workout recap — ${textModel.title}`,
      text: formatRecapShareText(textModel, formattedDate),
      file: null,
    };
    const payload = sharePayload;
    void Promise.resolve(renderShareCard(buildRecapShareModel(recap), {
      formattedDate,
      tokenSource,
      fileName: `heracles-recap-${recap.performedOn}.png`,
    })).then((file) => {
      if (currentRequest === requestId && payload === sharePayload) payload.file = file ?? null;
    }).catch(() => {});
  }

  function renderMethod() {
    const method = element("details", "method-card workout-recap-method");
    const summary = element("summary", null, "How these comparisons work");
    const copy = element("div", "method-copy");
    const paragraphs = [
      "e1RM is an estimated one-repetition maximum calculated from a set you entered. It is not a measured 1RM, and a change between two workouts does not by itself show that you gained or lost muscle.",
      "For each exercise and equipment, the recap takes your best RIR 0–3 working set from a session (the same representative set used by the My data strength progression) and calculates the lower of two estimates from the completed reps: Brzycki, weight × 36 ÷ (37 − reps), and Epley, weight × (1 + reps ÷ 30). Reported RIR is not added to the reps here, so only entered load and reps move the comparison. Warm-ups and 4+ RIR sets are excluded.",
      "Only the same exercise on the same equipment is compared, at any gym where you used that equipment. Sets with equipment not recorded are only compared with other sets at the same gym that also have no equipment recorded. Last comparable session means the most recent earlier completed workout with an estimate for that exercise and equipment, not necessarily your previous workout. New best means today's estimate is higher than every earlier comparable estimate; equalling it is not a new best.",
      `Changes smaller than ${RECAP_SIMILAR_THRESHOLD_PERCENT}% in either direction are shown as Similar. This band is a Heracles display rule, not a scientifically validated measure of meaningful change. Percentages compare kilograms of estimated load; for dumbbell exercises every weight and estimate is per dumbbell.`,
      "Heracles does not give this workout a score: the counts at the top only tally the exercise rows. Workout duration is not shown because Heracles does not store when a workout ends.",
    ];
    for (const text of paragraphs) copy.append(element("p", null, text));
    method.append(summary, copy);
    return method;
  }

  function renderExerciseRow(row) {
    const item = element("li", "workout-recap-exercise");
    item.dataset.status = row.status;
    const heading = element("div", "workout-recap-exercise-heading");
    const name = element("h3", null, formatRecapExerciseLabel(row));
    const titles = element("div");
    titles.append(name);
    if (!row.equipmentRecorded) titles.append(element("p", "workout-recap-equipment", "Equipment not recorded"));
    heading.append(titles);
    if (row.isNewBest) heading.append(element("span", "workout-recap-badge", "New best"));
    item.append(heading);

    const { change, lines } = describeRecapRow(row);
    if (change) {
      const changeLine = element("p", `workout-recap-change ${directionClass(change.direction)}`);
      changeLine.append(element("strong", null, change.value), document.createTextNode(` ${change.label} · ${change.context}`));
      item.append(changeLine);
    }
    for (const line of lines) item.append(element("p", "workout-recap-detail", line));
    const setCount = element("p", "workout-recap-sets", `${row.workingSetCount} ${row.workingSetCount === 1 ? "working set" : "working sets"}`);
    item.append(setCount);
    return item;
  }

  function renderRecap(recap, currentRequest) {
    const { header, eyebrow, heading, copy } = renderShell();
    eyebrow.textContent = `${origin === RECAP_ORIGIN.HISTORY ? "Workout recap" : "Workout complete"} · ${formatDate(recap.performedOn)}`;
    heading.textContent = recap.presetName || recap.gymName || "Workout recap";
    const context = element("p", "page-lede workout-recap-context", [
      recap.presetName && recap.gymName ? recap.gymName : null,
      `${recap.exerciseCount} ${recap.exerciseCount === 1 ? "exercise" : "exercises"}`,
      `${recap.workingSetCount} ${recap.workingSetCount === 1 ? "working set" : "working sets"}`,
    ].filter(Boolean).join(" · "));
    copy.append(context);

    const summary = element("section", "home-card workout-recap-summary");
    summary.setAttribute("aria-labelledby", "workout-recap-summary-title");
    const summaryTitle = element("h2", null, "Strength changes");
    summaryTitle.id = "workout-recap-summary-title";
    const counts = element("p", "workout-recap-counts", formatRecapCounts(recap.counts));
    const list = element("ol", "workout-recap-list");
    for (const row of recap.exercises) list.append(renderExerciseRow(row));
    summary.append(summaryTitle, counts);
    if (recap.exercises.length) summary.append(list);
    else summary.append(element("p", "workout-recap-detail", "No exercises were saved in this workout."));

    const shareable = recap.exercises.length > 0;
    if (shareable) prepareSharePayload(recap, currentRequest);
    container.replaceChildren(header, summary, renderActions({ shareable }), renderMethod());
  }

  return {
    async show(sessionId, { origin: requestedOrigin = RECAP_ORIGIN.COMPLETION } = {}) {
      if (!container) return null;
      const currentRequest = ++requestId;
      origin = requestedOrigin;
      sharePayload = null;
      const { header } = renderShell("Loading your recap…");
      container.replaceChildren(header, renderActions());
      try {
        const recap = await loadRecap(sessionId);
        if (currentRequest !== requestId) return null;
        renderRecap(recap, currentRequest);
        return recap;
      } catch (error) {
        if (currentRequest !== requestId) return null;
        const message = origin === RECAP_ORIGIN.HISTORY
          ? `The recap could not be loaded: ${error.message}`
          : `Your workout was saved, but the recap could not be loaded: ${error.message}`;
        const { header: errorHeader } = renderShell(message);
        container.replaceChildren(errorHeader, renderActions());
        return null;
      }
    },
    reset() {
      requestId += 1;
      sharePayload = null;
      container?.replaceChildren();
    },
  };
}

function downloadFileInBrowser(file) {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
