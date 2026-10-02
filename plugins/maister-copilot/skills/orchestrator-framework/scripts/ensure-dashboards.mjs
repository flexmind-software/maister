#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frameworkDirectory = path.resolve(scriptDirectory, "..");
const projectRoot = path.resolve(process.argv[2] || process.cwd());
const taskDirectory = process.argv[3] ? path.resolve(projectRoot, process.argv[3]) : null;
const tasksRoot = path.join(projectRoot, ".maister", "tasks");
const configPath = path.join(projectRoot, ".maister", "config.yml");

function htmlOutputEnabled() {
  if (!fs.existsSync(configPath)) return true;
  const config = fs.readFileSync(configPath, "utf8");
  const match = config.match(/^\s*html_output:\s*(true|false)\s*$/m);
  return match ? match[1] === "true" : true;
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function syncAsset(assetPath, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const changed = !fs.existsSync(destination) || digest(assetPath) !== digest(destination);
  if (!changed) return false;

  const temporary = `${destination}.tmp-${process.pid}`;
  fs.copyFileSync(assetPath, temporary);
  fs.renameSync(temporary, destination);
  console.log(`Synchronized dashboard asset: ${path.relative(projectRoot, destination)}`);
  return true;
}

if (!htmlOutputEnabled()) {
  console.log("Maister HTML dashboards are disabled by .maister/config.yml (html_output: false)");
  process.exit(0);
}

const projectAsset = path.join(frameworkDirectory, "assets", "tasks-dashboard.html");
const taskAsset = path.join(frameworkDirectory, "assets", "dashboard.html");
if (!fs.existsSync(projectAsset) || !fs.existsSync(taskAsset)) {
  console.error(`Maister dashboard assets are missing from ${frameworkDirectory}/assets`);
  process.exit(1);
}

syncAsset(projectAsset, path.join(tasksRoot, "dashboard.html"));

if (taskDirectory) {
  const relativeTask = path.relative(tasksRoot, taskDirectory);
  if (!fs.existsSync(taskDirectory) || !relativeTask || relativeTask.startsWith("..") || path.isAbsolute(relativeTask)) {
    console.error(`Task directory must be inside ${tasksRoot}: ${taskDirectory}`);
    process.exit(2);
  }
  syncAsset(taskAsset, path.join(taskDirectory, "dashboard.html"));
}

console.log("Maister dashboards are present and synchronized with the plugin assets");
