---
name: orchestrator-framework
description: Shared orchestration patterns for all workflow orchestrators. NOT an executable skill - provides reference documentation for phase execution, state management, phase gates, and initialization. All orchestrators reference these patterns.
---

# Orchestrator Framework

This skill provides **shared reference documentation** for all orchestrator skills in the maister plugin. It is NOT an executable skill - orchestrators reference these patterns and implement them for their specific domain.

## Purpose

Reduce duplication across orchestrators by documenting common patterns once:

- **Phase Blocks**: Simple phase structure with inline transitions (`→ MANDATORY GATE`, `→ AUTO-CONTINUE`) — the two transition types; see `orchestrator-patterns.md` § 2 for semantics
- **State Management**: `orchestrator-state.yml` schema and operations
- **Phase Gates**: Pause behavior and user prompts
- **Initialization**: Task directory setup, metadata, task creation patterns

## How Orchestrators Use This

Each orchestrator reads the framework reference file at initialization (Step 1):

```markdown
### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. `../orchestrator-framework/references/orchestrator-patterns.md`
```

## Reference Files

| File | Purpose |
|------|---------|
| `references/orchestrator-patterns.md` | Delegation rules, phase gates, state schema, initialization, context passing, issue resolution |
| `references/orchestrator-creation-checklist.md` | Authoring checklist for creating new orchestrators (not loaded at runtime) |
| `references/html-report-style.md` | Style guide for HTML companion reports (passed to companion-writing agents) |
| `assets/dashboard.html` | The frozen operator dashboard, copied into every task dir |
| `assets/tasks-dashboard.html` | Central cross-task dashboard template, copied to `.maister/tasks/dashboard.html` |
| `scripts/ensure-dashboards.mjs` | Repairs missing or stale project/task dashboard assets |
| `scripts/generate-task-index.mjs` | Scans task state files and writes the central task list projection |
| `scripts/validate-task-index.mjs` | Validates the central task list projection |
| `scripts/validate-dashboard-state-sync.mjs` | Verifies phase decisions/risks are projected from state into the task dashboard |

## Key Principles

All orchestrators follow these principles:

1. **State-Driven Execution**: `orchestrator-state.yml` is source of truth
2. **Resume Capability**: Any orchestrator can be paused and resumed
3. **Interactive**: Pause after each phase for user review
4. **User-Confirmed Rollback**: Never auto-rollback without user approval
5. **Task Progress**: Always track progress with TaskCreate/TaskUpdate tools
6. **Standards Discovery**: Reference `.maister/docs/INDEX.md` throughout

When `TaskCreate`/`TaskUpdate`, `Skill`, or browser tools are not exposed, the
portable implementation is not a skip: use the available `exec_command` and
`apply_patch` tools, persist task state in `orchestrator-state.yml`, and run
the dashboard scripts and validators described below. Native tool names must
never be claimed when they were not available.

## Orchestrators Using This Framework

- `development` (bug fixes, enhancements, features)
- `performance`
- `migration`
- `research`
- `product-design`

Library consumers — not orchestrators themselves, but they read and write the same state and artifacts:

- `implementation-plan-executor`
- `implementation-verifier`

## NOT an Executable Skill

This skill does NOT get invoked directly. It exists to:
1. Provide discoverable documentation for orchestrator patterns
2. Serve as single source of truth for common logic
3. Enable consistent behavior across all orchestrators

When building new orchestrators, reference these patterns rather than duplicating them.

## Central Task Dashboard

In addition to each task's self-contained dashboard, every orchestrator maintains a
project-level task index when `orchestrator.options.html_output` is enabled. The
index is a generated projection, not a second source of truth:

1. Run `node <plugin>/skills/orchestrator-framework/scripts/ensure-dashboards.mjs
   <project-root> [task-directory]`. It creates or repairs the project dashboard
   and, when a task directory is provided, that task's dashboard. The files are
   synchronized by SHA-256 against the plugin assets, so stale copies are repaired
   as well as missing files. When `html_output: false`, the command is a no-op.
2. Run `node <plugin>/skills/orchestrator-framework/scripts/generate-task-index.mjs
   <project-root>` after task initialization/resume and after every state/dashboard
   rewrite trigger.
3. Validate the result with
   `node <plugin>/skills/orchestrator-framework/scripts/validate-task-index.mjs
   <project-root>/.maister/tasks/dashboard-data.js`.
4. Validate the active task dashboard against its source state with
   `node <plugin>/skills/orchestrator-framework/scripts/validate-dashboard-state-sync.mjs
   <task-directory>/dashboard-data.js <task-directory>/orchestrator-state.yml`.
   A phase dashboard entry that projects decisions or risks must declare
   `summary_keys` matching the corresponding `phase_summaries` keys. The
   validator compares ordered values and fails on omissions, stale text or
   unmapped summaries.

If native dashboard or browser tooling is absent, run all three commands above
through `exec_command` anyway. Opening the HTML file is optional; generation,
central-index refresh and validation are mandatory. After each run, verify that
the central index contains the active task's path, status and a non-null
`updated`; the generator falls back to the state-file modification time for
legacy states without an explicit timestamp.

The generator scans `.maister/tasks/<type>/*/orchestrator-state.yml` for all
framework task types and exposes type, title, short description, status, next
action, updated timestamp, task dashboard link, and state link. It must not modify
individual task state files. When `html_output` is false, skip the central
dashboard, data projection, browser opening, and validation just as for task-level
dashboards.
