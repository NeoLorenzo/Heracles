// Signed-out showcase: interactive demonstrations for the public front page.
// Every calculated value shown here comes from the same modules the signed-in app uses.
import { calculateMuscleExposure } from "../analytics.js";
import { activityLevel } from "./activity-heatmap.js";
import { calculateBrzycki, calculateEpley, calculateRirE1rmEstimates, formatSetClassification } from "../set-model.js";

// Canonical (issue #22) projection of the authored relevance source: one row per equipment-independent exercise.
export const RELEVANCE_SOURCE_PATH = "./EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE_CANONICAL.csv";

// UI group identities mirror public.ui_muscle_groups (source_order, code, name).
export const UI_MUSCLE_GROUPS = Object.freeze({
  abs: { code: "abs", name: "Abs", sourceOrder: 1 },
  adductors: { code: "adductors", name: "Adductors", sourceOrder: 2 },
  back: { code: "back", name: "Back", sourceOrder: 3 },
  biceps: { code: "biceps", name: "Biceps", sourceOrder: 4 },
  calves: { code: "calves", name: "Calves", sourceOrder: 5 },
  chest: { code: "chest", name: "Chest", sourceOrder: 6 },
  forearms: { code: "forearms", name: "Forearms", sourceOrder: 7 },
  glutes: { code: "glutes", name: "Glutes", sourceOrder: 8 },
  hamstrings: { code: "hamstrings", name: "Hamstrings", sourceOrder: 9 },
  hip_flexors: { code: "hip_flexors", name: "Hip Flexors", sourceOrder: 10 },
  quads: { code: "quads", name: "Quads", sourceOrder: 11 },
  shoulders: { code: "shoulders", name: "Shoulders", sourceOrder: 12 },
  triceps: { code: "triceps", name: "Triceps", sourceOrder: 13 },
});

// Muscle-to-group membership mirrors the ui_muscle_groups migration, keyed by the CSV header label.
export const MUSCLE_GROUP_BY_HEADER = Object.freeze({
  "Pectoralis Major — Clavicular": "chest",
  "Pectoralis Major — Sternocostal": "chest",
  "Pectoralis Minor": "chest",
  "Anterior Deltoid": "shoulders",
  "Lateral Deltoid": "shoulders",
  "Posterior Deltoid": "shoulders",
  "Latissimus Dorsi": "back",
  "Teres Major": "back",
  "Upper Trapezius": "back",
  "Middle Trapezius": "back",
  "Lower Trapezius": "back",
  "Rhomboids": "back",
  "Serratus Anterior": "back",
  "Lumbar Erector Spinae": "back",
  "Biceps Brachii": "biceps",
  "Brachialis": "biceps",
  "Brachioradialis": "forearms",
  "Triceps Brachii — Long Head": "triceps",
  "Triceps Brachii — Lateral Head": "triceps",
  "Triceps Brachii — Medial Head": "triceps",
  "Wrist Flexors": "forearms",
  "Wrist Extensors": "forearms",
  "Finger Flexors / Grip": "forearms",
  "Rectus Abdominis": "abs",
  "Obliques": "abs",
  "Iliopsoas": "hip_flexors",
  "Gluteus Maximus": "glutes",
  "Gluteus Medius + Minimus": "glutes",
  "Adductor Magnus": "adductors",
  "Other Hip Adductors": "adductors",
  "Rectus Femoris": "quads",
  "Vastus Lateralis": "quads",
  "Vastus Medialis": "quads",
  "Vastus Intermedius": "quads",
  "Biceps Femoris — Long Head": "hamstrings",
  "Biceps Femoris — Short Head": "hamstrings",
  "Semitendinosus": "hamstrings",
  "Semimembranosus": "hamstrings",
  "Gastrocnemius": "calves",
  "Soleus": "calves",
});

// Presentation order for the heatmap: head to foot, grouped.
export const DISPLAY_GROUP_ORDER = Object.freeze([
  "chest", "shoulders", "back", "biceps", "forearms", "triceps",
  "abs", "hip_flexors", "glutes", "adductors", "quads", "hamstrings", "calves",
]);

export const RELEVANCE_LEVELS = Object.freeze([
  { value: 1, label: "Principal hypertrophy target" },
  { value: 0.75, label: "Major target" },
  { value: 0.5, label: "Substantial secondary contribution" },
  { value: 0.25, label: "Small but worthwhile contribution" },
  { value: 0, label: "Not counted as meaningful stimulus" },
]);

export const E1RM_PERSPECTIVES = Object.freeze([
  { key: "observedBrzycki", equation: "Brzycki", basis: "completed reps", adjusted: false },
  { key: "observedEpley", equation: "Epley", basis: "completed reps", adjusted: false },
  { key: "adjustedBrzycki", equation: "Brzycki", basis: "reps + RIR", adjusted: true },
  { key: "adjustedEpley", equation: "Epley", basis: "reps + RIR", adjusted: true },
]);

