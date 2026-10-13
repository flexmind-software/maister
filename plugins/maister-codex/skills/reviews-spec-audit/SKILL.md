---
name: reviews-spec-audit
description: Independent specification audit to verify completeness and clarity before implementation
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

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Dispatch Maister agent with subagent_type="maister:spec-auditor" NOW. Pass the spec path in the prompt. Do not read files, explore code, or execute workflow steps yourself.

You are running an independent specification audit using the `spec-auditor` agent.

## Your Task

You are performing senior auditor review of specifications to verify completeness, clarity, and implementability.

## Parse User Request

**Determine the following from the user's request:**

1. **Specification path**:
   - If provided: Use the specified spec file path
   - If not provided: Use Maister user decision to ask for spec.md path

2. **Audit type**:
   - **Pre-implementation**: Audit spec before building (default)
   - **Post-implementation**: Audit spec vs actual implementation (if implementation exists)

## Your Instructions

**Invoke the spec-auditor agent NOW using the Dispatch Maister agent:**

```
Task Tool:
- subagent_type: spec-auditor
- description: Specification audit
- prompt: |
    You are the spec-auditor agent. Audit the specification at: [spec-path]

    Your task:
    1. Read and comprehend the specification thoroughly
    2. [If pre-implementation]: Identify ambiguities, missing details, unclear sections
    3. [If post-implementation]: Examine actual implementation independently
    4. [If post-implementation]: Compare specification vs implementation
    5. Categorize gaps (Missing/Incomplete/Incorrect/Extra/Ambiguous)
    6. Assign severity to each finding (Critical/High/Medium/Low)
    7. Request clarification for ambiguous specifications
    8. Generate comprehensive audit report

    [If post-implementation]:
    - Use az CLI to verify Azure resources if applicable
    - Use gh CLI to verify GitHub integration if applicable
    - Examine codebase, database schemas, API endpoints, configurations
    - Trust nothing, verify everything independently

    Save report to: verification/spec-audit.md

    Focus on: Evidence-based assessment. Every finding must have file:line references or clear evidence.
```

**Wait for the agent to complete before proceeding.**

The spec-auditor agent will:
1. Thoroughly read and understand specification
2. Identify ambiguities, unclear sections, missing details
3. (If post-impl) Independently examine actual implementation
4. (If post-impl) Compare specification vs implementation using external tools
5. Categorize gaps with evidence
6. Assign severity with justification
7. Ask clarifying questions for ambiguities
8. Provide recommendations for compliance

## Examples

**Example 1**: Pre-implementation spec audit
```
User: $maister:reviews-spec-audit .maister/tasks/development/2025-11-17-user-auth/implementation/spec.md
```

**Example 2**: Post-implementation audit
```
User: $maister:reviews-spec-audit .maister/tasks/development/2025-11-17-user-auth/ --post-implementation
```

**Example 3**: Audit with clarification focus
```
User: $maister:reviews-spec-audit spec.md --focus=ambiguity
```

## What to Expect

The spec-auditor will provide:
- Specification completeness assessment
- Ambiguities and unclear sections identified
- (If post-impl) Gaps between spec and implementation (Missing/Incomplete/Incorrect/Extra)
- All findings with evidence (file:line references or absence proof)
- Severity assessment (Critical/High/Medium/Low)
- Clarification questions for stakeholders
- Compliance status (✅ Compliant | ⚠️ Mostly Compliant | ❌ Non-Compliant)
- Specific recommendations for each finding

## Notes

- This is analysis only - no code or specs will be modified
- Senior auditor perspective: healthy skepticism, verify independently
- Uses external tools (az CLI, gh CLI) for deployment verification
- Focus on functional reality, not theoretical compliance
- Severity levels guide prioritization:
  - **Critical**: Breaks core functionality, blocks deployment
  - **High**: Important feature missing/incorrect
  - **Medium**: Nice-to-have missing, workarounds exist
  - **Low**: Minor discrepancy, low user impact
