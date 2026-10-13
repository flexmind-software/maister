---
name: docs-manager
description: Internal engine for managing project documentation and technical standards in .maister/docs/. Handles file operations, INDEX.md generation, and AGENTS.md integration. Invoked by maister:init, standards-update, and standards-discover skills.
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

# Documentation Manager (Internal Engine)

Internal skill that manages documentation file operations in `.maister/docs/`. Not directly user-invocable — called by `maister:init`, `standards-update`, and `standards-discover` skills.

## Core Principles

- **Project documentation is source of truth** — plugin-bundled docs are baseline/reference only
- **INDEX.md is the master map** — always kept up-to-date after changes
- **AGENTS.md integration is mandatory** — ensures AI reads documentation

## Documentation Structure

```
.maister/docs/
├── INDEX.md                      # Master index - READ THIS FIRST
├── project/                      # Project-level documentation (generated by maister:init, not copied from templates)
│   ├── vision.md                # Project vision and goals
│   ├── roadmap.md               # Development roadmap
│   ├── tech-stack.md            # Technology choices and rationale
│   └── architecture.md          # System architecture (optional)
└── standards/                    # Technical standards and conventions
    ├── global/                  # Language-agnostic standards
    │   ├── error-handling.md
    │   ├── validation.md
    │   ├── conventions.md
    │   ├── coding-style.md
    │   └── commenting.md
    ├── frontend/                # Frontend-specific standards
    │   ├── css.md
    │   ├── components.md
    │   ├── accessibility.md
    │   └── responsive.md
    ├── backend/                 # Backend-specific standards
    │   ├── api.md
    │   ├── models.md
    │   ├── queries.md
    │   └── migrations.md
    └── testing/                 # Testing standards
        └── test-writing.md
```

## Standard File Conventions

Standard files follow the structure `standards/[category]/[topic].md`:
- **Category** = domain folder (global, frontend, backend, testing, or custom)
- **Topic file** = contains multiple related standards

**Format**: Each file uses `## Topic` as the file heading, with `### Standard Name` for each individual standard. Each standard has a 1-10 line description (excluding code snippets) and an optional brief code example (under 10 lines).

**Conciseness**: Standards are quick-reference conventions, not tutorials. If a file grows unwieldy, split into focused sub-topic files.

**Why ### per standard**: Each standard as a discrete section makes it easier for agents to find, update, and reference individually — no need to parse bullet lists.

---

## Bundled Resources

This skill bundles the following resources within the plugin:

- **Standards Directory**: Contains baseline technical standards organized by category:
  - `global/` - Global standards (error handling, validation, conventions, etc.)
  - `frontend/` - Frontend-specific standards (CSS, components, accessibility, etc.)
  - `backend/` - Backend-specific standards (API design, database, queries, etc.)
  - `testing/` - Testing standards (test writing, coverage, etc.)
- **INDEX.md Template**: Master template for documentation index

## Location Reference

- **Plugin bundles** (read-only baseline): This skill's `docs/` subdirectory within the plugin
- **Project documentation** (source of truth): `.maister/docs/` in the project root
- **Project configuration**: `AGENTS.md` in the project root

## Capabilities

### 1. Initialize Documentation in Project

Use this when a project doesn't have `.maister/docs/` or needs documentation for the first time. This is a **one-time baseline setup** that gives the project a starting point.

**IMPORTANT**: This operation accepts an optional `standards_selection` parameter (array of standard categories) to control which standards to initialize. If not provided, all standards are copied (backward compatible). It also accepts an optional `standards_source_path` parameter to copy standards from an external project instead of the bundled defaults.

**What to do:**
1. Check if `.maister/docs/` exists in the project root
2. If it exists, warn the user that initialization will overwrite existing documentation and ask for confirmation
3. Create the directory structure based on standards_selection:
   ```
   .maister/docs/
   ├── project/
   └── standards/
       ├── global/      (if 'global' in standards_selection or no selection provided)
       ├── frontend/    (if 'frontend' in standards_selection or no selection provided)
       ├── backend/     (if 'backend' in standards_selection or no selection provided)
       └── testing/     (if 'testing' in standards_selection or no selection provided)
   ```
