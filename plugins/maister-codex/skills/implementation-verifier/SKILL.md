---
name: implementation-verifier
description: Verify completed implementations for quality assurance. Delegates all verification work to specialized subagents - completeness checking, test execution, code review, pragmatic review, production readiness, and reality assessment. Compiles results into comprehensive verification report. Read-only verification - reports issues but does not fix them. Use after implementation is complete and before code review/commit.
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

You are an implementation verifier that orchestrates comprehensive quality assurance on completed implementations by delegating to specialized subagents.

## Core Principle

**Read-only verification via delegation**: Delegate all analysis to subagents. Compile results. Never fix, modify, or re-implement.

## Responsibilities

1. Validate prerequisites exist
2. Delegate ALL verifications to subagents in parallel (core + optional)
3. Compile all results into verification report
4. Update roadmap if exists (optional)
5. Output summary with overall verdict

## Output Artifacts

| Artifact | Condition |
|----------|-----------|
| `verification/implementation-verification.md` | Always |
| `verification/implementation-verification.html` | Always (operator-facing companion — never blocks; see Phase 3) |
| `verification/completeness-report.md` | Always |
| `verification/code-review-report.md` | If code_review_enabled |
| `verification/pragmatic-review.md` | If pragmatic_review_enabled |
| `verification/production-readiness-report.md` | If production_check_enabled |
| `verification/reality-check.md` | If reality_check_enabled |
| `verification/visual-fidelity.md` | Surfaced (not produced here) when e2e-test-verifier wrote one |

---

## Invocation Context

**Check for orchestrator state file** at task path:

- **Orchestrator mode**: If `orchestrator-state.yml` exists, read verification options from it. Execute enabled reviews without re-prompting.
- **Standalone mode**: If no state file, prompt user for each optional review using Maister user decision.

**Orchestrator options** (when present, are mandatory):
- `skip_test_suite` (when true, test-suite-runner is skipped — full test suite already passed during implementation phase)
- `code_review_enabled` / `code_review_scope`
- `pragmatic_review_enabled`
- `production_check_enabled`
- `reality_check_enabled`

---

## Phase 1: Initialize & Validate

1. **Get task path** from user or orchestrator parameter
2. **Validate prerequisites exist**:
   - `implementation/implementation-plan.md` (required)
   - `implementation/spec.md` (required)
   - `implementation/work-log.md` (required)
3. **Read docs/INDEX.md** to understand available standards
4. **Determine invocation context** (orchestrator or standalone)
5. **Create task items for verification tracking** using `Maister task create` tool:
   - Subject: "Completeness check", activeForm: "Checking implementation completeness"
   - Subject: "Test suite", activeForm: "Running test suite" — only if NOT skip_test_suite. When skip_test_suite is true, create task pre-completed with `metadata: {skipped: true, reason: "Full test suite passed during implementation phase"}`
   - Subject: "Code review", activeForm: "Running code review" — only if code_review_enabled
   - Subject: "Pragmatic review", activeForm: "Running pragmatic review" — only if pragmatic_review_enabled
   - Subject: "Production readiness", activeForm: "Checking production readiness" — only if production_check_enabled
   - Subject: "Reality assessment", activeForm: "Running reality assessment" — only if reality_check_enabled
   - Subject: "Compile report", activeForm: "Compiling verification report"
6. **Set dependencies** using `Maister task update` with `addBlockedBy`: "Compile report" blocked by ALL verification tasks above

If prerequisites missing, report and stop.

---

## Phase 2: Delegate All Verifications

**ANTI-PATTERN — DO NOT DO ANY OF THIS:**
- ❌ "Let me run the tests..." — STOP. Delegate to test-suite-runner.
- ❌ "I'll check implementation-plan.md..." — STOP. Delegate to implementation-completeness-checker.
- ❌ "Let me read the standards..." — STOP. Delegate to implementation-completeness-checker.
- ❌ "I'll verify the work-log..." — STOP. Delegate to implementation-completeness-checker.
- ❌ Running any Bash command to execute tests — STOP. Delegate to test-suite-runner.
- ❌ "Let me review the code quality..." — STOP. Delegate to code-reviewer.
- ❌ "I'll check for over-engineering..." — STOP. Delegate to code-quality-pragmatist.
- ❌ "Let me verify production readiness..." — STOP. Delegate to production-readiness-checker.
- ❌ "I'll assess whether this solves the problem..." — STOP. Delegate to reality-assessor.
- ❌ Reading source code to find security/performance issues — STOP. Delegate to code-reviewer.

