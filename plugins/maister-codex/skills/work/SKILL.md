---
name: work
description: Unified entry point — auto-classifies tasks and routes to appropriate workflow. ALWAYS execute when invoked via slash command.
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

**NOTE**: This is a multi-step workflow that invokes the task-classifier subagent and orchestrator skills at specific steps. The `<command-name>` tag refers to THIS command only — you MUST still use the Load Maister skill to invoke those other skills when instructed below. Follow ALL steps in order.

# Unified Work Entry Point

Auto-classifies tasks and routes to the appropriate workflow orchestrator. Supports resuming existing tasks or starting new ones.

## Usage

```bash
/work [task description | task folder path | issue identifier]
```

### Input Types

| Input Type | Example |
|------------|---------|
| Task folder path | `.maister/tasks/development/2025-10-23-login-timeout` |
| Folder name only | `2025-10-26-user-auth` (searches all task types) |
| Task description | `"Fix login timeout error on mobile"` |
| GitHub issue | `#456`, `GH-456`, `https://github.com/owner/repo/issues/456` |
| Jira ticket | `PROJ-456`, `https://company.atlassian.net/browse/PROJ-456` |
| Azure DevOps | `AB#123`, `https://dev.azure.com/org/project/_workitems/edit/123` |
| No argument | Prompts for input |

## Examples

```bash
# Resume existing task
/work ".maister/tasks/development/2025-10-23-login-timeout"
/work "2025-10-26-user-auth"

# New task (auto-classifies)
/work "Fix login timeout error on mobile devices"
/work "Add user authentication with email/password"
/work "Improve dashboard loading performance"

# From issue tracker
/work "#456"
/work "PROJ-123"
/work "AB#789"
```

## How It Works

1. **Detect existing task** - If input is a task folder path, route to resume
2. **Classify new task** - Invoke task-classifier subagent to determine workflow type
3. **Route to workflow** - Use Load Maister skill to invoke appropriate orchestrator skill

## Workflow Type Routing

| Classification | Routes To (Skill) |
|----------------|-------------------|
| development | `maister:development` |
| performance | `maister:performance` |
| migration | `maister:migration` |
| research | `maister:research` |
| product-design | `maister:product-design` |

---

## Workflow

### Step 1: Parse Input and Detect Task Folder

**Check if input is an existing task folder:**

1. Try path as-is (absolute path)
2. Try prepending `.maister/` (relative path)
3. Search `.maister/tasks/*/` for folder name match

**If folder exists AND contains `orchestrator-state.yml`:**
- Go to **Step 2: Resume Existing Task**

**If NOT a task folder:**
- Go to **Step 3: Classify & Route New Task**

**If no argument provided:**
- Prompt user: "What would you like to work on?" with input examples
- Then check if input is task folder or description

### Step 2: Resume Existing Task

**When existing task detected:**

1. Read `orchestrator-state.yml` from task folder
2. Determine workflow type from folder path:

| Folder | Workflow Type |
|--------|--------------|
| `development/` | development |
| `performance/` | performance |
| `migrations/` | migration |
| `research/` | research |
| `product-design/` | product-design |

3. Extract status from state file:
   - `completed`: null = in-progress, timestamp = finished
   - `completed_phases`: derive active phase as first phase not in this list
   - `failed_phases`: array of failed attempts

4. Present status to user with Maister user decision:

**For In-Progress Tasks:**
```
Options:
1. Resume from next incomplete phase
2. Restart from specific phase
3. Cancel
```

**For Completed Tasks:**
```
Options:
1. View task details
2. Create follow-up development task
3. Re-run verification phase
4. Cancel
```

**For Failed Tasks:**
```
Options:
1. Resume with fresh attempts (--reset-attempts --clear-failures)
2. Retry failed phase
3. Restart from specific phase
4. Cancel
```

5. **Route using Load Maister skill:**

```
Use Load Maister skill:
  skill: "maister:[orchestrator-name]"
  args: "--resume [task_path] [flags]"
```

