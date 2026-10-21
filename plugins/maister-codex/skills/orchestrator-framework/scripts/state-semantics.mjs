import YAML from "../vendor/yaml-2.9.1/dist/index.js";

export const YAML_VENDOR = Object.freeze({
  package: "yaml",
  version: "2.9.1",
});

const YAML_OPTIONS = Object.freeze({
  keepSourceTokens: true,
  merge: false,
  prettyErrors: false,
  schema: "core",
  strict: true,
  stringKeys: true,
  uniqueKeys: true,
});

const CONSUMED_STRING_PATHS = Object.freeze([
  ["task", "title"],
  ["task", "name"],
  ["task", "description"],
  ["task", "status"],
  ["task", "updated"],
  ["orchestrator", "updated"],
]);

const TASK_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "failed",
  "superseded",
  "cancelled",
]);

const PHASE_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "skipped",
  "blocked",
  "failed",
  "cancelled",
]);

const TASK_TYPE_ALIASES = new Map([
  ["development", "development"],
  ["performance", "performance"],
  ["migration", "migration"],
  ["migrations", "migration"],
  ["research", "research"],
  ["product-design", "product-design"],
]);

export class StateSemanticsError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map(formatDiagnostic).join("\n"));
    this.name = "StateSemanticsError";
    this.diagnostics = diagnostics;
  }
}

export function formatDiagnostic(diagnostic) {
  const location =
    diagnostic.line && diagnostic.column
      ? `:${diagnostic.line}:${diagnostic.column}`
      : "";
  return `${diagnostic.sourcePath}${location}: ${diagnostic.message}`;
}

export function formatDiagnostics(diagnostics) {
  return diagnostics.map(formatDiagnostic).join("\n");
}

export function createStateDiagnostic({
  sourcePath,
  source,
  offset = 0,
  kind,
  code,
  message,
  fieldPath,
}) {
  const { line, column } = lineAndColumn(source, offset);
  return {
    kind,
    code,
    sourcePath,
    line,
    column,
    ...(fieldPath ? { fieldPath } : {}),
    message,
  };
}

export function parseStateDocument(source, { sourcePath = "<state>" } = {}) {
  if (typeof source !== "string") {
    throw new TypeError("State document source must be a string");
  }

  const documents = YAML.parseAllDocuments(source, YAML_OPTIONS);
  const diagnostics = collectSyntaxDiagnostics(documents, source, sourcePath);

  if (documents.length !== 1) {
    const offset = documents[1]?.range?.[0] ?? documents[0]?.range?.[0] ?? 0;
    diagnostics.push(
      createStateDiagnostic({
        sourcePath,
        source,
        offset,
        kind: "schema",
        code: "multiple-documents",
        message: `Expected exactly one YAML document, received ${documents.length}`,
      }),
    );
  }

  for (const document of documents) {
    if (!YAML.isMap(document.contents)) {
      diagnostics.push(
        createStateDiagnostic({
          sourcePath,
          source,
          offset: document.contents?.range?.[0] ?? document.range?.[0] ?? 0,
          kind: "schema",
          code: "mapping-root-required",
          message: "YAML document root must be a mapping",
        }),
      );
    }

    if (document.contents) {
      collectPolicyDiagnostics(document.contents, [], diagnostics, source, sourcePath);
    }

    if (YAML.isMap(document.contents)) {
      collectConsumedTypeDiagnostics(document, diagnostics, source, sourcePath);
    }
  }

  if (diagnostics.length > 0) {
    diagnostics.sort(compareDiagnostics);
    throw new StateSemanticsError(diagnostics);
  }

  const document = documents[0];
  const value = document.toJS({ mapAsMap: false, maxAliasCount: 0 });
  return Object.freeze({
    sourcePath,
    source,
    document,
    value,
    nodeFor(fieldPath) {
      return document.getIn(normalizeFieldPath(fieldPath), true) ?? null;
    },
    locationFor(fieldPath) {
      const node = document.getIn(normalizeFieldPath(fieldPath), true);
      return node?.range ? lineAndColumn(source, node.range[0]) : null;
    },
  });
}

export function parseAndNormalizeState(
  source,
  { sourcePath = "<state>", taskType = null } = {},
) {
  return normalizeStateDocument(parseStateDocument(source, { sourcePath }), { taskType });
}