4. Copy standards to the project's `.maister/docs/standards/` directory. **Source selection**: If `standards_source_path` is provided, copy from that external path. Otherwise, copy from this skill's bundled `docs/standards/` directory:
   - **Project documentation**: Do NOT copy project templates — only create the `project/` directory. Project documentation files (vision, roadmap, tech-stack, architecture) are generated by the calling skill (e.g., maister:init) using analyzer data, not copied as placeholder templates.
   - **Standards**: Only copy selected standard categories based on standards_selection parameter:
     - If `standards_selection` is empty or not provided: Copy ALL standards (backward compatible)
     - If `standards_selection` is provided: Only copy specified categories
     - Examples:
       - `['global', 'frontend', 'testing']` → Copy only these three categories
       - `['global', 'backend', 'testing']` → Skip frontend standards
       - `['global', 'testing']` → Only global and testing standards
5. Generate INDEX.md with entries for all copied documentation (see "Manage INDEX.md" operation):
   - For skipped standard categories, add placeholder sections with "Not initialized - run standards discovery if needed"
   - Example: If frontend standards are skipped, INDEX.md shows:
     ```markdown
     ### Frontend Standards

     *Not initialized for this project. If you need frontend standards, you can:*
     - *Add them manually using the docs-manager skill*
     - *Run `$maister:standards-discover --scope=frontend` to auto-discover*
     ```
6. **MANDATORY - Update AGENTS.md:**
   - Check if `AGENTS.md` exists in the project root; if not, ask the user if they want to create it
   - Add the documentation reference section (see "Manage AGENTS.md Integration" operation)
   - Ensure it emphasizes reading INDEX.md at the beginning of any task
7. Inform the caller about the documentation structure created

**Parameters:**
- `standards_selection` (optional, array of strings): Standard categories to initialize
  - Array of category names (e.g., `['global', 'frontend', 'backend', 'testing']`). Baseline categories: global, frontend, backend, testing. Custom categories are also supported.
  - If omitted or empty: Initialize all baseline standards (backward compatible)
  - If provided: Only initialize specified categories (creates directories for custom ones)
- `standards_source_path` (optional, string): Absolute path to an external standards directory (e.g., `/path/to/other-project/.maister/docs/standards/`)
  - If provided: Copy standards from this path instead of the bundled defaults
  - If omitted: Copy from this skill's bundled `docs/standards/` directory (default behavior)

**Result:** The project now has baseline documentation in `.maister/docs/`, a comprehensive INDEX.md, and AGENTS.md integration that ensures AI assistance is documentation-aware. Only selected standard categories are initialized.

**Important:** After this initial setup, the project's documentation becomes the source of truth. Teams should customize it for their specific needs.

**Note on Skipped Standards**: If standard categories are skipped during initialization, teams can add them later using:
- "Add Documentation File" operation to add specific standards
- `$maister:standards-discover` command to auto-discover standards from codebase

---

### 2. Manage INDEX.md

Use this to create or update the INDEX.md file that serves as the master documentation map.

**What to do:**
1. Scan the `.maister/docs/` directory structure
2. For each documentation file found:
   - Read the file content to extract description
   - Determine the file's purpose and category
   - **For technical standards**: The description MUST enumerate the specific practices/conventions documented in the file, not just a generic category description.
3. Read `references/index-md-template.md` for the INDEX.md structure template
4. Generate INDEX.md by populating the template with discovered files and descriptions
5. Write the generated INDEX.md to `.maister/docs/INDEX.md`
6. Verify that AGENTS.md references this index (see "Manage AGENTS.md Integration" operation)

**Result:** A comprehensive, up-to-date INDEX.md that provides a clear map of all project documentation.

---

### 3. Add Documentation File

Use this to add new documentation to the project, either from plugin baseline or custom.