// Illustrative example history for one exercise; it is labelled as example data wherever it is drawn.
export const EXAMPLE_PROGRESSION = Object.freeze([
  { date: "2026-08-05", weight: 26, reps: 10, rir: 2 },
  { date: "2026-08-12", weight: 27.5, reps: 9, rir: 2 },
  { date: "2026-08-19", weight: 27.5, reps: 10, rir: 1 },
  { date: "2026-08-26", weight: 30, reps: 8, rir: 2 },
  { date: "2026-09-02", weight: 30, reps: 9, rir: 1 },
  { date: "2026-09-09", weight: 30, reps: 10, rir: 1 },
  { date: "2026-09-16", weight: 32.5, reps: 7, rir: 1 },
  { date: "2026-09-23", weight: 32.5, reps: 8, rir: 1 },
]);

export const EXAMPLE_BODY_WEIGHT = Object.freeze([
  { day: 0, kg: 81.6 }, { day: 3, kg: 81.2 }, { day: 4, kg: 81.4 }, { day: 9, kg: 80.9 },
  { day: 11, kg: 81.1 }, { day: 18, kg: 80.6 }, { day: 19, kg: 80.8 }, { day: 25, kg: 80.3 },
  { day: 30, kg: 80.5 }, { day: 31, kg: 80.2 }, { day: 38, kg: 80.4 }, { day: 44, kg: 79.9 },
  { day: 46, kg: 80.1 }, { day: 52, kg: 80.4 },
]);

const HERO_EXERCISE = "Chest Press (Incline 30)";
const HERO_SET = Object.freeze({ weight: 32.5, reps: 7, rir: 1 });

export function parseRelevanceCsv(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("The relevance source is empty.");
  const [, ...muscles] = lines[0].split(",").map((cell) => cell.trim());
  const exercises = lines.slice(1).map((line) => {
    const [name, ...cells] = line.split(",");
    const values = cells.map((cell) => Number(cell));
    if (values.length !== muscles.length || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Malformed relevance row for ${name}.`);
    }
    return { name: name.trim(), values };
  });
  return { muscles, exercises };
}

export function describeMuscles(muscles) {
  return muscles.map((name, index) => {
    const code = MUSCLE_GROUP_BY_HEADER[name];
    if (!code) throw new Error(`No muscle group is defined for ${name}.`);
    return { name, sourceOrder: index + 1, uiGroup: UI_MUSCLE_GROUPS[code] };
  });
}

export function buildExerciseMuscleLookup(matrix) {
  const muscles = describeMuscles(matrix.muscles);
  return new Map(matrix.exercises.map((exercise) => [
    exercise.name,
    muscles.map((muscle, index) => ({ ...muscle, relevance: exercise.values[index] })),
  ]));
}

// Weighted-set contribution of one analytical working set, using the dashboard's own aggregation.
export function weightedSetsForOneSet(lookup, exerciseName, set = { weight: 1, reps: 1, rir: 0 }) {
  const record = {
    exercise_id: exerciseName,
    exercise_name: exerciseName,
    is_warmup: false,
    weight: set.weight,
    reps: set.reps,
    reported_rir_bucket: set.rir,
  };
  const { groupExposure } = calculateMuscleExposure([record], lookup, []);
  return [...groupExposure]
    .filter(([, value]) => value > 0)
    .map(([code, value]) => ({ ...UI_MUSCLE_GROUPS[code], value }))
    .sort((a, b) => b.value - a.value || DISPLAY_GROUP_ORDER.indexOf(a.code) - DISPLAY_GROUP_ORDER.indexOf(b.code));
}

export function principalGroup(exercise, muscles) {
  let best = null;
  exercise.values.forEach((value, index) => {
    if (value <= 0) return;
    const code = MUSCLE_GROUP_BY_HEADER[muscles[index]];
    const rank = DISPLAY_GROUP_ORDER.indexOf(code);
    if (!best || value > best.value || (value === best.value && rank < best.rank)) best = { code, value, rank };
  });
  return best?.code ?? null;
}

export function orderExercisesForDisplay(matrix) {
  return [...matrix.exercises].sort((a, b) => {
    const rankA = DISPLAY_GROUP_ORDER.indexOf(principalGroup(a, matrix.muscles));
    const rankB = DISPLAY_GROUP_ORDER.indexOf(principalGroup(b, matrix.muscles));
    return rankA - rankB || a.name.localeCompare(b.name);
  });
}

export function orderMusclesForDisplay(muscles) {
  return muscles
    .map((name, index) => ({ name, index, code: MUSCLE_GROUP_BY_HEADER[name] }))
    .sort((a, b) => DISPLAY_GROUP_ORDER.indexOf(a.code) - DISPLAY_GROUP_ORDER.indexOf(b.code) || a.index - b.index);
}

export function relevanceLevelLabel(value) {
  return RELEVANCE_LEVELS.find((level) => level.value === value)?.label ?? "Unrecognised coefficient";
}

// Mirrors the app contract: estimates exist only for completed RIR 0–3 working sets inside each formula's domain.
export function estimateSet({ weight, reps, rir }) {
  const set = { is_warmup: false, weight, reps, reported_rir_bucket: rir };
  const classification = formatSetClassification(set);
  const estimates = calculateRirE1rmEstimates(set);
  if (estimates) return { available: true, classification, values: estimates };
  let reason = "Enter a completed load and repetitions to calculate estimates.";
  if (Number(rir) === 4) {
    reason = "No estimate: 4+ RIR is open-ended, so it cannot give a finite adjusted repetition count. The set stays in history but is not a working set.";
  } else if (Number.isInteger(Number(reps)) && Number(reps) >= 1 && calculateBrzycki(weight, Number(reps) + Number(rir)) === null && calculateEpley(weight, reps) !== null) {
    reason = `No estimate: ${Number(reps) + Number(rir)} reps + RIR falls outside the Brzycki equation's 1–36 repetition domain, so Heracles withholds all four values rather than show a partial set.`;
  }
  return { available: false, classification, reason };
}

export function formulaText(key, weight, reps, rir) {
  const effectiveReps = key.startsWith("adjusted") ? Number(reps) + Number(rir) : Number(reps);
  const load = formatNumber(weight);
  return key.endsWith("Brzycki")
    ? `${load} × 36 ÷ (37 − ${effectiveReps})`
    : `${load} × (1 + ${effectiveReps} ÷ 30)`;
}

export function exampleProgressionRanges(history = EXAMPLE_PROGRESSION) {
  return history.map((entry) => {
    const estimates = calculateRirE1rmEstimates({ is_warmup: false, weight: entry.weight, reps: entry.reps, reported_rir_bucket: entry.rir });
    const values = Object.values(estimates);
    return { ...entry, estimates, low: Math.min(...values), high: Math.max(...values) };
  });
}

function formatNumber(value, digits = null) {
  const number = Number(value);
  if (digits !== null) return number.toFixed(digits);
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
}

/* ------------------------------------------------------------------ */
/* Browser behaviour                                                   */
/* ------------------------------------------------------------------ */

const SVG_NS = "http://www.w3.org/2000/svg";
let relevancePromise = null;

function loadRelevanceMatrix() {
  relevancePromise ??= fetch(RELEVANCE_SOURCE_PATH)
    .then((response) => {
      if (!response.ok) throw new Error(`Source request failed (${response.status})`);
      return response.text();
    })
    .then(parseRelevanceCsv);
  return relevancePromise;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function whenVisible(element, callback, { threshold = 0, rootMargin = "0px" } = {}) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) callback(entry.isIntersecting, entry);
  }, { threshold, rootMargin });
  observer.observe(element);
  return observer;
}

