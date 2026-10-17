import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createDashboardFeature,
  createProgressionScale,
  datePosition,
  deriveProgressionObservation,
  formatProgressionAnnotation,
  formatEquipmentLabel,
  getAdaptiveDateTicks,
} from "../features/dashboard.js";

test("formats progression equipment labels from names with defensive fallbacks", () => {
  assert.equal(formatEquipmentLabel({ equipment_id: 42, equipment_name: "Prime Leg Extension" }), "Prime Leg Extension");
  assert.equal(formatEquipmentLabel({ equipment_id: 42, equipment_name: "  " }), "42");
  assert.equal(formatEquipmentLabel({ equipment_id: null, equipment_name: null }), "Not recorded");
});

test("exports createDashboardFeature factory function", () => {
  assert.equal(typeof createDashboardFeature, "function");
});

test("createDashboardFeature returns lifecycle and invalidation API", () => {
  const feature = createDashboardFeature({
    getClient: () => null,
    getUserId: () => "user-123",
    getActivePageName: () => "home",
    ensureExerciseMuscleLookup: async () => new Map(),
    ensureBodyWeightState: async () => ({}),
    getBodyWeightState: () => ({ dailySeries: [], effectiveRelativeEnabled: false }),
    resolveOneRepMaxRange: () => null,
  });

  assert.equal(typeof feature.load, "function");
  assert.equal(typeof feature.invalidate, "function");
  assert.equal(typeof feature.reset, "function");
});

test("dashboard feature preserves pure analytics layer separation", async () => {
  const source = await readFile(new URL("../features/dashboard.js", import.meta.url), "utf8");

  assert.match(source, /import \{[\s\S]*\} from "\.\.\/analytics\.js";/);
  assert.doesNotMatch(source, /weight\s*\*\s*reps/i);
  assert.match(source, /export function createDashboardFeature/);
});