**What to do:**
1. Determine the type of documentation to add:
   - Project documentation (vision, roadmap, tech-stack, architecture, custom)
   - Technical standard (any category under standards/)
2. If adding from plugin baseline:
   - Check if the requested documentation exists in this skill's bundled `docs/` directory
   - Copy it to the appropriate location in `.maister/docs/`
3. If creating custom documentation:
   - Ask for the category (project/ or standards/category/)
   - Ask for the filename and purpose
   - Create a template file with appropriate frontmatter and structure
4. Update INDEX.md to include the new documentation (see "Manage INDEX.md" operation)
5. If this is a technical standard and corresponds to a Codex Skill, ensure consistency

**Result:** New documentation is added to the project and indexed in INDEX.md.

---

### 4. Update Documentation

Use this to help the user update or modify existing project documentation.

**What to do:**
1. Accept the documentation identifier from the user (e.g., "project/vision", "standards/global/error-handling")
2. Check if the documentation exists in `.maister/docs/`
3. If the documentation exists:
   - Read the current documentation
   - Ask the user what they want to change or update
   - Help them edit the documentation file directly
   - Optionally, show them the plugin's baseline version for reference if they ask
4. If the documentation doesn't exist:
   - Offer to add it from the plugin baseline (see "Add Documentation File" operation)
   - Or offer to help them create custom documentation from scratch
5. After updating:
   - Check if INDEX.md needs updating (if the purpose/description changed significantly)
   - If updating tech-stack.md or architecture.md, suggest reviewing AGENTS.md for consistency
6. For technical standards:
   - If a corresponding Codex Skill exists, suggest reviewing it for consistency
   - Standards should align with actual code patterns in the project

**Result:** Documentation is updated to reflect current project state and team decisions.

---

### 5. Use Plugin Documentation as Reference

Use this when a team wants to see the plugin's baseline documentation for reference, or reset specific docs to plugin defaults.

**What to do:**
1. Compare the documentation in this skill's bundled `docs/` directory with the project's `.maister/docs/` directory to identify differences
2. Show the user which documents differ and how they differ
3. Explain that plugin documentation is baseline/reference only, and project documentation is superior
4. **WARNING**: Copying plugin documentation to the project will overwrite any project-specific customizations
5. Ask the user if they want to:
   - View the differences for reference only (no changes)
   - Reset specific documentation to plugin baseline (selective overwrite)
   - Reset all documentation to plugin baseline (full overwrite - rarely recommended)
6. If the user chooses to copy any documentation:
   - Copy the selected files from this skill's bundled `docs/` directory to the project's `.maister/docs/` directory
   - Update INDEX.md to reflect any changes
   - Review AGENTS.md for any necessary updates

**Important:** This operation should be used rarely, mainly when a team wants to reset to baseline. Project documentation is the source of truth and should be maintained by the team.

**Result:** User can reference plugin baseline documentation and optionally reset specific docs to plugin versions.

---

### 6. List Available Documentation

Use this to show what documentation is bundled with this plugin and their installation status in the project.

**What to do:**
1. List all documentation in this skill's bundled `docs/` directory, organized by category
2. For each bundled document:
   - Show the category and name
   - Check if it exists in the project at `.maister/docs/[category]/[name].md`
   - Show installation status (bundled only, installed, or customized)
   - If installed, show whether it differs from the baseline (customized)
3. Show whether INDEX.md exists and is up-to-date
4. Show whether AGENTS.md has documentation integration
5. Remind the user that plugin documentation is baseline/reference only, and project documentation (if installed) is the source of truth

**Result:** The user sees a complete inventory of available baseline documentation and their installation status in the current project.

---

### 7. Manage AGENTS.md Integration

Use this to ensure the project's AGENTS.md properly integrates with the documentation system, encouraging AI to read and use the documentation.