function initReveal(root) {
  const items = [...root.querySelectorAll(".reveal")];
  if (!items.length || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
  root.classList.add("has-reveal");
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  for (const item of items) observer.observe(item);
}

/* Hero: a set being logged, then interpreted. */
function initHeroDemo(root) {
  const stage = root.querySelector("[data-hero-demo]");
  if (!stage) return;
  const fields = Object.fromEntries([...stage.querySelectorAll("[data-demo-field]")].map((field) => [field.dataset.demoField, field]));
  const sync = stage.querySelector("[data-demo-sync]");
  const liveSet = stage.querySelector("[data-demo-set]");
  const range = stage.querySelector("[data-demo-range]");
  const bars = [...stage.querySelectorAll("[data-demo-bars] i")];
  const classification = stage.querySelector("[data-demo-class]");

  const result = estimateSet(HERO_SET);
  if (result.available) {
    const values = E1RM_PERSPECTIVES.map((perspective) => result.values[perspective.key]);
    const low = Math.min(...values);
    const high = Math.max(...values);
    range.textContent = `${formatNumber(low, 2)}–${formatNumber(high, 2)}`;
    values.forEach((value, index) => {
      bars[index]?.style.setProperty("--p", String(0.35 + 0.65 * ((value - low) / Math.max(high - low, 0.01))));
    });
    classification.textContent = result.classification;
  }

  const setSync = (state) => {
    sync.className = `ld-sync is-${state}`;
    sync.textContent = { saved: "Saved ✓", saving: "Saving…" }[state];
  };

  if (prefersReducedMotion()) {
    stage.classList.add("is-complete");
    return;
  }

  let timers = [];
  let running = false;
  const at = (delay, action) => timers.push(window.setTimeout(action, delay));

  const typeInto = (field, text, start, step = 140) => {
    at(start, () => {
      liveSet.dataset.focus = field.dataset.demoField;
      field.textContent = "";
    });
    [...text].forEach((_, index) => at(start + step * (index + 1), () => {
      field.textContent = text.slice(0, index + 1);
      setSync("saving");
    }));
    const end = start + step * (text.length + 1);
    at(end + 420, () => setSync("saved"));
    return end + 520;
  };

  const run = () => {
    timers.forEach(window.clearTimeout);
    timers = [];
    stage.classList.remove("is-complete");
    for (const field of Object.values(fields)) field.textContent = "";
    fields.rir.textContent = "—";
    delete liveSet.dataset.focus;
    liveSet.classList.remove("is-done", "is-choosing", "is-picked");
    setSync("saved");

    let cursor = 700;
    cursor = typeInto(fields.weight, String(HERO_SET.weight), cursor);
    cursor = typeInto(fields.reps, String(HERO_SET.reps), cursor);
    at(cursor, () => {
      liveSet.dataset.focus = "rir";
      liveSet.classList.add("is-choosing");
    });
    at(cursor + 700, () => {
      liveSet.classList.add("is-picked");
      fields.rir.textContent = String(HERO_SET.rir);
      setSync("saving");
    });
    at(cursor + 1050, () => {
      liveSet.classList.remove("is-choosing");
    });
    at(cursor + 1450, () => {
      setSync("saved");
      delete liveSet.dataset.focus;
      liveSet.classList.add("is-done");
      stage.classList.add("is-complete");
    });
    at(cursor + 7600, () => {
      stage.classList.remove("is-complete");
    });
    at(cursor + 8400, () => {
      if (running) run();
    });
  };

  whenVisible(stage, (visible) => {
    if (visible && !running) {
      running = true;
      run();
    } else if (!visible && running) {
      running = false;
      timers.forEach(window.clearTimeout);
      timers = [];
      stage.classList.add("is-complete");
      for (const [key, field] of Object.entries(fields)) field.textContent = String(HERO_SET[key]);
    }
  }, { threshold: 0.25 });
}

/* Product tour tabs. */
const TOUR_TITLES = Object.freeze({
  home: "Home",
  train: "Live Workout",
  history: "Session history",
  data: "My data",
  presets: "My Stuff",
  body: "Settings",
});

function initTour(root) {
  const tour = root.querySelector("[data-tour]");
  if (!tour) return;
  const tabs = [...tour.querySelectorAll("[data-tour-tab]")];
  const panels = [...tour.querySelectorAll("[data-tour-panel]")];
  const screens = [...tour.querySelectorAll("[data-aw-screen]")];
  const items = [...tour.querySelectorAll("[data-aw-item]")];
  const title = tour.querySelector("[data-aw-title]");
  const topSync = tour.querySelector("[data-aw-sync]");
  let autoplay = !prefersReducedMotion();

  const select = (name, { focus = false } = {}) => {
    for (const tab of tabs) {
      const selected = tab.dataset.tourTab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.tourPanel !== name;
    for (const screen of screens) screen.classList.toggle("is-active", screen.dataset.awScreen === name);
    // The live workout is reached from Home, so the sidebar keeps Home active.
    const sidebarItem = name === "train" ? "home" : name;
    for (const item of items) item.classList.toggle("is-active", item.dataset.awItem === sidebarItem);
    title.textContent = TOUR_TITLES[name];
    if (topSync) topSync.hidden = name !== "train";
  };

  const stopAutoplay = () => {
    autoplay = false;
    tour.classList.remove("is-autoplay");
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      stopAutoplay();
      select(tab.dataset.tourTab);
    });
    tab.addEventListener("keydown", (event) => {
      const offset = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (event.key === "Home" || event.key === "End" || offset) {
        event.preventDefault();
        stopAutoplay();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
        select(tabs[next].dataset.tourTab, { focus: true });
      }
    });
    tab.querySelector(".tour-progress")?.addEventListener("animationend", () => {
      if (!autoplay) return;
      select(tabs[(index + 1) % tabs.length].dataset.tourTab);
    });
  });

  const setPaused = (paused) => tour.classList.toggle("is-paused", paused);
  tour.addEventListener("pointerenter", () => setPaused(true));
  tour.addEventListener("pointerleave", () => setPaused(tour.contains(document.activeElement)));
  tour.addEventListener("focusin", () => setPaused(true));
  tour.addEventListener("focusout", () => setPaused(tour.matches(":hover")));

  if (autoplay) {
    tour.classList.add("is-autoplay", "is-paused");
    whenVisible(tour, (visible) => {
      if (!visible) setPaused(true);
      else if (!tour.matches(":hover") && !tour.contains(document.activeElement)) setPaused(false);
    }, { threshold: 0.35 });
  }
  select("home");
  drawMiniHeatmap(tour.querySelector("[data-mini-heatmap]"));
  drawMiniProgression(tour.querySelector("[data-mini-progression]"));
  drawMiniWeight(tour.querySelector("[data-mini-weight]"));
}

