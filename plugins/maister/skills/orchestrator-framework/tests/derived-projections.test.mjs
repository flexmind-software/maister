import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const frameworkDirectory = path.resolve(testDirectory, "..");
const repositoryRoot = path.resolve(testDirectory, "../../../../..");
const fixtureDirectory = path.join(testDirectory, "fixtures", "derived-views");
const syncScript = path.join(frameworkDirectory, "scripts", "validate-dashboard-state-sync.mjs");
const dataScript = path.join(frameworkDirectory, "scripts", "validate-dashboard-data.mjs");

function makeFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maister-derived-"));
  for (const name of ["orchestrator-state.yml", "dashboard-data.js", "codex-tasks.json"]) {
    fs.copyFileSync(path.join(fixtureDirectory, name), path.join(directory, name));
  }
  return directory;
}

function run(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
}

function validateFixture(directory, script = syncScript) {
  return run(
    script,
    path.join(directory, "dashboard-data.js"),
    path.join(directory, "orchestrator-state.yml"),
  );
}

function rewriteDashboard(directory, transform, globalName = "MAISTER_DATA") {
  const source = fs.readFileSync(path.join(fixtureDirectory, "dashboard-data.js"), "utf8");
  fs.writeFileSync(
    path.join(directory, "dashboard-data.js"),
    transform(source.replace("window.MAISTER_DATA", `window.${globalName}`)),
  );
}

test("D01 accepts every dashboard global and compares canonical task, phases, decisions, and risks", () => {
  for (const globalName of [
    "MAISTER_DATA",
    "__MAISTER_DASHBOARD_DATA__",
    "__MAISTER_STATE__",
    "__MAISTER_TASK__",
  ]) {
    const directory = makeFixture();
    rewriteDashboard(directory, (source) => source, globalName);
    const result = validateFixture(directory);
    assert.equal(result.status, 0, `${globalName}: ${result.stderr}`);
  }
});

test("D02 rejects task or explicit phase drift and duplicate or unknown local phase states", () => {
  const cases = [
    [(source) => source.replace('title: "Derived view fixture"', 'title: "Stale title"'), /task\.title/],
    [(source) => source.replace('status: "in_progress"', 'status: "completed"'), /task\.status/],
    [(source) => source.replace('status: "blocked"', 'status: "pending"'), /phase-3/],
    [(source) => source.replace('id: "phase-2"', 'id: "phase-1"'), /duplicated/],
    [
      (source) => source.replace(
        "  ]\n};",
        ',\n    {id: "phase-99", name: "Unknown", status: "pending", artifacts: []}\n  ]\n};',
      ),
      /not declared by canonical state/,
    ],
    [(source) => source.replace('status: "blocked"', 'status: "unknown"'), /status is invalid/],
  ];
  for (const [transform, expected] of cases) {
    const directory = makeFixture();
    rewriteDashboard(directory, transform);
    const result = validateFixture(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }
});

test("D07 bounds dashboard JavaScript evaluation time", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maister-dashboard-timeout-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "dashboard-data.js");
  fs.writeFileSync(file, "while (true) {}\n");

  const result = spawnSync(process.execPath, [dataScript, file], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: { PATH: process.env.PATH },
    timeout: 5000,
  });
  assert.notEqual(result.error?.code, "ETIMEDOUT", "validation must terminate on a looping dashboard");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Script execution timed out/);
});