export function normalizeStateDocument(parsed, { taskType = null } = {}) {
  if (!parsed || !isRecord(parsed.value)) {
    throw new TypeError("Parsed state document is required");
  }

  const diagnostics = [];
  const root = parsed.value;
  const task = readRequiredMapping(parsed, root, ["task"], diagnostics);
  const orchestrator = hasOwn(root, "orchestrator")
    ? readOptionalMapping(parsed, root, ["orchestrator"], diagnostics) ?? {}
    : {};
  const workflowType = taskType === null ? null : normalizeTaskType(taskType);

  const title = readTaskTitle(parsed, task, diagnostics);
  const description = readRequiredDescription(parsed, task, diagnostics);
  const status = readEnum(
    parsed,
    task,
    "status",
    ["task", "status"],
    TASK_STATUSES,
    diagnostics,
  );
  const updated = readUpdatedTimestamp(parsed, task, orchestrator, diagnostics);
  const commitState = normalizeCommit(parsed, root, orchestrator, diagnostics);
  const applicabilityControls = normalizeApplicabilityControls(
    parsed,
    root,
    orchestrator,
    diagnostics,
  );
  const phaseState = normalizePhases(
    parsed,
    root,
    orchestrator,
    workflowType,
    applicabilityControls,
    diagnostics,
  );
  const handoff = normalizeHandoff(parsed, root, orchestrator, diagnostics);
  const activeReferences = normalizeActiveReferences(parsed, orchestrator, handoff, diagnostics);
  const phaseSummaries = normalizePhaseSummaries(parsed, root, diagnostics);
  const taskIdState = normalizeTaskIdMaps(
    parsed,
    orchestrator,
    phaseState.phaseById,
    diagnostics,
  );
  const verificationStatus = normalizeVerificationStatus(parsed, root, diagnostics);

  validateCompletedTask(parsed, status, phaseState.phases, diagnostics);
  validateActivePhaseTasks(
    parsed,
    phaseState.phaseTaskEntries,
    phaseState.phaseById,
    diagnostics,
  );

  const actionState = normalizeActionSources(
    parsed,
    task,
    orchestrator,
    handoff,
    activeReferences,
    diagnostics,
  );

  if (diagnostics.length > 0) {
    diagnostics.sort(compareDiagnostics);
    throw new StateSemanticsError(diagnostics);
  }

  const normalizedTask = {
    title,
    description,
    status,
    updated,
  };
  const model = {
    sourcePath: parsed.sourcePath,
    taskType: workflowType,
    task: normalizedTask,
    commit: {
      status: commitState.status,
      sha: commitState.sha,
      message: commitState.message,
    },
    phases: phaseState.phases,
    phaseSummaries,
    taskIdMaps: taskIdState.taskIdMaps,
    registryExpectations: taskIdState.registryExpectations,
    activePhase: activeReferences.primaryValue,
    startedPhase: activeReferences.startedValue,
    handoff: {
      activePhase: handoff.activePhase.value,
      nextAction: handoff.nextAction.value,
      pendingUserDecision: handoff.pendingUserDecision.value,
    },
    verificationStatus,
    provenance: {
      handoff: {
        activePhase: handoff.activePhase.provenance,
        nextAction: handoff.nextAction.provenance,
        pendingUserDecision: handoff.pendingUserDecision.provenance,
      },
      activePhase: activeReferences.primaryProvenance,
      startedPhase: activeReferences.startedProvenance,
      commit: commitState.provenance,
    },
  };
  model.nextAction = deriveNextAction(model, {
    actionState,
    phaseTaskEntries: phaseState.phaseTaskEntries,
    phaseById: phaseState.phaseById,
    primaryWasPresent: activeReferences.primaryWasPresent,
  });
  return model;
}

export function normalizeTaskType(type) {
  if (typeof type !== "string" || !TASK_TYPE_ALIASES.has(type)) {
    throw new TypeError(`Unsupported task type: ${String(type)}`);
  }
  return TASK_TYPE_ALIASES.get(type);
}

export function projectTaskRecord(
  model,
  { type, relativeDirectory, stateFileMtime } = {},
) {
  if (!model?.task || typeof relativeDirectory !== "string" || !relativeDirectory.trim()) {
    throw new TypeError("Canonical model and relativeDirectory are required");
  }
  const normalizedType = normalizeTaskType(type);
  const updated = model.task.updated ?? normalizeProjectionTimestamp(stateFileMtime);
  const directory = relativeDirectory.split("\\").join("/").replace(/\/$/, "");
  return {
    type: normalizedType,
    name: model.task.title,
    description: model.task.description,
    status: model.task.status,
    next_action: model.nextAction,
    updated,
    path: directory,
    dashboard: `${directory}/dashboard.html`,
    state: `${directory}/orchestrator-state.yml`,
    commit_status: model.commit.status,
    commit_sha: model.commit.sha,
    commit_message: model.commit.message,
  };
}

export function sortTaskRecords(records) {
  if (!Array.isArray(records)) throw new TypeError("Task records must be an array");
  return [...records].sort(
    (left, right) =>
      right.updated.localeCompare(left.updated) || left.name.localeCompare(right.name),
  );
}

function readTaskTitle(parsed, task, diagnostics) {
  if (!task) return null;
  if (hasOwn(task, "title")) {
    return readRequiredText(parsed, task, "title", ["task", "title"], diagnostics);
  }
  return readRequiredText(parsed, task, "name", ["task", "name"], diagnostics);
}

function readRequiredDescription(parsed, task, diagnostics) {
  const fieldParts = ["task", "description"];
  if (!task || !hasOwn(task, "description")) {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "missing-field", "task.description is required"));
    return null;
  }
  const value = task.description;
  if (typeof value !== "string" || !value.trim()) {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-value", "task.description must be a non-empty string"));
    return null;
  }
  return value;
}

function readRequiredText(parsed, owner, key, fieldParts, diagnostics) {
  if (!owner || !hasOwn(owner, key)) {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "missing-field", `${displayFieldPath(fieldParts)} is required`));
    return null;
  }
  const value = owner[key];
  if (typeof value !== "string" || !value.trim()) {
    diagnostics.push(
      fieldDiagnostic(
        parsed,
        fieldParts,
        "invalid-field-value",
        `${displayFieldPath(fieldParts)} must be a non-empty string`,
      ),
    );
    return null;
  }
  return value.trim();
}

function readEnum(parsed, owner, key, fieldParts, allowed, diagnostics) {
  const value = readRequiredText(parsed, owner, key, fieldParts, diagnostics);
  if (value !== null && !allowed.has(value)) {
    diagnostics.push(
      fieldDiagnostic(
        parsed,
        fieldParts,
        "unsupported-value",
        `${displayFieldPath(fieldParts)} has unsupported value ${JSON.stringify(value)}`,
      ),
    );
    return null;
  }
  return value;
}

