import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const frameworkDirectory = path.resolve(testDirectory, "..");
const fixtureDirectory = path.join(testDirectory, "fixtures", "parser");
const compatibilityFixtureDirectory = path.join(
  testDirectory,
  "fixtures",
  "compatibility",
);
const semanticsUrl = new URL("../scripts/state-semantics.mjs", import.meta.url);

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureDirectory, name), "utf8");
}

function readCompatibilityFixture(name) {
  return fs.readFileSync(path.join(compatibilityFixtureDirectory, `${name}.yml`), "utf8");
}

async function loadSemantics() {
  return import(semanticsUrl.href);
}

function captureStateError(parseStateDocument, source, sourcePath) {
  try {
    parseStateDocument(source, { sourcePath });
  } catch (error) {
    return error;
  }
  assert.fail(`Expected ${sourcePath} to be rejected`);
}

test("Y01 parses supported YAML forms and preserves timestamp scalars as strings", async () => {
  const { parseStateDocument } = await loadSemantics();
  const parsed = parseStateDocument(readFixture("Y01-valid-syntax.yml"), {
    sourcePath: "fixtures/Y01-valid-syntax.yml",
  });

  assert.equal(parsed.value.task.description, "First description line continues here.");
  assert.equal(parsed.value.task.literal, "alpha\nbeta");
  assert.deepEqual(parsed.value.orchestrator.completed_phases, ["phase-1", 2]);
  assert.deepEqual(parsed.value.orchestrator.options, {
    html_output: true,
    label: "quoted value",
  });
  assert.equal(parsed.value.task.updated, "2026-10-20T12:34:56Z");
  assert.equal(typeof parsed.value.task.updated, "string");
  assert.deepEqual(parsed.locationFor(["task", "updated"]), { line: 11, column: 12 });
});

test("Y02 reports malformed YAML with stable source, line, and column diagnostics", async () => {
  const { formatDiagnostic, parseStateDocument, StateSemanticsError } = await loadSemantics();
  const sourcePath = "fixtures/Y02-malformed.yml";
  const error = captureStateError(
    parseStateDocument,
    readFixture("Y02-malformed.yml"),
    sourcePath,
  );

  assert.ok(error instanceof StateSemanticsError);
  assert.ok(error.diagnostics.some((diagnostic) => diagnostic.kind === "syntax"));
  for (const diagnostic of error.diagnostics) {
    assert.equal(diagnostic.sourcePath, sourcePath);
    assert.ok(Number.isInteger(diagnostic.line) && diagnostic.line > 0);
    assert.ok(Number.isInteger(diagnostic.column) && diagnostic.column > 0);
    assert.match(formatDiagnostic(diagnostic), /^fixtures\/Y02-malformed\.yml:\d+:\d+: /);
  }
});

test("Y03 rejects duplicate keys, multiple documents, and non-mapping roots", async () => {
  const { parseStateDocument, StateSemanticsError } = await loadSemantics();
  const cases = [
    ["Y03-duplicate.yml", "duplicate-key"],
    ["Y03-multiple-documents.yml", "multiple-documents"],
    ["Y03-non-mapping-root.yml", "mapping-root-required"],
  ];

  for (const [fixture, expectedCode] of cases) {
    const error = captureStateError(parseStateDocument, readFixture(fixture), `fixtures/${fixture}`);
    assert.ok(error instanceof StateSemanticsError);
    assert.ok(
      error.diagnostics.some((diagnostic) => diagnostic.code === expectedCode),
      `${fixture} should report ${expectedCode}`,
    );
  }
});

test("Y04 enforces zero-tolerance alias and merge-key policy", async () => {
  const { parseStateDocument, StateSemanticsError } = await loadSemantics();
  const cases = [
    ["Y04-alias.yml", "alias-not-allowed"],
    ["Y04-merge-key.yml", "merge-key-not-allowed"],
  ];

  for (const [fixture, expectedCode] of cases) {
    const error = captureStateError(parseStateDocument, readFixture(fixture), `fixtures/${fixture}`);
    assert.ok(error instanceof StateSemanticsError);
    assert.ok(
      error.diagnostics.some((diagnostic) => diagnostic.code === expectedCode),
      `${fixture} should report ${expectedCode}`,
    );
  }
});