test("D03 rejects missing summary mappings and preserves ordered decision, rationale, and risk projections", () => {
  const cases = [
    [(source) => source.replace('summary_keys: ["analysis"],', ""), /no summary_keys mapping/],
    [(source) => source.replace("Preserve decision order.", "Reordered decision."), /decisions/],
    [(source) => source.replace("Derived views only report drift.", "Stale rationale."), /decisions/],
    [(source) => source.replace("Stale projections can mislead operators.", "Different risk."), /risks/],
    [(source) => source.replace('summary_keys: ["planning"],', 'summary_keys: ["missing"],'), /unknown phase summary/],
  ];
  for (const [transform, expected] of cases) {
    const directory = makeFixture();
    rewriteDashboard(directory, transform);
    const result = validateFixture(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }
});

test("D04 validates phase status, dependencies, skipped encoding, and existence-only namespaces", () => {
  const directory = makeFixture();
  let result = validateFixture(directory);
  assert.equal(result.status, 0, result.stderr);

  const registryPath = path.join(directory, "codex-tasks.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  registry.tasks.find(({ id }) => id === "4").status = "pending";
  registry.tasks.find(({ id }) => id === "4").blockedBy = [];
  registry.tasks.find(({ id }) => id === "5").status = "failed";
  registry.tasks.find(({ id }) => id === "6").status = "completed";
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  result = validateFixture(directory);
  assert.equal(result.status, 0, result.stderr);

  registry.tasks.find(({ id }) => id === "2").metadata.skipped = false;
  registry.tasks.find(({ id }) => id === "3").blockedBy = [];
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  result = validateFixture(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /metadata\.skipped/);
  assert.match(result.stderr, /blockedBy/);
});

test("D05 enforces registry schema, unique one-to-one IDs, and conditional registry presence", () => {
  const mutations = [
    [(registry) => { registry.schema_version = 2; }, /schema_version/],
    [(registry) => { registry.next_id = 0; }, /next_id/],
    [(registry) => { registry.tasks.push({...registry.tasks[0]}); }, /duplicated/],
    [(registry) => { registry.tasks = registry.tasks.filter(({ id }) => id !== "6"); }, /does not resolve/],
  ];
  for (const [mutate, expected] of mutations) {
    const directory = makeFixture();
    const registryPath = path.join(directory, "codex-tasks.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    mutate(registry);
    fs.writeFileSync(registryPath, JSON.stringify(registry));
    const result = validateFixture(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }

  const missing = makeFixture();
  fs.unlinkSync(path.join(missing, "codex-tasks.json"));
  assert.match(validateFixture(missing).stderr, /Missing Codex task registry/);

  const absentAllowed = makeFixture();
  fs.unlinkSync(path.join(absentAllowed, "codex-tasks.json"));
  fs.writeFileSync(
    path.join(absentAllowed, "orchestrator-state.yml"),
    "task:\n  title: No registry\n  description: No mappings.\n  status: pending\n",
  );
  rewriteDashboard(
    absentAllowed,
    () => 'window.MAISTER_DATA={task:{title:"No registry",status:"pending"},phases:[]};\n',
  );
  assert.equal(validateFixture(absentAllowed).status, 0);

  const corrupt = makeFixture();
  fs.writeFileSync(path.join(corrupt, "codex-tasks.json"), "{not-json");
  assert.match(validateFixture(corrupt).stderr, /Invalid Codex task registry JSON/);

  const reusedMapping = makeFixture();
  const statePath = path.join(reusedMapping, "orchestrator-state.yml");
  fs.writeFileSync(
    statePath,
    fs.readFileSync(statePath, "utf8").replace('group-build: "4"', 'group-build: "1"'),
  );
  const reuseResult = validateFixture(reusedMapping);
  assert.notEqual(reuseResult.status, 0);
  assert.match(reuseResult.stderr, /registry ID "1" conflicts/);
});

test("D06 generated Codex and Copilot packages preserve byte parity and run without installation", () => {
  const relativeAssets = [
    "scripts/state-semantics.mjs",
    "scripts/validate-dashboard-data.mjs",
    "scripts/validate-dashboard-state-sync.mjs",
    "tests/derived-projections.test.mjs",
    "vendor/yaml-2.9.1/LICENSE",
    "vendor/yaml-2.9.1/PROVENANCE.json",
    "vendor/yaml-2.9.1/dist/index.js",
  ];
  const source = path.join(repositoryRoot, "plugins", "maister", "skills", "orchestrator-framework");
  for (const variant of ["maister-codex", "maister-copilot"]) {
    const generated = path.join(repositoryRoot, "plugins", variant, "skills", "orchestrator-framework");
    for (const relative of relativeAssets) {
      assert.deepEqual(
        fs.readFileSync(path.join(generated, relative)),
        fs.readFileSync(path.join(source, relative)),
        `${variant}/${relative}`,
      );
    }
    const directory = makeFixture();
    const result = validateFixture(
      directory,
      path.join(generated, "scripts", "validate-dashboard-state-sync.mjs"),
    );
    assert.equal(result.status, 0, `${variant}: ${result.stderr}`);
  }
});
