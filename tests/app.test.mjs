import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("ships an installable app shell", async () => {
  const [html, manifest, serviceWorker, app] = await Promise.all([
    read("index.html"),
    read("manifest.webmanifest"),
    read("service-worker.js"),
    read("app.js"),
  ]);

  assert.match(html, /rel="manifest"/);
  assert.match(html, /id="google-sign-in"/);
  assert.match(html, />\s*Sign in\s*<\/button>/);
  assert.match(html, /id="start-session"/);
  assert.match(html, />Loading session…<\/button>/);
  assert.match(html, /data-page="session-history"/);
  assert.match(html, /data-page-panel="session-history"/);
  assert.match(html, /data-page="my-stuff"/);
  assert.match(html, /data-page-panel="my-stuff"/);
  assert.match(app, /"my-stuff": "My Stuff"/);
  assert.match(html, /<h1>Session history<\/h1>/);
  assert.match(html, /id="lift-list"/);
  assert.match(html, /id="load-more"/);
  assert.ok(html.indexOf('data-page-panel="home"') < html.indexOf('data-page-panel="session-history"'));
  assert.ok(html.indexOf('data-page-panel="session-history"') < html.indexOf('id="lift-list"'));
  assert.doesNotMatch(html, /Hello world/i);
  assert.equal(JSON.parse(manifest).display, "standalone");
  assert.match(serviceWorker, /addEventListener\("fetch"/);
});

test("ships a crawlable public science and product overview", async () => {
  const [html, app, styles, robots, sitemap] = await Promise.all([
    read("index.html"),
    read("app.js"),
    read("styles.css"),
    read("robots.txt"),
    read("sitemap.xml"),
  ]);

  assert.match(html, /id="signed-out" class="public-site"/);
  assert.match(html, /id="google-sign-in"[\s\S]*Sign in/);
  assert.ok(html.indexOf("public-brand") < html.indexOf('id="google-sign-in"'));
  assert.match(html, /Know what your training data actually means/);
  assert.match(html, /id="how-it-works"/);
  assert.match(html, /id="principles"/);
  assert.match(html, /id="literature"/);
  assert.match(html, /116[\s\S]*catalogued exercises/);
  assert.match(html, /40[\s\S]*detailed muscle entities/);
  assert.match(html, /thirteen broader groups keep the interface readable/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /name="description"/);
  assert.match(html, /name="robots"/);
  assert.match(html, /href="\?literature=study-selection"/);
  assert.match(html, /href="\?literature=no-tonnage"/);
  assert.match(app, /openPublicLiteratureDocument/);
  assert.match(app, /window\.history\.pushState/);
  assert.match(styles, /\.public-nav/);
  assert.match(styles, /\.public-hero/);
  assert.match(styles, /\.public-library-grid/);
  assert.match(robots, /Allow: \//);
  assert.match(robots, /sitemap\.xml/i);
  assert.match(sitemap, /https:\/\/heracles\.fabbrosystems\.com\//);
});

test("keeps signed-in application pages in explicit URL-backed history state", async () => {
  const app = await read("app.js");

  assert.match(app, /const URL_BACKED_SIGNED_IN_PAGES = new Set\(\[[\s\S]*"live-session"[\s\S]*"session-history"[\s\S]*"my-data"[\s\S]*"my-stuff"[\s\S]*"literature"[\s\S]*"settings"/);
  assert.match(app, /function readSignedInPageFromUrl\(\)[\s\S]*URL_BACKED_SIGNED_IN_PAGES\.has\(pageName\) \? pageName : "home"/);
  assert.match(app, /function synchronizeSignedInPageUrl\(pageName, \{ replace = false \} = \{\}\)[\s\S]*pageName === "home"\) url\.searchParams\.delete\("page"\)[\s\S]*url\.searchParams\.set\("page", pageName\)[\s\S]*window\.history\.replaceState[\s\S]*window\.history\.pushState/);
  assert.match(app, /if \(url\.href === window\.location\.href\) return/);
  assert.match(app, /const pageName = readSignedInPageFromUrl\(\);[\s\S]*synchronizeSignedInPageUrl\(pageName, \{ replace: true \}\);[\s\S]*showPage\(pageName, \{ updateHistory: false \}\);/);
  assert.match(app, /if \(!signedInView\.hidden\) \{[\s\S]*showPage\(readSignedInPageFromUrl\(\), \{ updateHistory: false \}\);[\s\S]*return;[\s\S]*const documentId = new URLSearchParams\(window\.location\.search\)\.get\("literature"\)/);
  assert.match(app, /function showPage\(pageName, \{ updateHistory = true \} = \{\}\)[\s\S]*URL_BACKED_SIGNED_IN_PAGES\.has\(pageName\)[\s\S]*synchronizeSignedInPageUrl\(pageName\)/);
  assert.match(app, /url\.searchParams\.delete\("literature"\)/);
  const signedInPageSet = app.slice(
    app.indexOf("const URL_BACKED_SIGNED_IN_PAGES"),
    app.indexOf("function readSignedInPageFromUrl"),
  );
  const routeSynchronization = app.slice(
    app.indexOf("function synchronizeSignedInPageUrl"),
    app.indexOf("function showPage"),
  );
  assert.doesNotMatch(signedInPageSet, /"document"/);
  assert.doesNotMatch(routeSynchronization, /workout_sessions|loadActiveSession|activeWorkoutSession/);
});

test("provides a dependency-free local development command", async () => {
  const [packageJson, devServer] = await Promise.all([
    read("package.json"),
    read("scripts/dev-server.mjs"),
  ]);

  assert.equal(JSON.parse(packageJson).scripts.dev, "node scripts/dev-server.mjs");
  assert.match(devServer, /Cache-Control": "no-store"/);
  assert.match(devServer, /5173/);
});

test("uses Google OAuth without privileged credentials", async () => {
  const [app, config] = await Promise.all([read("app.js"), read("config.js")]);
  const assignments = config
    .split("\n")
    .filter((line) => line.startsWith("export const"))
    .join("\n");

  assert.match(app, /provider: "google"/);
  assert.match(app, /flowType: "pkce"/);
  assert.match(app, /\.from\("workout_sessions"\)/);
  assert.match(app, /\.from\("exercises"\)/);
  assert.match(app, /\.eq\("is_active", true\)/);
  assert.doesNotMatch(app, /\.from\("exercises"\)[\s\S]{0,250}\.eq\("owner_id"/);
  assert.match(app, /\.order\("name", \{ ascending: true \}\)/);
  assert.match(app, /session_exercises\$\{requestedSearch[\s\S]+\}\(id, exercise_id, exercise_order, equipment_id, exercises/);
  assert.match(app, /"session-history": "Session history"/);
  assert.match(app, /is_warmup/);
  assert.match(app, /is_drop_set/);
  assert.match(app, /is_superset/);
  assert.match(app, /estimated_1rm_brzycki/);
  assert.match(app, /estimated_1rm_epley/);
  assert.match(app, /reported_rir_bucket/);
  assert.match(app, /estimated_1rm_brzycki_rir_adjusted/);
  assert.match(app, /estimated_1rm_epley_rir_adjusted/);
  assert.match(app, /supabase-js@\d+\.\d+\.\d+/);
  assert.doesNotMatch(app, /supabase-js@2(?:["/])/);
  assert.doesNotMatch(assignments, /service[_-]?role/i);
  assert.doesNotMatch(assignments, /client[_-]?secret/i);
});

test("uses global versioned exercise and movement reference data", async () => {
  const [catalogueMigration, movementMigration, catalogueSyncMigration, consolidationMigration, muscleMigration, hardeningMigration] = await Promise.all([
    read("supabase/migrations/20260806153407_create_exercise_catalogue.sql"),
    read("supabase/migrations/20260807140438_global_exercise_and_movement_model.sql"),
    read("supabase/migrations/20260810182625_add_close_grip_incline_press.sql"),
    read("supabase/migrations/20260810195322_consolidate_exercise_definitions.sql"),
    read("supabase/migrations/20260810183743_create_muscle_catalogue.sql"),
    read("supabase/migrations/20260820174224_harden_canonical_workout_store.sql"),
  ]);

  assert.doesNotMatch(movementMigration, /add column equipment_id/);
  assert.match(movementMigration, /drop column owner_id/);
  assert.match(hardeningMigration, /drop table public\.exercise_aliases/);
  assert.match(movementMigration, /create table public\.movement_patterns/);
  assert.match(movementMigration, /create table public\.movement_mapping_versions/);
  assert.match(movementMigration, /create table public\.exercise_movement_pattern_coefficients/);
  assert.match(movementMigration, /numeric\(4, 3\).*between 0 and 1/);
  assert.match(movementMigration, /5600/);
  assert.match(movementMigration, /where coefficient > 0/);
  assert.match(movementMigration, /grant select on public\.exercises/);
  assert.match(movementMigration, /from anon, authenticated/);
  assert.match(catalogueMigration, /alter column exercise_id set not null/);
  assert.match(catalogueSyncMigration, /catalogue_sync_2026_08_10/);
  assert.match(catalogueSyncMigration, /Press \(Machine\) \(Incline\) \(Plate Loaded\) \(Close Grip\)/);
  assert.match(catalogueSyncMigration, /141/);
  assert.match(catalogueSyncMigration, /5640/);
  assert.match(consolidationMigration, /exercise_definitions_2026_08_10/);
  assert.match(consolidationMigration, /Consolidated 138 by 40 movement-pattern matrix/);
  assert.match(consolidationMigration, /exercise_press_machine_incline_plate_loaded_close_neutral_grip/);
  assert.match(consolidationMigration, /5520/);
  assert.match(consolidationMigration, /1152/);
  assert.match(consolidationMigration, /56a34dfe0c65f4e95d706190c05baf9defd743994225ac7e897d3cff64d9465c/);
  assert.match(muscleMigration, /create table public\.muscles/);
  assert.match(muscleMigration, /generated always as identity primary key/);
  assert.match(muscleMigration, /Authenticated users can read muscles/);
  assert.match(muscleMigration, /grant select on table public\.muscles to authenticated/);
  assert.match(muscleMigration, /from anon, authenticated/);
  assert.match(muscleMigration, /count\(\*\) from public\.muscles\) <> 40/);
  const movementMuscleMigration = await read("supabase/migrations/20260810184959_create_movement_pattern_muscle_matrix.sql");
  assert.match(movementMuscleMigration, /create table public\.movement_muscle_mapping_versions/);
  assert.match(movementMuscleMigration, /create table public\.movement_pattern_muscle_coefficients/);
  assert.match(movementMuscleMigration, /1600/);
  assert.match(movementMuscleMigration, /112/);
  assert.match(movementMuscleMigration, /coefficient between 0 and 1/);
  assert.match(movementMuscleMigration, /from anon, authenticated/);
  const exerciseMuscleMigration = await read("supabase/migrations/20260810194801_create_exercise_muscle_matrix.sql");
  assert.match(exerciseMuscleMigration, /create table public\.exercise_muscle_mapping_versions/);
  assert.match(exerciseMuscleMigration, /create table public\.exercise_muscle_coefficients/);
  assert.match(exerciseMuscleMigration, /raw_sum_product_v1/);
  assert.match(exerciseMuscleMigration, /sum\(exercise_pattern\.coefficient \* pattern_muscle\.coefficient\)/);
  assert.match(exerciseMuscleMigration, /5640/);
  assert.match(exerciseMuscleMigration, /1171/);
  assert.match(exerciseMuscleMigration, /from anon, authenticated/);
});

test("keeps the authoritative movement-to-muscle source intact", async () => {
  const [matrix, documentation, importScript, indexMigration] = await Promise.all([
    read("Movement_Pattern_to_Muscle_Function_Matrix.csv"),
    read("docs/MOVEMENT_PATTERN_TO_MUSCLE_FUNCTION.md"),
    read("scripts/prepare_movement_muscle_import.py"),
    read("supabase/migrations/20260810185010_index_movement_pattern_muscle_foreign_key.sql"),
  ]);
  const rows = matrix.trim().split(/\r?\n/).map((row) => row.split(","));
  const coefficients = rows.slice(1).flatMap((row) => row.slice(1).map(Number));

  assert.equal(rows.length, 41);
  assert.ok(rows.every((row) => row.length === 41));
  assert.equal(coefficients.length, 1600);
  assert.equal(coefficients.filter((value) => value > 0).length, 112);
  assert.ok(coefficients.every((value) => value >= 0 && value <= 1));
  assert.equal(
    createHash("sha256").update(matrix).digest("hex"),
    "c0664168df7b971c84e24d5a9cebdf04ffde3c09c5eda8726a16559e539e50e2",
  );
  assert.match(documentation, /^# Movement Pattern → Muscle Function Matrix/);
  assert.match(documentation, /not percentages/i);
  assert.match(importScript, /PATTERN_ALIASES/);
  assert.match(indexMigration, /movement_pattern_muscle_coefficients_pattern_idx/);
});

test("documents the derived exercise-to-muscle matrix without overstating it", async () => {
  const [documentation, derivationScript] = await Promise.all([
    read("docs/EXERCISE_MUSCLE_COMPOSITION.md"),
    read("scripts/derive_exercise_muscle_matrix.py"),
  ]);

  assert.match(documentation, /^# Exercise × Muscle Functional Composition Matrix/);
  assert.match(documentation, /ordinary matrix multiplication/i);
  assert.match(documentation, /No row or column is normalized/i);
  assert.match(documentation, /not capped at `1\.0`/i);
  assert.match(documentation, /not a direct exercise-to-muscle hypertrophy matrix/i);
  assert.match(documentation, /5d2aa404f975039f337aea446bf07e3fbad6c299786858fab9c62e2f0419cdf5/);
  assert.match(derivationScript, /raw_sum_product_v1/);
  assert.match(derivationScript, /sum\(products, Decimal\(0\)\)/);
});

test("uses the authored exercise-to-muscle hypertrophic relevance layer", async () => {
  const [matrix, catalogue, functionalMatrix, documentation, importScript, migration, app] = await Promise.all([
    read("EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.csv"),
    read("Movement Pattern Mapping Matrix - Mapping_Matrix.csv"),
    read("Movement_Pattern_to_Muscle_Function_Matrix.csv"),
    read("docs/EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.md"),
    read("scripts/prepare_exercise_muscle_relevance_import.py"),
    read("supabase/migrations/20260810203718_add_exercise_muscle_hypertrophic_relevance.sql"),
    read("app.js"),
  ]);
  const rows = matrix.trim().split(/\r?\n/).map((row) => row.split(","));
  const catalogueNames = catalogue.trim().split(/\r?\n/).slice(1).map((row) => row.split(",", 1)[0]);
  const functionalHeaders = functionalMatrix.split(/\r?\n/, 1)[0].split(",").slice(1);
  const coefficients = rows.slice(1).flatMap((row) => row.slice(1).map(Number));
  const names = rows.slice(1).map((row) => row[0]);

  assert.equal(rows.length, 139);
  assert.ok(rows.every((row) => row.length === 41));
  assert.deepEqual(rows[0].slice(1), functionalHeaders);
  assert.deepEqual([...names].sort(), [...catalogueNames].sort());
  assert.equal(new Set(names).size, 138);
  assert.equal(coefficients.length, 5520);
  assert.equal(coefficients.filter((value) => value > 0).length, 723);
  assert.equal(coefficients.filter((value) => value === 0.25).length, 141);
  assert.equal(coefficients.filter((value) => value === 0.5).length, 178);
  assert.equal(coefficients.filter((value) => value === 0.75).length, 218);
  assert.equal(coefficients.filter((value) => value === 1).length, 186);
  assert.ok(coefficients.every((value) => [0, 0.25, 0.5, 0.75, 1].includes(value)));
  assert.equal(
    createHash("sha256").update(matrix.replace(/\r\n/g, "\n")).digest("hex"),
    "506cd478b08fa1289cf2c9263e92aa68296a92e82380919321f708a54d72c3b8",
  );
  assert.match(documentation, /^# Exercise → Muscle Hypertrophic Relevance Matrix/);
  assert.match(documentation, /not percentages/i);
  assert.match(documentation, /506cd478b08fa1289cf2c9263e92aa68296a92e82380919321f708a54d72c3b8/);
  assert.match(documentation, /ea447d03fdc8284768512a47fb713a5670bfd7f507155df8bbf3337285b3de3f/);
  assert.match(importScript, /ALLOWED_COEFFICIENTS/);
  assert.match(importScript, /exercise rows do not exactly match the current catalogue/);
  assert.match(migration, /create table public\.exercise_muscle_relevance_versions/);
  assert.match(migration, /create table public\.exercise_muscle_relevance_coefficients/);
  assert.match(migration, /relevance in \(0, 0\.25, 0\.50, 0\.75, 1\.00\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /from anon, authenticated/);
  assert.match(migration, /grant select on table public\.exercise_muscle_relevance_coefficients to authenticated/);
  assert.match(app, /\.from\("exercise_muscle_relevance_versions"\)/);
  assert.match(app, /\.from\("exercise_muscle_relevance_coefficients"\)/);
  assert.match(app, /\.gt\("relevance", 0\)/);
});

test("uses exercise-specific names without legacy muscle-group prefixes", async () => {
  const [matrix, hypertrophicRelevance] = await Promise.all([
    read("Movement Pattern Mapping Matrix - Mapping_Matrix.csv"),
    read("EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.csv"),
  ]);
  const names = matrix.trim().split(/\r?\n/).slice(1).map((line) => line.split(",", 1)[0]);
  const relevanceNames = hypertrophicRelevance.trim().split(/\r?\n/).slice(1).map((line) => line.split(",", 1)[0]);
  const legacyPrefix = /^(?:Abs|Adductors|Back|Biceps|Calves|Chest|Forearms|Glutes|Hamstrings|Legs|Quads|Shoulders|Triceps) - /;
  const retiredNames = [
    "Back Extentions (Dumbbell)",
    "Back Extentions (Dumbbell) (45)",
    "Back Extentions (Dumbbell) (55)",
    "Fly (Cable) (Bent Over Standing)",
    "Fly (Cable) (Kneeling)",
    "Fly (Cable) (Seated)",
    "Press (Machine) (Incline) (Plate Loaded) (Close Grip)",
    "Thinker Curls (Cable) (Unilateral)",
    "Curl (Cable) (EZ Bar)",
    "French Press (Cable) (EZ Bar)",
    "Overhead Press (Landmine) (Kneeling)",
    "Pullover (Cable) (EZ Bar)",
  ];

  assert.equal(names.length, 138);
  assert.equal(relevanceNames.length, 138);
  assert.equal(new Set(names).size, 138);
  assert.equal(new Set(relevanceNames).size, 138);
  assert.ok(names.includes("Back Extensions (Dumbbell)"));
  assert.ok(names.includes("Chest Fly (Cable) (Bent Over Standing) (Horizontal)"));
  assert.ok(names.includes("Chest Fly (Cable) (Kneeling) (Horizontal)"));
  assert.ok(names.includes("Chest Fly (Cable) (Seated) (Horizontal)"));
  assert.ok(names.includes("Press (Machine) (Incline) (Plate Loaded) (Close Neutral Grip)"));
  assert.ok(names.includes("Wrist Curls (Cable) (Unilateral)"));
  assert.ok(names.includes("Curl (Cable) (EZ Bar Attachment)"));
  assert.ok(names.includes("French Press (Cable) (EZ Bar Attachment)"));
  assert.ok(names.includes("Overhead Press (Landmine) (Barbell) (Kneeling)"));
  assert.ok(names.includes("Pullover (Cable) (EZ Bar Attachment)"));
  assert.ok(retiredNames.every((name) => !names.includes(name)));
  assert.ok(retiredNames.every((name) => !relevanceNames.includes(name)));
  assert.equal(
    createHash("sha256").update(matrix).digest("hex"),
    "93cc08e6b5c4751f7e8d3b7546a2bf4ea2fc567d25a9aea1f7c85087ceaa6c27",
  );
  assert.equal(names.filter((name) => name.startsWith("Overhead Press")).length, 7);
  assert.equal(names.filter((name) => legacyPrefix.test(name)).length, 0);
  assert.equal(relevanceNames.filter((name) => legacyPrefix.test(name)).length, 0);
});

test("renders collapsed sessions with toggleable exercise-level muscle pills", async () => {
  const [html, app, styles, uiGroupMigration, taxonomy] = await Promise.all([
    read("index.html"),
    read("app.js"),
    read("styles.css"),
    read("supabase/migrations/20260810191604_add_ui_muscle_groups.sql"),
    read("docs/MUSCLE_GROUP_TAXONOMY.md"),
  ]);

  assert.match(app, /session_exercises\$\{requestedSearch[\s\S]+\}\(id, exercise_id, exercise_order/);
  assert.match(app, /\.from\("exercise_muscle_relevance_versions"\)/);
  assert.match(app, /\.from\("exercise_muscle_relevance_coefficients"\)/);
  assert.match(app, /\.from\("muscles"\)/);
  assert.match(app, /ui_muscle_groups\(code, name, source_order\)/);
  assert.match(app, /\.gt\("relevance", 0\)/);
  assert.match(app, /document\.createElement\("details"\)/);
  assert.match(app, /document\.createElement\("summary"\)/);
  assert.match(app, /disclosure\.append\(summary\);[\s\S]*disclosure\.append\(exerciseList\)/);
  assert.doesNotMatch(app, /disclosure\.open\s*=|setAttribute\("open"/);
  assert.match(app, /exercise\.exercise_sets\.some\(isAnalyticalWorkingSet\)/);
  assert.match(app, /className = `muscle-pill muscle-group-\$\{muscle\.uiGroup\.code\}`/);
  assert.match(app, /if \(muscleViews\) item\.append\(muscleViews\)/);
  assert.match(app, /summaryCopy\.append\(heading\)[\s\S]*summaryCopy\.append\(context\)/);
  assert.match(app, /if \(sessionMuscleViews\) summaryCopy\.append\(sessionMuscleViews\)/);
  assert.match(app, /createMuscleViews\(muscles, "session-muscles", "Session"\)/);
  assert.match(app, /createMuscleViews\([\s\S]*"exercise-muscles",[\s\S]*"Exercise"/);
  assert.doesNotMatch(app, /createSessionMusclePills/);
  assert.match(app, /list\.hidden = view !== muscleViewMode/);
  assert.match(app, /list\.dataset\.muscleView !== mode/);
  assert.match(html, /name="muscle-view" value="ui" checked/);
  assert.match(html, /name="muscle-view" value="detailed"/);
  assert.match(html, /Simplified uses UI muscle groups/);
  assert.match(styles, /\.session-summary:focus-visible/);
  assert.match(styles, /\.session-entry\[open\]/);
  assert.match(styles, /\.muscle-pill-list/);
  assert.match(styles, /\.muscle-pill/);
  assert.match(styles, /\.session-entry\[open\] \.session-muscles/);
  assert.match(styles, /\.muscle-group-abs \{ --muscle-hue:/);
  assert.match(styles, /\.muscle-group-triceps \{ --muscle-hue:/);
  assert.match(uiGroupMigration, /create table public\.ui_muscle_groups/);
  assert.match(uiGroupMigration, /add column ui_muscle_group_id bigint/);
  assert.match(uiGroupMigration, /alter column ui_muscle_group_id set not null/);
  assert.match(uiGroupMigration, /Authenticated users can read UI muscle groups/);
  assert.match(uiGroupMigration, /grant select on table public\.ui_muscle_groups to authenticated/);
  assert.match(uiGroupMigration, /count\(\*\) from public\.ui_muscle_groups\) <> 13/);
  assert.match(uiGroupMigration, /count\(distinct ui_muscle_group_id\) from public\.muscles\) <> 13/);
  assert.match(taxonomy, /# 30\. UI muscle groups/);
  assert.match(taxonomy, /UI muscle groups are display aggregations only/);
  assert.match(taxonomy, /`ui_muscle_groups` stores the 13 display groups/);
});

test("provides a modelled muscle-exposure dashboard without tonnage", async () => {
  const [html, app, dashboard, analytics, styles, policy] = await Promise.all([
    read("index.html"),
    read("app.js"),
    read("features/dashboard.js"),
    read("analytics.js"),
    read("styles.css"),
    read("docs/WHY_THE_APP_DOES_NOT_TRACK_TONNAGE.md"),
  ]);

  assert.match(html, /id="menu-toggle"/);
  assert.match(html, /data-page="home"[^>]*aria-current="page"/);
  assert.match(html, /data-page="my-data"/);
  assert.match(html, /How these numbers are calculated/);
  assert.match(html, /Muscle exposure/);
  assert.match(html, /Weighted sets/);
  assert.match(html, /Exercise progression/);
  assert.match(html, /Recent change/);
  assert.match(html, /data-dashboard-range="8w" aria-pressed="true"/);
  assert.match(html, /Exercises trained/);
  assert.doesNotMatch(html, /Training analytics|>Context<|Underlying model|Exercise-specific performance/);
  assert.doesNotMatch(html, /weight-convention-note|dashboard-detail-grid/);
  assert.doesNotMatch(html, />Exposure over time<|>Exercise sources</);
  assert.doesNotMatch(html, /Recorded volume|kg × reps|volume load/i);
  assert.match(dashboard, /fetchOwnedRows\(supabase, "workout_sessions"/);
  assert.match(dashboard, /fetchOwnedRows\(supabase, "session_exercises"/);
  assert.match(dashboard, /"exercise_sets"/);
  assert.match(dashboard, /\.eq\("owner_id", ownerId\)/);
  assert.match(app, /\.select\("exercise_id, muscle_id, relevance"\)/);
  assert.match(analytics, /isAnalyticalWorkingSet/);
  assert.match(analytics, /Math\.max\(perSetGroups\.get/);
  assert.doesNotMatch(`${app}\n${dashboard}\n${analytics}`, /setVolume|monthlyVolume|recordedVolume|weight\s*\*\s*reps/i);
  assert.doesNotMatch(`${app}\n${dashboard}`, /\$\{weight\}\s*×\s*\$\{reps\}/);
  assert.match(styles, /[.]muscle-exposure-grid/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /[.]exposure-item[.]is-expanded/);
  assert.match(dashboard, /className = "exposure-breakdown ranked-list"/);
  assert.match(dashboard, /button\.setAttribute\("aria-expanded", String\(expanded\)\)/);
  assert.doesNotMatch(`${app}\n${dashboard}`, /metric-note|detailedMuscleTitle|detailedMuscleList/);
  assert.match(app, /const activePanel = pagePanels\.find[\s\S]*activePanel\?\.querySelector\("h1, \[data-page-heading-anchor\]"\)/);
  assert.match(app, /const isContextual = headingBottom <= topBarBottom;/);
  assert.match(app, /currentPageTitle\.textContent = isContextual \? pageTitle : ""/);
  assert.match(app, /"my-stuff": "My Stuff"/);
  assert.match(styles, /\.trend-chart/);
  assert.match(dashboard, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "path"\)/);
  assert.match(dashboard, /className = "progression-y-axis"/);
  assert.match(dashboard, /className = "progression-x-labels"/);
  assert.match(dashboard, /getRepeatedExercises\(periodRecords\)/);
  assert.match(dashboard, /selectRepresentativeSetsBySeries/);
  assert.match(dashboard, /className = "progression-legend"/);
  assert.match(dashboard, /className = "progression-tooltip"/);
  assert.match(dashboard, /marker\.tabIndex = 0/);
  assert.doesNotMatch(dashboard, /representatives\.slice\(0,\s*12\)/);
  assert.match(styles, /\.progression-band/);
  assert.match(styles, /\.progression-marker:hover \.progression-tooltip/);
  assert.match(dashboard, /formatPercentageChange\(item\.current, item\.previous\)/);
  assert.match(dashboard, /formatPercentageChange\(group\.current, group\.previous\)/);
  assert.match(dashboard, /"New this period"/);
  assert.match(dashboard, /change-positive/);
  assert.match(dashboard, /change-negative/);
  assert.match(styles, /\.change-positive > strong[\s\S]*#4ade80/);
  assert.match(styles, /\.change-negative > strong[\s\S]*#fb7185/);
  assert.doesNotMatch(dashboard, /delta\.textContent = `\$\{formatSigned/);
  assert.match(policy, /Never use or display weight × reps/);
  assert.match(policy, /prefer fewer meaningful metrics/i);
  assert.match(styles, /\.progression-tooltip[\s\S]*display: none/);
  assert.match(styles, /\.progression-marker:hover \.progression-tooltip[\s\S]*display: grid/);
  assert.match(dashboard, /point\.x <= 50 \? "is-start" : "is-end"/);
});

test("defines and applies one per-dumbbell weight convention", async () => {
  const [html, app, designRules, readme] = await Promise.all([
    read("index.html"),
    read("app.js"),
    read("docs/DESIGN_RULES.md"),
    read("README.md"),
  ]);

  // The signed-in shell must take every unit label from formatWeightUnit rather than hard-coding one.
  const signedInShell = html.slice(html.indexOf('<section id="signed-in"'));
  assert.doesNotMatch(signedInShell, /dumbbell/i);
  // The public showcase illustrates dumbbell exercises, so it must use the same per-dumbbell label.
  const publicHome = html.slice(html.indexOf('<div id="public-home">'), html.indexOf('<section id="signed-in"'));
  assert.match(publicHome, /kg per dumbbell/);
  assert.doesNotMatch(publicHome, /pair of dumbbells|dumbbells? × 2|combined dumbbell/i);
  // The recorded canonical equipment decides the per-dumbbell unit now that exercise names omit equipment.
  assert.match(app, /formatWeightUnit\(exercise\.exercises\.name, equipmentName\)/);
  assert.match(app, /usesPerDumbbellLoad\(\{ equipmentName, exerciseName \}\) \? "kg per dumbbell" : "kg"/);
  assert.match(designRules, /Dumbbell weight is always per dumbbell/);
  assert.match(designRules, /never infer or display the combined weight/i);
  assert.match(readme, /stored value is always the weight of \*\*one dumbbell\*\*/);
});

test("defines consistent exercise and directional color rules", async () => {
  const [app, dashboard, styles, designRules] = await Promise.all([
    read("app.js"),
    read("features/dashboard.js"),
    read("styles.css"),
    read("docs/DESIGN_RULES.md"),
  ]);

  assert.match(dashboard, /EXERCISE_SERIES_COLORS/);
  assert.match(dashboard, /stableStringHash\(`\$\{exerciseName\}:\$\{seriesKey\}`\)/);
  assert.match(styles, /background: var\(--series-color/);
  assert.match(designRules, /same exact exercise and equipment identity must keep the same color/i);
  assert.match(designRules, /Positive increases are green/);
  assert.match(designRules, /Negative decreases are red/);
  assert.match(designRules, /Color must never be the only way/i);
});

test("provides a transparent Literature page for the app's scientific foundations", async () => {
  const [html, app, styles, literature, taxonomy] = await Promise.all([
    read("index.html"),
    read("app.js"),
    read("styles.css"),
    read("literature.js"),
    read("docs/MUSCLE_GROUP_TAXONOMY.md"),
  ]);

  assert.match(html, /data-page="literature"/);
  assert.match(html, /data-page-panel="literature"/);
  assert.match(html, /Scientific foundations/);
  assert.match(html, /How studies are judged/);
  assert.match(html, /Muscle-group taxonomy/);
  assert.match(html, /Movement-pattern coefficients/);
  assert.match(html, /Movement pattern to muscle function/);
  assert.match(html, /Exercise to muscle composition/);
  assert.match(html, /Hypertrophic relevance by exercise/);
  assert.match(html, /Current mapping limitations/);
  assert.match(html, /Design rules/);
  assert.match(html, /Why tonnage is excluded/);
  assert.match(html, /Estimated one-rep max/);
  assert.match(html, /unresolved citation placeholders/i);
  assert.match(html, /data-document="study-selection"/);
  assert.match(html, /data-document="muscle-taxonomy"/);
  assert.match(html, /data-document="movement-coefficients"/);
  assert.match(html, /data-document="movement-data-model"/);
  assert.match(html, /data-document="movement-muscle-function"/);
  assert.match(html, /data-document="exercise-muscle-composition"/);
  assert.match(html, /data-document="exercise-muscle-relevance"/);
  assert.match(html, /data-document="mapping-limitations"/);
  assert.match(html, /data-document="design-rules"/);
  assert.match(html, /data-document="no-tonnage"/);
  assert.doesNotMatch(html, /href="[^"]+\.md"/);
  assert.match(app, /literature: "Literature"/);
  assert.match(app, /openLiteratureDocument/);
  assert.match(styles, /\.literature-grid/);
  assert.match(styles, /\.evidence-badge/);
  assert.match(styles, /\.markdown-reader/);
  assert.match(literature, /MUSCLE_GROUP_TAXONOMY\.md/);
  assert.match(literature, /CURRENT_LIMITATIONS_OF_MUSCLE_GROUP_MAPPING\.md/);
  assert.match(literature, /EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE\.md/);
  assert.match(literature, /docs\/DESIGN_RULES\.md/);
  assert.match(taxonomy, /^# Muscle Group Taxonomy for Hypertrophy Modelling/);
});

test("renders repository literature as safe in-app document pages", async () => {
  const { LITERATURE_DOCUMENTS, renderMarkdown } = await import("../literature.js");
  const rendered = renderMarkdown([
    "# Test document",
    "",
    "A **strong** statement with `code`.",
    "",
    "| Field | Meaning |",
    "| --- | --- |",
    "| One | <unsafe> |",
    "",
    "[Taxonomy](MUSCLE_GROUP_TAXONOMY.md)",
  ].join("\n"));

  assert.equal(Object.keys(LITERATURE_DOCUMENTS).length, 11);
  assert.ok(Object.values(LITERATURE_DOCUMENTS).every((document) => document.path.startsWith("./docs/")));
  assert.ok(Object.values(LITERATURE_DOCUMENTS).every((document) => /^[A-Z0-9_]+\.md$/.test(document.path.split("/").pop())));
  await Promise.all(Object.values(LITERATURE_DOCUMENTS).map((document) => read(document.path.replace(/^\.\//, ""))));
  assert.match(rendered, /<h2 id="test-document">Test document<\/h2>/);
  assert.match(rendered, /<strong>strong<\/strong>/);
  assert.match(rendered, /<table>/);
  assert.match(rendered, /&lt;unsafe&gt;/);
  assert.match(rendered, /data-document="muscle-taxonomy"/);
  assert.doesNotMatch(rendered, /<unsafe>/);
});

test("searches session history by exercise and edits owned exercise sets", async () => {
  const [html, app, styles, oneRepMaxMigration] = await Promise.all([
    read("index.html"),
    read("app.js"),
    read("styles.css"),
    read("supabase/migrations/20260805184116_add_estimated_one_rep_max_range.sql"),
  ]);

  assert.match(html, /id="session-search"[^>]+type="search"/);
  assert.match(html, /id="session-exercise-options"/);
  assert.match(app, /session_exercises\$\{requestedSearch \? "!inner" : ""\}/);
  assert.match(app, /\.ilike\("session_exercises\.exercises\.name"/);
  assert.match(app, /exercise_sets\(id, set_number, weight, reps/);
  assert.match(app, /showExerciseEditor\(item, exercise, performedOn\)/);
  assert.match(app, /import \{ persistSessionHistoryExerciseCorrection \} from "\.\/features\/session\/history-correction\.js"/);
  assert.match(app, /const savedCorrection = await persistSessionHistoryExerciseCorrection\(/);
  assert.match(app, /exercise\.canonical_equipment_id = savedCorrection\.canonical_equipment_id/);
  assert.match(app, /equipmentInput\.name = "canonical_equipment_id"/);
  assert.doesNotMatch(app, /textContent = "Equipment ID"/, "Session History no longer edits the legacy free-text equipment field");
  assert.match(app, /\.eq\("owner_id", requestedUserId\)/);
  assert.match(app, /estimated_1rm_brzycki_rir_adjusted, estimated_1rm_epley_rir_adjusted/);
  assert.match(oneRepMaxMigration, /generated always as/);
  assert.match(styles, /\.session-search/);
  assert.match(styles, /\.exercise-edit-set/);
});
test("manages owner-scoped unordered workout presets", async () => {
  const [html, app, styles, migration, indexMigration, setCountMigration, readme, serviceWorker, presetsFeature] = await Promise.all([
    read("index.html"),
    read("app.js"),
    read("styles.css"),
    read("supabase/migrations/20260811021711_create_workout_presets.sql"),
    read("supabase/migrations/20260811021907_index_workout_preset_owner_foreign_key.sql"),
    read("supabase/migrations/20260811115349_add_preset_set_counts_and_session_population.sql"),
    read("README.md"),
    read("service-worker.js"),
    read("features/presets.js"),
  ]);

  assert.match(html, /<h2 id="my-presets-title">My Presets<\/h2>/);
  assert.match(html, /id="create-preset"[^>]*>Create preset<\/button>/);
  assert.match(html, /data-preset-source="scratch"[\s\S]*Create from scratch/);
  assert.match(html, /data-preset-source="session"[\s\S]*Create from previous session/);
  assert.match(html, /id="preset-name"/);
  assert.match(html, /id="preset-session-select"/);
  assert.match(html, /id="preset-exercise-search"/);
  assert.match(html, /id="preset-selected-list"/);
  assert.match(presetsFeature, /\.from\("workout_presets"\)/);
  assert.match(presetsFeature, /\.eq\("owner_id", requestedUserId\)/);
  assert.match(presetsFeature, /\.rpc\("save_workout_preset"/);
  assert.match(presetsFeature, /p_set_counts: setCounts/);
  assert.match(presetsFeature, /data-preset-set-count/);
  assert.match(presetsFeature, /data\.map\(\(preset\)/);
  assert.match(presetsFeature, /\[\["edit", "Edit"\], \["delete", "Delete"\]\]/);
  assert.doesNotMatch(presetsFeature, /\["open", "Open"\]|\["rename", "Rename"\]/);
  assert.match(html, /<dialog id="preset-modal" class="preset-modal"/);
  assert.match(presetsFeature, /presetModal\.showModal\(\)/);
  assert.match(styles, /\.preset-card:hover \.preset-card-actions[\s\S]*opacity: 1/);
  assert.match(styles, /\.preset-modal[\s\S]*height: 100dvh/);
  const sourceSessionLoader = presetsFeature.slice(presetsFeature.indexOf("async function loadPresetSourceSessions"), presetsFeature.indexOf("function applySelectedPresetSession"));
  assert.match(sourceSessionLoader, /session_exercises\(exercise_id, exercises\(name\), exercise_sets\(id\)\)/);
  assert.doesNotMatch(sourceSessionLoader, /equipment_id|weight|reps|rpe|is_warmup/i);
  assert.match(sourceSessionLoader, /\.eq\("status", "completed"\)/);
  assert.match(migration, /create table public\.workout_presets/);
  assert.match(migration, /create table public\.workout_preset_exercises/);
  assert.match(migration, /unique index workout_presets_owner_name_unique_idx[\s\S]*owner_id, lower\(name\)/);
  assert.match(migration, /primary key \(preset_id, exercise_id\)/);
  assert.match(migration, /references public\.workout_presets\(id, owner_id\)[\s\S]*on delete cascade/);
  assert.match(migration, /exercise_id bigint not null references public\.exercises\(id\) on delete restrict/);
  assert.doesNotMatch(migration, /exercise_order|set_number|equipment_id|weight|reps|rpe|is_warmup/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /preset_owner_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /alter table public\.workout_presets enable row level security/);
  assert.match(migration, /alter table public\.workout_preset_exercises enable row level security/);
  assert.match(migration, /for update to authenticated[\s\S]*using[\s\S]*with check/);
  assert.match(migration, /revoke all on public\.workout_presets, public\.workout_preset_exercises from anon/);
  assert.match(migration, /grant select, insert, update, delete[\s\S]*on public\.workout_presets[\s\S]*to authenticated/);
  assert.match(indexMigration, /on public\.workout_preset_exercises \(preset_id, owner_id\)/);
  assert.match(setCountMigration, /add column set_count smallint not null default 1/);
  assert.match(setCountMigration, /check \(set_count between 1 and 20\)/);
  assert.match(setCountMigration, /p_set_counts smallint\[\]/);
  assert.match(setCountMigration, /unnest\(p_exercise_ids, p_set_counts\)/);
  assert.match(styles, /\.preset-list[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.preset-list/);
  assert.match(readme, /`workout_presets`/);
  assert.match(serviceWorker, /\/presets\.js/);
});

test("creates, resumes, and concludes one persisted active workout session", async () => {
  const [html, app, styles, migration, setCountMigration, serviceWorker, presetsFeature, sessionController] = await Promise.all([
    read("index.html"),
    read("app.js"),
    read("styles.css"),
    read("supabase/migrations/20260811112258_add_workout_session_lifecycle.sql"),
    read("supabase/migrations/20260811115349_add_preset_set_counts_and_session_population.sql"),
    read("service-worker.js"),
    read("features/presets.js"),
    read("features/session/session-controller.js"),
  ]);

  assert.match(html, /id="start-session"[^>]*>Loading session/);
  assert.match(html, /id="session-modal"/);
  assert.match(html, /id="session-modal-title">Start a session/);
  assert.match(html, /id="session-from-preset"[^>]*>Create session from preset/);
  assert.match(html, /id="session-from-scratch"[^>]*>Create session from scratch/);
  assert.match(html, /id="session-progress-title">Session in progress/);
  assert.match(html, /id="conclude-session"[^>]*>Conclude Session/);
  const home = html.slice(html.indexOf('id="home-page"'), html.indexOf('id="session-history-page"'));
  assert.doesNotMatch(home, /id="exercise-catalogue"|Exercise catalogue|Exercise library|Browse the global exercise catalogue/);
  assert.match(sessionController, /\.eq\("status", "in_progress"\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(sessionController, /start_or_resume_workout_session/);
  assert.match(sessionController, /conclude_workout_session/);
  assert.match(app, /activeWorkoutSession \? "Resume Session" : "Create Session"/);
  assert.match(app, /querySelector\("h1, \[data-page-heading-anchor\]"\)/);
  assert.match(app, /status\.textContent = "In progress"/);
  assert.match(styles, /\.start-session-home[\s\S]*place-content: center/);
  assert.match(styles, /\.session-modal::backdrop/);
  assert.match(styles, /\.session-status-badge/);
  assert.match(migration, /alter column gym_id drop not null/);
  assert.match(migration, /add column status text not null default 'completed'/);
  assert.match(migration, /where status = 'in_progress'/);
  assert.match(migration, /create or replace function public\.start_or_resume_workout_session/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.start_or_resume_workout_session\(\) from public, anon/);
  assert.match(serviceWorker, /const CACHE_NAME = "heracles-v\d+";/);
  assert.match(presetsFeature, /async function openSessionPresetPicker\(\)/);
  assert.match(setCountMigration, /row_number\(\) over \(order by random\(\)\)/);
  assert.match(setCountMigration, /generate_series\(1, membership\.set_count\)/);
  assert.match(setCountMigration, /drop constraint exercise_sets_check/);
});

test("provides owner-scoped body-weight import, interpolation, settings, and analytics", async () => {
  const [html, app, module, styles, migration, readme, designRules, documentation, serviceWorker, feature] = await Promise.all([
    read("index.html"), read("app.js"), read("body-weight.js"), read("styles.css"),
    read("supabase/migrations/20260819090000_add_body_weight_data.sql"), read("README.md"),
    read("docs/DESIGN_RULES.md"), read("docs/BODY_WEIGHT_DATA.md"), read("service-worker.js"),
    read("features/body-weight.js"),
  ]);
  assert.match(html, /data-page="settings"/);
  assert.match(html, /id="body-weight-file"[^>]*accept=".csv,text\/csv"/);
  assert.match(html, /id="body-weight-preview"/);
  assert.match(html, /id="delete-body-weight"/);
  assert.doesNotMatch(html, /id="body-weight-chart"/);
  assert.match(html, /id="body-weight-last-imported">Never imported/);
  assert.match(feature, /parseBodyWeightCsv/);
  assert.match(feature, /rpc\("import_body_weight"/);
  assert.match(feature, /rpc\("body_weight_daily_series"/);
  assert.match(feature, /p_rows:/);
  assert.match(feature, /rpc\("delete_body_weight_data"/);
  assert.match(feature, /window\.confirm\(/);
  assert.match(module, /parseBodyWeightDate/);
  assert.match(module, /Date\.UTC\(year, month - 1, day\)/);
  assert.doesNotMatch(module, /MacroFactor/);
  assert.doesNotMatch(styles, /\.body-weight-(?:chart|plot|line|marker|y-axis|x-axis)/);
  assert.doesNotMatch(feature, /renderChart|clearChart|bodyWeightChart/);
  assert.match(feature, /from\("data_imports"\)\.select\("imported_at"\)/);
  assert.match(feature, /importResult\.data\?\.imported_at/);
  assert.match(migration, /create table public\.body_weight_measurements/);
  assert.match(migration, /create table public\.body_weight_measurements/);
  assert.match(migration, /unique \(owner_id, measured_on\)/);
  assert.match(migration, /weight_kg numeric not null check \(weight_kg > 0\)/);
  assert.match(migration, /alter table public\.body_weight_measurements enable row level security/);
  assert.match(migration, /for update to authenticated[\s\S]*using[\s\S]*with check/);
  assert.match(migration, /security invoker/g);
  assert.match(migration, /on conflict \(owner_id, measured_on\) do update/);
  assert.match(migration, /generate_series\(first_day, last_day/);
  assert.match(migration, /case when previous_measured_on = next_measured_on then 'measured' else 'interpolated'/);
  assert.match(migration, /revoke all on function public\.import_body_weight[\s\S]*from public, anon/);
  assert.match(readme, /Absolute generated e1RM columns remain canonical and unchanged/);
  assert.match(designRules, /Interpolation is a mathematical convenience/);
  assert.match(documentation, /No calculated rows are written/);
  assert.match(serviceWorker, /body-weight\.js/);
  assert.match(serviceWorker, /BODY_WEIGHT_DATA\.md/);
  const freshnessMigration = await read("supabase/migrations/20260821103000_refresh_body_weight_import_timestamp.sql");
  assert.match(freshnessMigration, /imported_at = now\(\)/);
});

test("applies the persisted relative-e1RM preference across history and progression", async () => {
  const [html, app, dashboard, relativeModule, migration, readme, bodyWeightDocs, designRules, serviceWorker, feature] = await Promise.all([
    read("index.html"), read("app.js"), read("features/dashboard.js"), read("relative-e1rm.js"),
    read("supabase/migrations/20260819120000_reconcile_relative_e1rm_user_settings.sql"),
    read("README.md"), read("docs/BODY_WEIGHT_DATA.md"), read("docs/DESIGN_RULES.md"), read("service-worker.js"),
    read("features/body-weight.js"),
  ]);
  assert.match(html, /id="relative-e1rm-enabled"[^>]*type="checkbox"/);
  assert.match(html, /body weight on each workout date/i);
  assert.match(app, /bodyWeightFeature\.ensureState/);
  assert.match(feature, /new Map\(dailySeries\.map/);
  assert.match(feature, /from\("user_settings"\)\.select\("relative_e1rm_enabled"\)/);
  assert.match(feature, /from\("user_settings"\)\.upsert/);
  assert.match(feature, /effectiveRelativeEnabled: hasBodyWeight && storedRelativeEnabled/);
  assert.match(app, /createExerciseItem\(exercise, session\.performed_on\)/);
  assert.match(dashboard, /resolveProgressionOneRepMax\(record\)/);
  assert.match(dashboard, /× BW per dumbbell/);
  assert.match(dashboard, /no body weight for its workout date and/);
  assert.match(relativeModule, /lowValue \/ bodyWeight/);
  assert.match(relativeModule, /highValue \/ bodyWeight/);
  assert.match(relativeModule, /weightByDate\.get\(performedOn\)/);
  assert.match(relativeModule, /Relative e1RM unavailable — no body weight for this date/);
  assert.match(migration, /create table if not exists public\.user_settings/);
  assert.match(migration, /relative_e1rm_enabled boolean not null default false/);
  assert.match(migration, /alter table public\.user_settings enable row level security/);
  assert.match(migration, /for update to authenticated[\s\S]*using[\s\S]*with check/);
  assert.match(migration, /revoke all on table public\.user_settings from anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.user_settings to authenticated/);
  assert.doesNotMatch(migration, /grant[^;]*truncate/i);
  assert.match(migration, /set relative_e1rm_enabled = false, updated_at = now\(\)/);
  assert.match(readme, /each absolute e1RM formula value is divided independently/i);
  assert.match(bodyWeightDocs, /dimensionless multiple labelled `× BW`/);
  assert.match(designRules, /Normalization does not make e1RM measured or more accurate/);
  assert.match(serviceWorker, /relative-e1rm\.js/);
});

test("implements canonical RIR persistence, UI requirements, and four-value progression", async () => {
  const [app, analytics, dashboard, setModel, migration, designRules, historyCorrection] = await Promise.all([
    read("app.js"), read("analytics.js"), read("features/dashboard.js"), read("set-model.js"),
    read("supabase/migrations/20260820190518_implement_rir_set_model.sql"), read("docs/DESIGN_RULES.md"),
    read("features/session/history-correction.js"),
  ]);
  assert.match(setModel, /SET_CLASS[\s\S]*WARMUP[\s\S]*WORKING[\s\S]*HIGH_RIR/);
  assert.match(analytics, /records\.filter\(isAnalyticalWorkingSet\)/);
  assert.match(app, /rirSelect\.required = !warmupInput\.checked/);
  assert.match(app, /if \(warmupInput\.checked\) rirSelect\.value = ""/);
  assert.match(app, /4\+ — not counted as a working set/);
  assert.match(historyCorrection, /is_warmup: set\.isWarmup/);
  assert.match(historyCorrection, /reported_rir_bucket: set\.reportedRirBucket/);
  assert.match(historyCorrection, /\.rpc\("update_session_history_exercise"/);
  assert.doesNotMatch(`${app}\n${dashboard}`, /RPE \$\{|RPE not recorded/);
  assert.match(dashboard, /E1RM_MODELS[\s\S]*observedBrzycki[\s\S]*adjustedEpley/);
  assert.match(dashboard, /calculateRirE1rmEstimates\(record\)/);
  assert.match(migration, /set reported_rir_bucket = case when is_warmup then null else 0 end/);
  assert.match(migration, /rir_source = case when is_warmup then null else 'historical_backfill' end/);
  assert.match(migration, /exercise_sets_rir_state_check/);
  assert.match(migration, /reported_rir_bucket between 0 and 4/);
  assert.match(designRules, /not a confidence interval/);
});
