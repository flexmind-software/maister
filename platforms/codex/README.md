# Maister for Codex CLI

This variant is generated from `plugins/maister/`. Never edit generated files.
Full functional parity is the acceptance requirement; see `docs/codex-parity.md`.
This is currently a development port, not a verified parity release.

## Prerequisites

- Codex CLI installed and authenticated (`codex login`). The CLI must support
  plugins, subagents and lifecycle hooks.
- Python 3.9 or newer, available as `python3`, for hooks and persistent task tracking.
- Node.js 20 or newer and `npx` for HTML mockups and the bundled Playwright MCP
  server. HTML mockups can fall back to ASCII without Node; browser E2E cannot.
- Git for installation from a repository; `make` for rebuilding a local checkout.

Installation and skill discovery have been tested with Codex CLI `0.162.1`.
This is a tested version, not a claimed minimum version.
If `codex plugin --help` is unavailable, use a CLI release with plugin support.

Normal interactive use can use your existing Codex authentication. The isolated
live acceptance runner currently requires `OPENAI_API_KEY`; that is a test-runner
requirement, not an additional requirement for installing Maister.

## Installation

### From the repository

Run these commands in your terminal, not in the Codex chat:

```bash
codex plugin marketplace add SkillPanel/maister
codex plugin add maister@maister-local
codex plugin list --marketplace maister-local
```

Use these commands after this change reaches the repository's default branch.
Until then, install from the local checkout below.

### From a local checkout

From a checkout containing the Codex variant, run:

```bash
make build-codex
make test-codex
codex plugin marketplace add .
codex plugin add maister@maister-local
```

The marketplace root is the repository root, not `plugins/maister-codex/`.

### Review hooks and start a new session

Review and trust the bundled hooks using your CLI's hook trust controls before
running workflows. Installing/enabling the plugin does not automatically trust
its hooks. Do not disable sandboxing or bypass hook trust as a workaround.

Start Codex in the project you want to work on, not in the plugin checkout:

```bash
cd /absolute/path/to/your-project
codex
```

Verify that the plugin is enabled in `/plugins`. Type `$` to inspect available
skills, or use the explicit names below. Restart Codex after installing or
refreshing the package if the skills do not appear.

The public plugin name is `maister`, and operation names match Claude Code.
Use Codex's native `$maister:<operation>` syntax instead of Claude Code's
`/maister:<operation>`. No command wrapper or custom slash-command layer is needed.
The `plugins/maister-codex/` directory and `maister-local` marketplace
are packaging details, not prefixes for workflow commands.

## Initial project setup

Enter this in the Codex chat:

```text
$maister:init
```

The init workflow is intended to discover standards and create `.maister/docs/`,
`.maister/tasks/` and an `AGENTS.md` documentation integration. Review its findings
and answer its questions. To reuse another project's standards:

```text
$maister:init --standards-from=/absolute/path/to/other-project
```

## First workflow

Use the unified entry point to classify and route a task:

```text
$maister:work Add a user profile page with avatar upload
```

Or select the workflow directly:

```text
$maister:development Add a user profile page with avatar upload
$maister:development Fix login timeout --type=bug
```

These are chat instructions, not shell commands: do not paste them into a shell,
where `$` would be interpreted as variable expansion. Claude Code's
`/maister:development` syntax is not the Codex plugin entry point.

At each mandatory gate, review the artifacts and explicitly approve, revise or
stop. Permission to edit files does not approve workflow decisions. If structured
questions are unavailable, the adapter asks in text and waits for your reply.

## Available workflows and utilities

All entries below are explicit chat skills. Arguments follow the corresponding
Maister command; internal machinery is loaded by workflows rather than selected
as a standalone entry point.

| Skill | Use when |
|---|---|
| `$maister:work` | Classify a task or route an existing task folder |
| `$maister:development` | Features, enhancements and bug fixes |
| `$maister:performance` | Analyze and optimize bottlenecks |
| `$maister:migration` | Plan and execute technology or data migrations |
| `$maister:research` | Gather evidence, synthesize findings and design solutions |
| `$maister:product-design` | Explore, converge and prototype product ideas |
| `$maister:mockup-studio` | Generate mockups for a screen or feature |
| `$maister:quick-plan` | Prepare a standards-aware plan before implementation |
| `$maister:quick-dev` | Implement a clear, small task with standards |
| `$maister:quick-bugfix` | Fix a small bug with TDD red/green verification |
| `$maister:init` | Initialize project documentation and standards |
| `$maister:standards-discover` | Discover conventions from the project |
| `$maister:standards-update` | Add, refine or import standards |
| `$maister:reviews-code` | Review quality, security and performance |
| `$maister:reviews-pragmatic` | Detect over-engineering |
| `$maister:reviews-spec-audit` | Audit a specification |
| `$maister:reviews-reality-check` | Check whether the work solves the problem |
| `$maister:reviews-production-readiness` | Assess deployment readiness |

