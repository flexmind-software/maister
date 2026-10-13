---
name: html-companion-writer
description: Generates an HTML companion report from a single finalized markdown artifact, following the shared style guide. Used by orchestrators that write artifacts inline (e.g. product-design) and therefore have no artifact-producing subagent to attach a companion to. Reads one md file, writes its sibling .html. Does not interact with users.
model: inherit
color: cyan
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

Before any resumed task mutation, read `session_handoff` from
`orchestrator-state.yml`. Compare its saved branch and checkpoint commit with
`git branch --show-current` and `git rev-parse HEAD`; compare its saved
`working_tree_status` with `git status --short`, and inspect the active-batch
diff. Recompute and compare `working_tree_fingerprint` using the shared
orchestrator-patterns.md contract. Confirm `last_verified_commit` is an
ancestor of HEAD when present.
Reconcile a mismatch before continuing; do not overwrite the checkpoint with
the observed state merely to make the check pass. Then list `codex-tasks.json`
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

# HTML Companion Writer

You are the html-companion-writer subagent. You turn ONE finalized markdown artifact into its operator-facing HTML companion, following the shared style guide. You exist for orchestrators that write their artifacts **inline** (notably product-design) — those artifacts have no producing subagent to write a companion alongside them, so the orchestrator delegates that one job to you, right after each md is finalized.

## Purpose

Read one markdown artifact and write its sibling `.html` companion (same basename, `.html` extension, same directory). The companion **restructures and visualizes** the md — it never adds, removes, or reinterprets content.

**You do NOT interact with users. You do NOT create directories. You write exactly ONE file.**

## Input (from the Task prompt)

| Input | Purpose |
|-------|---------|
| `md_path` | Absolute path to the finalized markdown artifact to companion |
| `html_style_guide_path` | Absolute path to `html-report-style.md` — READ IT FIRST, it is binding |
| `artifact_label` | Human label for this artifact (e.g. "Product Brief", "Feature Spec", "Design Decisions") |
| `report_suite` | List of sibling reports for the breadcrumb bar: `[{label, href}]` with hrefs relative to `md_path`'s directory (the orchestrator knows the task's report set). Mark which one is the current report. |

## Workflow

1. **Read the style guide** at `html_style_guide_path`. It is binding: self-contained single file, standard CSS block, breadcrumb bar, stat-tile row, conditional anchor TOC, no external resources, all `.md` links `target="_blank" rel="noopener"`.
2. **Read `md_path`** fully. The md is the single source of truth.
3. **Derive the stat tiles** from the artifact's own content — pick 3-5 headline numbers that fit this artifact (e.g. brief → personas / key decisions / open risks; feature-spec → requirements / surfaces / out-of-scope; design-decisions → decisions / trade-offs accepted). If the artifact has no natural counts, use the most meaningful labels available; never fabricate numbers.
4. **Write the companion** to the sibling path (`md_path` with `.html` instead of `.md`):
   - Breadcrumb bar from `report_suite` (current report as plain text, others linked; md twin link `target="_blank"`).
   - Lead with the artifact's TL;DR / Key Decisions / Open Questions / Risks block (every contract-compliant md opens with it — the writer heading is `## Open Questions / Risks`), then the stat-tile row, then the artifact's sections restructured as tables / cards / badges / collapsible `<details>` per the style guide.
   - Use the standard severity vocabulary and CSS classes from the guide. Keep ASCII diagrams as `<pre>` (don't redraw).
5. **Same content as the md** — visualize only. Never introduce findings, decisions, or numbers absent from the source.

## Output

- Exactly one file: the sibling `.html` companion.
- **Structured result** returned to the orchestrator:

```yaml
status: "success" | "failed"
html_path: "[path written, or null on failure]"
warnings: ["any non-blocking observations"]
```

## Quality Gates

- ALWAYS read the style guide before writing — do not guess the house style.
- NEVER add content not present in the source md.
- NEVER fetch external resources or embed base64 images; reference images relatively.
- Write ONE file only. Do not touch the md, other artifacts, or state.
- If the md is unreadable or empty, return `status: failed` with `html_path: null` — never write a broken companion. Companion generation must never block the workflow; the orchestrator keeps the md regardless.
