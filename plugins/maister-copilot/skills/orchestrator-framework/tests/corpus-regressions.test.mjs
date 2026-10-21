import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  StateSemanticsError,
  parseAndNormalizeState,
} from "../scripts/state-semantics.mjs";
import { validateDashboardStateSync } from "../scripts/validate-dashboard-state-sync.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(testDirectory, "fixtures", "corpus-regressions");

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureDirectory, name), "utf8");
}

function captureStateError(name, taskType = "development") {
  try {
    parseAndNormalizeState(readFixture(name), {
      sourcePath: `fixtures/corpus-regressions/${name}`,
      taskType,
    });
  } catch (error) {
    return error;
  }
  assert.fail(`Expected ${name} to be rejected`);
}

test("C01 quotes both live-corpus backtick scalars without changing their text", () => {
  for (const stem of ["backtick-action", "backtick-risk"]) {
    const invalid = captureStateError(`${stem}-invalid.yml`);
    assert.ok(invalid instanceof StateSemanticsError);
    assert.ok(invalid.diagnostics.some(({ kind }) => kind === "syntax"));
  }

  const action = parseAndNormalizeState(readFixture("backtick-action-valid.yml"), {
    sourcePath: "fixtures/corpus-regressions/backtick-action-valid.yml",
    taskType: "development",
  });
  const risk = parseAndNormalizeState(readFixture("backtick-risk-valid.yml"), {
    sourcePath: "fixtures/corpus-regressions/backtick-risk-valid.yml",
    taskType: "development",
  });
  assert.equal(
    action.phaseSummaries.analysis.decisions[0].decision,
    "`context_expansion_required` remains the transition reason.",
  );
  assert.equal(
    risk.phaseSummaries.analysis.risks[0],
    "`EvidenceReranker` needs a deterministic fallback.",
  );
});

test("C02 reports both MinIO phase sources and observed statuses", () => {
  const error = captureStateError("minio-phase-conflict.yml", "migrations");
  assert.ok(error instanceof StateSemanticsError);
  const message = error.diagnostics.map(({ message }) => message).join("\n");
  assert.match(message, /orchestrator\.failed_phases\[0\]=\"failed\"/);
  assert.match(message, /orchestrator\.phase_tasks\[0\]=\"completed\"/);
});

test("C03 accepts Entra skipped registry encoding only as completed plus metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maister-entra-regression-"));
  try {
    fs.copyFileSync(path.join(fixtureDirectory, "entra-state.yml"), path.join(directory, "orchestrator-state.yml"));
    fs.copyFileSync(path.join(fixtureDirectory, "entra-dashboard.js"), path.join(directory, "dashboard-data.js"));
    fs.copyFileSync(path.join(fixtureDirectory, "entra-registry-stale.json"), path.join(directory, "codex-tasks.json"));

    const stale = validateDashboardStateSync({
      dashboardPath: path.join(directory, "dashboard-data.js"),
      statePath: path.join(directory, "orchestrator-state.yml"),
    });
    assert.ok(stale.some((message) => message.includes("phase status mismatch")));
    assert.ok(stale.some((message) => message.includes("metadata.skipped mismatch")));

    fs.copyFileSync(path.join(fixtureDirectory, "entra-registry-current.json"), path.join(directory, "codex-tasks.json"));
    assert.deepEqual(
      validateDashboardStateSync({
        dashboardPath: path.join(directory, "dashboard-data.js"),
        statePath: path.join(directory, "orchestrator-state.yml"),
      }),
      [],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("C04 rejects completed applicable work but accepts frozen exceptions", () => {
  const conflict = captureStateError("completed-open.yml");
  assert.ok(conflict instanceof StateSemanticsError);
  assert.ok(
    conflict.diagnostics.some(({ message }) =>
      message.includes("completed task has open applicable phase-3"),
    ),
  );

  for (const name of [
    "completed-non-applicable.yml",
    "superseded-open.yml",
    "cancelled-open.yml",
  ]) {
    const model = parseAndNormalizeState(readFixture(name), {
      sourcePath: `fixtures/corpus-regressions/${name}`,
      taskType: "development",
    });
    assert.notEqual(model.nextAction, "phase-3", name);
  }
});
