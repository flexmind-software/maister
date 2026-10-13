# Repository Recon

## Map

Maister is a plugin repository whose canonical implementation lives in
`plugins/maister/`. It contains Claude Code commands, skills, agents, hooks,
and MCP configuration. `plugins/maister-copilot/` and `plugins/maister-codex/`
are generated adaptations. The Codex adapter lives in `platforms/codex/runtime/`
and keeps persistent task IDs in each task's `codex-tasks.json`.

## Commands

- `make build` — regenerate `plugins/maister-copilot/` from `plugins/maister/`.
- `make validate` — validate generated Copilot names, references, paths, and
  platform substitutions.
- `make clean` — remove the generated Copilot directory.
- `make build-codex` — regenerate `plugins/maister-codex/` from shared sources
  and the Codex execution adapter.
- `make test-codex` — run offline Codex build, runtime, and harness tests.

## Flow traced

`make build-codex` → `platforms/codex/build.py` → reads `plugins/maister/`
source skills and `platforms/codex/runtime/platform.md` → emits translated
skills, agent prompts, manifests, and `runtime/tasks.py` into
`plugins/maister-codex/` → `make test-codex` checks generated coverage and
task-registry behavior.

## Conventions

- Edit canonical files under `plugins/maister/`; generated variants are not
  edited directly.
- Keep platform transformations in a build script or platform adapter.
- Skills use `SKILL.md` with YAML frontmatter and optional `references/`.
- Plugin metadata is stored in `plugins/maister/plugin.json` and the Claude
  manifest at `plugins/maister/.claude-plugin/plugin.json`.
- Validation is shell/Make based and should cover generated output.

## Open questions

- Live model-driven Codex parity, including a complete development Phase 11
  resume after compaction, remains unverified by the offline suite.