test("Y05 rejects explicit tags and invalid consumed-field types with field paths", async () => {
  const { parseStateDocument, StateSemanticsError } = await loadSemantics();
  const taggedError = captureStateError(
    parseStateDocument,
    readFixture("Y05-explicit-tag.yml"),
    "fixtures/Y05-explicit-tag.yml",
  );
  assert.ok(taggedError instanceof StateSemanticsError);
  assert.ok(taggedError.diagnostics.some((diagnostic) => diagnostic.code === "tag-not-allowed"));

  const typeError = captureStateError(
    parseStateDocument,
    readFixture("Y05-invalid-consumed-type.yml"),
    "fixtures/Y05-invalid-consumed-type.yml",
  );
  assert.ok(typeError instanceof StateSemanticsError);
  assert.ok(
    typeError.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid-field-type" && diagnostic.fieldPath === "task.description",
    ),
  );
});

test("Y06 uses the pinned zero-install yaml 2.9.1 runtime with complete provenance", async () => {
  const { YAML_VENDOR } = await loadSemantics();
  const vendorDirectory = path.join(frameworkDirectory, "vendor", "yaml-2.9.1");
  const provenance = JSON.parse(
    fs.readFileSync(path.join(vendorDirectory, "PROVENANCE.json"), "utf8"),
  );
  const license = fs.readFileSync(path.join(vendorDirectory, "LICENSE"), "utf8");
  const semanticsSource = fs.readFileSync(fileURLToPath(semanticsUrl), "utf8");

  assert.deepEqual(YAML_VENDOR, {
    package: "yaml",
    version: "2.9.1",
  });
  assert.deepEqual(provenance, {
    package: "yaml",
    version: "2.9.1",
    license: "ISC",
    upstream: "git+https://github.com/eemeli/yaml.git",
    integrity:
      "sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==",
    owner: "Maister plugin maintainers",
  });
  assert.match(license, /Permission to use, copy, modify, and\/or distribute this software/);
  assert.match(semanticsSource, /\.\.\/vendor\/yaml-2\.9\.1\/dist\/index\.js/);
  assert.ok(fs.existsSync(path.join(vendorDirectory, "dist", "index.js")));
});

test("N01 normalizes current terminal sets and projects the complete central record", async () => {
  const { parseAndNormalizeState, projectTaskRecord } = await loadSemantics();
  const model = parseAndNormalizeState(readCompatibilityFixture("compat-current-terminal-sets"), {
    sourcePath: "fixtures/compat-current-terminal-sets.yml",
    taskType: "development",
  });

  assert.deepEqual(
    model.phases.map(({ id, status }) => ({ id, status })),
    [
      { id: "phase-1", status: "completed" },
      { id: "phase-2", status: "completed" },
      { id: "phase-3", status: "failed" },
      { id: "phase-4", status: "in_progress" },
    ],
  );
  assert.deepEqual(
    projectTaskRecord(model, {
      type: "development",
      relativeDirectory: "development/current-terminal-sets",
      stateFileMtime: "2026-10-20T09:00:00.000Z",
    }),
    {
      type: "development",
      name: "Current terminal sets",
      description: "Complete folded description.",
      status: "in_progress",
      next_action: "phase-4",
      updated: "2026-10-20T10:00:00Z",
      path: "development/current-terminal-sets",
      dashboard: "development/current-terminal-sets/dashboard.html",
      state: "development/current-terminal-sets/orchestrator-state.yml",
      commit_status: "committed",
      commit_sha: "abc123",
      commit_message: "feat: preserve projection",
    },
  );
});

test("N02 normalizes numeric phase-aware values without rewriting unrelated strings", async () => {
  const { parseAndNormalizeState } = await loadSemantics();
  const model = parseAndNormalizeState(readCompatibilityFixture("compat-numeric-phase-map"), {
    sourcePath: "fixtures/compat-numeric-phase-map.yml",
    taskType: "development",
  });

  assert.equal(model.task.title, "Numeric phase map");
  assert.equal(model.task.updated, "2026-10-20T11:00:00Z");
  assert.equal(typeof model.task.updated, "string");
  assert.equal(model.activePhase, "phase-2");
  assert.deepEqual(
    model.phases.map(({ id, status }) => [id, status]),
    [
      ["phase-1", "completed"],
      ["phase-2", "in_progress"],
      ["phase-3", "pending"],
    ],
  );
  assert.ok(model.phases[0].provenance.some(({ path: sourcePath }) => sourcePath === "orchestrator.completed_phases[0]"));
});

