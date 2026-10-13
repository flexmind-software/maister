---
name: reviews-reality-check
description: Comprehensive reality assessment of completed work to verify it actually works and is production-ready
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

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Dispatch Maister agent with subagent_type="maister:reality-assessor" NOW. Pass the task path in the prompt. Do not read files, explore code, or execute workflow steps yourself.

You are running a comprehensive reality check using the `reality-assessor` agent.

## Your Task

You are performing no-nonsense reality assessment to determine if completed work actually works and solves the business problem.

## Parse User Request

**Determine the following from the user's request:**

1. **Task path**:
   - If provided: Use the specified task directory path
   - If not provided: Use Maister user decision to ask for task path

## Your Instructions

**Invoke the reality-assessor agent NOW using the Dispatch Maister agent:**

```
Task Tool:
- subagent_type: reality-assessor
- description: Reality assessment
- prompt: |
    You are the reality-assessor agent. Assess the reality of completion for: [task-path]

    Your task:
    1. Load all available verification reports (implementation-verifier, pragmatic-review.md, code-review-report.md, spec-audit.md)
    2. Assess claimed completion (check implementation-plan.md markers, test results, verification status)
    3. Validate functional completeness:
       - Run tests yourself (don't trust reports)
       - Test end-to-end workflows (not just unit tests)
       - Try error scenarios (invalid inputs, edge cases, realistic data)
       - Test integration with dependent systems
       - Test under realistic conditions
    4. Identify reality gaps (functionality, quality, production readiness)
    5. Check integration points (data flow, API contracts, auth, external systems)
    6. Generate reality assessment report with clear deployment decision

    Save report to: verification/reality-check.md

    Focus on: Does this ACTUALLY work for intended purpose? Functional reality over technical perfection.

    Provide clear deployment decision: ✅ Ready | ⚠️ Issues Found | ❌ Not Ready
```

**Wait for the agent to complete before proceeding.**

The reality-assessor agent will:
1. Review all available verification reports
2. Validate claimed completions through independent testing
3. Test end-to-end functionality (not just isolated tests)
4. Identify gaps between claims and reality
5. Check integration with rest of system
6. Assess production readiness
7. Provide pragmatic action plan (if gaps exist)
8. Make clear GO/NO-GO deployment decision

## Examples

**Example 1**: Reality check before deployment
```
User: $maister:reviews-reality-check .maister/tasks/development/2025-11-17-payment-processing/
```

**Example 2**: Verify claimed completion
```
User: $maister:reviews-reality-check .maister/tasks/development/2025-11-17-login-timeout/
```

**Example 3**: Production readiness check
```
User: $maister:reviews-reality-check .maister/tasks/development/2025-11-17-user-dashboard/ --production
```

## What to Expect

The reality-assessor will provide:
- Reality vs claims gap analysis
- Critical gaps preventing deployment (Critical severity)
- Quality gaps affecting reliability (High/Medium severity)
- Integration issues with system components
- Functional completeness percentage assessment
- Pragmatic action plan with specific steps
- Clear deployment decision (✅ Ready | ⚠️ Issues | ❌ Not Ready)
- Evidence-based assessment (test results, error messages, observed behavior)

## Notes

- This is validation only - no code will be modified
- Runs actual tests and workflows, doesn't just read reports
- Tests with realistic data and scenarios
- Checks production configuration and deployment readiness
- Focus on: Does it ACTUALLY work and solve the problem?
- Severity levels guide deployment decision:
  - **Critical**: Must fix before deployment (prevents GO decision)
  - **High**: Should fix soon (allows conditional GO with monitoring)
  - **Medium**: Can deploy with known issues
  - **Low**: Minor issues, acceptable
