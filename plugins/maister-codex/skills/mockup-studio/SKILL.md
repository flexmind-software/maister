---
name: mockup-studio
description: Generates UI mockups (rendered HTML/CSS via a browser visual companion, or terminal ASCII). Discovers and binds to the project's frontend/UI/UX resources (standards, design system, available design skills). Invoked standalone by users, or by the development and product-design orchestrators as their mockup-generation step.
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

# Mockup Studio

The single, reusable engine for generating UI mockups in the maister plugin. It runs in the **main agent context** (not a subagent), so it can start a local visual-companion server (Bash), open a browser (Playwright MCP), and run interactive `Maister user decision` refinement gates.

Two ways it runs:

- **Invoked by an orchestrator** (development Phase 4, product-design Phase 7) via the Load Maister skill, with explicit parameters (see Input Parameters). The orchestrator owns its own phase gate; mockup-studio does the generation.
- **Invoked standalone by a user** (`$maister:mockup-studio "<screen or feature>"`). It creates its own task directory and runs the full interactive flow.

Whatever the caller, the work is the same: discover the project's design language → render mockups in the chosen format → persist them → (optionally) index them for downstream binding.

---

## Core Principles

1. **One engine, two formats** — `html` (visual companion server + browser) is the default; `ascii` (delegated to the `ascii-mockup-generator` subagent) is the no-Node/no-browser path. HTML auto-falls back to ASCII when Node.js is unavailable.
2. **Bind to the real design language** — before generating, run design-resource discovery (`references/design-resource-discovery.md`). Discovered standards, tokens, and components are **binding inputs**, not suggestions.
3. **Consistency over creativity** — mockups should look like the existing application (reuse real components, tokens, icons), not a generic theme.
4. **Graceful degradation** — every step has a fallback; when nothing is discovered, generation proceeds exactly as it would without discovery.

---

## Input Parameters