test("N03 normalizes root phase maps and sequences with explicit dependencies", async () => {
  const { parseAndNormalizeState } = await loadSemantics();
  for (const fixtureId of ["compat-root-phase-map", "compat-root-phase-sequence"]) {
    const model = parseAndNormalizeState(readCompatibilityFixture(fixtureId), {
      sourcePath: `fixtures/${fixtureId}.yml`,
      taskType: "development",
    });
    assert.deepEqual(
      model.phases.map(({ id, status, dependencies }) => ({ id, status, dependencies })),
      [
        { id: "phase-1", status: "completed", dependencies: null },
        { id: "phase-2", status: "pending", dependencies: ["phase-1"] },
      ],
      fixtureId,
    );
    assert.equal(model.nextAction, "phase-2");
  }
});

test("N04 preserves named IDs and collapses equivalent handoff and commit facts with provenance", async () => {
  const { parseAndNormalizeState } = await loadSemantics();
  const named = parseAndNormalizeState(readCompatibilityFixture("compat-named-phases"), {
    sourcePath: "fixtures/compat-named-phases.yml",
    taskType: "development",
  });
  assert.deepEqual(named.phases.map(({ id }) => id), [
    "analysis",
    "finalization",
    "planning",
    "verification",
  ]);
  assert.equal(named.nextAction, "verification");

  const handoff = parseAndNormalizeState(readCompatibilityFixture("compat-handoff-locations"), {
    sourcePath: "fixtures/compat-handoff-locations.yml",
    taskType: "development",
  });
  assert.equal(handoff.nextAction, "Approve implementation?");
  assert.deepEqual(handoff.commit, {
    status: "committed",
    sha: "def456",
    message: "Equivalent commit",
  });
  assert.deepEqual(
    handoff.provenance.handoff.activePhase.map(({ path: sourcePath }) => sourcePath),
    ["orchestrator.session_handoff.active_phase", "session_handoff.active_phase"],
  );
});

test("N05 applies only frozen development conditions and keeps sparse completion unknown", async () => {
  const { parseAndNormalizeState } = await loadSemantics();
  const conditional = parseAndNormalizeState(
    readCompatibilityFixture("compat-conditional-development"),
    {
      sourcePath: "fixtures/compat-conditional-development.yml",
      taskType: "development",
    },
  );
  assert.deepEqual(
    conditional.phases.map(({ id, applicable }) => [id, applicable]),
    [
      ["phase-3", false],
      ["phase-4", false],
      ["phase-6", false],
      ["phase-9", false],
      ["phase-12", false],
      ["phase-13", false],
    ],
  );
  assert.equal(conditional.nextAction, "Kontynuować bieżącą fazę");

  const sparse = parseAndNormalizeState(readCompatibilityFixture("compat-completed-sparse"), {
    sourcePath: "fixtures/compat-completed-sparse.yml",
    taskType: "development",
  });
  assert.deepEqual(sparse.phases.map(({ id }) => id), ["phase-1", "phase-8"]);
  assert.equal(sparse.nextAction, "Brak — zakończone");

  assert.throws(
    () =>
      parseAndNormalizeState(
        `task: {title: Invalid option, description: Invalid option, status: pending}\n` +
          `orchestrator: {options: {e2e_enabled: yes}}\n`,
        { sourcePath: "fixtures/invalid-option.yml", taskType: "development" },
      ),
    /orchestrator\.options\.e2e_enabled must be a boolean/,
  );
});

test("N10 rejects malformed timestamps and preserves historical ISO date precision", async () => {
  const { isIsoDateOrTimestamp, parseAndNormalizeState } = await loadSemantics();
  assert.equal(isIsoDateOrTimestamp("2026-10-09"), true);
  assert.equal(isIsoDateOrTimestamp("2026-02-31"), false);
  for (const updated of ["October 20, 2026", "2026-02-31T10:00:00Z"]) {
    const source = `task: {title: Timestamp fixture, description: Test, status: pending, updated: "${updated}"}\n`;
    assert.throws(
      () => parseAndNormalizeState(source, { sourcePath: "fixtures/invalid-updated.yml" }),
      /task\.updated must be a valid ISO date or timestamp/,
      updated,
    );
  }
  const dateOnly = parseAndNormalizeState(readCompatibilityFixture("compat-date-only-updated"), {
    sourcePath: "fixtures/compat-date-only-updated.yml",
    taskType: "development",
  });
  assert.equal(dateOnly.task.updated, "2026-10-09");
});

