# Maister for Codex

This package is generated from `plugins/maister/`. Use the `$maister:<operation>`
skills to start workflows. Read the complete selected `SKILL.md`, including its
Codex execution adapter, before acting. Load internal skills in the parent
context and dispatch source agent roles through native subagents as the adapter
directs.

Keep workflow state and the persistent task registry in the project's
`.maister/tasks/` folder. Reload them when resuming. At each mandatory decision,
ask the user and wait for an explicit answer; file-edit permission does not
approve a workflow decision. Preserve standards checks and verification evidence.

The package's `hooks/hooks.json` uses `hooks/guard.py` for session reminders and
the command guard. Hooks require trust in Codex before they run. The guard is an
additional lexical safeguard, not a replacement for Codex sandboxing.

When changing this package, edit the source plugin or `platforms/codex/`, run
`make build-codex` and `make test-codex`, and review `docs/codex-parity.md`.
