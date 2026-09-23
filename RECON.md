# Repository Recon

## Map

Maister is a plugin repository whose canonical implementation lives in
`plugins/maister/`. It contains Claude Code commands, skills, agents, hooks,
and MCP configuration. `plugins/maister-copilot/` is a generated adaptation
produced by `platforms/copilot-cli/build.sh`; the repository currently targets
Claude Code and GitHub Copilot CLI, with no Codex manifest or Codex-specific
build target.

## Commands

- `make build` — regenerate `plugins/maister-copilot/` from `plugins/maister/`.
- `make validate` — validate generated Copilot names, references, paths, and
  platform substitutions.
- `make clean` — remove the generated Copilot directory.

## Flow traced

`make build` → `platforms/copilot-cli/build.sh` → copies `plugins/maister/` to
`plugins/maister-copilot/` → rewrites plugin metadata, command/skill names,
`maister:` references, user-question syntax, project-instruction paths, and
plugin-root variables → writes Copilot installation notes.

## Conventions

- Edit canonical files under `plugins/maister/`; generated variants are not
  edited directly.
- Keep platform transformations in a build script.
- Skills use `SKILL.md` with YAML frontmatter and optional `references/`.
- Plugin metadata is currently stored in `.claude-plugin/plugin.json`.
- Validation is shell/Make based and should cover generated output.

## Open questions

- Codex needs a portable/root `plugin.json` or `.codex-plugin/plugin.json` and
  consumes skills, but does not use Claude slash-command registration.
- The common artifact should preserve Copilot compatibility while exposing a
  Codex-compatible skill-only surface; Claude remains the canonical source.