test("dashboard synchronizes contextual range controls and keeps progression history compact", async () => {
  const source = await readFile(new URL("../features/dashboard.js", import.meta.url), "utf8");

  assert.match(source, /querySelectorAll\("\[data-dashboard-range\]"\)/);
  assert.match(source, /syncRangeControls\(\);/);
  assert.match(source, /button\.setAttribute\("aria-pressed", String\(button\.dataset\.dashboardRange === dashboardRange\)\)/);
  assert.match(source, /`e1RM \$\{formatOneRepMaxRange\(display\)\} \$\{display\.unit\}`/);
  assert.match(source, /`RIR \$\{record\.reported_rir_bucket\}`/);
  assert.match(source, /function formatOneRepMaxRange\(display\)/);
  assert.match(source, /date\.textContent = formatHistoryDate\(record\.performed_on\)/);
  assert.match(source, /function formatHistoryDate\(value\)/);
  assert.match(source, /padStart\(2, "0"\)/);
  assert.match(source, /\$\{formatDecimal\(Number\(record\.weight\)\)\} \$\{formatWeightUnit\(record\.exercise_name, record\.equipment_name\)\}/);
  assert.match(source, /formatEquipmentLabel\(record\)/);
  assert.match(source, /formatEquipmentLabel\(sample\)/);
  assert.match(source, /formatEquipmentLabel\(point\.record\)/);
  assert.doesNotMatch(source, /: `Equipment \$\{equipmentId\}`/);
  assert.match(source, /E1RM_MODELS\.map\(\(model\) => `\$\{model\.label\}: \$\{formatOneRepMaxValue/);
});

test("dashboard muscle exposure begins unselected and supports toggle and outside deselection", async () => {
  const source = await readFile(new URL("../features/dashboard.js", import.meta.url), "utf8");

  assert.match(source, /let selectedDashboardGroup = null;/);
  assert.match(source, /selectedDashboardGroup === button\.dataset\.muscleGroup \? null : button\.dataset\.muscleGroup/);
  assert.match(source, /document\.addEventListener\("click", \(event\) => \{/);
  assert.match(source, /event\.stopPropagation\(\);/);
  assert.match(source, /muscleExposureInteraction\?\.contains\(event\.target\)/);
  assert.match(source, /selectedDashboardGroup = null;[\s\S]*renderDashboard\(\);/);
  assert.match(source, /muscleTrendPanel\.hidden = true/);
  assert.match(source, /exerciseSourcesSection\.hidden = true/);
  assert.match(source, /muscleTrendPanel\.hidden = false/);
  assert.match(source, /exerciseSourcesSection\.hidden = false/);
  assert.doesNotMatch(source, /const highestGroup =/);
});

test("contextual header swaps the one active dashboard range selector", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="dashboard-page-range"/);
  assert.match(html, /id="contextual-dashboard-range"[\s\S]*hidden/);
  assert.match(app, /const isDashboardRangeContextual = activePageName === "my-data" && isContextual;/);
  assert.match(app, /contextualDashboardRange\.hidden = !isDashboardRangeContextual/);
  assert.match(app, /dashboardPageRange\.hidden = isDashboardRangeContextual/);
  assert.match(styles, /\.contextual-range-control/);
});

test("muscle detail sections are hidden until a group is selected", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /id="muscle-trend-panel"[^>]*hidden/);
  assert.match(html, /id="exercise-sources-section"[^>]*hidden/);
});

test("progression observations retain all four estimates and derive their visual envelope", () => {
  const values = { observedBrzycki: 190.2, observedEpley: 192.1, adjustedBrzycki: 194.4, adjustedEpley: 196.3 };
  const observation = deriveProgressionObservation({ equipment_id: "Machine A", performed_on: "2026-08-10" }, { values });

  assert.deepEqual(observation.values, values);
  assert.equal(observation.low, 190.2);
  assert.equal(observation.high, 196.3);
  assert.equal(observation.seriesKey, "equipment-Machine A");
});

test("progression annotation collapses equal formatted endpoints and otherwise shows a range", () => {
  assert.equal(formatProgressionAnnotation({ low: 191.2, high: 191.4 }, false), "191");
  assert.equal(formatProgressionAnnotation({ low: 1.921, high: 1.974 }, true), "1.92–1.97");
});

test("progression scale uses visible values and does not force a zero baseline", () => {
  const scale = createProgressionScale([190.2, 196.3, 201.1]);
  assert.ok(scale.minimum > 0);
  assert.ok(scale.minimum < 190.2);
  assert.ok(scale.maximum > 201.1);
  assert.ok(scale.ticks.length >= 4 && scale.ticks.length <= 6);
});

test("progression date axis spaces actual dates and reduces ticks on narrow layouts", () => {
  const dates = ["2025-12-31", "2026-01-01", "2026-01-10", "2026-03-15", "2026-08-20", "2026-08-21"];
  assert.ok(datePosition(dates[1], dates) < 3);
  assert.ok(datePosition(dates[4], dates) > 90);
  const narrow = getAdaptiveDateTicks(dates, 168);
  const wide = getAdaptiveDateTicks(dates, 504);
  assert.deepEqual(narrow, [dates[0], dates.at(-1)]);
  assert.equal(wide[0], dates[0]);
  assert.equal(wide.at(-1), dates.at(-1));
  assert.ok(wide.length > narrow.length);
});

test("progression uses equipment toggle pills instead of formula legend entries", async () => {
  const source = await readFile(new URL("../features/dashboard.js", import.meta.url), "utf8");

  assert.match(source, /className = "progression-series-pill"/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /hiddenProgressionSeries/);
  assert.match(source, /visibleObservations = observations\.filter/);
  assert.match(source, /class", "progression-band"/);
  assert.doesNotMatch(source, /for \(const model of E1RM_MODELS\) \{[\s\S]{0,180}legend\.append/);
});

test("ISSUE 22: a canonical exercise mixing dumbbell and barbell series labels dumbbell loads per dumbbell", async () => {
  const { formatProgressionUnit } = await import("../features/dashboard.js");
  const barbell = { exercise_name: "Chest Press (Incline 30)", equipment_name: "Barbell" };
  const dumbbell = { exercise_name: "Chest Press (Incline 30)", equipment_name: "Dumbbell" };
  assert.equal(formatProgressionUnit([barbell]), "kg");
  assert.equal(formatProgressionUnit([dumbbell]), "kg per dumbbell");
  assert.equal(formatProgressionUnit([dumbbell], true), "× BW per dumbbell");
  assert.equal(formatProgressionUnit([barbell, dumbbell]), "kg; dumbbell series per dumbbell");
  assert.equal(formatProgressionUnit([barbell, dumbbell], true), "× BW; dumbbell series per dumbbell");
});
