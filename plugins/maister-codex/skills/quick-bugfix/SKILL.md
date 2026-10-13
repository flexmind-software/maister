---
name: quick-bugfix
description: Quick bug fix with TDD red/green gates and complexity escalation
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

# Quick Bug Fix

Lightweight TDD-driven bug fix workflow with planning mode. Analyze the bug, present a fix plan for approval, then reproduce with a failing test, fix, and verify. No orchestrator state, no task directory, no subagents.

For complex bugs that grow beyond a quick fix, suggests escalating to the full development workflow (`$maister:development`).

## Usage

```bash
$maister:quick-bugfix "Login form submits twice on slow connections"
$maister:quick-bugfix "API returns 500 when email contains special characters"
$maister:quick-bugfix "Dark mode toggle doesn't persist after refresh"
```

## When to Use

**Use `$maister:quick-bugfix` when:**
- Bug is reasonably scoped and reproducible
- You have a clear description of expected vs actual behavior
- Fix likely touches a small number of files

**Use `$maister:development` instead when:**
- Bug requires architectural changes
- Multiple subsystems are involved
- You need formal specification and planning

---

## Workflow

### Step 1: Parse Input

**Get the bug description:**

- If provided as argument, use it directly
- If not provided, scan the recent conversation for bug context (error messages, reproduction steps, discussed symptoms). If found, use that as the bug description.
- Only if no argument AND no bug context in session, use Maister user decision:
  ```
  "Describe the bug — what's the expected behavior vs actual behavior?"
  ```

### Step 2: Discover Standards

Discover the project's standards as part of analysis and planning (Steps 3–4), relevant to the bug area — not as a bulk upfront read.

- Read `.maister/docs/INDEX.md` to find which standards exist.
- **Then read the specific standard files it points to that match the bug area** (e.g. API bug → api + error-handling standards; form bug → validation + frontend standards; query bug → database + backend standards). Reading INDEX.md alone is NOT sufficient — this is mandatory.
- Apply the matched standards in the fix plan (Step 4) and during implementation (Step 6).

If `.maister/docs/INDEX.md` does not exist, note it and suggest `$maister:init` in the completion summary.

### Step 3: Analyze & Assess Complexity

**Explore the codebase to understand the bug:**

1. Search for relevant files (Glob, Grep, Read)
2. Trace the code path where the bug occurs
3. Identify: likely root cause, affected files, existing tests
4. Form a root cause hypothesis

**Complexity Escalation Check:**

Assess whether this bug exceeds quick-fix scope. If **2 or more** of these signals are detected, suggest escalation:

| Signal | Example |
|--------|---------|
| Changes span 5+ files across multiple modules | Bug in shared utility affects API, frontend, and background jobs |
| Requires database schema or data model changes | Missing column, wrong relationship, migration needed |
| Multiple valid fix approaches with architectural trade-offs | Could fix at API layer, middleware layer, or client layer |
| Security-sensitive code | Auth, crypto, permissions, input sanitization |
| Root cause unclear after initial analysis | Symptoms don't point to a single location |

**If escalation triggered:**

Use Maister user decision:
- Question: "This bug appears more complex than a quick fix — [describe why]. How would you like to proceed?"
- Options:
  1. "Continue with quick fix" — proceed, accepting the complexity
  2. "Switch to full development workflow" — stop here and suggest running `$maister:development` with the bug description and analysis context

**If no escalation needed or user chooses to continue:** proceed to Step 4.

### Step 4: Enter Planning Mode

**Use the `Maister planning-only mode` tool to present the fix plan for user approval.**

Standards context from Step 2 and analysis from Step 3 MUST inform the plan.

**Plan file content:**

```markdown
## Bug Analysis

**Root Cause**: [hypothesis with evidence — file paths, code references]
**Affected Files**: [list of files that need changes]

## Proposed Fix

[Description of the fix approach — what changes, why this approach]

## Test Strategy

[What the failing test will assert — setup conditions, expected behavior]

## Applicable Standards

[List each standard file read, with key guidelines extracted from each.
If no standards exist: "No Maister standards found. Consider running `$maister:init`."]

## Standards Compliance Checklist

- [ ] [Guideline from standard file] (from `standards/[path]`)
- [ ] [Guideline from standard file] (from `standards/[path]`)
```

### Maister plan approval Gate: Mandatory Sections

**BLOCKING: Do NOT call `Maister plan approval` until the plan file contains:**

1. **"## Bug Analysis"** — root cause hypothesis with evidence
2. **"## Proposed Fix"** — what changes and why
3. **"## Test Strategy"** — what the TDD red test will assert
4. **"## Applicable Standards"** — standards read and key guidelines
5. **"## Standards Compliance Checklist"** — checkboxes for applicable guidelines

If any section is missing, add it before calling Maister plan approval.

### Step 5: TDD Red Gate

**Write a failing test that reproduces the bug.**

1. Identify the appropriate test file (existing test suite or create new test file following project conventions)
2. Write a test that:
   - Sets up the conditions that trigger the bug
   - Asserts the **correct** (expected) behavior
   - Should FAIL with current code (proving the bug exists)
3. Run the test

**The test MUST fail.** This proves the bug is real and reproducible.

**If the test passes:**
- The bug may not be what we think, or it's already fixed
- Investigate further — re-read the bug description, check if conditions are correct
- Use Maister user decision: "The reproduction test passes — the expected behavior already works under these conditions. Is the bug description accurate, or are there additional conditions?"

### Step 6: Fix & Verify (TDD Green)

**Implement the fix:**

1. Apply the fix based on the approved plan from Step 4
2. **Apply discovered standards** from Step 2
3. Run the failing test — it MUST now pass
4. Run the full test file and related test files to check for regressions

**If tests fail after fix:**
- Analyze the failure
- Adjust the fix
- Re-run tests
- Maximum 3 fix-and-verify iterations

**If still failing after 3 attempts:**
- Stop and present findings to the user
- Suggest escalating to `$maister:development` for a more thorough approach

### Step 7: Summary

**Provide completion summary:**

- **Root cause**: What caused the bug
- **Fix**: What was changed and why
- **Files modified**: List of changed files
- **Standards applied**: Which standards from INDEX.md were followed
- **Tests**: Which tests were run and their results (including the TDD red→green transition)
- **Commit suggestion**: Propose a commit message

**Post-implementation standards check (mandatory):** after the test is green, go through the `## Standards Compliance Checklist` from the plan file and verify each item — mark pass/fail and report it in the summary. Address any failure before marking the task complete.

---

## Graceful Fallback

**If `.maister/docs/` does not exist:**

Proceed with the bug fix normally, then note:

```
"No Maister standards found. Consider running `$maister:init` to initialize
project documentation and coding standards for better consistency."
```
