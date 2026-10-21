#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StateSemanticsError, formatDiagnostic, parseAndNormalizeState } from "./state-semantics.mjs";
import { loadDashboardData, validateDashboardData } from "./validate-dashboard-data.mjs";

const REGISTRY_STATUSES = new Set(["pending", "in_progress", "completed", "failed", "blocked"]);

export function validateDashboardStateSync({ dashboardPath, statePath }) {
  const errors = [];
  let dashboard;
  let model;
  try {
    dashboard = loadDashboardData(dashboardPath);
    errors.push(...validateDashboardData(dashboard, dashboardPath));
  } catch (error) {
    errors.push(error.message);
  }
  try {
    const source = fs.readFileSync(statePath, "utf8");
    model = parseAndNormalizeState(source, { sourcePath: statePath, taskType: inferTaskType(statePath) });
  } catch (error) {
    if (error instanceof StateSemanticsError) errors.push(...error.diagnostics.map(formatDiagnostic));
    else errors.push(`${statePath}: ${error.message}`);
  }
  if (!dashboard || !model) return errors;

  compareValue("task.title", model.task.title, dashboard.task?.title, errors);
  compareValue("task.status", model.task.status, dashboard.task?.status, errors);
  validatePhaseProjection(model, dashboard, errors);
  validateSummaryProjection(model, dashboard, errors);
  validateRegistryProjection(model, path.join(path.dirname(statePath), "codex-tasks.json"), errors);
  return errors;
}

function validatePhaseProjection(model, dashboard, errors) {
  const dashboardById = new Map();
  const phases = Array.isArray(dashboard.phases) ? dashboard.phases : [];
  for (const [index, phase] of phases.entries()) {
    if (typeof phase?.id !== "string" || dashboardById.has(phase.id)) continue;
    dashboardById.set(phase.id, { phase, index });
  }
  for (const canonical of model.phases) {
    const local = dashboardById.get(canonical.id);
    if (!local) {
      errors.push(`canonical phase ${canonical.id} is missing from dashboard phases`);
      continue;
    }
    compareValue(
      `phase ${canonical.id} status (dashboard phases[${local.index}].status)`,
      canonical.status,
      local.phase.status,
      errors,
    );
  }
  const canonicalIds = new Set(model.phases.map(({ id }) => id));
  for (const id of dashboardById.keys()) {
    if (!canonicalIds.has(id)) {
      errors.push(`dashboard phase ${id} is not declared by canonical state`);
    }
  }
}

function validateSummaryProjection(model, dashboard, errors) {
  const mappedKeys = new Set();
  const phases = Array.isArray(dashboard.phases) ? dashboard.phases : [];
  for (const [index, phase] of phases.entries()) {
    const keys = Array.isArray(phase?.summary_keys)
      ? phase.summary_keys
      : phase?.summary_key ? [phase.summary_key] : [];
    const decisions = Array.isArray(phase?.decisions) ? phase.decisions : [];
    const risks = Array.isArray(phase?.risks) ? phase.risks : [];
    if ((decisions.length > 0 || risks.length > 0) && keys.length === 0) {
      errors.push(`phases[${index}] has decisions/risks but no summary_keys mapping`);
      continue;
    }
    const summaries = [];
    for (const key of keys) {
      if (typeof key !== "string" || !Object.hasOwn(model.phaseSummaries, key)) {
        errors.push(`phases[${index}] maps unknown phase summary: ${String(key)}`);
        continue;
      }
      mappedKeys.add(key);
      summaries.push(model.phaseSummaries[key]);
    }
    const expected = mergeSummaries(summaries);
    compareList(
      `phases[${index}].decisions`,
      expected.decisions.map(normalizeDecision),
      decisions.map(normalizeDecision),
      errors,
    );
    compareList(
      `phases[${index}].risks`,
      expected.risks.map(normalizeText),
      risks.map(normalizeText),
      errors,
    );
  }
  for (const [key, summary] of Object.entries(model.phaseSummaries)) {
    if ((summary.decisions.length > 0 || summary.risks.length > 0) && !mappedKeys.has(key)) {
      errors.push(`state task_context.phase_summaries.${key} has decisions/risks but is not projected to the dashboard`);
    }
  }
}

