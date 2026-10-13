import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Heracles branding preserves deployment and PWA identity contracts", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.name, "Heracles");
  assert.equal(manifest.short_name, "Heracles");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");

  const index = read("index.html");
  for (const expected of [
    'property="og:site_name" content="Heracles"',
    'property="og:title" content="Heracles | Evidence-aware resistance training"',
    "<title>Heracles | Evidence-aware resistance training</title>",
    'aria-label="Heracles home"',
    '<img class="public-brand-lockup" src="./fabbro-design/assets/Heracles Logo Colored With Text Beside.svg" alt="Heracles" />',
    '<img src="./fabbro-design/assets/Fabbro Systems Logo.svg" alt="" aria-hidden="true" />',
    '<link rel="stylesheet" href="./styles.css?v=26" />',
    '<link rel="stylesheet" href="./public.css?v=4" />',
    '<meta name="theme-color" content="#000000" />',
    "Heracles combines a persistent training ledger",
    '<img class="sidebar-lockup" src="./brand/heracles-lockup.svg" alt="Heracles" />',
  ]) assert.ok(index.includes(expected), `missing ${expected}`);
  const structuredData = JSON.parse(index.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  assert.deepEqual(
    structuredData["@graph"].map((entry) => entry.name),
    ["Heracles", "Heracles"],
  );
  assert.match(index, /https:\/\/heracles\.fabbrosystems\.com\//);
  assert.doesNotMatch(index, /Lorenzo's Lifting Ledger|>Lifting Ledger</);

  const publicCss = read("public.css");
  assert.match(
    publicCss,
    /#signed-out\.public-site\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*var\(--fs-page-max\);[\s\S]*?margin:\s*0 auto;/,
    "signed-out root must implement the canonical fluid 1680px Fabbro frame",
  );
  assert.doesNotMatch(
    publicCss,
    /#signed-out\s+\.public-site\s*\{/,
    "canonical frame must target the signed-out root itself, not a descendant",
  );

  const sharedCss = read("styles.css");
  assert.match(
    sharedCss,
    /\.public-site\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*var\(--fs-page-max\);[^}]*margin:\s*0 auto;/,
    "shared public-site base must use the canonical Fabbro frame",
  );
  assert.doesNotMatch(
    sharedCss,
    /\.public-site\s*\{[^}]*76rem/,
    "legacy 76rem public width cap must not return",
  );

  const serviceWorker = read("service-worker.js");
  assert.ok(serviceWorker.includes('"/public.css?v=4"'), "public shell stylesheet must be precached");

  for (const expected of [
    'id="capabilities"',
    "Persistent workout sessions",
    "Four e1RM perspectives",
    "synchronize Apple Health data",
    "Standardized circumference history",
    "relaxed and flexed upper-arm series",
    "Heracles does not extrapolate",
    "https://kleos.fabbrosystems.com/",
    "https://ariadne.fabbrosystems.com/",
    "Evidence → state → action.",
  ]) assert.ok(index.includes(expected), `public product description missing ${expected}`);

  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));
  assert.equal(packageJson.name, "heracles");
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.packages[""].name, packageJson.name);
});

test("retired Lorenzo's Lifting Ledger name does not appear outside documented exceptions", () => {
  const retiredName = /lorenzo'?s lifting ledger|lorenzos-lifting-ledger|lifting[ _]ledger/i;
  const allowed = new Set([
    // Documents the retired name so it is not reintroduced.
    "README.md",
    // Guards production against the legacy GitHub Pages URL.
    ".github/workflows/production-smoke.yml",
    // Migrates pending edits stored under the legacy localStorage prefix.
    "features/session/session-storage.js",
    "tests/session-storage-migration.test.mjs",
    "tests/branding.test.mjs",
  ]);
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const offenders = tracked.filter((file) => {
    if (allowed.has(file) || !fs.existsSync(path.join(root, file))) return false;
    const contents = fs.readFileSync(path.join(root, file));
    if (contents.includes(0)) return false;
    return retiredName.test(contents.toString("utf8"));
  });
  assert.deepEqual(offenders, []);

  assert.match(read("supabase/config.toml"), /^project_id = "heracles"$/m);
});


test("Heracles public shell consumes Fabbro Public Shell 1.0.0 tokens", () => {
  const contract = JSON.parse(
    fs.readFileSync(new URL("../fabbro-design/components/public-shell/contract.json", import.meta.url), "utf8")
  );
  const css = fs.readFileSync(new URL("../public.css", import.meta.url), "utf8");

  assert.equal(contract.version, "1.0.0");
  assert.equal(contract.designSystemVersion, "0.3.0");
  assert.match(css, /var\(--fs-public-header-grid\)/);
  assert.match(css, /var\(--fs-public-header-lockup-max\)/);
  assert.match(css, /var\(--fs-public-header-lockup-compact\)/);
  assert.match(css, /var\(--fs-public-header-lockup-mobile\)/);
  assert.match(css, /var\(--fs-type-kicker-weight\)/);
  assert.match(css, /var\(--fs-public-footer-product-lockup\)/);
  assert.match(css, /var\(--fs-public-footer-family-mark\)/);
  assert.match(css, /var\(--fs-focus-outline-width\)/);
});