Examples:

```text
$maister:quick-bugfix Fix division returning a product
$maister:reviews-code src/ --scope=security
$maister:standards-discover --scope=quick
$maister:development Add checkout --e2e --user-docs --code-review
```

## Resume and chain workflows

Pass the actual task folder created by your workflow:

```text
$maister:development .maister/tasks/development/2026-10-11-user-profile
$maister:work .maister/tasks/development/2026-10-11-user-profile
$maister:development .maister/tasks/research/2026-10-11-auth-research
$maister:development .maister/tasks/product-design/2026-10-11-dashboard Implement only phase 1
```

Keep `orchestrator-state.yml`, `codex-tasks.json`, the plan and work log together.
Do not remove the task registry or manually mark a gated phase as completed to
force progress. Start a fresh session when handing research/design to development.

## Updating and uninstalling

### Migrating from the previous plugin name

If you installed the fork's earlier `maister-codex` plugin, remove it before
installing `maister` to avoid duplicate entry points:

```bash
codex plugin remove maister-codex@maister-codex-plugins
codex plugin add maister@maister-local
```

Replace previous `$maister-codex:maister-<operation>` invocations with
`$maister:<operation>`. Project `.maister/` state and artifacts are unchanged;
do not delete them during migration. Restart Codex and review hook trust again.

### Refreshing the current installation

For a Git marketplace, refresh the branch snapshot:

```bash
codex plugin marketplace upgrade maister-local
```

For a local checkout, pull the branch and run `make build-codex` and
`make test-codex` again. To explicitly replace the cached installation after
either method:

```bash
codex plugin remove maister@maister-local
codex plugin add maister@maister-local
```

Restart Codex, inspect the installed plugin and review hook trust again if its
definition changed. Rebuilding source alone does not refresh the cached package.
To uninstall, use the remove command above; keep project `.maister/` artifacts
unless you deliberately want to discard your workflow history.

## Troubleshooting

- **Marketplace/plugin not found:** check `codex plugin marketplace list`, that
  the checkout contains `plugins/maister-codex/`, and the selector
  `maister@maister-local`.
- **Skill not found:** confirm the plugin is enabled, restart the session and use
  the full `$maister:...` name.
- **Hooks do not run:** check Python availability and the CLI's trust status. Do
  not assume that a successful installation enabled the command guard.
- **Workflow pauses:** answer the pending question explicitly; do not treat a
  mandatory gate as a stalled process or ask the model to skip all questions.
- **HTML/Playwright unavailable:** verify Node 20+, `npx` and the bundled MCP
  connection. ASCII fallback does not replace browser verification.
- **Delegation unavailable:** use a CLI configuration supporting subagents; the
  adapter must report the missing capability rather than silently work inline.

## Plugin development

```bash
make build-codex
make test-codex
```

Requires Python 3.9 or newer for generation, hooks and persistent task tracking.
The existing HTML preview requires Node.js 20 or newer; ASCII fallback is retained.
Codex must support plugins, subagents and lifecycle hooks. Hook execution also
requires explicit trust review; installing a plugin does not trust its hooks.

## Execution adapter

Public workflows include their execution adapter; internal
skills are loaded in the parent context. Source agent roles dispatch through
native subagents with complete role instructions; their TOML files are optional
custom-agent configurations, not automatically registered by the plugin.

For parser/installation tests, use a temporary CODEX_HOME, never the user's
personal configuration. Actual workflow acceptance requires model-driven tests
with interactive decisions; non-interactive execution must stop at gates.

## Development limitations

Coverage and adapter unit tests do not establish functional parity. Outstanding
work includes model-driven validation of all workflows, task/phase resumption,
parallel dispatch, decisions, hook trust and visual/E2E functionality. The lexical
command guard is defense-in-depth, not a complete shell security boundary.