test("N06 rejects provenance conflicts, completed-open contradictions, and multiple active tasks", async () => {
  const { parseAndNormalizeState, StateSemanticsError } = await loadSemantics();
  const cases = [
    [
      `task: {title: Conflict, description: Conflict, status: in_progress}\n` +
        `orchestrator:\n  completed_phases: [phase-2]\n  failed_phases: [phase-2]\n`,
      ["orchestrator.completed_phases[0]", "orchestrator.failed_phases[0]", "completed", "failed"],
    ],
    [
      `task: {title: Complete, description: Complete, status: completed}\n` +
        `orchestrator:\n  phases: {phase-4: pending}\n`,
      ["task.status", "orchestrator.phases.phase-4", "completed", "pending"],
    ],
    [
      `task: {title: Active, description: Active, status: in_progress}\n` +
        `orchestrator:\n  phase_tasks:\n    - {id: phase-1, status: in_progress}\n    - {id: phase-2, status: in_progress}\n`,
      ["orchestrator.phase_tasks[0]", "orchestrator.phase_tasks[1]", "in_progress"],
    ],
  ];

  for (const [source, fragments] of cases) {
    assert.throws(
      () => parseAndNormalizeState(source, { sourcePath: "fixtures/conflict.yml", taskType: "development" }),
      (error) => {
        assert.ok(error instanceof StateSemanticsError);
        for (const fragment of fragments) assert.ok(error.message.includes(fragment), fragment);
        return true;
      },
    );
  }
});

test("N07 evaluates all eight next-action tiers and rejects every same-tier ambiguity", async () => {
  const { parseAndNormalizeState, StateSemanticsError } = await loadSemantics();
  const precedence = parseAndNormalizeState(readCompatibilityFixture("action-tier-precedence"), {
    sourcePath: "fixtures/action-tier-precedence.yml",
    taskType: "development",
  });
  assert.equal(precedence.nextAction, "Decide now");
  const cases = [
    ["orchestrator:\n  pending_user_decision: Decide now\n", "Decide now"],
    [
      "orchestrator:\n  pause_requested: true\n  pause_reason: Awaiting review\n  resume_from: phase-2\n",
      "Wstrzymane — Awaiting review; wznowić od phase-2",
    ],
    [
      "orchestrator:\n  phases: {phase-3: in_progress}\n  session_handoff: {active_phase: phase-3, next_action: Continue handoff}\n",
      "Continue handoff",
    ],
    [
      "orchestrator:\n  phase_tasks:\n    - {id: phase-4, status: in_progress, active_form: Doing phase four}\n",
      "Doing phase four",
    ],
    ["orchestrator:\n  current_phase: phase-5\n  phases: {phase-5: in_progress}\n", "phase-5"],
    ["orchestrator:\n  started_phase: 6\n  phases: {phase-6: in_progress}\n", "phase-6"],
    ["orchestrator:\n  phases: {phase-10: pending, phase-2: pending}\n", "phase-2"],
    ["", "Brak — zakończone", "completed"],
  ];
  for (const [orchestrator, expected, status = "in_progress"] of cases) {
    const source = `task:\n  title: Action tier\n  description: Action tier\n  status: ${status}\n${orchestrator}`;
    const model = parseAndNormalizeState(source, {
      sourcePath: "fixtures/action-tier.yml",
      taskType: "development",
    });
    assert.equal(model.nextAction, expected);
  }

  const conflicts = [
    `task: {title: Action conflict, description: Action conflict, status: in_progress}\n` +
      "orchestrator:\n  pending_user_decision: First\n  pending_decision: Second\n",
    `task:\n  title: Action conflict\n  description: Action conflict\n  status: in_progress\n  pause_requested: true\n  pause_reason: Second\n` +
      "orchestrator:\n  pause_requested: true\n  pause_reason: First\n",
    `task: {title: Action conflict, description: Action conflict, status: in_progress}\n` +
      "orchestrator:\n  session_handoff: {next_action: First}\nsession_handoff: {next_action: Second}\n",
    `task: {title: Action conflict, description: Action conflict, status: in_progress}\n` +
      "orchestrator:\n  current_phase: phase-1\n  session_handoff: {active_phase: phase-2}\n",
    `task: {title: Action conflict, description: Action conflict, status: in_progress}\n` +
      "orchestrator:\n  phase_tasks:\n    - {id: phase-1, status: in_progress}\n    - {id: phase-2, status: in_progress}\n",
  ];
  for (const source of conflicts) {
    assert.throws(
      () => parseAndNormalizeState(source, { sourcePath: "fixtures/action-conflict.yml", taskType: "development" }),
      StateSemanticsError,
    );
  }

  const terminalExclusion = parseAndNormalizeState(
    `task: {title: Exclusion, description: Exclusion, status: in_progress}\n` +
      `orchestrator:\n` +
      `  current_phase: phase-7\n` +
      `  phases: {phase-2: pending, phase-7: completed, phase-8: blocked, phase-9: failed}\n` +
      `  session_handoff: {active_phase: phase-7, next_action: Ignore terminal handoff}\n`,
    { sourcePath: "fixtures/terminal-exclusion.yml", taskType: "development" },
  );
  assert.equal(terminalExclusion.nextAction, "phase-2");
});

