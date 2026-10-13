---
name: init
description: Initialize Maister framework with intelligent project analysis and documentation generation
---

# Maister Codex execution adapter

Read this adapter before executing any generated Maister entry point. It defines
the platform operations used in the instructions below; they are not invented
native tools. Never call an unavailable Claude tool by its old name.

## Resource resolution

Resolve the package root from the absolute path of the loaded SKILL.md: public
and internal skills are under `<root>/skills/<name>/SKILL.md`. Hook commands use
`${PLUGIN_ROOT}`; do not assume that variable is exported to ordinary shell tools.
For shell commands, replace `${MAISTER_PLUGIN_ROOT}` with this resolved absolute
root or explicitly set it in the command. Resolve skill-relative references
against the skill directory, never against the user's working directory.

## Load Maister skill

Read the complete `<root>/skills/<name>/SKILL.md`, execute its instructions in
the parent context, and return to the caller when done. Public names use
`maister:<name>`; remove the `maister:` namespace to resolve the directory.
Directory names remain the source names. Do not spawn a subagent for a skill
that itself delegates. Reading and executing the instructions is Codex's skill
loading mechanism, not permission to bypass the workflow.

## Dispatch Maister agent

Use the runtime's subagent spawning tool. For each requested `subagent_type`,
load `<root>/agents/<role>.md` (remove `maister:` or the optional custom-agent
prefix `maister-` from the role name) and pass its
full instructions plus the complete caller context as the child prompt. Use a
native `default` child for source roles; these definitions are not automatically
registered plugin agents. For the source Explore role, use native `explorer`
with the selected prompt templates and the explicit no-write constraint.
The generated `agents/*.toml` are optional custom-agent configurations, not a
prerequisite for dispatch. Do not claim a custom role is registered unless it is.

For docs-operator, preload `<root>/skills/docs-manager/SKILL.md` into its prompt.
Preserve isolated agent contexts. Spawn every ready wave member before waiting
for any; wait for all members, process all outcomes, then compute the next wave.
Use runtime tool schemas for argument names. Translated `subagent_type`, `prompt`
and `description` examples describe the dispatch contract, not literal Codex
function signatures. If delegation is unavailable, stop and report the missing
capability rather than implement delegated work inline.

## Maister user decision

Use the runtime's structured user-input tool when available. Otherwise present
the same question(s), options and context as text and end the turn. Continue
only after an explicit user response. Multiple questions stay distinct, and
multi-select decisions retain their meaning. Permission approvals are not
workflow approvals. Before pausing, persist current state and pending decision
context without completing the gated phase. Reload that state on continuation.
Non-interactive execution without a human response remains blocked; never
infer a choice, silently skip a gate or mark work completed before approval.

## Persistent task operations

The parent alone runs the following adapter through the shell tool:

```bash
python3 "<root>/runtime/tasks.py" --task-path "<task-path>" create --json '{"subject":"Analysis","description":"Analyze the codebase","activeForm":"Analyzing"}'
python3 "<root>/runtime/tasks.py" --task-path "<task-path>" update --json '{"taskId":"2","addBlockedBy":["1"]}'
python3 "<root>/runtime/tasks.py" --task-path "<task-path>" list
python3 "<root>/runtime/tasks.py" --task-path "<task-path>" get --json '{"taskId":"1"}'
```

Maister task create/update/list/get correspond to these operations. Preserve
subject, description, activeForm, owner, metadata, IDs and dependencies. Record
returned IDs in `orchestrator-state.yml`. `codex-tasks.json` is persistent task
tracking, not a replacement for workflow state or implementation checkboxes.
Updates reject unknown dependencies, cycles and premature starts/completion.
On resume, reuse existing IDs; do not create duplicate task lists. Restore
completed tasks in dependency order. Only the parent writes the registry, even
when workers execute concurrently. Adapter errors must be reported, not ignored.
Quick workflows without a task directory do not need a registry.

At a checkpoint, run
`python3 "<root>/runtime/checkpoint.py" --task-path "<task-path>" capture`
and copy its `algorithm`, `branch`, `commit`,
`working_tree_status`, and `working_tree_fingerprint` to the matching
`session_handoff` fields (`fingerprint_algorithm` stores `algorithm`).
Run capture again after writing the state; its fingerprint must remain equal.

Before any resumed task mutation, read `session_handoff` from
`orchestrator-state.yml`. Run
`python3 "<root>/runtime/checkpoint.py" --task-path "<task-path>" verify --expected-algorithm "<saved-fingerprint-algorithm>" --expected-fingerprint "<saved-working-tree-fingerprint>"`.
The command must exit zero and return
`match: true`. Compare its branch, commit, and `working_tree_status` with the
saved values, and inspect the active-batch diff. Confirm
`last_verified_commit` is an ancestor of HEAD when present. A missing or
unknown `fingerprint_algorithm` on an existing digest is a legacy checkpoint:
stop automatic mutation, inspect the diff, and request an explicit user decision
before replacing it. Never guess the byte encoding or silently rebaseline.
Reconcile any other mismatch before continuing; do not overwrite the checkpoint
with the observed state merely to make the check pass. Then list `codex-tasks.json`
through this adapter and verify every saved `orchestrator.task_ids` entry
resolves to the same phase task. Missing or corrupt registry data is an error,
not permission to recreate the task list. A legacy task without a handoff may
establish one from observed repository state before resuming.

