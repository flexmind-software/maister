#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const file = process.argv[2];
if (!file) {
  console.error("usage: validate-dashboard-data.mjs <dashboard-data.js>");
  process.exit(2);
}

if (!fs.existsSync(file)) {
  console.error(`Missing Maister dashboard data: ${file}`);
  process.exit(1);
}

const window = {};
vm.runInNewContext(fs.readFileSync(file, "utf8"), { window });
const data = window.MAISTER_DATA || window.__MAISTER_DASHBOARD_DATA__ || window.__MAISTER_STATE__ || window.__MAISTER_TASK__;
const errors = [];
const allowedStatuses = new Set(["pending", "in_progress", "completed", "skipped", "blocked", "failed"]);

if (!data || typeof data !== "object") errors.push("missing dashboard data global");
if (!data?.task?.title) errors.push("task.title is required");
if (!Array.isArray(data?.phases)) errors.push("phases must be an array");
if (data?.generated && Number.isNaN(Date.parse(data.generated))) errors.push("generated must be an ISO timestamp");

const phaseIds = new Set();

for (const [index, phase] of (data?.phases || []).entries()) {
  const prefix = `phases[${index}]`;
  if (!phase?.id) errors.push(`${prefix}.id is required`);
  if (phase?.id && phaseIds.has(phase.id)) errors.push(`${prefix}.id is duplicated: ${phase.id}`);
  if (phase?.id) phaseIds.add(phase.id);
  if (!phase?.name) errors.push(`${prefix}.name is required (use name, not title)`);
  if (phase?.status && !allowedStatuses.has(phase.status)) errors.push(`${prefix}.status is invalid: ${phase.status}`);
  if (!Array.isArray(phase?.artifacts)) errors.push(`${prefix}.artifacts must be an array`);
  for (const [artifactIndex, artifact] of (phase?.artifacts || []).entries()) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      errors.push(`${prefix}.artifacts[${artifactIndex}] must be an object with path/label/html`);
    } else if (!artifact.path) {
      errors.push(`${prefix}.artifacts[${artifactIndex}].path is required`);
    } else if (!fs.existsSync(resolveArtifact(file, artifact.path))) {
      errors.push(`${prefix}.artifacts[${artifactIndex}].path does not exist: ${artifact.path}`);
    }
    if (artifact?.html && !fs.existsSync(resolveArtifact(file, artifact.html))) {
      errors.push(`${prefix}.artifacts[${artifactIndex}].html does not exist: ${artifact.html}`);
    }
  }
}

if (errors.length) {
  console.error(`Invalid Maister dashboard data: ${file}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Valid Maister dashboard data: ${file}`);

function resolveArtifact(dataFile, relativePath) {
  return path.resolve(path.dirname(dataFile), relativePath);
}
