import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const frameworkDirectory = path.resolve(testDirectory, "..");
const scriptsDirectory = path.join(frameworkDirectory, "scripts");
const fixtureDirectory = path.join(testDirectory, "fixtures", "task-index");
const generator = path.join(scriptsDirectory, "generate-task-index.mjs");
const validator = path.join(scriptsDirectory, "validate-task-index.mjs");

function makeProject(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-task-index-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

function addTask(projectRoot, type, name, fixture) {
  const directory = path.join(projectRoot, ".maister", "tasks", type, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(path.join(fixtureDirectory, fixture), path.join(directory, "orchestrator-state.yml"));
  fs.writeFileSync(path.join(directory, "dashboard.html"), "<!doctype html>\n");
  return directory;
}

function run(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function indexPath(projectRoot) {
  return path.join(projectRoot, ".maister", "tasks", "dashboard-data.js");
}

function readIndex(file) {
  const source = fs.readFileSync(file, "utf8");
  return JSON.parse(source.replace(/^window\.MAISTER_TASK_INDEX = /, "").replace(/;\n$/, ""));
}

function writeIndex(file, data) {
  fs.writeFileSync(file, `window.MAISTER_TASK_INDEX = ${JSON.stringify(data, null, 2)};\n`);
}

function generateValidTwoTaskIndex(t) {
  const projectRoot = makeProject(t);
  addTask(projectRoot, "development", "current", "valid-current.yml");
  addTask(projectRoot, "migrations", "newer", "valid-newer.yml");
  const result = run(generator, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  return { projectRoot, file: indexPath(projectRoot), data: readIndex(indexPath(projectRoot)) };
}

function writeFsTraceHook(projectRoot, { failOnFsync = false, umask = null } = {}) {
  const hook = path.join(projectRoot, "fs-trace.cjs");
  const trace = path.join(projectRoot, "fs-trace.jsonl");
  fs.writeFileSync(
    hook,
    `const fs = require("node:fs");\n` +
      `const trace = ${JSON.stringify(trace)};\n` +
      `const traceFd = fs.openSync(trace, "a");\n` +
      `const writeTrace = fs.writeSync.bind(fs);\n` +
      (umask === null ? "" : `process.umask(${umask});\n`) +
      `["openSync", "writeFileSync", "fchmodSync", "fsyncSync", "closeSync", "renameSync", "unlinkSync"].forEach((name) => {\n` +
      `  const original = fs[name];\n` +
      `  fs[name] = function (...args) {\n` +
      `    writeTrace(traceFd, JSON.stringify({ name, args: args.map((arg) => typeof arg === "number" ? arg : String(arg)) }) + "\\n");\n` +
      (failOnFsync
        ? `    if (name === "fsyncSync") throw new Error("injected fsync failure");\n`
        : "") +
      `    return original.apply(this, args);\n` +
      `  };\n` +
      `});\n`,
  );
  return { hook, trace };
}

function runWithHook(hook, script, ...args) {
  return spawnSync(process.execPath, ["--require", hook, script, ...args], {
    encoding: "utf8",
  });
}

test("I01 generates canonical records for the complete corpus in deterministic order", (t) => {
  const projectRoot = makeProject(t);
  addTask(projectRoot, "development", "current", "valid-current.yml");
  addTask(projectRoot, "migrations", "newer", "valid-newer.yml");
  const nested = path.join(projectRoot, ".maister", "tasks", "development", "current", "nested");
  fs.mkdirSync(nested);
  fs.copyFileSync(
    path.join(fixtureDirectory, "valid-newer.yml"),
    path.join(nested, "orchestrator-state.yml"),
  );

  const result = run(generator, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Generated Maister task index: /);
  const data = readIndex(indexPath(projectRoot));
  assert.equal(data.project, path.basename(projectRoot));
  assert.deepEqual(data.tasks.map(({ name }) => name), ["Newer task", "Current task"]);
  assert.equal(data.tasks[0].type, "migration");
  assert.equal(
    data.tasks[1].description,
    "First description line continued on the second line.",
  );
  assert.equal(data.tasks[1].next_action, "Start implementation?");
  assert.equal(data.tasks[1].commit_sha, "abc123");
});

test("I02 aggregates corpus diagnostics and preserves the prior index without temp residue", (t) => {
  const projectRoot = makeProject(t);
  addTask(projectRoot, "development", "bad-syntax", "invalid-syntax.yml");
  addTask(projectRoot, "research", "bad-semantic", "invalid-semantic.yml");
  const file = indexPath(projectRoot);
  const original = Buffer.from('window.MAISTER_TASK_INDEX = {"sentinel":true};\n');
  fs.writeFileSync(file, original);

  const result = run(generator, projectRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bad-syntax[/\\]orchestrator-state\.yml/);
  assert.match(result.stderr, /bad-semantic[/\\]orchestrator-state\.yml/);
  assert.match(result.stderr, /completed task has open applicable phase-1/);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).filter((name) => /^\.dashboard-data\.js\..*\.tmp$/.test(name)),
    [],
  );
});

test("I03 atomically replaces an existing index after sync and preserves its complete mode", (t) => {
  const projectRoot = makeProject(t);
  addTask(projectRoot, "development", "current", "valid-current.yml");
  const file = indexPath(projectRoot);
  fs.writeFileSync(file, "old index\n");
  fs.chmodSync(file, 0o764);
  const { hook, trace } = writeFsTraceHook(projectRoot);

  const result = runWithHook(hook, generator, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(file).mode & 0o7777, 0o764);
  const operations = fs.readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
  const names = operations.map(({ name }) => name);
  const open = operations.find(({ name, args }) => name === "openSync" && args[0].endsWith(".tmp"));
  assert.ok(open, "temporary index must be opened explicitly");
  assert.equal(path.dirname(open.args[0]), path.dirname(file));
  assert.ok((open.args[1] & fs.constants.O_EXCL) !== 0, "temporary create must be exclusive");
  assert.ok(names.indexOf("writeFileSync") < names.indexOf("fsyncSync"));
  assert.ok(names.indexOf("fsyncSync") < names.indexOf("closeSync"));
  assert.ok(names.indexOf("closeSync") < names.indexOf("renameSync"));
});

test("I04 applies umask for a new index and cleans only its temp file on write failure", (t) => {
  const projectRoot = makeProject(t);
  addTask(projectRoot, "development", "current", "valid-current.yml");
  const file = indexPath(projectRoot);
  const firstHook = writeFsTraceHook(projectRoot, { umask: 0o027 });
  const created = runWithHook(firstHook.hook, generator, projectRoot);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);

  const sentinel = Buffer.from("last valid index\n");
  fs.writeFileSync(file, sentinel);
  const unrelatedTemp = path.join(path.dirname(file), ".dashboard-data.js.unrelated.tmp");
  fs.writeFileSync(unrelatedTemp, "keep\n");
  const failingHook = writeFsTraceHook(projectRoot, { failOnFsync: true });
  const failed = runWithHook(failingHook.hook, generator, projectRoot);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /injected fsync failure/);
  assert.deepEqual(fs.readFileSync(file), sentinel);
  assert.equal(fs.readFileSync(unrelatedTemp, "utf8"), "keep\n");
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).filter(
      (name) => /^\.dashboard-data\.js\..*\.tmp$/.test(name) && name !== path.basename(unrelatedTemp),
    ),
    [],
  );
});