## Maister planning-only mode / Maister plan approval

For quick-plan, perform read-only exploration and design: no application edits
or implementation before approval. Write the plan artifact as required, with
applicable standards and the compliance checklist. Present the plan and stop
for explicit approval. After approval, implement and verify the checklist.
Do not try to call EnterPlanMode/ExitPlanMode or change the user's sandbox.

## File, shell and web operations

Source Read/Write/Edit/Glob/Grep/Bash labels describe operations: use actual
runtime file/shell tools. For WebFetch/WebSearch use available web/MCP tools.
Keep standards discovery, no-write roles, test evidence and report contracts.
If a required integration is missing, report and resolve it explicitly.

## Safety and lifecycle

Review and trust plugin hooks before execution. A reminder is not proof that a
hook ran; verify runtime loading. The guard conservatively blocks destructive
commands for every agent because PreToolUse does not reliably identify roles.
Human-confirmed destructive recovery must be performed by the human outside
automated execution. The guard is lexical defense-in-depth, not a sandbox or
complete protection against arbitrary shell code. Keep runtime sandboxing.


---

# Initialize Maister Framework

Initialize `.maister/docs/` with intelligent project analysis and meaningful documentation generation based on actual codebase inspection.

**NOTE**: This skill invokes other skills and subagents at specific phases. Use the **Dispatch Maister agent with `docs-operator` subagent** (subagent_type: `maister:docs-operator`) for all docs-manager operations, and **Dispatch Maister agent** for project-analyzer. Use the **Load Maister skill** only for standards-discover (Phase 8, last phase). The Dispatch Maister agent returns control to this skill after completion; the Load Maister skill does not.

## Phase Configuration

| Phase | Subject | activeForm |
|-------|---------|------------|
| 1 | Pre-flight checks | Running pre-flight checks |
| 2 | Analyze project codebase | Analyzing project codebase |
| 3 | Present findings & gather context | Gathering project context |
| 4 | Select standards to initialize | Selecting standards |
| 5 | Initialize documentation structure | Initializing documentation |
| 6 | Generate project documentation | Generating project documentation |
| 7 | Validate | Validating initialization |
| 8 | Discover coding standards | Discovering coding standards |

**Task Tracking**: Before Phase 1, use `Maister task create` for all phases (pending), then set sequential dependencies with `Maister task update addBlockedBy`. At each phase: `Maister task update` to `in_progress` → execute → `Maister task update` to `completed`. If skipped (e.g., user selects "Update existing"), mark skipped phases as `completed` with `metadata: {skipped: true}`.

---

## PHASE 1: Pre-flight Checks

**If `--standards-from=PATH` is provided:**
1. Resolve the path (absolute or relative to current working directory)
2. Check if `PATH/.maister/docs/standards/` exists. If not, inform the user and stop — the specified project doesn't have maister standards initialized.
3. Store the resolved standards source path for use in Phases 4 and 5.

Check if `.maister/` directory already exists.

**If exists**, use Maister user decision:
- Options: "Backup and reinitialize", "Update existing documentation", "Cancel"
- If "Backup": Create `.maister.backup-$(date +%Y%m%d-%H%M%S)/` using Bash tool
- If "Update": Skip to PHASE 6 (documentation generation only)
- If "Cancel": Stop execution

---

## PHASE 2: Project Analysis

Invoke `project-analyzer` subagent via the Dispatch Maister agent.

Wait for completion. Store analysis results for use in Phases 3 and 6.

---

## PHASE 3: Present Findings & Gather Context

**Step 1**: Present analysis results to the user (project type, primary language/framework, architecture, tech stack, conventions, strengths/opportunities).

**Step 2**: Use Maister user decision to confirm analysis accuracy. If corrections needed, collect them.

**Step 3**: Gather additional context via Maister user decision (adapt to project type):
1. Project name (if not obvious)
2. Project description (1-2 sentences)
3. Primary goals (adapt question to new/existing/legacy project)
4. Team context (optional)
5. Special requirements (optional)

**Step 4**: Ask which project documentation to generate using Maister user decision (multi-select):
- "Vision" — Project vision, goals, and purpose
- "Roadmap" — Development roadmap and planned features
- "Tech Stack" — Technology choices and rationale (ALWAYS selected, required)
- "Architecture" — System architecture and design patterns (optional)

Smart defaults based on `projectArchitectureType`:
- Standard/Frontend-only/Backend-only: All selected
- Monorepo/Umbrella: Only "Tech Stack" selected

Store selections for Phase 6.

---

## PHASE 4: Select Standards to Initialize

Before presenting options, explain to the user:
- **What standards are**: Coding standards are documented conventions and best practices (naming, error handling, testing patterns, etc.) that guide consistent development across the project.
- **Starting point**: If `--standards-from` was provided, standards come from the referenced project. Otherwise, the plugin includes generic built-in standards. Either way, they serve as a starting point and can be fully customized or extended later.