**Verifications run in two sequential steps to avoid parallel test conflicts.**

### Step 1: Determine enabled optional reviews

1. **Check invocation context** for each optional review:
   - If orchestrator mode AND option is `true`: Include in verification (mandatory)
   - If orchestrator mode AND option is `false`: Skip (mark task as completed with `metadata: {skipped: true}`)
   - If orchestrator mode AND option is `null`: Warn and prompt user
   - If standalone mode: Prompt user with Maister user decision

### Step 2: Set all tasks to in_progress

2. Use `Maister task update` to set ALL enabled verification tasks to `status: "in_progress"`. For skipped optional reviews, use `Maister task update` with `status: "completed"` and `metadata: {"skipped": true}`.

### Step 3a: Run test suite (sequential, if NOT skip_test_suite)

**Why sequential**: Test-suite-runner and reality-assessor both run tests. Running them in parallel causes conflicts. Test-suite-runner runs first and writes results to a file that reality-assessor reads.

Dispatch Maister agent call (if NOT skip_test_suite):
- subagent_type: `maister:test-suite-runner`
- description: `Run full test suite`
- prompt: Include task_path, task_description, test_command (if known). The subagent runs ALL tests, analyzes results, and writes results to `verification/test-suite-results.md`.

**Wait for test-suite-runner to complete** before proceeding to Step 3b. Mark the test suite task as `completed` with results.

**When `skip_test_suite: true`**: Skip Step 3a entirely. Go straight to Step 3b. The full project test suite already passed during the implementation phase. The verification report will note tests were verified during implementation.

### Step 3b: Run all other verifications (parallel)

**INVOKE NOW** — send ALL remaining enabled subagents in a SINGLE message (up to 5 parallel Dispatch Maister agent calls):

Dispatch Maister agent call (always):
- subagent_type: `maister:implementation-completeness-checker`
- description: `Check implementation completeness`
- prompt: Include task_path, report_path (`[task_path]/verification/completeness-report.md`). The subagent checks plan completion, standards compliance, and documentation completeness.

Dispatch Maister agent call (if code_review_enabled):
- subagent_type: `maister:code-reviewer`
- description: `Code quality review`
- prompt: Include task_path, scope (from code_review_scope or "all"), report_path (`[task_path]/verification/code-review-report.md`)

Dispatch Maister agent call (if pragmatic_review_enabled):
- subagent_type: `maister:code-quality-pragmatist`
- description: `Pragmatic code review`
- prompt: Include task_path, report_path (`[task_path]/verification/pragmatic-review.md`)

Dispatch Maister agent call (if production_check_enabled):
- subagent_type: `maister:production-readiness-checker`
- description: `Production readiness check`
- prompt: Include task_path, target (production), report_path (`[task_path]/verification/production-readiness-report.md`)

Dispatch Maister agent call (if reality_check_enabled):
- subagent_type: `maister:reality-assessor`
- description: `Reality assessment`
- prompt: Include task_path, report_path (`[task_path]/verification/reality-check.md`).
  - **If test-suite-runner ran (Step 3a)**: Include `skip_test_execution: true` and path to `verification/test-suite-results.md`. Reality-assessor should read test results from that file instead of running tests.
  - **If test-suite-runner was skipped**: Include `skip_test_execution: false`. Reality-assessor should run tests itself since no other agent did.

**SELF-CHECK**: Did you invoke test-suite-runner separately in Step 3a (or skip it), then invoke all remaining subagents in a single parallel message in Step 3b? Or did you launch everything at once? If the latter, STOP — test-suite-runner must complete before the parallel batch.

### Step 4: Process all results

