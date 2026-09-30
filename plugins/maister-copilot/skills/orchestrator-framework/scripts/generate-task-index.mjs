#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.argv[2] || process.cwd());
const tasksRoot = path.join(projectRoot, ".maister", "tasks");
const outputPath = path.join(tasksRoot, "dashboard-data.js");

const taskTypeDirectories = new Map([
  ["development", "development"],
  ["performance", "performance"],
  ["migration", "migration"],
  ["migrations", "migration"],
  ["research", "research"],
  ["product-design", "product-design"],
]);

function scalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readTaskState(statePath, type, taskDirectory) {
  const lines = fs.readFileSync(statePath, "utf8").split(/\r?\n/);
  let section = null;
  let title = "";
  let description = "";
  let status = "pending";
  let updated = "";
  let phase = "";
  let pauseRequested = false;
  let resumeFrom = "";
  let current = "";
  let pending = [];
  let verificationStatus = "";
  let commitStatus = "not_recorded";
  let commitSha = "";
  let commitMessage = "";
  let readingDescription = false;

  for (const line of lines) {
    const verificationMatch = line.match(/^  last_status:\s*(.*)$/);
    if (verificationMatch) verificationStatus = scalar(verificationMatch[1]);
    if (/^task:\s*$/.test(line)) { section = "task"; readingDescription = false; continue; }
    if (/^orchestrator:\s*$/.test(line)) { section = "orchestrator"; readingDescription = false; continue; }
    if (/^commit:\s*$/.test(line)) { section = "commit"; readingDescription = false; continue; }
    if (/^[^ \t].*:\s*$/.test(line)) { section = null; readingDescription = false; continue; }

    if (section === "task") {
      const match = line.match(/^  (title|name|description|status|pause_requested|resume_from):\s*(.*)$/);
      if (match) {
        const [, key, raw] = match;
        readingDescription = key === "description" && /^(>|\|-)/.test(raw.trim());
        if (key === "title" || (key === "name" && !title)) title = scalar(raw);
        if (key === "description" && raw.trim() && !/^(>|\|-)/.test(raw.trim())) description = scalar(raw);
        if (key === "status") status = scalar(raw);
        if (key === "pause_requested") pauseRequested = scalar(raw) === "true";
        if (key === "resume_from") resumeFrom = scalar(raw);
        continue;
      }
      if (readingDescription) {
        const continuation = line.match(/^    (.+)$/);
        if (continuation && !description) description = continuation[1].trim();
      }
    }

    if (section === "orchestrator") {
      const match = line.match(/^  (updated|started_phase|current|task_path):\s*(.*)$/);
      if (match) {
        const [, key, raw] = match;
        if (key === "updated") updated = scalar(raw);
        if (key === "started_phase") phase = scalar(raw);
        if (key === "current") current = scalar(raw);
        continue;
      }
      if (/^  pending:\s*$/.test(line)) { pending = []; continue; }
      const pendingMatch = line.match(/^    - (.+)$/);
      if (pendingMatch && pending.length < 3) pending.push(scalar(pendingMatch[1]));
    }

    if (section === "commit") {
      const match = line.match(/^  (status|sha|message):\s*(.*)$/);
      if (match) {
        const [, key, raw] = match;
        if (key === "status") commitStatus = scalar(raw) || "not_recorded";
        if (key === "sha") commitSha = scalar(raw);
        if (key === "message") commitMessage = scalar(raw);
      }
    }
  }

  const relativeDirectory = path.relative(tasksRoot, taskDirectory).split(path.sep).join("/");
  const nextAction = pauseRequested
    ? `Wstrzymane — wznowić od ${resumeFrom || phase || "bieżącej fazy"}`
    : status === "in_progress"
      ? `Kontynuować ${current || phase || "bieżącą fazę"}${pending.length ? `; następnie ${pending.join(", ")}` : ""}`
      : status === "completed"
        ? verificationStatus === "passed_with_issues"
          ? "Zakończone z uwagami — sprawdzić raport weryfikacji"
          : "Brak — zakończone"
        : status === "failed" || status === "blocked"
          ? "Wymaga analizy i wznowienia"
          : "Uruchomić zadanie";

  return {
    type,
    name: title || path.basename(taskDirectory),
    description: description || "Brak opisu",
    status,
    next_action: nextAction,
    updated: updated || null,
    path: relativeDirectory,
    dashboard: `${relativeDirectory}/dashboard.html`,
    state: `${relativeDirectory}/orchestrator-state.yml`,
    commit_status: commitStatus,
    commit_sha: commitSha || null,
    commit_message: commitMessage || null,
  };
}

function discoverTasks() {
  if (!fs.existsSync(tasksRoot)) return [];
  const tasks = [];
  for (const type of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
    if (!type.isDirectory() || !taskTypeDirectories.has(type.name)) continue;
    const normalizedType = taskTypeDirectories.get(type.name);
    const typeRoot = path.join(tasksRoot, type.name);
    for (const task of fs.readdirSync(typeRoot, { withFileTypes: true })) {
      if (!task.isDirectory()) continue;
      const directory = path.join(typeRoot, task.name);
      const statePath = path.join(directory, "orchestrator-state.yml");
      if (fs.existsSync(statePath)) tasks.push(readTaskState(statePath, normalizedType, directory));
    }
  }
  return tasks.sort((a, b) => (b.updated || "").localeCompare(a.updated || "") || a.name.localeCompare(b.name));
}

const generated = new Date().toISOString();
const data = { generated, project: path.basename(projectRoot), tasks: discoverTasks() };
fs.mkdirSync(tasksRoot, { recursive: true });
fs.writeFileSync(outputPath, `window.MAISTER_TASK_INDEX = ${JSON.stringify(data, null, 2)};\n`);
console.log(`Generated Maister task index: ${outputPath} (${data.tasks.length} tasks)`);