function readUpdatedTimestamp(parsed, task, orchestrator, diagnostics) {
  for (const [owner, fieldParts] of [
    [task, ["task", "updated"]],
    [orchestrator, ["orchestrator", "updated"]],
  ]) {
    const key = fieldParts.at(-1);
    if (!hasOwn(owner, key) || owner[key] === null) continue;
    const value = owner[key];
    if (typeof value !== "string" || !isTimestamp(value)) {
      diagnostics.push(
        fieldDiagnostic(
          parsed,
          fieldParts,
          "invalid-timestamp",
          `${displayFieldPath(fieldParts)} must be a valid ISO date or timestamp`,
        ),
      );
      return null;
    }
    return value;
  }
  return null;
}

function normalizeProjectionTimestamp(value) {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (typeof normalized !== "string" || !isTimestamp(normalized)) {
    throw new TypeError("stateFileMtime must be an ISO timestamp string or Date");
  }
  return normalized;
}

function normalizeCommit(parsed, root, orchestrator, diagnostics) {
  const locations = [
    [root, "commit", ["commit"]],
    [orchestrator, "commit", ["orchestrator", "commit"]],
  ];
  const facts = { status: [], sha: [], message: [] };
  for (const [owner, key, fieldParts] of locations) {
    if (!hasOwn(owner, key) || owner[key] === null) continue;
    const mapping = readOptionalMapping(parsed, owner, fieldParts, diagnostics);
    if (!mapping) continue;
    for (const field of Object.keys(facts)) {
      if (!hasOwn(mapping, field)) continue;
      const value = mapping[field];
      const valuePath = [...fieldParts, field];
      if (value !== null && typeof value !== "string") {
        diagnostics.push(
          fieldDiagnostic(
            parsed,
            valuePath,
            "invalid-field-type",
            `${displayFieldPath(valuePath)} must be a string or null`,
          ),
        );
        continue;
      }
      facts[field].push({
        value: typeof value === "string" ? value.trim() : null,
        path: displayFieldPath(valuePath),
        fieldParts: valuePath,
      });
    }
  }
  const normalized = {};
  const provenance = {};
  for (const field of Object.keys(facts)) {
    const result = collapseEquivalentFacts(parsed, facts[field], `commit.${field}`, diagnostics);
    normalized[field] = result.value;
    provenance[field] = result.provenance;
  }
  return {
    status: normalized.status || "not_recorded",
    sha: normalized.sha || null,
    message: normalized.message || null,
    provenance,
  };
}

function normalizePhases(
  parsed,
  root,
  orchestrator,
  taskType,
  applicabilityControls,
  diagnostics,
) {
  const phaseFacts = new Map();
  const phaseTaskEntries = [];

  const addFact = ({ idValue, statusValue, fieldParts, dependenciesValue, metadata = null }) => {
    const id = normalizePhaseIdValue(parsed, idValue, [...fieldParts, "id"], diagnostics);
    const status = normalizePhaseStatus(parsed, statusValue, [...fieldParts, "status"], diagnostics);
    const dependencies = normalizeDependencies(
      parsed,
      dependenciesValue,
      [...fieldParts, metadata?.dependencyField ?? "dependencies"],
      diagnostics,
    );
    if (id === null || status === null) return;
    const fact = {
      id,
      status,
      dependencies,
      path: displayFieldPath(fieldParts),
      fieldParts,
      content: metadata?.content ?? null,
      activeForm: metadata?.activeForm ?? null,
      fromPhaseTask: metadata !== null,
    };
    if (!phaseFacts.has(id)) phaseFacts.set(id, []);
    phaseFacts.get(id).push(fact);
    if (metadata !== null) phaseTaskEntries.push(fact);
  };

  for (const [owner, baseParts] of [
    [orchestrator, ["orchestrator"]],
    [root, []],
  ]) {
    for (const [key, status] of [
      ["completed_phases", "completed"],
      ["failed_phases", "failed"],
      ["skipped_phases", "skipped"],
    ]) {
      if (!hasOwn(owner, key)) continue;
      const fieldParts = [...baseParts, key];
      const values = readSequence(parsed, owner[key], fieldParts, diagnostics);
      if (!values) continue;
      values.forEach((idValue, index) =>
        addFact({
          idValue,
          statusValue: status,
          fieldParts: [...fieldParts, index],
          dependenciesValue: undefined,
        }),
      );
    }
  }

  if (hasOwn(orchestrator, "phases")) {
    collectPhaseMap(
      parsed,
      orchestrator.phases,
      ["orchestrator", "phases"],
      addFact,
      diagnostics,
      false,
    );
  }
  if (hasOwn(root, "phases")) {
    collectPhaseMap(parsed, root.phases, ["phases"], addFact, diagnostics, true);
  }
  for (const [owner, fieldParts] of [
    [orchestrator, ["orchestrator", "phase_tasks"]],
    [root, ["phase_tasks"]],
  ]) {
    const key = fieldParts.at(-1);
    if (!hasOwn(owner, key)) continue;
    collectPhaseTasks(parsed, owner[key], fieldParts, addFact, diagnostics);
  }

  const phases = [];
  for (const [id, facts] of phaseFacts) {
    const statuses = facts.map((fact) => ({
      value: fact.status,
      path: fact.path,
      fieldParts: fact.fieldParts,
    }));
    const status = collapseEquivalentFacts(parsed, statuses, `phase ${id} status`, diagnostics).value;
    const dependencyFacts = facts
      .filter((fact) => fact.dependencies !== null)
      .map((fact) => ({
        value: fact.dependencies,
        path: `${fact.path}.${fact.fromPhaseTask ? "blocked_by" : "dependencies"}`,
        fieldParts: fact.fieldParts,
      }));
    const dependencies = collapseEquivalentFacts(
      parsed,
      dependencyFacts,
      `phase ${id} dependencies`,
      diagnostics,
      arraysEqual,
    ).value;
    phases.push({
      id,
      status,
      dependencies: dependencies ?? null,
      applicable: phaseIsApplicable(
        id,
        status,
        taskType,
        applicabilityControls,
        phaseFacts,
      ),
      provenance: facts.map((fact) => ({ path: fact.path, value: fact.status })),
    });
  }
  phases.sort(comparePhases);
  return {
    phases,
    phaseById: new Map(phases.map((phase) => [phase.id, phase])),
    phaseTaskEntries,
  };
}

