#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const TASK_STATUSES = new Set([
  "pending", "in_progress", "completed", "blocked", "failed", "superseded", "cancelled",
]);
export const PHASE_STATUSES = new Set([
  "pending", "in_progress", "completed", "skipped", "blocked", "failed", "cancelled",
]);
const DASHBOARD_GLOBALS = [
  "MAISTER_DATA", "__MAISTER_DASHBOARD_DATA__", "__MAISTER_STATE__", "__MAISTER_TASK__",
];

export function loadDashboardData(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing Maister dashboard data: ${file}`);
  const window = {};
  try {
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { window }, { filename: file, timeout: 1000 });
  } catch (error) {
    throw new Error(`Cannot evaluate Maister dashboard data ${file}: ${error.message}`);
  }
  return DASHBOARD_GLOBALS.map((name) => window[name]).find((value) => value !== undefined);
}

export function validateDashboardData(data, file) {
  if (!isRecord(data)) return ["missing dashboard data global"];
  const errors = [];
  if (!isNonEmptyString(data.task?.title)) errors.push("task.title is required");
  if (!TASK_STATUSES.has(data.task?.status)) errors.push(`task.status is invalid: ${String(data.task?.status)}`);
  if (!Array.isArray(data.phases)) errors.push("phases must be an array");
  if (data.generated && Number.isNaN(Date.parse(data.generated))) errors.push("generated must be an ISO timestamp");

  const phaseIds = new Set();
  for (const [index, phase] of (data.phases || []).entries()) {
    const prefix = `phases[${index}]`;
    if (!isRecord(phase)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmptyString(phase.id)) errors.push(`${prefix}.id is required`);
    if (isNonEmptyString(phase.id) && phaseIds.has(phase.id)) errors.push(`${prefix}.id is duplicated: ${phase.id}`);
    if (isNonEmptyString(phase.id)) phaseIds.add(phase.id);
    if (!isNonEmptyString(phase.name)) errors.push(`${prefix}.name is required (use name, not title)`);
    if (!PHASE_STATUSES.has(phase.status)) errors.push(`${prefix}.status is invalid: ${String(phase.status)}`);
    if (!Array.isArray(phase.artifacts)) errors.push(`${prefix}.artifacts must be an array`);
    if (phase.decisions !== undefined && !Array.isArray(phase.decisions)) errors.push(`${prefix}.decisions must be an array`);
    if (phase.risks !== undefined && !Array.isArray(phase.risks)) errors.push(`${prefix}.risks must be an array`);
    for (const [artifactIndex, artifact] of (phase.artifacts || []).entries()) {
      if (!isRecord(artifact)) {
        errors.push(`${prefix}.artifacts[${artifactIndex}] must be an object with path/label/html`);
      } else if (!isNonEmptyString(artifact.path)) {
        errors.push(`${prefix}.artifacts[${artifactIndex}].path is required`);
      } else if (!fs.existsSync(resolveArtifact(file, artifact.path))) {
        errors.push(`${prefix}.artifacts[${artifactIndex}].path does not exist: ${artifact.path}`);
      }
      if (artifact?.html && !fs.existsSync(resolveArtifact(file, artifact.html))) {
        errors.push(`${prefix}.artifacts[${artifactIndex}].html does not exist: ${artifact.html}`);
      }
    }
  }
  return errors;
}

function resolveArtifact(dataFile, relativePath) {
  return path.resolve(path.dirname(dataFile), relativePath);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: validate-dashboard-data.mjs <dashboard-data.js>");
    process.exitCode = 2;
  } else {
    try {
      const errors = validateDashboardData(loadDashboardData(file), file);
      if (errors.length > 0) {
        console.error(`Invalid Maister dashboard data: ${file}`);
        for (const error of errors) console.error(`- ${error}`);
        process.exitCode = 1;
      } else {
        console.log(`Valid Maister dashboard data: ${file}`);
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