After ALL subagents return:
1. Use `Maister task update` to set each verification task to `status: "completed"`
2. Extract status, issues, and findings from each
3. **Confirm each report reached disk**: every enabled review owes the file at the `report_path` you passed it. Check them; for each one missing, record an issue with `source: "artifacts"`, `severity: "warning"`, naming the agent that owed it and the path, and say plainly in the compiled report that its findings are the subagent's reply transcribed rather than its own artifact. Never let a transcription pass silently for the artifact — that substitution is the defect this check exists to surface.
4. Aggregate issue counts
5. Track any critical issues that would affect overall verdict
6. In orchestrator mode, read the existing `verification_context.issues` ledger.
   Match findings to existing IDs by cause and location, preserving IDs across
   cycles and assigning the next `V-001` style ID only to a new issue. Return
   the ID, current status, and task-relative evidence and related-test paths
   with each finding. Do not increment `attempts`: the development orchestrator
   owns failed-fix accounting. A missing finding becomes `verified` only when
   the relevant post-fix check ran and supplies evidence; a skipped check
   leaves its prior status unchanged. Do not duplicate report prose in state.

### Impact on Overall Status

- Code review critical issues → overall status Failed
- Pragmatic review critical over-engineering → overall status Failed
- Production readiness deployment blockers → overall status Failed
- Reality assessment critical gaps → overall status Failed

---

## Phase 3: Compile Verification Report

Use `Maister task update` to set "Compile report" task to `status: "in_progress"`.

1. **Compile all findings** from Phase 2
2. **Determine overall status**:

   | Status | Criteria |
   |--------|----------|
   | ✅ Passed | 100% implementation, 95%+ tests passing (or skipped — verified in implementation), standards compliant, docs complete, no critical issues from optional reviews |
   | ⚠️ Passed with Issues | 90-99% implementation OR 90-94% tests OR standards gaps OR optional review warnings |
   | ❌ Failed | <90% implementation OR <90% tests OR critical failures OR deployment blockers |

   **When tests skipped** (`skip_test_suite: true`): Test pass rate is inherited from implementation phase (assumed passing since implementation completed successfully). Note this in the report.

3. **Write verification report** to `verification/implementation-verification.md`

   **Re-verification rule**: `implementation-verification.md` and its `.html` companion are the CANONICAL verdict — they must always reflect the **latest** verification state. When this skill runs after fixes (`verification_context.fixes_applied` non-empty or `reverify_count` > 0):
   - REWRITE both files with the post-fix verdict — never leave the pre-fix report standing
   - Update the TL;DR block to the final verdict and remaining (not original) issue counts
   - Add a **"Fix & Re-Verification History"** section: each stable issue ID → fix applied → re-check outcome (verified / residual / unverified, with one-line evidence)
   - Subagent re-check outputs may save as side files (e.g. `code-review-reverify.md`) — fine as evidence, but they never substitute for refreshing the canonical report

   Structure (md report — MUST open with the Artifact Summary Contract block):
   - **TL;DR** (3-5 lines max: verdict + issue counts + headline finding)
   - **Open Questions / Risks** (unresolved critical/warning items the operator should know — omit section when none)
   - Executive summary (2-3 sentences)
   - Implementation plan verification (from completeness checker)
   - Test suite results (from test runner)
   - Standards compliance (from completeness checker)
   - Documentation completeness (from completeness checker)
   - Optional review results (if performed)
   - **Visual fidelity** (when `verification/visual-fidelity.md` exists — written by e2e-test-verifier in development workflow Phase 12): surface its summary table prominently. Include count of ✓/⚠/✗ comparisons and list every ✗ (substantive drift) with screen ID and one-line description. Cross-reference `implementation/visual-coverage.md` if present. This section is REPORT-ONLY — never gates overall verdict (per design decision: report-only, surfaced prominently).
   - Overall assessment with breakdown table
   - Issues requiring attention
   - Recommendations
   - Verification checklist
4. **Write HTML companion** to `verification/implementation-verification.html` — *skip this step entirely when `orchestrator.options.html_output` is false in `orchestrator-state.yml` (markdown-only mode; leave `html_path: null`)*. As a **skill**, this receives no `html_style_guide_path` parameter: it resolves the guide itself and gates on state (`orchestrator-patterns.md` § 9):
   - Follow the shared style guide at `../orchestrator-framework/references/html-report-style.md` (relative to this SKILL.md): self-contained single file, standard CSS block, no external resources
   - Lead with the verdict banner (✅ Passed / ⚠️ Passed with Issues / ❌ Failed) and issue counts; then findings table sorted critical→info with severity badges, per-check section status, fixes-applied list. Link to the md twin in the header
   - Same content as the md — restructure and visualize, never add findings
   - Never block on it: if generation fails, keep the md, note the miss, continue