Examples:
- Resume development: `skill: "maister:development"` with `args: "--resume .maister/tasks/development/2025-10-23-fix"`
- Restart from phase: `skill: "maister:development"` with `args: "--resume .maister/tasks/development/2025-10-26-auth --from=verify"`
- Fresh attempts: `skill: "maister:migration"` with `args: "--resume .maister/tasks/migrations/2025-10-20-redux --reset-attempts"`

### Step 3: Classify & Route New Task

**For new task descriptions:**

1. **Invoke task-classifier subagent** to determine workflow type:

```
Use Dispatch Maister agent:
  subagent_type: "maister:task-classifier"
  description: "Classify task type"
  prompt: "Classify this task into a workflow type: [task description].
           Return structured YAML classification result."

The subagent will:
- Detect issue identifiers (GitHub, Jira)
- Fetch issue details if available
- Analyze codebase context
- Match keywords and calculate confidence
- Confirm with user if needed
- Return classification in YAML format
```

2. **Parse classification result:**
```yaml
classification:
  task_type: [development|performance|migration|research|product-design]
  confidence: [percentage]
  reasoning: [explanation]
```

3. **Route to appropriate workflow using Load Maister skill:**

```
Display:
  Task classified as: [task_type] ([confidence]% confidence)
  Routing to [task_type] workflow...

Use Load Maister skill:
  skill: "maister:[orchestrator-name]"
  args: "[description]"
```

**Routing examples:**
- development (92%): `skill: "maister:development"` with `args: "Fix login timeout error"`
- development (88%): `skill: "maister:development"` with `args: "Add filtering to user table"`
- performance (95%): `skill: "maister:performance"` with `args: "Optimize slow dashboard queries"`

---

## Error Handling

### Classification Fails

If task-classifier returns error:
```
Display:
"Unable to automatically classify this task. Please select manually:"

Use Maister user decision with options:
1. Development - Fix bugs, improve features, or add new capabilities
2. Performance - Optimize speed/efficiency
3. Migration - Move to new tech/pattern
4. Research - Investigate and document findings
5. Product Design - Design features or products before building them

Then route to selected workflow using Load Maister skill.
```

### User Cancels

```
Display:
"Task cancelled. You can:
- Run /work again when ready
- Use specific workflow commands directly:
  $maister:development, $maister:performance, etc."
```

---

## Resume Skill Reference

| Workflow Type | Skill | Args |
|---------------|-------|------|
| development | `maister:development` | `--resume [path] [--from=PHASE] [--reset-attempts]` |
| performance | `maister:performance` | `--resume [path] [--from=PHASE]` |
| migration | `maister:migration` | `--resume [path] [--from=PHASE]` |
| research | `maister:research` | `--resume [path] [--from=PHASE]` |
| product-design | `maister:product-design` | `--resume [path] [--from=PHASE]` |

---

## Integration Notes

### With Task Classifier

The `/work` command delegates classification to the task-classifier subagent via Dispatch Maister agent, which:
- Fetches issue details from GitHub/Jira/Azure DevOps (via MCP, CLI tools, or WebFetch)
- Analyzes codebase context for better classification
- Uses confidence-based user confirmation
- Returns structured classification result

### With Orchestrators

After classification/detection, this command routes to the appropriate orchestrator via Load Maister skill:
- Each orchestrator handles its specific workflow (spec, plan, implement, verify, etc.)
- State is persisted in `orchestrator-state.yml` for pause/resume
- Auto-recovery handles common failures

### With Project Documentation

Uses project documentation for context:
- `.maister/docs/INDEX.md` - Project overview and standards
- `.maister/tasks/` - Existing task directories

---

## Key Behaviors

1. **Single entry point** - One command for all workflow types
2. **Auto-classification** - Intelligent routing based on task description
3. **Resume support** - Detects and resumes existing tasks
4. **Issue integration** - Fetches details from GitHub/Jira/Azure DevOps
5. **Direct skill invocation** - Uses Load Maister skill for immediate orchestrator loading
6. **Graceful fallback** - Manual selection if classification fails
