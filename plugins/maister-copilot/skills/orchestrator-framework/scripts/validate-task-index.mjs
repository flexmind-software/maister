#!/usr/bin/env node

import fs from "node:fs";
import vm from "node:vm";

const file = process.argv[2];
if (!file) {
  console.error("usage: validate-task-index.mjs <dashboard-data.js>");
  process.exit(2);
}

const window = {};
vm.runInNewContext(fs.readFileSync(file, "utf8"), { window });
const data = window.MAISTER_TASK_INDEX;
const errors = [];

if (!data || typeof data !== "object") errors.push("missing MAISTER_TASK_INDEX global");
if (!Array.isArray(data?.tasks)) errors.push("tasks must be an array");
for (const [index, task] of (data?.tasks || []).entries()) {
  for (const field of ["type", "name", "description", "status", "path", "dashboard", "state", "commit_status"]) {
    if (!task?.[field]) errors.push(`tasks[${index}].${field} is required`);
  }
}

if (errors.length) {
  console.error(`Invalid Maister task index: ${file}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Valid Maister task index: ${file}`);