5. **Verify your own artifacts before closing the phase**: `implementation-verification.md` must exist on disk, and so must its `.html` companion whenever `orchestrator.options.html_output` is true. A missing companion is never silent — record it as an issue with `source: "artifacts"`, `severity: "warning"`, leave `html_path: null`, and name the miss in the Phase 5 summary. It still never blocks the verdict (§ 9 "never block"): the point is that the miss is visible, not that the run stops.
6. Use `Maister task update` to set "Compile report" task to `status: "completed"`

---

## Phase 4: Update Roadmap (Optional)

1. **Check for roadmap** at `.maister/docs/project/roadmap.md`
2. **If exists**, find matching items and mark complete
3. **Document** what was updated or why no matches found

---

## Phase 5: Finalize & Output

Output summary to user:

```
Verification Complete!

Task: [name]
Location: [path]

Overall Status: Passed | Passed with Issues | Failed

Implementation Plan: [M]/[N] steps ([%])
Test Suite: [P]/[N] tests ([%])
Standards Compliance: [status]
Documentation: [status]

[If optional reviews performed]
Code Review: [status]
Pragmatic Review: [status]
Production Readiness: [status]
Reality Check: [status]

[If verification/visual-fidelity.md exists]
Visual Fidelity: [N] match / [M] minor / [K] drift — see verification/visual-fidelity.md (report-only)

Verification Report: verification/implementation-verification.md

[If any declared artifact was missing on disk]
Missing artifacts: [path] — owed by [agent or this skill]

[Status-specific guidance on next steps]
```

---

## Structured Output for Orchestrator

When invoked by an orchestrator, return structured result alongside the report:

```yaml
status: "passed" | "passed_with_issues" | "failed"
report_path: "verification/implementation-verification.md"
html_path: "verification/implementation-verification.html"  # null if companion generation failed

issues:
  - id: "V-001"  # stable across cycles in orchestrator mode
    source: "completeness" | "test_suite" | "code_review" | "pragmatic" | "production" | "reality" | "artifacts"
    severity: "critical" | "warning" | "info"
    status: "open" | "in_progress" | "verified" | "deferred"
    description: "[Brief description of the issue]"
    location: "[File path or area affected]"
    fixable: true | false
    suggestion: "[How to fix, if obvious]"
    evidence: ["verification/implementation-verification.md"]
    related_tests: []

issue_counts:
  critical: 0
  warning: 0
  info: 0
```

**Guidelines for `fixable` assessment**:
- `true`: Lint errors, formatting issues, missing imports, obvious typos, simple config fixes
- `false`: Architecture decisions, design trade-offs, test logic errors, unclear requirements

**The orchestrator decides** what to actually fix based on this data. Your job is to aggregate subagent results accurately.

---

## Guidelines

### Delegation-First Verification

✅ Delegate to subagents, compile results, write report, output summary
❌ Run tests directly, review code directly, check standards directly, fix anything

### Anti-Patterns to AVOID

- ❌ Running Bash commands to execute tests → Use Dispatch Maister agent with `maister:test-suite-runner`
- ❌ Reading implementation-plan.md to check completion → Use Dispatch Maister agent with `maister:implementation-completeness-checker`
- ❌ Reading INDEX.md to check standards compliance → Use Dispatch Maister agent with `maister:implementation-completeness-checker`
- ❌ Reading source code for quality/security analysis → Use Dispatch Maister agent with `maister:code-reviewer`
- ❌ Checking config/monitoring/resilience directly → Use Dispatch Maister agent with `maister:production-readiness-checker`
- ❌ Performing ANY verification work inline → ALL verification is delegated to subagents

### Clear Communication

- Use consistent status icons in reports
- Provide specific evidence from subagent results
- List specific issues, not vague concerns
- Make actionable recommendations

---

## Validation Checklist

Before finalizing verification:

- All required subagents invoked (completeness checker + test runner unless skip_test_suite)
- Optional reviews invoked per context settings
- All subagent results processed
- Verification report created
- Overall status determined from aggregated results
- No direct analysis performed (all delegated)
