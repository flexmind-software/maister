#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  StateSemanticsError,
  formatDiagnostic,
  normalizeTaskType,
  parseAndNormalizeState,
  projectTaskRecord,
  sortTaskRecords,
} from "./state-semantics.mjs";

export const TASK_TYPE_DIRECTORIES = Object.freeze([
  "development",
  "performance",
  "migration",
  "migrations",
  "research",
  "product-design",
]);

export class TaskIndexBuildError extends Error {
  constructor(diagnostics) {
    super(`Cannot generate Maister task index:\n${diagnostics.map((item) => `- ${item}`).join("\n")}`);
    this.name = "TaskIndexBuildError";
    this.diagnostics = diagnostics;
  }
}

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function discoverTaskStates(tasksRoot) {
  if (!fs.existsSync(tasksRoot)) return [];
  const states = [];
  for (const directoryName of TASK_TYPE_DIRECTORIES) {
    const typeRoot = path.join(tasksRoot, directoryName);
    if (!fs.existsSync(typeRoot)) continue;
    for (const entry of fs.readdirSync(typeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const taskDirectory = path.join(typeRoot, entry.name);
      const statePath = path.join(taskDirectory, "orchestrator-state.yml");
      if (!fs.existsSync(statePath)) continue;
      states.push({
        type: normalizeTaskType(directoryName),
        taskDirectory,
        statePath,
      });
    }
  }
  return states;
}

function diagnosticsForError(error, statePath) {
  if (error instanceof StateSemanticsError) {
    return error.diagnostics.map(formatDiagnostic);
  }
  return [`${statePath}: ${error instanceof Error ? error.message : String(error)}`];
}

export function buildTaskIndex(projectRoot, { generated = new Date().toISOString() } = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const tasksRoot = path.join(resolvedProjectRoot, ".maister", "tasks");
  const records = [];
  const diagnostics = [];

  for (const state of discoverTaskStates(tasksRoot)) {
    try {
      const source = fs.readFileSync(state.statePath, "utf8");
      const model = parseAndNormalizeState(source, {
        sourcePath: state.statePath,
        taskType: state.type,
      });
      records.push(
        projectTaskRecord(model, {
          type: state.type,
          relativeDirectory: toPortablePath(path.relative(tasksRoot, state.taskDirectory)),
          stateFileMtime: fs.statSync(state.statePath).mtime,
        }),
      );
    } catch (error) {
      diagnostics.push(...diagnosticsForError(error, state.statePath));
    }
  }

  if (diagnostics.length > 0) throw new TaskIndexBuildError(diagnostics);
  return {
    generated,
    project: path.basename(resolvedProjectRoot),
    tasks: sortTaskRecords(records),
  };
}

export function serializeTaskIndex(data) {
  return `window.MAISTER_TASK_INDEX = ${JSON.stringify(data, null, 2)};\n`;
}

function openExclusiveTemporary(outputPath) {
  const directory = path.dirname(outputPath);
  const basename = path.basename(outputPath);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const token = crypto.randomBytes(8).toString("hex");
    const temporaryPath = path.join(
      directory,
      `.${basename}.${process.pid}.${Date.now()}.${token}.tmp`,
    );
    try {
      const descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o666,
      );
      return { descriptor, temporaryPath };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Unable to create an exclusive temporary index beside ${outputPath}`);
}

export function writeTaskIndexAtomically(outputPath, source) {
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  const existingMode = fs.existsSync(resolvedOutputPath)
    ? fs.statSync(resolvedOutputPath).mode & 0o7777
    : null;
  let descriptor = null;
  let temporaryPath = null;

  try {
    ({ descriptor, temporaryPath } = openExclusiveTemporary(resolvedOutputPath));
    if (existingMode !== null) fs.fchmodSync(descriptor, existingMode);
    fs.writeFileSync(descriptor, source, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, resolvedOutputPath);
    temporaryPath = null;
  } catch (error) {
    let cleanupError = null;
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        cleanupError = closeError;
      }
    }
    if (temporaryPath !== null) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") cleanupError ??= unlinkError;
      }
    }
    if (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Task index write failed (${error.message}); temporary-file cleanup also failed (${cleanupError.message})`,
      );
    }
    throw error;
  }
}

export function generateTaskIndex(projectRoot) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const outputPath = path.join(resolvedProjectRoot, ".maister", "tasks", "dashboard-data.js");
  const data = buildTaskIndex(resolvedProjectRoot);
  writeTaskIndexAtomically(outputPath, serializeTaskIndex(data));
  return { data, outputPath };
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const projectRoot = path.resolve(process.argv[2] || process.cwd());
    const { data, outputPath } = generateTaskIndex(projectRoot);
    console.log(`Generated Maister task index: ${outputPath} (${data.tasks.length} tasks)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