function drawBandChart(svg, { width, height, padding, labels = false }) {
  if (!svg) return;
  const ranges = exampleProgressionRanges();
  const min = Math.floor(Math.min(...ranges.map((range) => range.low)) - 1);
  const max = Math.ceil(Math.max(...ranges.map((range) => range.high)) + 1);
  const x = (index) => padding.left + (index / (ranges.length - 1)) * (width - padding.left - padding.right);
  const y = (value) => padding.top + (1 - (value - min) / (max - min)) * (height - padding.top - padding.bottom);
  svg.replaceChildren();

  const ticks = labels ? 4 : 3;
  for (let index = 0; index <= ticks; index += 1) {
    const value = min + ((max - min) * index) / ticks;
    svg.append(svgElement("line", { x1: padding.left, x2: width - padding.right, y1: y(value), y2: y(value), class: "chart-grid" }));
    if (labels) {
      const label = svgElement("text", { x: padding.left - 10, y: y(value) + 4, class: "chart-tick", "text-anchor": "end" });
      label.textContent = formatNumber(value, 0);
      svg.append(label);
    }
  }

  const upper = ranges.map((range, index) => `${x(index)},${y(range.high)}`);
  const lower = ranges.map((range, index) => `${x(index)},${y(range.low)}`).reverse();
  svg.append(svgElement("path", { d: `M${upper.join("L")}L${lower.join("L")}Z`, class: "chart-band" }));
  svg.append(svgElement("path", { d: `M${ranges.map((range, index) => `${x(index)},${y((range.low + range.high) / 2)}`).join("L")}`, class: "chart-mid" }));

  ranges.forEach((range, index) => {
    svg.append(svgElement("line", { x1: x(index), x2: x(index), y1: y(range.high), y2: y(range.low), class: "chart-spread" }));
    svg.append(svgElement("circle", { cx: x(index), cy: y((range.low + range.high) / 2), r: labels ? 4.5 : 3, class: "chart-dot" }));
    if (labels) {
      const date = svgElement("text", { x: x(index), y: height - 8, class: "chart-tick", "text-anchor": "middle" });
      const [, month, day] = range.date.split("-").map(Number);
      date.textContent = `${day}/${month}`;
      svg.append(date);
    }
  });

  if (labels) {
    const last = ranges.at(-1);
    const note = svgElement("text", { x: x(ranges.length - 1) - 8, y: y(last.high) - 12, class: "chart-annotation", "text-anchor": "end" });
    note.textContent = `${formatNumber(last.low, 2)}–${formatNumber(last.high, 2)}`;
    svg.append(note);
  }
}

