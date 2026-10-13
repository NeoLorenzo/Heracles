import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SUPABASE_DIR = path.join(ROOT, "supabase");
const BOOTSTRAP_DIR = path.join(SUPABASE_DIR, "bootstrap");
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, "migrations");
const CLI = path.join(ROOT, "node_modules", "supabase", "dist", "supabase.js");
const FILENAME_PATTERN = /^(\d{14})_(.+)\.sql$/;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", shell: false, maxBuffer: 50 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status ?? 1}`);
  }
  return result;
}

function parseManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(BOOTSTRAP_DIR, "baseline.json"), "utf8"));
  const match = FILENAME_PATTERN.exec(manifest.cutoverMigration ?? "");
  if (!match || !/^[0-9a-f]{64}$/.test(manifest.sha256 ?? "")) {
    throw new Error("supabase/bootstrap/baseline.json must declare a valid cutover migration and SHA-256.");
  }
  const baselinePath = path.join(BOOTSTRAP_DIR, manifest.baselineFile ?? "");
  if (!fs.existsSync(baselinePath)) throw new Error("Committed bootstrap baseline is missing.");
  const actualHash = crypto.createHash("sha256").update(fs.readFileSync(baselinePath)).digest("hex");
  if (actualHash !== manifest.sha256) throw new Error("Committed bootstrap baseline SHA-256 does not match baseline.json.");
  return { baselinePath, cutoverVersion: match[1] };
}

function isolatedConfig() {
  const source = fs.readFileSync(path.join(SUPABASE_DIR, "config.toml"), "utf8");
  const config = source
    .replace('project_id = "heracles"', 'project_id = "heracles-bootstrap"')
    .replace("[db.migrations]\nenabled = true", "[db.migrations]\nenabled = false")
    .replaceAll("54320", "55320").replaceAll("54321", "55321").replaceAll("54322", "55322")
    .replaceAll("54323", "55323").replaceAll("54324", "55324").replaceAll("54325", "55325")
    .replaceAll("54327", "55327").replaceAll("54329", "55329");

  if (!/project_id = "heracles-bootstrap"/.test(config)
    || !/\[db\.migrations\][\s\S]*?enabled = false/.test(config)
    || !/\[db\.seed\][\s\S]*?enabled = false/.test(config)
    || !/\[db\][\s\S]*?port = 55322/.test(config)) {
    throw new Error("Could not create a safe isolated Supabase bootstrap configuration.");
  }
  return config;
}

function futureMigrations(cutoverVersion) {
  return fs.readdirSync(MIGRATIONS_DIR)
    .map((name) => ({ name, match: FILENAME_PATTERN.exec(name) }))
    .filter(({ name, match }) => name.endsWith(".sql") && match)
    .map(({ name, match }) => ({ name, version: match[1] }))
    .filter(({ version }) => version > cutoverVersion)
    .sort((left, right) => left.version.localeCompare(right.version) || left.name.localeCompare(right.name));
}

function writeBrowserSmokeEnvironment(temporaryRoot) {
  const requestedPath = process.env.HERACLES_BROWSER_SMOKE_ENV_FILE?.trim();
  if (!requestedPath) return;

  const status = run(process.execPath, [CLI, "status", "--workdir", temporaryRoot, "-o", "env"]);
  const values = new Map();
  for (const rawLine of (status.stdout ?? "").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/.exec(rawLine.trim());
    if (!match) continue;
    values.set(match[1], match[2] ?? match[3] ?? match[4] ?? "");
  }

  const apiUrl = values.get("API_URL") ?? values.get("SUPABASE_URL");
  const browserKey = values.get("ANON_KEY") ?? values.get("SUPABASE_ANON_KEY") ?? values.get("PUBLISHABLE_KEY");
  if (!apiUrl || !browserKey) {
    throw new Error("Could not read the local Supabase API URL and browser-safe key for browser smoke tests.");
  }

  const outputPath = path.resolve(ROOT, requestedPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    `HERACLES_SMOKE_API_URL=${apiUrl}\nHERACLES_SMOKE_ANON_KEY=${browserKey}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

const { baselinePath, cutoverVersion } = parseManifest();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-supabase-bootstrap-"));
const temporarySupabaseDir = path.join(temporaryRoot, "supabase");
const docker = process.platform === "win32" ? "docker.exe" : "docker";

try {
  fs.mkdirSync(temporarySupabaseDir, { recursive: true });
  fs.writeFileSync(path.join(temporarySupabaseDir, "config.toml"), isolatedConfig(), "utf8");
  run(process.execPath, [CLI, "start", "--workdir", temporaryRoot]);
  run(process.execPath, [CLI, "db", "reset", "--local", "--no-seed", "--workdir", temporaryRoot]);
  run(docker, ["cp", baselinePath, "supabase_db_heracles-bootstrap:/tmp/current_baseline.sql"]);
  run(docker, ["exec", "supabase_db_heracles-bootstrap", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "/tmp/current_baseline.sql"]);

  for (const migration of futureMigrations(cutoverVersion)) {
    const sourcePath = path.join(MIGRATIONS_DIR, migration.name);
    const containerPath = `/tmp/${migration.name}`;
    run(docker, ["cp", sourcePath, `supabase_db_heracles-bootstrap:${containerPath}`]);
    run(docker, ["exec", "supabase_db_heracles-bootstrap", "psql", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", containerPath]);
  }

  writeBrowserSmokeEnvironment(temporaryRoot);
  console.log("Clean local Supabase bootstrap completed.");
  console.log("SUPABASE_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
