---
name: codebase-analyzer
description: Analyzes codebase using adaptive parallel Explore subagents based on task complexity. Selects agent roles from a pool, launches Explore agents, then delegates report generation to codebase-analysis-reporter subagent.
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

# Codebase Analyzer Skill

Orchestrates parallel codebase analysis using built-in Explore subagents. Adaptively selects which agent roles to activate based on task complexity, then delegates report synthesis to a specialized subagent.

## Core Principles

1. **Adaptive Agent Selection**: Select roles from a pool based on task complexity — no fixed count
2. **Task-Type Awareness**: Adapt prompts and focus based on task type
3. **Delegated Reporting**: Raw findings go to `codebase-analysis-reporter` subagent for synthesis

---

## Input Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task_description` | Yes | Description of the development task |
| `description` | Yes | Task description from user |
| `task_path` | Yes | Path to task directory |
| `artifact_name` | No | Override output filename (default: `codebase-analysis.md`) |

---

## Execution Workflow

### Step 1: Parse Input and Determine Focus

Extract keywords, component names, file hints, domain, and technology hints from the description.

Determine primary focus from the task description:

| Signal in Description | Primary Focus | Key Questions |
|----------------------|---------------|---------------|
| Error/crash/broken language | Find buggy code path | Where does the issue occur? What's the execution flow? |
| Improve/enhance/existing | Find existing feature | What files implement this feature? How does it work? |
| Add/new/create | Find patterns/integration points | What similar patterns exist? Where should this integrate? |

### Step 2: Select Agent Roles

Choose which roles to activate from the pool. Each role is a distinct analysis concern.

| Role | Purpose | When Needed |
|------|---------|-------------|
| **File Discovery** | Find relevant files by patterns, keywords, naming | Almost always |
| **Code Analysis** | Analyze code structure, patterns, execution flow | When understanding existing behavior matters |
| **Context Discovery** | Find tests, consumers, dependencies | When understanding impact/coverage matters |
| **Pattern Mining** | Find similar implementations as templates | New features following existing patterns |
| **Migration Target** | Analyze target technology/compatibility | Migrations comparing current vs target |

**Decision signals:**
- **Specificity** (exact files mentioned → fewer agents)
- **Scope breadth** (multiple domains → more agents)
- **Uncertainty** (unclear location → more agents)
- **Task type** (bugs tend focused, features broad, migrations broadest)

**Examples:**

| Task Description | Roles Selected | Count |
|------------------|---------------|-------|
| "Fix null check in `utils/parser.ts`" | File Discovery + Code Analysis (combined) | 1 |
| "Add sorting to user table" | File Discovery, Code Analysis | 2 |
| "Fix login timeout" | File Discovery + Code Analysis (combined), Context Discovery | 2 |
| "Add OAuth authentication system" | File Discovery, Code Analysis, Context Discovery | 3 |
| "Add export feature similar to import" | File Discovery, Code Analysis, Pattern Mining | 3 |
| "Migrate from REST to GraphQL" | File Discovery, Code Analysis, Context Discovery, Migration Target | 4 |

When selecting fewer agents, merge related concerns into a single prompt — don't drop concerns.

State which roles you selected and why (1 sentence).

### Step 3: Read Prompt Templates and Launch Agents

> **STOP — Do NOT skip this step. Do NOT write prompts from memory.**
>
> Before launching ANY Explore agent, you MUST use the Read tool to load the prompt template for each selected role. This is non-negotiable.

**3a. Read templates** — Use the Read tool to load ONLY the files for your selected roles:

| Role | Read This File |
|------|--------------|
| File Discovery | `references/file-discovery.md` |
| Code Analysis | `references/code-analysis.md` |
| Context Discovery | `references/context-discovery.md` |
| Pattern Mining | `references/pattern-mining.md` |
| Migration Target | `references/migration-target.md` |

If combining roles into one agent, also read `references/combined.md` for merging guidance.

**3b. Adapt templates** — Replace `[description]` with the actual task description. Select the correct task-type section (Bug / Enhancement / Feature).

**3c. Launch agents** — Use the Dispatch Maister agent with `subagent_type="explorer"` — one call per selected role, all in ONE message.

**IMPORTANT**: Every Explore agent prompt MUST include this instruction:
> IMPORTANT: Do NOT create, write, or modify any files. Output all findings as text in your response only.

**SELF-CHECK**: Did you read the template files with the Read tool? If not, go back to 3a. Do not proceed.

### Step 4: Delegate Report Generation

After all Explore agents complete, delegate to `codebase-analysis-reporter` subagent via Dispatch Maister agent:

```
Dispatch Maister agent:
  subagent_type: "maister:codebase-analysis-reporter"
  description: "Merge findings into analysis report"
  prompt: |
    You are the codebase-analysis-reporter. Merge these raw findings into a structured analysis report.

    Task description: [description]
    Agent roles used: [list of roles]
    Agent count: [N]
    Output path: [task_path]/analysis/[artifact_name]

    ## Raw Findings

    ### [Role 1 Name]
    [paste raw output from agent 1]

    ### [Role 2 Name]
    [paste raw output from agent 2]

    [... for each agent]
```

The subagent produces the final report at `{task_path}/analysis/{artifact_name}` and returns structured results.

### Step 5: Return Results to Orchestrator

Pass through the subagent's structured output:

```yaml
status: success|partial|failed
report_path: analysis/[artifact_name]
summary: "[1-2 sentence summary]"
files_found: [count]
complexity: simple|moderate|complex
risk_level: low|low-medium|medium|medium-high|high
```

---

## Error Handling

- **No files found**: Report partial results, suggest user provide more specific hints
- **Agent timeout**: Use results from completed agents, note incomplete analysis
- **Conflicting results**: Pass all perspectives to reporter subagent, which highlights conflicts

---

## Integration

| Orchestrator | Phase | artifact_name |
|-------------|-------|---------------|
| development orchestrator | Phase 1 | `codebase-analysis.md` (default) |
| migration orchestrator | Phase 1 | `current-state-analysis.md` |
| performance orchestrator | Phase 1 | `codebase-analysis.md` (default) |