function drawMiniProgression(svg) {
  drawBandChart(svg, { width: 320, height: 150, padding: { top: 12, right: 10, bottom: 12, left: 10 } });
}

// Illustrative training calendar: a steady three-to-four-day week with a short break,
// shaded with the app's fixed working-set bands.
export function exampleActivityLevels(weeks = 53) {
  const days = [];
  for (let week = 0; week < weeks; week += 1) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const onBreak = week === 19 || week === 20 || week === 38;
      const trainingDay = !onBreak && [0, 2, 4].includes(weekday) || (!onBreak && weekday === 5 && week % 3 === 0);
      const sets = trainingDay ? 5 + ((week * 11 + weekday * 7) % 19) : 0;
      days.push(activityLevel(sets));
    }
  }
  return days;
}

function drawMiniHeatmap(container) {
  if (!container) return;
  const levels = exampleActivityLevels();
  container.replaceChildren(...levels.map((level, index) => {
    const day = document.createElement("i");
    day.dataset.level = String(level);
    if (index === levels.length - 5) day.classList.add("is-today");
    return day;
  }));
}

function drawMiniWeight(svg) {
  if (!svg) return;
  const width = 320;
  const height = 110;
  const points = EXAMPLE_BODY_WEIGHT;
  const lastDay = points.at(-1).day;
  const min = Math.min(...points.map((point) => point.kg)) - 0.4;
  const max = Math.max(...points.map((point) => point.kg)) + 0.4;
  const x = (day) => 10 + (day / lastDay) * (width - 20);
  const y = (kg) => 10 + (1 - (kg - min) / (max - min)) * (height - 20);
  svg.replaceChildren();
  svg.append(svgElement("path", { d: `M${points.map((point) => `${x(point.day)},${y(point.kg)}`).join("L")}`, class: "weight-interp" }));
  for (const point of points) svg.append(svgElement("circle", { cx: x(point.day), cy: y(point.kg), r: 3, class: "weight-dot" }));
}

