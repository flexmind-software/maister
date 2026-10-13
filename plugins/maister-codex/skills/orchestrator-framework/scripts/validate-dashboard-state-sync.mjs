#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const [dashboardPath, statePath] = process.argv.slice(2);
if (!dashboardPath || !statePath) {
  console.error("usage: validate-dashboard-state-sync.mjs <dashboard-data.js> <orchestrator-state.yml>");
  process.exit(2);
}

if (!fs.existsSync(dashboardPath)) {
  console.error(`Missing dashboard data: ${dashboardPath}`);
  process.exit(1);
}
if (!fs.existsSync(statePath)) {
  console.error(`Missing orchestrator state: ${statePath}`);
  process.exit(1);
}

const window = {};
vm.runInNewContext(fs.readFileSync(dashboardPath, "utf8"), { window });
const dashboard = window.MAISTER_DATA || window.__MAISTER_DASHBOARD_DATA__ || window.__MAISTER_STATE__ || window.__MAISTER_TASK__;
const stateSummaries = readPhaseSummaries(statePath);
const errors = [];
const mappedKeys = new Set();

if (!dashboard || !Array.isArray(dashboard.phases)) {
  errors.push("dashboard must expose a phases array");
} else {
  for (const [index, phase] of dashboard.phases.entries()) {
    const keys = Array.isArray(phase.summary_keys)
      ? phase.summary_keys
      : phase.summary_key
        ? [phase.summary_key]
        : [];
    const hasProjection = (phase.decisions || []).length > 0 || (phase.risks || []).length > 0;
    if (hasProjection && keys.length === 0) {
      errors.push(`phases[${index}] has decisions/risks but no summary_keys mapping`);
      continue;
    }
    for (const key of keys) {
      if (!stateSummaries.has(key)) {
        errors.push(`phases[${index}] maps unknown phase summary: ${key}`);
        continue;
      }
      mappedKeys.add(key);
    }

    const expected = mergeSummaries(keys.map((key) => stateSummaries.get(key)));
    compareLists(
      `phases[${index}].decisions`,
      expected.decisions.map((item) => item.decision),
      (phase.decisions || []).map((item) => typeof item === "string" ? item : item.decision),
      errors,
    );
    compareLists(`phases[${index}].risks`, expected.risks, phase.risks || [], errors);
  }
}

for (const [key, summary] of stateSummaries.entries()) {
  if ((summary.decisions.length || summary.risks.length) && !mappedKeys.has(key)) {
    errors.push(`state phase_summaries.${key} has decisions/risks but is not projected to the dashboard`);
  }
}

if (errors.length) {
  console.error("Dashboard/state synchronization failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Dashboard/state synchronization valid: ${path.basename(dashboardPath)}`);

function readPhaseSummaries(file) {
  const summaries = new Map();
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let inSummaries = false;
  let current = null;
  let section = null;
  let currentDecision = null;

  for (const line of lines) {
    if (line === "  phase_summaries:") {
      inSummaries = true;
      continue;
    }
    if (!inSummaries) continue;
    if (/^  \S/.test(line)) break;

    const phaseMatch = line.match(/^    ([A-Za-z0-9_-]+):\s*$/);
    if (phaseMatch) {
      current = { decisions: [], risks: [] };
      summaries.set(phaseMatch[1], current);
      section = null;
      currentDecision = null;
      continue;
    }
    if (!current) continue;

    const sectionMatch = line.match(/^      (decisions|risks):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      currentDecision = null;
      continue;
    }
    if (/^      \S/.test(line)) {
      section = null;
      currentDecision = null;
      continue;
    }

    if (section === "decisions") {
      const decisionMatch = line.match(/^        - decision:\s*(.*)$/);
      if (decisionMatch) {
        currentDecision = { decision: scalar(decisionMatch[1]) };
        current.decisions.push(currentDecision);
        continue;
      }
      const rationaleMatch = line.match(/^          rationale:\s*(.*)$/);
      if (rationaleMatch && currentDecision) currentDecision.rationale = scalar(rationaleMatch[1]);
    } else if (section === "risks") {
      const riskMatch = line.match(/^        - (.*)$/);
      if (riskMatch) current.risks.push(scalar(riskMatch[1]));
    }
  }
  return summaries;
}

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function mergeSummaries(summaries) {
  const merged = { decisions: [], risks: [] };
  for (const summary of summaries) {
    if (!summary) continue;
    merged.decisions.push(...summary.decisions);
    merged.risks.push(...summary.risks);
  }
  return merged;
}

function compareLists(label, expected, actual, errors) {
  const normalize = (value) => String(value ?? "").trim();
  const expectedNormalized = expected.map(normalize);
  const actualNormalized = actual.map(normalize);
  if (expectedNormalized.length !== actualNormalized.length || expectedNormalized.some((value, index) => value !== actualNormalized[index])) {
    errors.push(`${label} does not match state; expected ${JSON.stringify(expectedNormalized)} but found ${JSON.stringify(actualNormalized)}`);
  }
}
