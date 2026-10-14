import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keeps browser-smoke configuration local to the development test path", async () => {
  const [config, devServer, bootstrap, workflow, browserSmoke] = await Promise.all([
    read("config.js"),
    read("scripts/dev-server.mjs"),
    read("scripts/db-bootstrap.mjs"),
    read(".github/workflows/validation.yml"),
    read("tests/browser_smoke.py"),
  ]);

  assert.match(config, /https:\/\/yfhmjwkscqbpzblrpsoy\.supabase\.co/);
  assert.doesNotMatch(config, /heracles-smoke\.local|HERACLES_SMOKE/);

  assert.match(devServer, /HERACLES_SMOKE_SUPABASE_URL/);
  assert.match(devServer, /HERACLES_SMOKE_SUPABASE_KEY/);
  assert.match(devServer, /https:\/\/heracles-smoke\.local/);
  assert.match(devServer, /relativePath === "config\.js" && smokeConfig/);

  assert.match(bootstrap, /HERACLES_BROWSER_SMOKE_ENV_FILE/);
  assert.match(bootstrap, /ANON_KEY/);
  assert.doesNotMatch(bootstrap, /HERACLES_SMOKE_SERVICE|SERVICE_ROLE_KEY.*browser-smoke\.env/);

  assert.match(workflow, /playwright==1\.55\.0/);
  assert.match(workflow, /python tests\/browser_smoke\.py/);
  assert.match(workflow, /HERACLES_SMOKE_SUPABASE_URL="https:\/\/heracles-smoke\.local"/);

  assert.match(browserSmoke, /auth\/v1\/signup/);
  assert.match(browserSmoke, /sb-heracles-smoke-auth-token/);
  assert.match(browserSmoke, /Start empty workout/);
  assert.match(browserSmoke, /confirm-cancel-workout-button/);
  assert.doesNotMatch(browserSmoke, /service[_-]?role/i);
});

test("browser-smoke failures name the failing resource without echoing query strings", async () => {
  const browserSmoke = await read("tests/browser_smoke.py");

  assert.match(browserSmoke, /page\.on\("response", record_response\)/);
  assert.match(browserSmoke, /message\.location\.get\("url"\)/);
  assert.match(browserSmoke, /Failed HTTP responses:/);
  assert.match(browserSmoke, /except Exception:\s+#[^\n]*\n\s+diagnostics = format_diagnostics\(browser_errors, failed_responses, supabase_failures\)/);
  assert.match(browserSmoke, /return f"\{parts\.scheme\}:\/\/\{parts\.netloc\}\{parts\.path\}"/);
});

test("browser-smoke Supabase failures classify the credential and error without echoing secrets", async () => {
  const browserSmoke = await read("tests/browser_smoke.py");

  assert.match(browserSmoke, /if response\.status >= 400:\s+supabase_failures\.append\(/);
  assert.match(browserSmoke, /describe_credential\(headers, session\)/);
  assert.match(browserSmoke, /bearer was the publishable key/);
  assert.match(browserSmoke, /bearer was the seeded user access token/);
  assert.match(browserSmoke, /Failed Supabase request details:/);
  // Credentials are compared and described, never interpolated into diagnostics.
  const diagnosticHelpers = browserSmoke.slice(
    browserSmoke.indexOf("def decode_jwt_claims"),
    browserSmoke.indexOf("def create_test_session"),
  );
  assert.ok(diagnosticHelpers.includes("def describe_credential"));
  assert.doesNotMatch(diagnosticHelpers,/f"[^"\n]*\{(?:token|authorization|LOCAL_SUPABASE_KEY|session\["(?:access|refresh)_token"\])[^}]*\}/);
});