test("I05 validator rejects missing, extra, duplicate, stale, reordered, and mismatched records", (t) => {
  const { projectRoot, file, data } = generateValidTwoTaskIndex(t);
  assert.equal(run(validator, file).status, 0);
  const unindexed = path.join(projectRoot, ".maister", "tasks", "development", "unindexed");
  fs.mkdirSync(unindexed, { recursive: true });
  fs.writeFileSync(path.join(unindexed, "dashboard.html"), "<!doctype html>\n");
  fs.writeFileSync(path.join(unindexed, "orchestrator-state.yml.backup"), "not discovered\n");

  const cases = [
    ["missing", { ...data, tasks: data.tasks.slice(1) }, /missing|count/i],
    [
      "extra",
      {
        ...data,
        tasks: [...data.tasks, { ...data.tasks[0], path: "development/unindexed", dashboard: "development/unindexed/dashboard.html", state: "development/unindexed/orchestrator-state.yml.backup" }],
      },
      /extra|count/i,
    ],
    ["duplicate", { ...data, tasks: [...data.tasks, data.tasks[0]] }, /duplicate/i],
    ["stale", { ...data, tasks: data.tasks.map((item, index) => index ? item : { ...item, status: "pending" }) }, /status|mismatch/i],
    ["reordered", { ...data, tasks: [...data.tasks].reverse() }, /order/i],
    ["field-mismatched", { ...data, tasks: data.tasks.map((item, index) => index ? item : { ...item, commit_sha: "wrong" }) }, /commit_sha|mismatch/i],
  ];

  for (const [name, candidate, diagnostic] of cases) {
    writeIndex(file, candidate);
    const result = run(validator, file);
    assert.notEqual(result.status, 0, `${name} should fail validation`);
    assert.match(result.stderr, diagnostic, name);
  }
});

test("I06 validator checks generated ISO independently and confines existing references to tasks", (t) => {
  const { projectRoot, file, data } = generateValidTwoTaskIndex(t);
  const outside = path.join(projectRoot, ".maister", "outside.html");
  fs.writeFileSync(outside, "outside\n");
  const cases = [
    ["generated", { ...data, generated: "not-an-iso-timestamp" }, /generated.*ISO/i],
    ["impossible-generated", { ...data, generated: "2026-02-31T10:00:00Z" }, /generated.*ISO/i],
    [
      "updated",
      { ...data, tasks: data.tasks.map((item, index) => index ? item : { ...item, updated: "2026-02-31T10:00:00Z" }) },
      /tasks\[0\]\.updated.*ISO date or timestamp/i,
    ],
    [
      "escaping",
      { ...data, tasks: data.tasks.map((item, index) => index ? item : { ...item, dashboard: "../outside.html" }) },
      /dashboard.*inside.*\.maister[/\\]tasks/i,
    ],
  ];
  for (const [name, candidate, diagnostic] of cases) {
    writeIndex(file, candidate);
    const result = run(validator, file);
    assert.notEqual(result.status, 0, `${name} should fail validation`);
    assert.match(result.stderr, diagnostic, name);
  }

  writeIndex(file, data);
  fs.unlinkSync(path.join(projectRoot, ".maister", "tasks", data.tasks[0].dashboard));
  const missing = run(validator, file);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /dashboard does not exist/i);
});

test("I07 bounds central dashboard JavaScript evaluation time", (t) => {
  const projectRoot = makeProject(t);
  const file = indexPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "while (true) {}\n");

  const result = spawnSync(process.execPath, [validator, file], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.notEqual(result.error?.code, "ETIMEDOUT", "validation must terminate on a looping index");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Script execution timed out/);
});
