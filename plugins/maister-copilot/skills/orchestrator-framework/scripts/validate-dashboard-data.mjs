#!/usr/bin/env node

import fs from "node:fs";
import vm from "node:vm";

const file = process.argv[2];
if (!file) {
  console.error("usage: validate-dashboard-data.mjs <dashboard-data.js>");
  process.exit(2);
}

const window = {};
vm.runInNewContext(fs.readFileSync(file, "utf8"), { window });
const data = window.MAISTER_DATA || window.__MAISTER_DASHBOARD_DATA__ || window.__MAISTER_STATE__ || window.__MAISTER_TASK__;
const errors = [];

if (!data || typeof data !== "object") errors.push("missing dashboard data global");
if (!data?.task?.title) errors.push("task.title is required");
if (!Array.isArray(data?.phases)) errors.push("phases must be an array");

for (const [index, phase] of (data?.phases || []).entries()) {
  const prefix = `phases[${index}]`;
  if (!phase?.id) errors.push(`${prefix}.id is required`);
  if (!phase?.name) errors.push(`${prefix}.name is required (use name, not title)`);
  if (!Array.isArray(phase?.artifacts)) errors.push(`${prefix}.artifacts must be an array`);
  for (const [artifactIndex, artifact] of (phase?.artifacts || []).entries()) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      errors.push(`${prefix}.artifacts[${artifactIndex}] must be an object with path/label/html`);
    } else if (!artifact.path) {
      errors.push(`${prefix}.artifacts[${artifactIndex}].path is required`);
    }
  }
}

if (errors.length) {
  console.error(`Invalid Maister dashboard data: ${file}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Valid Maister dashboard data: ${file}`);
