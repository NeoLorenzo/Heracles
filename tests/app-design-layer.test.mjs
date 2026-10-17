import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { datePosition, getAdaptiveDateTicks } from "../features/dashboard.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function selectorsOf(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith("@")) continue;
    const parts = selector.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.every((part) => /^(from|to|\d+(\.\d+)?%)$/.test(part))) continue;
    selectors.push(...parts);
  }
  return selectors;
}

test("authenticated design layer loads after the shared and public stylesheets and is precached", async () => {
  const [html, serviceWorker] = await Promise.all([read("index.html"), read("service-worker.js")]);
  const styles = html.indexOf('href="./styles.css?v=26"');
  const publicCss = html.indexOf('href="./public.css?v=4"');
  const appCss = html.indexOf('href="./app.css?v=1"');
  assert.ok(styles > -1 && publicCss > styles && appCss > publicCss, "app.css must load last");
  assert.ok(serviceWorker.includes('"/app.css?v=1"'), "app.css must be precached for the offline shell");
  assert.ok(serviceWorker.includes(`"/${html.match(/src="\.\/(app\.js\?v=\d+)"/)[1]}"`), "precached app.js version must match index.html");
});

test("authenticated design layer never styles the signed-out public site", async () => {
  const css = await read("app.css");
  const unscoped = selectorsOf(css).filter((selector) => !/^(#signed-in|body\.is-authenticated)\b/.test(selector));
  assert.deepEqual(unscoped, []);
  assert.doesNotMatch(css, /font-family:\s*"?Inter"?\s*;/, "the webfont uses a private family name so public typography is unchanged");
  assert.match(css, /font-family: "Heracles Inter";/);
});

test("authenticated design layer uses Fabbro tokens and reserves the Heracles accent for primary actions", async () => {
  const css = await read("app.css");
  assert.match(css, /--hx-accent: var\(--fs-accent\)/);
  assert.match(css, /#signed-in \.primary-button,[\s\S]*?background: var\(--hx-accent\);[\s\S]*?color: var\(--hx-on-accent\);/);
  assert.doesNotMatch(css, /#2563eb|#1d4ed8|#3b82f6/i, "legacy blue primary colours must not return");
  assert.match(css, /#signed-in \.change-positive > strong \{[\s\S]*?var\(--hx-positive\)/);
  assert.match(css, /--hx-positive: #4ade80;/);
  assert.match(css, /--hx-negative: #fb7185;/);
});

test("home shows an owner-scoped recent-session list beside the start or resume action", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
  const home = html.slice(html.indexOf('id="home-page"'), html.indexOf('id="session-history-page"'));
  assert.match(home, /id="home-hero" class="home-hero" data-state="loading"/);
  assert.match(home, /id="start-session"[^>]*>Loading session/);
  assert.match(home, /id="home-recent-list"/);
  assert.match(home, /data-page-link="session-history"/);
  assert.match(app, /async function loadHomeRecentSessions\(supabase\)[\s\S]*?\.from\("workout_sessions"\)[\s\S]*?\.eq\("owner_id", requestedUserId\)[\s\S]*?\.limit\(HOME_RECENT_SESSION_LIMIT\)/);
  assert.match(app, /exercise_sets \?\? \[\]\)\.filter\(isAnalyticalWorkingSet\)/, "recent working-set counts use the shared analytical set rule");
  assert.match(app, /if \(pageName === "home" && activeUserId && supabaseClient\) \{\s*void loadHomeRecentSessions\(supabaseClient\);/);
});

test("session history renders sets as a table whose load header carries the per-dumbbell unit", async () => {
  const app = await read("app.js");
  assert.match(app, /sets\.className = "set-table"/);
  assert.match(app, /\["set-load", "Load", weightUnit\]/);
  assert.match(app, /const weightUnit = formatWeightUnit\(exercise\.exercises\.name, equipmentName\)/);
  assert.match(app, /formatSetClassification\(set\)/);
});

test("progression date ticks are spaced by chart position so neighbouring labels do not collide", () => {
  const dates = ["2026-08-14", "2026-08-21", "2026-08-31", "2026-09-08", "2026-09-15", "2026-09-21", "2026-09-28"];
  const ticks = getAdaptiveDateTicks(dates, 430);
  assert.equal(ticks[0], dates[0]);
  assert.equal(ticks.at(-1), dates.at(-1));
  const minimumGap = (100 / 430) * 96;
  for (let index = 1; index < ticks.length; index += 1) {
    assert.ok(datePosition(ticks[index], dates) - datePosition(ticks[index - 1], dates) >= minimumGap, `${ticks[index - 1]} and ${ticks[index]} overlap`);
  }
});

test("dense progression charts label only the latest point per series", async () => {
  const dashboard = await read("features/dashboard.js");
  assert.match(dashboard, /plot\.classList\.toggle\("is-dense", points\.length > 6\)/);
  assert.match(dashboard, /if \(latestPoints\.has\(point\)\) marker\.classList\.add\("is-latest"\)/);
  const css = await read("app.css");
  assert.match(css, /\.progression-plot\.is-dense \.progression-marker:not\(\.is-latest\) \.progression-marker-value \{\s*opacity: 0;/);
});