test("N08 exposes summaries, ID namespaces, and deterministic aliased projections", async () => {
  const { normalizeTaskType, parseAndNormalizeState, projectTaskRecord } = await loadSemantics();
  const model = parseAndNormalizeState(readCompatibilityFixture("registry-mixed-task-ids"), {
    sourcePath: "fixtures/registry-mixed-task-ids.yml",
    taskType: "migration",
  });

  assert.deepEqual(model.phaseSummaries.planning, {
    decisions: [
      { decision: "Keep canonical state", rationale: "One source" },
      { decision: "Validate derived views", rationale: null },
    ],
    risks: ["Registry drift"],
  });
  assert.equal(
    model.task.description,
    "Mixed phase and group task identifiers.\nDescription text stays complete.\n",
  );
  assert.deepEqual(model.taskIdMaps.task_ids, {
    "phase-1": "1",
    "phase-2": "2",
    "phase-analysis": "6",
    "group-1": "3",
  });
  assert.deepEqual(
    model.registryExpectations.map(({ namespace, key, registryId, phaseStatus, dependencies }) => ({
      namespace,
      key,
      registryId,
      phaseStatus,
      dependencies,
    })),
    [
      { namespace: "task_ids", key: "group-1", registryId: "3", phaseStatus: null, dependencies: null },
      { namespace: "task_ids", key: "phase-1", registryId: "1", phaseStatus: "completed", dependencies: null },
      { namespace: "task_ids", key: "phase-2", registryId: "2", phaseStatus: "pending", dependencies: ["phase-1"] },
      { namespace: "task_ids", key: "phase-analysis", registryId: "6", phaseStatus: "pending", dependencies: null },
      { namespace: "group_task_ids", key: "implementation", registryId: "4", phaseStatus: null, dependencies: null },
    ],
  );
  const separated = parseAndNormalizeState(
    readCompatibilityFixture("registry-separated-namespaces"),
    { sourcePath: "fixtures/registry-separated-namespaces.yml", taskType: "development" },
  );
  assert.deepEqual(
    separated.registryExpectations.map(({ namespace, registryId, phaseStatus }) => ({
      namespace,
      registryId,
      phaseStatus,
    })),
    [
      { namespace: "group_task_ids", registryId: "10", phaseStatus: null },
      { namespace: "verification_task_ids", registryId: "11", phaseStatus: null },
      { namespace: "fix_task_ids", registryId: "13", phaseStatus: null },
      { namespace: "operational_task_ids", registryId: "14", phaseStatus: null },
      { namespace: "verification_cycle_1_task_ids", registryId: "12", phaseStatus: null },
    ],
  );
  assert.equal(normalizeTaskType("migrations"), "migration");
  const options = {
    type: "migrations",
    relativeDirectory: "migrations/registry-task",
    stateFileMtime: "2026-10-20T12:00:00.000Z",
  };
  assert.deepEqual(projectTaskRecord(model, options), projectTaskRecord(model, options));
  assert.equal(projectTaskRecord(model, options).type, "migration");
  assert.equal(projectTaskRecord(model, options).updated, "2026-10-20T12:00:00.000Z");
  assert.equal(projectTaskRecord(model, options).next_action, "phase-2");
});