/* Scroll story. */
function initStory(root) {
  const story = root.querySelector("[data-story]");
  if (!story) return;
  const steps = [...story.querySelectorAll("[data-story-step]")];

  const result = estimateSet(HERO_SET);
  if (result.available) {
    const rows = [...story.querySelectorAll("[data-story-estimates] tbody tr")];
    E1RM_PERSPECTIVES.forEach((perspective, index) => {
      const row = rows[index];
      if (!row) return;
      row.querySelector("code").textContent = formulaText(perspective.key, HERO_SET.weight, HERO_SET.reps, HERO_SET.rir);
      row.querySelector("b").textContent = formatNumber(result.values[perspective.key], 2);
    });
  }
  drawBandChart(story.querySelector("[data-story-chart]"), { width: 480, height: 240, padding: { top: 30, right: 20, bottom: 30, left: 44 }, labels: true });

  if (!("IntersectionObserver" in window)) return;
  story.classList.add("is-enhanced");
  const activate = (step) => {
    for (const candidate of steps) candidate.classList.toggle("is-active", candidate === step);
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) activate(entry.target.closest("[data-story-step]"));
    }
  }, { rootMargin: "-45% 0px -45% 0px" });
  for (const step of steps) observer.observe(step.querySelector(".story-copy"));
}