**What to do:**
1. Check if `AGENTS.md` exists in the project root
2. If it doesn't exist, ask the user if they want to create it
3. Look for a documentation reference section in AGENTS.md
4. If the section doesn't exist or is incomplete:
   - Read `references/agents-md-template.md` for the template
   - Add the template section to AGENTS.md
5. Ensure the documentation section is placed prominently in AGENTS.md (near the top)
6. Verify that the INDEX.md path is correct and the file exists
7. If `.maister/docs/` doesn't exist, suggest running the initialization operation first

**Result:** AGENTS.md properly integrates with the documentation system, ensuring AI assistance is documentation-aware and follows team conventions.

---

### 8. Validate Documentation Consistency

Use this to check that documentation is consistent, up-to-date, and properly integrated.

**What to do:**
1. **Check structure:**
   - Verify `.maister/docs/` directory exists
   - Verify all expected subdirectories exist (project/, standards/global/, etc.)
2. **Check INDEX.md:**
   - Verify it exists and is readable
   - Check that all files in `.maister/docs/` are listed in INDEX.md
   - Check that all files listed in INDEX.md actually exist
   - Report any orphaned files or broken references
3. **Check AGENTS.md integration:**
   - Verify AGENTS.md exists
   - Verify it contains documentation reference section
   - Verify it uses valid file reference format: @.maister/docs/INDEX.md (with @ prefix, without backticks)
   - Warn if using incorrect formats like `.maister/docs/INDEX.md` or `@.maister/docs/INDEX.md` (backticks)
4. **Check project documentation:**
   - Verify critical files exist (vision.md, tech-stack.md)
   - Check if they contain placeholder text vs. actual project information
   - Warn if critical documentation is missing or empty
5. **Check standards consistency:**
   - If Codex Skills exist, check if corresponding standards documentation exists
   - If standards exist without skills, suggest creating skills (if appropriate)
   - Report any inconsistencies
6. **Generate validation report:**
   - Summary of documentation status
   - List of issues found
   - Recommendations for fixes
7. **Offer to fix issues:**
   - Ask if the user wants to automatically fix found issues
   - Fix missing INDEX.md entries
   - Fix missing AGENTS.md integration
   - Create missing directory structure

**Result:** A comprehensive validation report with optional automatic fixes for common issues.

---

## Usage Examples

**Initialize documentation in a new project:**
```
User: "Set up documentation for this project"
Claude: [Executes Initialize Documentation - creates structure, copies baseline docs, generates INDEX.md, updates AGENTS.md, gathers project info]
```

**Update project vision:**
```
User: "I want to update our project vision to include AI-first approach"
Claude: [Executes Update Documentation - reads current vision.md, helps user edit it, updates INDEX.md if needed]
```

**Add custom documentation:**
```
User: "Add documentation for our deployment process"
Claude: [Executes Add Documentation File - creates custom project/deployment.md, updates INDEX.md]
```

**Reference plugin baseline:**
```
User: "Show me the plugin's baseline error handling standard"
Claude: [Executes Use Plugin Documentation as Reference - shows plugin baseline, compares with project version, no changes unless user requests]
```

**Validate documentation:**
```
User: "Check if our documentation is complete and consistent"
Claude: [Executes Validate Documentation Consistency - checks structure, INDEX.md, AGENTS.md integration, generates report]
```

**Manage INDEX.md:**
```
User: "Rebuild the documentation index"
Claude: [Executes Manage INDEX.md - scans .maister/docs/, regenerates comprehensive INDEX.md]
```

---

## Important Notes

- **Project documentation is source of truth** — plugin-bundled docs are baseline/reference only
- **INDEX.md must stay current** — regenerate after any documentation change
- **AGENTS.md integration is mandatory** — ensures AI reads documentation at task start
- **This skill is an internal engine** — called by maister:init, standards-update, and standards-discover. Not directly user-invocable.
- **CRITICAL: Return control after completion** — This is an internal sub-skill. After completing the requested operation, return control to the calling workflow. Do NOT treat completion of this skill as the end of the conversation turn — the parent skill has more steps to execute.
