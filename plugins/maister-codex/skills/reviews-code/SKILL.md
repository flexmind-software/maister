---
name: reviews-code
description: Run automated code quality, security, and performance analysis on your code
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

**ACTION REQUIRED**: This command delegates to a subagent. The `<command-name>` tag refers to THIS command, not the target. Invoke the code-reviewer subagent via the Dispatch Maister agent NOW. Pass path and scope arguments. Do not read files, explore code, or execute workflow steps yourself.

You are running a comprehensive code review using the `code-reviewer` subagent.

## Your Task

You are performing automated code analysis to identify quality, security, and performance issues.

## Parse User Request

**Determine the following from the user's request:**

1. **Path to analyze**:
   - If provided: Use the specified path
   - If not provided: Use Maister user decision to ask what to analyze

2. **Analysis scope**:
   - If `--scope=quality`: Only code quality analysis
   - If `--scope=security`: Only security analysis
   - If `--scope=performance`: Only performance analysis
   - If `--scope=all` or no scope: Complete analysis (recommended)

## Your Instructions

**Invoke the code-reviewer subagent NOW using the Dispatch Maister agent:**

```
Use Dispatch Maister agent:
  subagent_type: "maister:code-reviewer"
  description: "Code quality review"
  prompt: |
    Analyze code at: [path from user or from Maister user decision]
    Scope: [quality|security|performance|all]
    Report path: [path]/code-review-report.md
```

**Wait for the subagent to complete before proceeding.**

The code-reviewer subagent will:
1. Analyze code for complexity, duplication, and code smells
2. Detect security vulnerabilities and hardcoded secrets
3. Identify performance issues (N+1 queries, missing indexes, caching opportunities)
4. Generate comprehensive report with findings categorized by severity
5. Provide actionable recommendations with code examples

## Examples

**Example 1**: Review specific task
```
User: $maister:reviews-code .maister/tasks/development/2025-10-24-auth/
```

**Example 2**: Review with specific scope
```
User: $maister:reviews-code src/api/ --scope=security
```

**Example 3**: Review entire project
```
User: $maister:reviews-code src/
```

## What to Expect

The code-reviewer will provide:
- Summary of issues found (critical, warnings, info)
- Detailed findings with file locations and line numbers
- Code examples showing issues and fixes
- Metrics on code quality, security, and performance
- Prioritized recommendations
- Go/no-go assessment for code review

## Notes

- This is analysis only - no code will be modified
- Focus on actionable findings
- Severity levels guide prioritization:
  - **Critical**: Must fix before production
  - **Warning**: Should fix before merge
  - **Info**: Nice to have improvements