/* Estimate lab. */
function initLab(root) {
  const lab = root.querySelector("[data-lab]");
  if (!lab) return;
  const form = lab.querySelector("[data-lab-form]");
  const inputs = Object.fromEntries([...lab.querySelectorAll("[data-lab-input]")].map((input) => [input.dataset.labInput, input]));
  const outputs = Object.fromEntries([...lab.querySelectorAll("[data-lab-out]")].map((output) => [output.dataset.labOut, output]));
  const classLabel = lab.querySelector("[data-lab-class]");
  const values = lab.querySelector("[data-lab-values]");
  const unitLabel = lab.querySelector("[data-lab-unit]");
  const refusal = lab.querySelector("[data-lab-refusal]");
  const line = lab.querySelector("[data-lab-line]");
  const band = lab.querySelector("[data-lab-band]");
  const marks = Object.fromEntries([...lab.querySelectorAll("[data-lab-mark]")].map((mark) => [mark.dataset.labMark, mark]));

  const update = () => {
    const weight = Number(inputs.load.value);
    const reps = Number(inputs.reps.value);
    const rir = Number(form.elements["lab-rir"].value);
    const dumbbell = form.elements["lab-kind"].value === "dumbbell";
    const unit = dumbbell ? "kg per dumbbell" : "kg";
    const bodyWeight = Number(inputs.bw.value);
    const relative = Number.isFinite(bodyWeight) && bodyWeight > 0;

    for (const input of [inputs.load, inputs.reps]) {
      input.style.setProperty("--fill", `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
    }
    outputs.load.textContent = `${formatNumber(weight)} ${unit}`;
    outputs.reps.textContent = String(reps);

    const result = estimateSet({ weight, reps, rir });
    classLabel.textContent = result.classification;
    lab.classList.toggle("is-refused", !result.available);
    refusal.hidden = result.available;
    values.hidden = !result.available;
    line.hidden = !result.available;
    unitLabel.hidden = !result.available;
    if (!result.available) {
      refusal.textContent = result.reason;
      return;
    }

    unitLabel.textContent = relative
      ? `Estimated 1RM in ${unit}, and each value ÷ ${formatNumber(bodyWeight)} kg body weight`
      : `Estimated 1RM in ${unit}`;
    const numbers = E1RM_PERSPECTIVES.map((perspective) => result.values[perspective.key]);
    const low = Math.min(...numbers);
    const high = Math.max(...numbers);
    const span = Math.max(high - low, high * 0.02);
    const domainLow = low - span * 0.6;
    const domainHigh = high + span * 0.6;
    const position = (value) => `${((value - domainLow) / (domainHigh - domainLow)) * 100}%`;
    band.style.left = position(low);
    band.style.width = `calc(${position(high)} - ${position(low)})`;

    for (const perspective of E1RM_PERSPECTIVES) {
      const value = result.values[perspective.key];
      const row = values.querySelector(`[data-lab-row="${perspective.key}"]`);
      const relativeText = relative ? ` · ${formatNumber(value / bodyWeight, 2)} × BW` : "";
      row.querySelector("[data-lab-value]").textContent = `${formatNumber(value, 2)}${relativeText}`;
      row.querySelector("[data-lab-formula]").textContent = formulaText(perspective.key, weight, reps, rir);
      row.classList.toggle("is-low", value === low);
      row.classList.toggle("is-high", value === high);
      marks[perspective.key].style.left = position(value);
    }
  };

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", (event) => event.preventDefault());
  update();
}

/* Full relevance matrix. */
const LEVEL_ALPHA = new Map([[0, 0], [0.25, 0.22], [0.5, 0.46], [0.75, 0.74], [1, 1]]);

function cellColor(value) {
  const alpha = LEVEL_ALPHA.get(value) ?? 0;
  return alpha === 0 ? "#111111" : `rgba(255, 56, 60, ${alpha})`;
}

function initMatrix(root) {
  const container = root.querySelector("[data-matrix]");
  const backdrop = root.querySelector("[data-matrix-backdrop]");
  if (!container && !backdrop) return;
  const start = () => {
    loadRelevanceMatrix()
      .then((matrix) => {
        if (backdrop) drawBackdrop(backdrop, matrix);
        if (container) renderMatrix(container, matrix);
      })
      .catch((error) => {
        const status = container?.querySelector("[data-matrix-status]");
        if (status) status.textContent = `The published matrix could not be loaded (${error.message}). The method document explains every coefficient.`;
      });
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 1500 });
  else window.setTimeout(start, 300);
}

function drawBackdrop(canvas, matrix) {
  const exercises = orderExercisesForDisplay(matrix);
  const muscles = orderMusclesForDisplay(matrix.muscles);
  const cell = 9;
  const gap = 2;
  canvas.width = exercises.length * (cell + gap);
  canvas.height = muscles.length * (cell + gap);
  const context = canvas.getContext("2d");
  exercises.forEach((exercise, column) => {
    muscles.forEach((muscle, row) => {
      const value = exercise.values[muscle.index];
      context.fillStyle = value === 0 ? "rgba(255,255,255,0.05)" : cellColor(value);
      context.fillRect(column * (cell + gap), row * (cell + gap), cell, cell);
    });
  });
  canvas.classList.add("is-drawn");
}

function renderMatrix(container, matrix) {
  const canvas = container.querySelector("[data-matrix-canvas]");
  const rowsLabel = container.querySelector("[data-matrix-rows]");
  const inspector = container.querySelector("[data-matrix-inspector]");
  const search = container.querySelector("[data-matrix-search]");
  const options = container.querySelector("[data-matrix-options]");
  const picks = [...container.querySelectorAll("[data-matrix-pick]")];
  const lookup = buildExerciseMuscleLookup(matrix);
  const exercises = orderExercisesForDisplay(matrix);
  const muscles = orderMusclesForDisplay(matrix.muscles);
  const context = canvas.getContext("2d");
  const groupGap = 5;
  let layout = null;
  let selected = exercises.findIndex((exercise) => exercise.name === HERO_EXERCISE);
  let hovered = -1;
  let revealProgress = prefersReducedMotion() ? 1 : 0;

  options.replaceChildren(...[...matrix.exercises].sort((a, b) => a.name.localeCompare(b.name)).map((exercise) => {
    const option = document.createElement("option");
    option.value = exercise.name;
    return option;
  }));

  const rowOffsets = [];
  const computeLayout = () => {
    const available = container.querySelector(".matrix-scroll").clientWidth;
    const cellWidth = Math.max(4, Math.floor(available / exercises.length));
    const rowHeight = available < 700 ? 8 : 11;
    rowOffsets.length = 0;
    let y = 0;
    muscles.forEach((muscle, index) => {
      if (index > 0 && muscle.code !== muscles[index - 1].code) y += groupGap;
      rowOffsets.push(y);
      y += rowHeight;
    });
    layout = { cellWidth, rowHeight, width: cellWidth * exercises.length, height: y };
    const ratio = window.devicePixelRatio || 1;
    canvas.width = layout.width * ratio;
    canvas.height = layout.height * ratio;
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    rowsLabel.replaceChildren();
    rowsLabel.style.height = `${layout.height}px`;
    for (const code of DISPLAY_GROUP_ORDER) {
      const indexes = muscles.map((muscle, index) => (muscle.code === code ? index : -1)).filter((index) => index >= 0);
      const top = rowOffsets[indexes[0]];
      const bottom = rowOffsets[indexes.at(-1)] + layout.rowHeight;
      const label = document.createElement("span");
      label.textContent = UI_MUSCLE_GROUPS[code].name;
      label.style.top = `${top}px`;
      label.style.height = `${bottom - top}px`;
      label.dataset.group = code;
      rowsLabel.append(label);
    }
  };

  const draw = () => {
    if (!layout) return;
    const { cellWidth, rowHeight, width, height } = layout;
    context.clearRect(0, 0, width, height);
    const visibleColumns = Math.ceil(exercises.length * revealProgress);
    const focus = hovered >= 0 ? hovered : selected;
    exercises.slice(0, visibleColumns).forEach((exercise, column) => {
      muscles.forEach((muscle, row) => {
        const value = exercise.values[muscle.index];
        context.fillStyle = cellColor(value);
        context.globalAlpha = focus >= 0 && column !== focus && value > 0 ? 0.82 : 1;
        context.fillRect(column * cellWidth, rowOffsets[row], Math.max(cellWidth - 1, 1), rowHeight - 1);
      });
    });
    context.globalAlpha = 1;
    if (focus >= 0 && revealProgress >= 1) {
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1.5;
      context.strokeRect(focus * cellWidth - 1, 0.75, cellWidth + 1, height - 1.5);
    }
    const focusExercise = exercises[focus];
    for (const label of rowsLabel.children) {
      const code = label.dataset.group;
      const active = focusExercise?.values.some((value, index) => value > 0 && MUSCLE_GROUP_BY_HEADER[matrix.muscles[index]] === code);
      label.classList.toggle("is-active", Boolean(active));
    }
  };

  const inspect = (column) => {
    const exercise = exercises[column];
    if (!exercise) return;
    const contributions = muscles
      .map((muscle) => ({ ...muscle, value: exercise.values[muscle.index] }))
      .filter((muscle) => muscle.value > 0)
      .sort((a, b) => b.value - a.value || DISPLAY_GROUP_ORDER.indexOf(a.code) - DISPLAY_GROUP_ORDER.indexOf(b.code));
    const groups = weightedSetsForOneSet(lookup, exercise.name);
    const zeroCount = matrix.muscles.length - contributions.length;

    const heading = document.createElement("div");
    heading.className = "inspector-head";
    const kicker = document.createElement("span");
    kicker.textContent = `Exercise ${column + 1} of ${exercises.length}`;
    const name = document.createElement("strong");
    name.textContent = exercise.name;
    heading.append(kicker, name);

    const list = document.createElement("ul");
    list.className = "inspector-muscles";
    for (const contribution of contributions) {
      const item = document.createElement("li");
      item.style.setProperty("--v", String(contribution.value));
      item.title = relevanceLevelLabel(contribution.value);
      const label = document.createElement("span");
      label.textContent = contribution.name;
      const value = document.createElement("b");
      value.textContent = contribution.value.toFixed(2);
      item.append(label, value);
      list.append(item);
    }

    const groupSummary = document.createElement("p");
    groupSummary.className = "inspector-groups";
    groupSummary.textContent = `One hard set counts as ${groups.map((group) => `${group.name} ${group.value.toFixed(2)}`).join(" · ")} weighted sets.`;

    const zeroes = document.createElement("p");
    zeroes.className = "inspector-zero";
    zeroes.textContent = `${zeroCount} of ${matrix.muscles.length} muscles are explicitly rated 0 for this exercise.`;

    const unit = document.createElement("p");
    unit.className = "inspector-zero";
    unit.textContent = "Equipment is recorded with each logged exercise; dumbbell loads are always logged per dumbbell.";
    inspector.replaceChildren(heading, list, groupSummary, zeroes, unit);
  };

  const columnFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const column = Math.floor((event.clientX - rect.left) / layout.cellWidth);
    return column >= 0 && column < exercises.length ? column : -1;
  };

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const column = columnFromEvent(event);
    if (column === hovered) return;
    hovered = column;
    if (column >= 0) inspect(column);
    draw();
  });
  canvas.addEventListener("pointerleave", () => {
    hovered = -1;
    if (selected >= 0) inspect(selected);
    draw();
  });
  canvas.addEventListener("click", (event) => {
    const column = columnFromEvent(event);
    if (column < 0) return;
    selected = column;
    search.value = exercises[column].name;
    inspect(column);
    draw();
  });

  const selectByName = (name) => {
    const column = exercises.findIndex((exercise) => exercise.name.toLowerCase() === name.trim().toLowerCase());
    if (column < 0) return false;
    selected = column;
    hovered = -1;
    search.value = exercises[column].name;
    for (const pick of picks) pick.setAttribute("aria-pressed", String(pick.dataset.matrixPick === exercises[column].name));
    inspect(column);
    draw();
    return true;
  };
  search.addEventListener("input", () => selectByName(search.value));
  search.addEventListener("change", () => selectByName(search.value));
  for (const pick of picks) {
    pick.setAttribute("aria-pressed", "false");
    pick.addEventListener("click", () => selectByName(pick.dataset.matrixPick));
  }

  computeLayout();
  if (selected >= 0) {
    search.value = exercises[selected].name;
    inspect(selected);
  }
  draw();

  let resizeFrame = 0;
  new ResizeObserver(() => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
      computeLayout();
      draw();
    });
  }).observe(container.querySelector(".matrix-scroll"));

  if (revealProgress < 1) {
    const observer = whenVisible(canvas, (visible) => {
      if (!visible) return;
      observer.disconnect();
      const startTime = performance.now();
      const step = (now) => {
        revealProgress = Math.min(1, (now - startTime) / 1400);
        draw();
        if (revealProgress < 1) window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    }, { threshold: 0.2 });
  }
}

export function initPublicShowcase(root = document.querySelector("#signed-out")) {
  if (!root || root.dataset.showcaseReady === "true") return;
  root.dataset.showcaseReady = "true";
  initReveal(root);
  initHeroDemo(root);
  initTour(root);
  initStory(root);
  initLab(root);
  initMatrix(root);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initPublicShowcase());
  else initPublicShowcase();
}