function collectPhaseMap(parsed, value, fieldParts, addFact, diagnostics, allowSequence) {
  if (Array.isArray(value)) {
    if (!allowSequence) {
      diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a mapping`));
      return;
    }
    value.forEach((entry, index) => {
      const entryParts = [...fieldParts, index];
      if (!isRecord(entry)) {
        diagnostics.push(fieldDiagnostic(parsed, entryParts, "invalid-field-type", `${displayFieldPath(entryParts)} must be a mapping`));
        return;
      }
      addFact({
        idValue: entry.id,
        statusValue: entry.status,
        fieldParts: entryParts,
        dependenciesValue: entry.dependencies,
      });
    });
    return;
  }
  if (!isRecord(value)) {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a mapping${allowSequence ? " or sequence" : ""}`));
    return;
  }
  for (const [rawId, rawEntry] of Object.entries(value)) {
    const entryParts = [...fieldParts, rawId];
    if (typeof rawEntry === "string") {
      addFact({
        idValue: rawId,
        statusValue: rawEntry,
        fieldParts: entryParts,
        dependenciesValue: undefined,
      });
    } else if (isRecord(rawEntry)) {
      addFact({
        idValue: rawId,
        statusValue: rawEntry.status,
        fieldParts: entryParts,
        dependenciesValue: rawEntry.dependencies,
      });
    } else {
      diagnostics.push(fieldDiagnostic(parsed, entryParts, "invalid-field-type", `${displayFieldPath(entryParts)} must be a phase status or mapping`));
    }
  }
}

function collectPhaseTasks(parsed, value, fieldParts, addFact, diagnostics) {
  const entries = readSequence(parsed, value, fieldParts, diagnostics);
  if (!entries) return;
  entries.forEach((entry, index) => {
    const entryParts = [...fieldParts, index];
    if (!isRecord(entry)) {
      diagnostics.push(fieldDiagnostic(parsed, entryParts, "invalid-field-type", `${displayFieldPath(entryParts)} must be a mapping`));
      return;
    }
    const content = readOptionalText(parsed, entry, "content", [...entryParts, "content"], diagnostics);
    const activeForm = readOptionalText(parsed, entry, "active_form", [...entryParts, "active_form"], diagnostics);
    addFact({
      idValue: entry.id,
      statusValue: entry.status,
      fieldParts: entryParts,
      dependenciesValue: entry.blocked_by,
      metadata: { content, activeForm, dependencyField: "blocked_by" },
    });
  });
}

function normalizePhaseIdValue(parsed, value, fieldParts, diagnostics) {
  if (Number.isInteger(value) && value > 0) return `phase-${value}`;
  if (typeof value !== "string") {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-phase-id", `${displayFieldPath(fieldParts)} must be a phase identifier`));
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const number = Number(trimmed);
    if (number > 0) return `phase-${number}`;
  }
  const numericPhase = trimmed.match(/^phase-(-?\d+)$/);
  if (numericPhase) {
    const number = Number(numericPhase[1]);
    if (number > 0) return `phase-${number}`;
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-phase-id", `${displayFieldPath(fieldParts)} must contain a positive phase number`));
    return null;
  }
  if (trimmed) return trimmed;
  diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-phase-id", `${displayFieldPath(fieldParts)} must be a non-empty phase identifier`));
  return null;
}

function normalizePhaseStatus(parsed, value, fieldParts, diagnostics) {
  if (typeof value !== "string" || !PHASE_STATUSES.has(value.trim())) {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "unsupported-phase-status", `${displayFieldPath(fieldParts)} has unsupported phase status ${JSON.stringify(value)}`));
    return null;
  }
  return value.trim();
}

function normalizeDependencies(parsed, value, fieldParts, diagnostics) {
  if (value === undefined || value === null) return null;
  const items = readSequence(parsed, value, fieldParts, diagnostics);
  if (!items) return null;
  const dependencies = [];
  items.forEach((item, index) => {
    const dependency = normalizePhaseIdValue(parsed, item, [...fieldParts, index], diagnostics);
    if (dependency !== null && !dependencies.includes(dependency)) dependencies.push(dependency);
  });
  return dependencies.sort(comparePhaseIds);
}

function normalizeApplicabilityControls(parsed, root, orchestrator, diagnostics) {
  const characteristics = {};
  if (isRecord(root.task_context) && hasOwn(root.task_context, "task_characteristics")) {
    const source = root.task_context.task_characteristics;
    const fieldParts = ["task_context", "task_characteristics"];
    if (!isRecord(source)) {
      diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a mapping`));
    } else {
      for (const field of ["has_reproducible_defect", "ui_heavy"]) {
        characteristics[field] = readOptionalBoolean(
          parsed,
          source,
          field,
          [...fieldParts, field],
          diagnostics,
        );
      }
    }
  }

  const options = {};
  if (hasOwn(orchestrator, "options")) {
    const source = orchestrator.options;
    const fieldParts = ["orchestrator", "options"];
    if (!isRecord(source)) {
      diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a mapping`));
    } else {
      for (const field of ["spec_audit_enabled", "e2e_enabled", "user_docs_enabled"]) {
        options[field] = readOptionalBoolean(
          parsed,
          source,
          field,
          [...fieldParts, field],
          diagnostics,
        );
      }
    }
  }
  return { characteristics, options };
}