When an orchestrator invokes this skill, it passes these. Standalone invocation derives them from the user's prompt + config (see Standalone Mode).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task_path` | Yes | Caller's task directory. Mockups, the discovery artifact, and (when requested) INDEX rows are written under it. |
| `output_subdir` | No | Where rendered mockups land, relative to `task_path`. Default `analysis/mockups` (product-design). Development passes `analysis/design-context/mockups`. |
| `format` | No | `html` (default) or `ascii`. Orchestrators pass `orchestrator.options.mockup_format`. Auto-falls back to `ascii` when Node.js is unavailable. |
| `iteration` | No | `single` (generate once, return — caller's phase gate handles approve/revise) or `full` (multi-round interactive refinement loop). Default `full`. |
| `emit_index_rows` | No | When `true`, append stable-ID rows to `<task_path>/analysis/design-context/INDEX.md` so downstream phases can attach `Visual References`. Default `false`. Development passes `true`. |
| `context` | No | Grounding summary (spec/gap-analysis/design-decisions excerpts, screen list, `design_reference` path) so generated screens are specific and feature-relevant — not generic placeholders. |

**Returns** (report back to the caller):
```yaml
mockup_files: []        # paths of written mockups (.html files, or the ascii-mockups.md)
index_rows: []          # stable-ID rows appended to design-context/INDEX.md (empty if emit_index_rows false)
format_used: html|ascii # the format actually used (may differ from requested if Node was unavailable)
notes: ""               # fallback notes, e.g. "html requested, fell back to ascii (Node unavailable)"
```

---

## Execution Workflow

### Step 1 — Resolve inputs & set up

- If invoked standalone with no `task_path`, run **Standalone Mode** setup first (below).
- Ensure `<task_path>/<output_subdir>/` exists.
- Capture the clock once with `date -u +"%Y-%m-%dT%H:%M:%SZ"` (Bash) for any timestamps written this turn.

### Step 2 — Design-resource discovery (binding)

**Read `references/design-resource-discovery.md` NOW** and run the 3-tier routine. Write `<task_path>/analysis/design-context/design-resources.md` (with a `## TL;DR`) and record the `design_resources` block (the routine specifies the schema). When nothing is found, write the one-line "none detected" artifact and continue unchanged.

The discovered standards (read them), design-system tokens/components (reuse by exact name), and skill hints (best-effort consult) are **binding** for whichever generator runs next.

### Step 3 — Format routing

Determine the effective format:
```
node_ok = `node --version` succeeds
if format == "html" AND node_ok   → HTML path (Step 4a)
else                              → ASCII path (Step 4b)
if format == "html" AND NOT node_ok → record in notes: "html requested, fell back to ascii (Node unavailable)"
```

### Step 4a — HTML path (visual companion)

Read `references/visual-companion.md` for the full protocol. Then:

1. **Stale-server check**: `curl -s http://localhost:3847/status` (try 3847–3850). If it responds with a different `taskPath`, `POST /shutdown` it. If it matches the current task, reuse it.
2. **Start the server** (Bash):
   `node ${MAISTER_PLUGIN_ROOT}/skills/mockup-studio/server/index.mjs --task-path=${task_path} --output-subdir=${output_subdir} &`
   The plugin root is this plugin's own directory — the one holding `plugin.json` — resolve it from the loaded SKILL.md; replace ${MAISTER_PLUGIN_ROOT} with that absolute path in shell commands.
   Wait ~1s, verify `curl -s http://localhost:${port}/status` returns ok (try 3847–3850).
3. **Open browser** (best-effort, non-blocking): Playwright MCP `browser_navigate` to `http://localhost:${port}` → fallback `open`/`xdg-open` → fallback log the URL.
4. **Generate user-facing wireframes** — one screen per relevant view implied by `context`. Title each screen specifically (e.g. "Add New Allergy Form", not "Dashboard"). Bind to discovered tokens/components/CSS variables by their real names. Add `data-screen="slug"` to clickable elements for click-through navigation, and `annotations` for component-reuse / integration / interaction hints (NOT requirements). Generate USER-FACING UI only — never architecture/data-flow/ER diagrams.
5. **POST each screen**: `POST http://localhost:${port}/update` with `{type, title, html, css, annotations}`. Each POST auto-saves `<output_subdir>/{slug}.html`.

### Step 4b — ASCII path

**INVOKE** the `maister:ascii-mockup-generator` subagent (Dispatch Maister agent). Pass: `task_path`, `output_subdir` target, the `context` grounding, the feature type, AND the discovered design resources (resolved standard file paths, design-system inventory, skill hints) so the agent binds to them. The agent writes ASCII to `analysis/design-context/ascii/ui-mockups.md` (or `<output_subdir>/ascii-mockups.md` for standalone/product-design) and can append INDEX rows itself.

### Step 5 — Refinement loop

- `iteration: single` — generate once and return. The calling orchestrator's phase gate offers approve/revise; on revise it re-invokes this skill.
- `iteration: full` — enter an interactive loop:
  `Maister user decision` with options like: "Approve all screens and continue", "Change the layout of [screen]", "Change the content of [screen]", "Change the interactions", "Add another screen", "Let me explain my thinking". On revision, regenerate the specific screen (re-POST updates it in place on disk and in the gallery for HTML; re-run the agent for ASCII). Track iterations and apply a soft cap (~5) — past it, recommend converging.

### Step 6 — Persist & index

- HTML mockups are saved on each POST. ASCII is saved by the subagent.
- When `emit_index_rows` is true, append one row per screen/component to `<task_path>/analysis/design-context/INDEX.md` (create if missing), using the stable-ID format below. Source points at the per-screen `.html` (HTML) or the ASCII file anchor:

```markdown
| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:add-allergy-form | screen | analysis/design-context/mockups/add-allergy-form.html | Add New Allergy form modal |
| component:severity-badge | component | analysis/design-context/mockups/add-allergy-form.html | Allergy severity pill (reuses Badge) |
```

### Step 7 — Teardown & return

- **Do NOT shut the server down when `iteration: single` (orchestrator mode).** In that mode the caller's *review gate fires after this skill returns* — the operator reviews the gallery at that gate, so the companion MUST stay running until the caller leaves the design stage. Shutting down here strands the reviewer with a dead `localhost` (the gallery survives on disk, but the live browsable gallery — the whole point — is gone). Leave it running and tell the caller the gallery URL; the orchestrator tears it down when it advances past the design/mockup phase (or on a "revise" it re-invokes this skill, which reuses the still-running server).
- Only shut the server down when this skill genuinely owns the *entire* lifecycle end-to-end: **standalone `iteration: full`** after the user has approved and the interactive loop is complete. Then `curl -s -X POST http://localhost:${port}/shutdown`.
- On restart the server auto-restores previously-saved screens from the on-disk manifest (`<output_subdir>/.mockups.json`), so a companion that was stopped can be brought back with the full gallery intact by re-running the same start command — no re-POST needed.
- Return the result block (Step "Returns" above) to the caller, including the live gallery URL so the caller can surface it at its review gate.

---

## Standalone Mode

When a user runs `$maister:mockup-studio "<screen or feature>"` (no `task_path` from an orchestrator):

1. Capture the clock; create `.maister/tasks/mockups/YYYY-MM-DD-<short-name>/` with an `analysis/` subdir.
2. Defaults: `output_subdir = analysis/mockups`, `iteration = full`, `emit_index_rows = false`, `format` from `.maister/config.yml` `mockup_format` (default `html`).
3. Build `context` from the user's prompt (and any referenced files/standards).
4. Run Steps 1–7. At the end, report the gallery URL and saved file paths.

This gives users an ad-hoc mockup session without running a full development or product-design workflow.

---

## Graceful Degradation

| Scenario | Detection | Fallback |
|---|---|---|
| Node.js unavailable | `node --version` fails | ASCII via `ascii-mockup-generator`; note it in `notes` |
| All ports 3847–3850 in use | server start fails on every port | ASCII fallback |
| Browser won't open | Playwright + `open` both fail | Log the URL; continue (server still saves to disk) |
| No design resources found | discovery `found_any: false` | Generate from codebase patterns only — unchanged behavior |

Never block the caller because a mockup enhancement failed. The mockup files on disk are the deliverable; live preview is additive.

---

## Local References

| File | When to Read | Purpose |
|------|-------------|---------|
| `references/design-resource-discovery.md` | Step 2 (before generating) | The 3-tier discovery routine, `design_resources` schema, binding rules |
| `references/visual-companion.md` | Step 4a (HTML path) | Server protocol, lifecycle, communication, graceful degradation |
