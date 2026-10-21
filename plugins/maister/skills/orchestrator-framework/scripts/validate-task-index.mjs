#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { buildTaskIndex } from "./generate-task-index.mjs";
import { isIsoDateOrTimestamp, isIsoTimestamp } from "./state-semantics.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: validate-task-index.mjs <dashboard-data.js>");
  process.exit(2);
}

const resolvedFile = path.resolve(file);
if (!fs.existsSync(resolvedFile)) {
  console.error(`Missing Maister task index: ${file}`);
  process.exit(1);
}

const tasksRoot = path.dirname(resolvedFile);
const realTasksRoot = fs.realpathSync(tasksRoot);
const projectRoot = path.resolve(tasksRoot, "..", "..");
const errors = [];
let data = null;

try {
  const window = {};
  vm.runInNewContext(fs.readFileSync(resolvedFile, "utf8"), { window }, { filename: resolvedFile, timeout: 1000 });
  data = window.MAISTER_TASK_INDEX;
} catch (error) {
  errors.push(`cannot load MAISTER_TASK_INDEX: ${error instanceof Error ? error.message : String(error)}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function validateReference(task, index, field, { directory = false } = {}) {
  const value = task?.[field];
  if (typeof value !== "string" || value.length === 0) return;
  const resolved = path.resolve(tasksRoot, value);
  if (!isInside(tasksRoot, resolved)) {
    errors.push(`tasks[${index}].${field} must resolve inside ${tasksRoot}: ${value}`);
    return;
  }
  if (!fs.existsSync(resolved)) {
    errors.push(`tasks[${index}].${field} does not exist: ${value}`);
    return;
  }
  const realResolved = fs.realpathSync(resolved);
  if (!isInside(realTasksRoot, realResolved)) {
    errors.push(`tasks[${index}].${field} must resolve inside ${tasksRoot}: ${value}`);
    return;
  }
  const stats = fs.statSync(resolved);
  if (directory && !stats.isDirectory()) {
    errors.push(`tasks[${index}].${field} must reference a directory: ${value}`);
  }
  if (!directory && !stats.isFile()) {
    errors.push(`tasks[${index}].${field} must reference a file: ${value}`);
  }
}

const requiredStringFields = [
  "type",
  "name",
  "description",
  "status",
  "next_action",
  "updated",
  "path",
  "dashboard",
  "state",
  "commit_status",
];
const nullableStringFields = ["commit_sha", "commit_message"];
const deterministicFields = [...requiredStringFields, ...nullableStringFields];

if (!isRecord(data)) {
  errors.push("missing MAISTER_TASK_INDEX global");
} else {
  if (!isIsoTimestamp(data.generated)) errors.push("generated must be an ISO timestamp");
  if (typeof data.project !== "string" || data.project.length === 0) {
    errors.push("project must be a non-empty string");
  }
  if (!Array.isArray(data.tasks)) errors.push("tasks must be an array");
}

const actualTasks = Array.isArray(data?.tasks) ? data.tasks : [];
const firstIndexByPath = new Map();
for (const [index, task] of actualTasks.entries()) {
  if (!isRecord(task)) {
    errors.push(`tasks[${index}] must be an object`);
    continue;
  }
  for (const field of requiredStringFields) {
    if (typeof task[field] !== "string" || task[field].length === 0) {
      errors.push(`tasks[${index}].${field} must be a non-empty string`);
    }
  }
  if (typeof task.updated === "string" && !isIsoDateOrTimestamp(task.updated)) {
    errors.push(`tasks[${index}].updated must be an ISO date or timestamp`);
  }
  for (const field of nullableStringFields) {
    if (task[field] !== null && typeof task[field] !== "string") {
      errors.push(`tasks[${index}].${field} must be a string or null`);
    }
  }
  if (typeof task.path === "string") {
    if (firstIndexByPath.has(task.path)) {
      errors.push(
        `duplicate task path at tasks[${firstIndexByPath.get(task.path)}] and tasks[${index}]: ${task.path}`,
      );
    } else {
      firstIndexByPath.set(task.path, index);
    }
  }
  validateReference(task, index, "path", { directory: true });
  validateReference(task, index, "dashboard");
  validateReference(task, index, "state");
}

let expected = null;
try {
  expected = buildTaskIndex(projectRoot, { generated: "1970-01-01T00:00:00.000Z" });
} catch (error) {
  errors.push(
    `cannot reconstruct canonical task index: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (expected) {
  if (data?.project !== expected.project) {
    errors.push(
      `project mismatch: expected ${JSON.stringify(expected.project)}, received ${JSON.stringify(data?.project)}`,
    );
  }
  if (actualTasks.length !== expected.tasks.length) {
    errors.push(`task count mismatch: expected ${expected.tasks.length}, received ${actualTasks.length}`);
  }

  const expectedByPath = new Map(expected.tasks.map((task) => [task.path, task]));
  const actualByPath = new Map(actualTasks.filter(isRecord).map((task) => [task.path, task]));
  for (const expectedTask of expected.tasks) {
    if (!actualByPath.has(expectedTask.path)) errors.push(`missing task record: ${expectedTask.path}`);
  }
  for (const actualTask of actualTasks.filter(isRecord)) {
    if (!expectedByPath.has(actualTask.path)) errors.push(`extra task record: ${actualTask.path}`);
  }

  const comparableLength = Math.min(actualTasks.length, expected.tasks.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const actualTask = actualTasks[index];
    const expectedTask = expected.tasks[index];
    if (!isRecord(actualTask)) continue;
    if (actualTask.path !== expectedTask.path) {
      errors.push(
        `task order mismatch at index ${index}: expected ${expectedTask.path}, received ${actualTask.path}`,
      );
    }
  }
  for (const [expectedIndex, expectedTask] of expected.tasks.entries()) {
    const actualTask = actualByPath.get(expectedTask.path);
    if (!actualTask) continue;
    for (const field of deterministicFields) {
      if (!Object.is(actualTask[field], expectedTask[field])) {
        errors.push(
          `task ${expectedTask.path} (${expectedIndex}).${field} mismatch: expected ${JSON.stringify(expectedTask[field])}, received ${JSON.stringify(actualTask[field])}`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Invalid Maister task index: ${file}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Valid Maister task index: ${file}`);