function phaseIsApplicable(id, status, taskType, controls, phaseFacts) {
  if (status === "skipped") return false;
  if (taskType !== "development") return true;
  const { characteristics, options } = controls;
  if (id === "phase-3" && characteristics.has_reproducible_defect === false) return false;
  if (id === "phase-4" && characteristics.ui_heavy === false) return false;
  if (id === "phase-6" && options.spec_audit_enabled === false) return false;
  if (id === "phase-12" && options.e2e_enabled === false) return false;
  if (id === "phase-13" && options.user_docs_enabled === false) return false;
  if (id === "phase-9") {
    const phaseThreeFacts = phaseFacts.get("phase-3") ?? [];
    if (
      characteristics.has_reproducible_defect === false ||
      phaseThreeFacts.some((fact) => fact.status === "skipped")
    ) {
      return false;
    }
  }
  return true;
}

function normalizeHandoff(parsed, root, orchestrator, diagnostics) {
  const locations = [
    [orchestrator, "session_handoff", ["orchestrator", "session_handoff"]],
    [root, "session_handoff", ["session_handoff"]],
  ];
  const facts = { activePhase: [], nextAction: [], pendingUserDecision: [] };
  for (const [owner, key, fieldParts] of locations) {
    if (!hasOwn(owner, key) || owner[key] === null) continue;
    const handoff = readOptionalMapping(parsed, owner, fieldParts, diagnostics);
    if (!handoff) continue;
    for (const [field, outputKey] of [
      ["active_phase", "activePhase"],
      ["next_action", "nextAction"],
      ["pending_user_decision", "pendingUserDecision"],
    ]) {
      if (!hasOwn(handoff, field) || handoff[field] === null || handoff[field] === "") continue;
      const valuePath = [...fieldParts, field];
      let value;
      if (field === "active_phase") {
        value = normalizePhaseIdValue(parsed, handoff[field], valuePath, diagnostics);
      } else {
        value = readOptionalText(parsed, handoff, field, valuePath, diagnostics);
      }
      if (value !== null) {
        facts[outputKey].push({ value, path: displayFieldPath(valuePath), fieldParts: valuePath });
      }
    }
  }
  return {
    activePhase: collapseEquivalentFacts(parsed, facts.activePhase, "handoff active phase", diagnostics),
    nextAction: collapseEquivalentFacts(parsed, facts.nextAction, "handoff next action", diagnostics),
    pendingUserDecision: collapseEquivalentFacts(parsed, facts.pendingUserDecision, "handoff pending decision", diagnostics),
  };
}

function normalizeActiveReferences(parsed, orchestrator, handoff, diagnostics) {
  const primaryFacts = [];
  if (hasOwn(orchestrator, "current_phase") && orchestrator.current_phase !== null) {
    const fieldParts = ["orchestrator", "current_phase"];
    const value = normalizePhaseIdValue(parsed, orchestrator.current_phase, fieldParts, diagnostics);
    if (value !== null) primaryFacts.push({ value, path: displayFieldPath(fieldParts), fieldParts });
  }
  primaryFacts.push(...handoff.activePhase.provenance);
  const primary = collapseEquivalentFacts(parsed, primaryFacts, "primary active phase", diagnostics);

  const startedFacts = [];
  if (hasOwn(orchestrator, "started_phase") && orchestrator.started_phase !== null) {
    const fieldParts = ["orchestrator", "started_phase"];
    const value = normalizePhaseIdValue(parsed, orchestrator.started_phase, fieldParts, diagnostics);
    if (value !== null) startedFacts.push({ value, path: displayFieldPath(fieldParts), fieldParts });
  }
  const started = collapseEquivalentFacts(parsed, startedFacts, "started phase", diagnostics);
  return {
    primaryValue: primary.value,
    primaryProvenance: primary.provenance,
    primaryWasPresent: primaryFacts.length > 0,
    startedValue: started.value,
    startedProvenance: started.provenance,
  };
}

function normalizePhaseSummaries(parsed, root, diagnostics) {
  if (!hasOwn(root, "task_context")) return {};
  const taskContext = readOptionalMapping(parsed, root, ["task_context"], diagnostics);
  if (!taskContext || !hasOwn(taskContext, "phase_summaries")) return {};
  const summaries = readOptionalMapping(
    parsed,
    taskContext,
    ["task_context", "phase_summaries"],
    diagnostics,
  );
  if (!summaries) return {};
  const result = {};
  for (const [key, value] of Object.entries(summaries)) {
    const baseParts = ["task_context", "phase_summaries", key];
    if (!isRecord(value)) {
      diagnostics.push(fieldDiagnostic(parsed, baseParts, "invalid-field-type", `${displayFieldPath(baseParts)} must be a mapping`));
      continue;
    }
    const decisions = [];
    if (hasOwn(value, "decisions")) {
      const entries = readSequence(parsed, value.decisions, [...baseParts, "decisions"], diagnostics);
      entries?.forEach((entry, index) => {
        const entryParts = [...baseParts, "decisions", index];
        if (typeof entry === "string" && entry.trim()) {
          decisions.push({ decision: entry.trim(), rationale: null });
        } else if (isRecord(entry)) {
          const decision = readRequiredText(parsed, entry, "decision", [...entryParts, "decision"], diagnostics);
          const rationale = readOptionalText(parsed, entry, "rationale", [...entryParts, "rationale"], diagnostics);
          if (decision !== null) decisions.push({ decision, rationale });
        } else {
          diagnostics.push(fieldDiagnostic(parsed, entryParts, "invalid-field-type", `${displayFieldPath(entryParts)} must be a string or decision mapping`));
        }
      });
    }
    const risks = [];
    if (hasOwn(value, "risks")) {
      const entries = readSequence(parsed, value.risks, [...baseParts, "risks"], diagnostics);
      entries?.forEach((entry, index) => {
        const entryParts = [...baseParts, "risks", index];
        if (typeof entry !== "string") {
          diagnostics.push(fieldDiagnostic(parsed, entryParts, "invalid-field-type", `${displayFieldPath(entryParts)} must be a string`));
        } else {
          risks.push(entry.trim());
        }
      });
    }
    result[key] = { decisions, risks };
  }
  return result;
}