function validateRegistryProjection(model, registryPath, errors) {
  const mappings = model.registryExpectations;
  if (!fs.existsSync(registryPath)) {
    if (mappings.length > 0) errors.push(`Missing Codex task registry required by canonical mappings: ${registryPath}`);
    return;
  }
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    errors.push(`Invalid Codex task registry JSON ${registryPath}: ${error.message}`);
    return;
  }
  const registryErrors = validateRegistryShape(registry);
  errors.push(...registryErrors.map((error) => `${registryPath}: ${error}`));
  if (registryErrors.length > 0) return;

  const byId = new Map(registry.tasks.map((task) => [task.id, task]));
  for (const expectation of mappings) {
    const label = `orchestrator.${expectation.namespace}.${expectation.key}`;
    const task = byId.get(expectation.registryId);
    if (!task) {
      errors.push(`${label}=${JSON.stringify(expectation.registryId)} does not resolve in ${registryPath}`);
      continue;
    }
    if (expectation.phaseId === null || expectation.phaseStatus === null) continue;
    const expectedStatus = expectation.phaseStatus === "skipped" ? "completed" : expectation.phaseStatus;
    if (task.status !== expectedStatus) {
      errors.push(`${label} phase status mismatch: expected ${JSON.stringify(expectedStatus)} but found ${JSON.stringify(task.status)} at registry task ${task.id}`);
    }
    const expectedSkipped = expectation.phaseStatus === "skipped";
    if ((task.metadata.skipped === true) !== expectedSkipped) {
      errors.push(`${label} metadata.skipped mismatch: expected ${expectedSkipped} but found ${JSON.stringify(task.metadata.skipped)}`);
    }
    if (expectation.dependencies !== null) {
      const expectedBlockedBy = [];
      for (const dependency of expectation.dependencies) {
        const mapped = model.taskIdMaps.task_ids?.[dependency];
        if (typeof mapped !== "string") {
          errors.push(`${label} dependency ${dependency} has no non-null orchestrator.task_ids mapping`);
        } else {
          expectedBlockedBy.push(mapped);
        }
      }
      compareUnorderedList(`${label} blockedBy`, expectedBlockedBy, task.blockedBy, errors);
    }
  }
}

function validateRegistryShape(registry) {
  const errors = [];
  if (!isRecord(registry)) return ["registry root must be an object"];
  if (registry.schema_version !== 1) errors.push("schema_version must equal 1");
  if (!Number.isInteger(registry.next_id) || registry.next_id <= 0) errors.push("next_id must be a positive integer");
  if (!Array.isArray(registry.tasks)) return [...errors, "tasks must be an array"];
  const ids = new Set();
  for (const [index, task] of registry.tasks.entries()) {
    const prefix = `tasks[${index}]`;
    if (!isRecord(task)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (typeof task.id !== "string" || task.id.length === 0) errors.push(`${prefix}.id must be a non-empty string`);
    else if (ids.has(task.id)) errors.push(`${prefix}.id is duplicated: ${task.id}`);
    else ids.add(task.id);
    if (!REGISTRY_STATUSES.has(task.status)) errors.push(`${prefix}.status is invalid: ${String(task.status)}`);
    if (!Array.isArray(task.blockedBy) || task.blockedBy.some((id) => typeof id !== "string")) {
      errors.push(`${prefix}.blockedBy must be a string array`);
    }
    if (!isRecord(task.metadata)) errors.push(`${prefix}.metadata must be an object`);
  }
  return errors;
}

function inferTaskType(statePath) {
  const supported = new Set(["development", "performance", "migration", "migrations", "research", "product-design"]);
  return [...path.resolve(statePath).split(path.sep)].reverse().find((part) => supported.has(part)) ?? null;
}
function mergeSummaries(summaries) {
  const merged = { decisions: [], risks: [] };
  for (const summary of summaries) {
    merged.decisions.push(...summary.decisions);
    merged.risks.push(...summary.risks);
  }
  return merged;
}
function normalizeDecision(value) {
  if (typeof value === "string") return { decision: value.trim(), rationale: null };
  if (!isRecord(value)) return { decision: String(value), rationale: null };
  return {
    decision: String(value.decision ?? "").trim(),
    rationale: value.rationale === null || value.rationale === undefined ? null : String(value.rationale).trim(),
  };
}
function normalizeText(value) {
  return String(value ?? "").trim();
}
function compareValue(label, expected, actual, errors) {
  if (expected !== actual) errors.push(`${label} does not match state; expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}`);
}
function compareList(label, expected, actual, errors) {
  const expectedJson = JSON.stringify(expected);
  const actualJson = JSON.stringify(actual);
  if (expectedJson !== actualJson) errors.push(`${label} does not match state; expected ${expectedJson} but found ${actualJson}`);
}
function compareUnorderedList(label, expected, actual, errors) {
  compareList(label, [...new Set(expected)].sort(), [...new Set(actual)].sort(), errors);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const [dashboardPath, statePath] = process.argv.slice(2);
  if (!dashboardPath || !statePath) {
    console.error("usage: validate-dashboard-state-sync.mjs <dashboard-data.js> <orchestrator-state.yml>");
    process.exitCode = 2;
  } else if (!fs.existsSync(statePath)) {
    console.error(`Missing orchestrator state: ${statePath}`);
    process.exitCode = 1;
  } else {
    const errors = validateDashboardStateSync({ dashboardPath, statePath });
    if (errors.length > 0) {
      console.error("Dashboard/state synchronization failed:");
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`Dashboard/state synchronization valid: ${path.basename(dashboardPath)}`);
    }
  }
}