**Determine available categories:**
- **If `--standards-from` was provided**: Scan `PATH/.maister/docs/standards/*/` to discover all available categories from the external project (may include custom categories beyond the baseline global/frontend/backend/testing).
- **Otherwise**: Use built-in baseline categories (global, frontend, backend, testing).

Calculate smart defaults based on analysis:
- **Global**: Always recommended (if available)
- **Frontend**: If frontend framework detected or projectArchitectureType includes frontend (if available)
- **Backend**: If backend framework detected or projectArchitectureType includes backend (if available)
- **Testing**: Always recommended (if available)

Also scan `.maister/docs/standards/*/` for any existing custom categories to include.

Show smart defaults summary (noting the source: external project or built-in), then use Maister user decision:
- "Use smart defaults" → proceed with calculated defaults
- "Customize selection" → show multi-select with all discovered categories + "Add custom category" option

Custom categories: if user adds a new category, create the directory and include it in the selection.

Store selection for Phase 5.

---

## PHASE 5: Initialize Documentation Structure

**Invoke `docs-operator` subagent** via Dispatch Maister agent (subagent_type: `maister:docs-operator`) with prompt:

> "Initialize documentation structure. Standards selection: [array from Phase 4]. [If --standards-from was provided: Standards source path: [resolved path]/.maister/docs/standards/. Copy standards from this external path instead of built-in defaults.] Only copy selected standard categories. Do NOT copy project templates — only create the project/ directory. Project documentation will be generated in Phase 6 with real content from project analysis. Create placeholder sections in INDEX.md for skipped categories."

Wait for docs-operator to complete, then immediately proceed to Phase 6.

**Step 2 — Scaffold project config** (Write tool, directly — not via docs-operator): if `.maister/config.yml` does not already exist, create it with the documented default so users have a discoverable place to toggle output. Do not overwrite an existing config.

```yaml
# Maister project configuration.
# html_output — generate the operator dashboard (dashboard.html + dashboard-data.js,
# auto-opened in your browser) and the HTML companion reports (.html twins of spec,
# implementation plan, verification, and research/design outputs). Set to false for
# markdown-only runs. Markdown artifacts, their TL;DR summary blocks, and
# orchestrator-state.yml are produced regardless. Default: true.
html_output: true

# mockup_format — how UI mockups are rendered when a workflow generates them
# (development Phase 4, product-design Phase 7, or $maister:mockup-studio).
#   html  (default): rendered HTML/CSS via the visual companion (browser preview, saved as .html).
#   ascii          : terminal ASCII mockups via the ascii-mockup-generator agent (no Node/browser needed).
# Auto-falls back to ascii when Node.js is unavailable. Default: html.
mockup_format: html
```

---

## PHASE 6: Generate Project Documentation

**IMPORTANT**: Only generate docs selected in Phase 3.

For each selected doc type, read the corresponding reference template:
- Vision selected → Read `references/vision-templates.md`, select template by project type (new/existing/legacy)
- Roadmap selected → Read `references/roadmap-templates.md`, select template by project type
- Tech Stack (always) → Read `references/tech-stack-template.md`
- Architecture selected → Read `references/architecture-template.md`

Fill templates using:
- Analysis report data (tech stack, age, structure)
- User-provided context from Phase 3 (goals, users, requirements)
- Auto-detected project characteristics

Write each file to `.maister/docs/project/`.

---

## PHASE 7: Validate

**Step 1**: Invoke `docs-operator` subagent via Dispatch Maister agent (subagent_type: `maister:docs-operator`) with prompt:

> "Regenerate INDEX.md to include all newly created project documentation. Then verify AGENTS.md is properly integrated with .maister/docs/ documentation."

Wait for docs-operator to complete, then immediately continue with Step 2.

**Step 2**: Run validation checks:
- Verify INDEX.md exists
- Verify tech-stack.md exists (required)
- Verify selected docs exist
- Verify selected standards directories exist
- Verify AGENTS.md integration

**Step 3**: Display comprehensive summary:
- Project analysis results (type, language, framework, architecture)
- Structure created (tree with check marks for created items)
- Documentation status (which docs generated, which standards initialized)
- Key findings (strengths, opportunities)
- Next steps:
  1. Review generated documentation
  2. Customize for your team
  3. Start development with `$maister:work`
  4. Keep documentation current

---

## PHASE 8: Discover Coding Standards

Invoke the `standards-discover` skill via Load Maister skill with `--scope=full` to automatically discover coding standards from the project's config files, source code patterns, documentation, and external sources.

> "Run standards discovery with --scope=full. This is being invoked as part of project initialization."

The standards-discover skill handles its own user interaction (presenting findings by confidence tier, asking for approval). Let it run its full workflow — this is the last phase of init, so context handoff is fine here.

After completion, display a brief summary of how many standards were discovered and applied.

---

## Error Handling Principles

- If `.maister/docs/` creation fails: check permissions, suggest manual creation
- If project-analyzer fails: offer to proceed with manual input only
- If docs-manager fails: offer retry (max 2 attempts), then manual instructions
- Never auto-rollback — always ask user before destructive actions