function normalizeTaskIdMaps(parsed, orchestrator, phaseById, diagnostics) {
  const namespaceNames = [];
  for (const name of [
    "task_ids",
    "group_task_ids",
    "verification_task_ids",
    "fix_task_ids",
    "operational_task_ids",
  ]) {
    if (hasOwn(orchestrator, name)) namespaceNames.push(name);
  }
  for (const name of Object.keys(orchestrator).sort()) {
    if (/^verification_cycle_.+_task_ids$/.test(name) && !namespaceNames.includes(name)) {
      namespaceNames.push(name);
    }
  }

  const taskIdMaps = {};
  const registryExpectations = [];
  const usedRegistryIds = new Map();
  for (const namespace of namespaceNames) {
    const mapping = readOptionalMapping(parsed, orchestrator, ["orchestrator", namespace], diagnostics);
    if (!mapping) continue;
    taskIdMaps[namespace] = {};
    for (const key of Object.keys(mapping).sort()) {
      const value = mapping[key];
      const fieldParts = ["orchestrator", namespace, key];
      if (value !== null && typeof value !== "string") {
        diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-registry-id", `${displayFieldPath(fieldParts)} must be a string or null`));
        continue;
      }
      taskIdMaps[namespace][key] = value;
      if (value === null) continue;
      const previous = usedRegistryIds.get(value);
      if (previous) {
        diagnostics.push(conflictDiagnostic(parsed, previous, displayFieldPath(fieldParts), value, value, `registry ID ${JSON.stringify(value)}`));
      } else {
        usedRegistryIds.set(value, displayFieldPath(fieldParts));
      }
      const phaseKey = namespace === "task_ids" && key.startsWith("phase-")
        ? normalizePhaseIdValue(parsed, key, fieldParts, diagnostics)
        : null;
      const phase = phaseKey ? phaseById.get(phaseKey) : null;
      registryExpectations.push({
        namespace,
        key,
        registryId: value,
        phaseId: phaseKey,
        phaseStatus: phase?.status ?? null,
        dependencies: phase?.dependencies ?? null,
      });
    }
  }
  return { taskIdMaps, registryExpectations };
}

function normalizeVerificationStatus(parsed, root, diagnostics) {
  if (!hasOwn(root, "verification_context")) return null;
  const context = readOptionalMapping(parsed, root, ["verification_context"], diagnostics);
  if (!context) return null;
  for (const field of ["last_status", "status"]) {
    if (!hasOwn(context, field) || context[field] === null) continue;
    return readOptionalText(parsed, context, field, ["verification_context", field], diagnostics);
  }
  return null;
}

function validateCompletedTask(parsed, taskStatus, phases, diagnostics) {
  if (taskStatus !== "completed") return;
  for (const phase of phases) {
    if (phase.applicable && ["pending", "in_progress", "blocked"].includes(phase.status)) {
      const phaseFact = phase.provenance[0];
      diagnostics.push(
        conflictDiagnostic(
          parsed,
          "task.status",
          phaseFact.path,
          "completed",
          phase.status,
          `completed task has open applicable ${phase.id}`,
        ),
      );
    }
  }
}

function validateActivePhaseTasks(parsed, entries, phaseById, diagnostics) {
  const active = entries.filter(
    (entry) => entry.status === "in_progress" && phaseById.get(entry.id)?.applicable,
  );
  if (active.length < 2) return;
  for (let index = 1; index < active.length; index += 1) {
    diagnostics.push(
      conflictDiagnostic(
        parsed,
        active[0].path,
        active[index].path,
        active[0].status,
        active[index].status,
        "multiple active phase_tasks entries",
      ),
    );
  }
}

