# Codex CLI acceptance status

The Codex package is generated from `plugins/maister/`. The source plugin remains
the workflow authority. A generated file should be changed through its source or
`platforms/codex/build.py`, then rebuilt with `make build-codex`.

## Verified locally

- The generator covers the current source skills, commands, agents and assets.
- Offline tests exercise generated entry points, task registry operations, hook
  protocol responses and the bounded acceptance harness (`make test-codex`).
- An isolated Codex CLI installation discovers all 23 public entry points
  (`python3 platforms/codex/tests/smoke_runtime.py`).
- The existing Copilot variant passes `make validate`.

## Still requiring runtime evidence

Skill discovery does not prove that a model follows the workflows. Before calling
this a parity release, run the scenarios in `platforms/codex/tests/README.md`
against a supported Codex CLI and retain the reports. In particular, verify
mandatory user decisions, standards application, red/green tests, task resume,
parallel delegation, hook trust and interception, visual previews, and browser
E2E. The current automated live harness covers only `quick-plan-gate` and
`quick-dev-standards`; both require an explicit model and `OPENAI_API_KEY` in an
isolated test environment. No live result is implied by offline tests.

The command guard is a lexical safeguard and only runs when the user trusts the
plugin hook. Codex sandboxing and permission controls remain necessary.