function normalizeActionSources(parsed, task, orchestrator, handoff, activeReferences, diagnostics) {
  const decisions = [];
  for (const [owner, field, fieldParts] of [
    [orchestrator, "pending_user_decision", ["orchestrator", "pending_user_decision"]],
    [orchestrator, "pending_decision", ["orchestrator", "pending_decision"]],
  ]) {
    const value = readOptionalText(parsed, owner, field, fieldParts, diagnostics);
    if (value !== null) decisions.push({ value, path: displayFieldPath(fieldParts), fieldParts });
  }
  decisions.push(...handoff.pendingUserDecision.provenance);
  const decision = collapseEquivalentFacts(parsed, decisions, "pending decision", diagnostics);

  const pauseFacts = [];
  const pauseReasons = [];
  const pauseResumePoints = [];
  for (const [owner, baseParts] of [
    [orchestrator, ["orchestrator"]],
    [task, ["task"]],
  ]) {
    for (const [field, target, isBoolean] of [
      ["pause_requested", pauseFacts, true],
      ["pause_reason", pauseReasons, false],
      ["resume_from", pauseResumePoints, false],
    ]) {
      if (!hasOwn(owner, field) || owner[field] === null || owner[field] === "") continue;
      const fieldParts = [...baseParts, field];
      let value = owner[field];
      if (isBoolean) {
        if (typeof value !== "boolean") {
          diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a boolean`));
          continue;
        }
      } else {
        value = readOptionalText(parsed, owner, field, fieldParts, diagnostics);
        if (value === null) continue;
      }
      target.push({ value, path: displayFieldPath(fieldParts), fieldParts });
    }
  }
  const pause = collapseEquivalentFacts(parsed, pauseFacts, "pause requested", diagnostics);
  const pauseReason = collapseEquivalentFacts(parsed, pauseReasons, "pause reason", diagnostics);
  const resumeFrom = collapseEquivalentFacts(parsed, pauseResumePoints, "pause resume point", diagnostics);
  return {
    decision: decision.value,
    pauseRequested: pause.value === true,
    pauseReason: pauseReason.value,
    resumeFrom: resumeFrom.value,
  };
}

function deriveNextAction(model, { actionState, phaseTaskEntries, phaseById, primaryWasPresent }) {
  if (actionState.decision) return actionState.decision;
  if (actionState.pauseRequested) {
    const reason = actionState.pauseReason ? ` — ${actionState.pauseReason}` : "";
    const resume = actionState.resumeFrom ? `; wznowić od ${actionState.resumeFrom}` : "";
    return `Wstrzymane${reason}${resume}`;
  }

  const taskCanContinue = ["pending", "in_progress"].includes(model.task.status);
  if (taskCanContinue && model.handoff.nextAction) {
    const handoffPhase = model.handoff.activePhase;
    if (!handoffPhase || isActionablePhase(phaseById.get(handoffPhase))) {
      return model.handoff.nextAction;
    }
  }
  if (taskCanContinue) {
    const activeEntry = phaseTaskEntries.find(
      (entry) => entry.status === "in_progress" && phaseById.get(entry.id)?.applicable,
    );
    if (activeEntry) return activeEntry.activeForm || activeEntry.content || activeEntry.id;
    if (model.activePhase && isActionablePhase(phaseById.get(model.activePhase))) {
      return model.activePhase;
    }
    if (!primaryWasPresent && model.startedPhase && isActionablePhase(phaseById.get(model.startedPhase))) {
      return model.startedPhase;
    }
    const explicit = model.phases.find(
      (phase) => phase.applicable && phase.status === "in_progress",
    ) ?? model.phases.find((phase) => phase.applicable && phase.status === "pending");
    if (explicit) return explicit.id;
  }

  if (model.task.status === "completed") {
    return model.verificationStatus === "passed_with_issues"
      ? "Zakończone z uwagami — sprawdzić raport weryfikacji"
      : "Brak — zakończone";
  }
  if (model.task.status === "superseded") return "Zastąpione — kontynuować zadanie powiązane";
  if (["blocked", "failed"].includes(model.task.status)) return "Wymaga analizy i wznowienia";
  if (model.task.status === "cancelled") return "Brak — anulowane";
  if (model.task.status === "pending") return "Uruchomić zadanie";
  return "Kontynuować bieżącą fazę";
}

function isActionablePhase(phase) {
  return Boolean(phase?.applicable && ["pending", "in_progress"].includes(phase.status));
}

function readRequiredMapping(parsed, owner, fieldParts, diagnostics) {
  const key = fieldParts.at(-1);
  if (!hasOwn(owner, key)) {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "missing-field", `${displayFieldPath(fieldParts)} is required`));
    return null;
  }
  return readOptionalMapping(parsed, owner, fieldParts, diagnostics);
}

function readOptionalMapping(parsed, owner, fieldParts, diagnostics) {
  const key = fieldParts.at(-1);
  const value = owner[key];
  if (!isRecord(value)) {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a mapping`));
    return null;
  }
  return value;
}

function readSequence(parsed, value, fieldParts, diagnostics) {
  if (!Array.isArray(value)) {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a sequence`));
    return null;
  }
  return value;
}

function readOptionalText(parsed, owner, key, fieldParts, diagnostics) {
  if (!hasOwn(owner, key) || owner[key] === null || owner[key] === "") return null;
  if (typeof owner[key] !== "string") {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a string or null`));
    return null;
  }
  const value = owner[key].trim();
  return value || null;
}

function readOptionalBoolean(parsed, owner, key, fieldParts, diagnostics) {
  if (!hasOwn(owner, key) || owner[key] === null) return null;
  if (typeof owner[key] !== "boolean") {
    diagnostics.push(fieldDiagnostic(parsed, fieldParts, "invalid-field-type", `${displayFieldPath(fieldParts)} must be a boolean`));
    return null;
  }
  return owner[key];
}

function collapseEquivalentFacts(parsed, facts, label, diagnostics, equivalent = Object.is) {
  if (facts.length === 0) return { value: null, provenance: [] };
  const first = facts[0];
  for (const fact of facts.slice(1)) {
    if (!equivalent(first.value, fact.value)) {
      diagnostics.push(conflictDiagnostic(parsed, first.path, fact.path, first.value, fact.value, label));
    }
  }
  return { value: first.value, provenance: facts };
}

function fieldDiagnostic(parsed, fieldParts, code, message) {
  const location = parsed.locationFor(fieldParts);
  return {
    kind: "semantic",
    code,
    sourcePath: parsed.sourcePath,
    line: location?.line ?? 0,
    column: location?.column ?? 0,
    fieldPath: displayFieldPath(fieldParts),
    message,
  };
}

function conflictDiagnostic(parsed, firstPath, secondPath, firstValue, secondValue, label) {
  return {
    kind: "semantic",
    code: "conflicting-facts",
    sourcePath: parsed.sourcePath,
    line: 0,
    column: 0,
    fieldPath: firstPath,
    relatedFieldPath: secondPath,
    message: `${label} conflicts: ${firstPath}=${JSON.stringify(firstValue)} versus ${secondPath}=${JSON.stringify(secondValue)}`,
  };
}

function comparePhases(left, right) {
  return comparePhaseIds(left.id, right.id);
}

function comparePhaseIds(left, right) {
  const leftNumber = /^phase-(\d+)$/.exec(left);
  const rightNumber = /^phase-(\d+)$/.exec(right);
  if (leftNumber && rightNumber) return Number(leftNumber[1]) - Number(rightNumber[1]);
  if (leftNumber) return -1;
  if (rightNumber) return 1;
  return left.localeCompare(right);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function isIsoDateOrTimestamp(value) {
  if (typeof value !== "string") return false;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return isValidCalendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  }
  return isIsoTimestamp(value);
}

export function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z") {
    const offset = /[+-](\d{2}):(\d{2})$/.exec(zone);
    if (!offset || Number(offset[1]) > 23 || Number(offset[2]) > 59) return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function isValidCalendarDate(year, month, day) {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function isTimestamp(value) {
  return isIsoDateOrTimestamp(value);
}

function hasOwn(owner, key) {
  return isRecord(owner) && Object.prototype.hasOwnProperty.call(owner, key);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectSyntaxDiagnostics(documents, source, sourcePath) {
  const diagnostics = [];
  for (const document of documents) {
    for (const error of document.errors) {
      diagnostics.push(
        createStateDiagnostic({
          sourcePath,
          source,
          offset: error.pos?.[0] ?? document.range?.[0] ?? 0,
          kind: "syntax",
          code: error.code === "DUPLICATE_KEY" ? "duplicate-key" : "invalid-yaml",
          message: error.message,
        }),
      );
    }
  }
  return diagnostics;
}

function collectPolicyDiagnostics(node, fieldParts, diagnostics, source, sourcePath) {
  if (YAML.isAlias(node)) {
    diagnostics.push(
      nodeDiagnostic({
        node,
        fieldParts,
        source,
        sourcePath,
        kind: "schema",
        code: "alias-not-allowed",
        message: `YAML aliases are not allowed at ${displayFieldPath(fieldParts)}`,
      }),
    );
    return;
  }

  if (node.tag) {
    diagnostics.push(
      nodeDiagnostic({
        node,
        fieldParts,
        source,
        sourcePath,
        kind: "schema",
        code: "tag-not-allowed",
        message: `Explicit YAML tags are not allowed at ${displayFieldPath(fieldParts)}`,
      }),
    );
  }

  if (YAML.isMap(node)) {
    for (const pair of node.items) {
      const key = scalarKey(pair.key);
      const pairPath = key === null ? fieldParts : [...fieldParts, key];
      if (key === "<<") {
        diagnostics.push(
          nodeDiagnostic({
            node: pair.key,
            fieldParts: pairPath,
            source,
            sourcePath,
            kind: "schema",
            code: "merge-key-not-allowed",
            message: `YAML merge keys are not allowed at ${displayFieldPath(pairPath)}`,
          }),
        );
      }
      collectPolicyDiagnostics(pair.key, fieldParts, diagnostics, source, sourcePath);
      if (pair.value) {
        collectPolicyDiagnostics(pair.value, pairPath, diagnostics, source, sourcePath);
      }
    }
    return;
  }

  if (YAML.isSeq(node)) {
    node.items.forEach((item, index) => {
      if (item) {
        collectPolicyDiagnostics(item, [...fieldParts, index], diagnostics, source, sourcePath);
      }
    });
  }
}

function collectConsumedTypeDiagnostics(document, diagnostics, source, sourcePath) {
  const taskNode = document.getIn(["task"], true);
  if (taskNode && !YAML.isMap(taskNode)) {
    diagnostics.push(
      nodeDiagnostic({
        node: taskNode,
        fieldParts: ["task"],
        source,
        sourcePath,
        kind: "schema",
        code: "invalid-field-type",
        message: `task must be a mapping, received ${describeNode(taskNode)}`,
      }),
    );
    return;
  }

  for (const fieldParts of CONSUMED_STRING_PATHS) {
    const node = document.getIn(fieldParts, true);
    if (node === undefined || node === null) continue;
    if (!YAML.isScalar(node) || typeof node.value !== "string") {
      diagnostics.push(
        nodeDiagnostic({
          node,
          fieldParts,
          source,
          sourcePath,
          kind: "schema",
          code: "invalid-field-type",
          message: `${displayFieldPath(fieldParts)} must be a string, received ${describeNode(node)}`,
        }),
      );
    }
  }
}

function nodeDiagnostic({
  node,
  fieldParts,
  source,
  sourcePath,
  kind,
  code,
  message,
}) {
  return createStateDiagnostic({
    sourcePath,
    source,
    offset: node?.range?.[0] ?? 0,
    kind,
    code,
    fieldPath: displayFieldPath(fieldParts),
    message,
  });
}

function describeNode(node) {
  if (YAML.isMap(node)) return "mapping";
  if (YAML.isSeq(node)) return "sequence";
  if (YAML.isAlias(node)) return "alias";
  if (YAML.isScalar(node)) return node.value === null ? "null" : typeof node.value;
  return "unknown value";
}

function scalarKey(node) {
  if (!YAML.isScalar(node)) return null;
  return typeof node.value === "string" || typeof node.value === "number"
    ? node.value
    : null;
}

function normalizeFieldPath(fieldPath) {
  if (Array.isArray(fieldPath)) return fieldPath;
  if (typeof fieldPath === "string" && fieldPath.length > 0) return fieldPath.split(".");
  throw new TypeError("Field path must be a non-empty string or an array");
}

function displayFieldPath(fieldParts) {
  if (fieldParts.length === 0) return "<root>";
  return fieldParts
    .map((part, index) =>
      typeof part === "number" ? `[${part}]` : `${index === 0 ? "" : "."}${part}`,
    )
    .join("");
}

function lineAndColumn(source, offset) {
  const lines = source.slice(0, Math.max(0, offset)).split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: lines.at(-1).length + 1,
  };
}

function compareDiagnostics(left, right) {
  return (
    left.line - right.line ||
    left.column - right.column ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}
