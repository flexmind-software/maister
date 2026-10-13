# Codex CLI acceptance tests

Scope: Codex CLI only. App-server integration is not interactive-terminal or
desktop UI verification. No automatic approval of unknown server requests.

## Offline tests

From the repository root, run `make test-codex`. These tests validate the harness,
fixtures and acceptance assertions without consuming model tokens. They do not
establish model-driven parity. The Python fixture baseline passes but intentionally
contains an untested divide defect for future TDD scenarios.

## Live tests

Build first with `make build-codex`. By default, provide an API key through the
environment. To use the current Codex ChatGPT login, pass `--auth chatgpt`:
the runner copies `auth.json` into its temporary home with restricted file
permissions and removes that copy when the run ends. It does not write token
values to evidence. Choose a model supported by your account explicitly. The timeout bounds each
protocol request/turn, but is not a dollar/token budget. Live tests consume tokens.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 platforms/codex/tests/live_acceptance.py \
  --codex /absolute/path/to/codex \
  --scenario quick-plan-gate \
  --model "$MAISTER_TEST_MODEL" \
  --evidence /tmp/maister-quick-plan-run \
  --timeout 180
```

For a logged-in Codex CLI session, use `--auth chatgpt --scenario session-resume`
with the same remaining arguments. `codex login status` should report
`Logged in using ChatGPT` before the run.

Use `--scenario quick-dev-standards` for direct implementation. The evidence
directory must be new: it retains the disposable workspace, protocol events,
stderr and report.json. The runner installs into a temporary CODEX_HOME without
modifying personal settings. Evidence may contain model output and fixture
source; review it before sharing. Credential values are never intentionally logged.

Use `--scenario session-resume` to run a real two-process Codex app-server
restart. It resumes the same thread, completes a second turn, and verifies that
the persisted Maister task ID is unchanged. This checks session transport and
registry persistence; a full Phase 11 recovery with live fix batches still
requires separate workflow acceptance evidence.

Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED. Reports start NOT RUN and record Codex/model,
source commit and surface. No live run happens in regular unit-test discovery.

## Implemented scenarios

- **quick-plan-gate:** existing fixture remains unchanged; no new Python code;
  plan includes applicable standards and compliance checklist; explicit approval
  request. No approval is sent. Structured-input requests are recorded and left
  unanswered; unexpected requests fail closed.
- **quick-dev-standards:** multiply exists, has sentinel docstring and return
  annotation, passes independent behavior checks and the full fixture unittest
  suite, and has new regression coverage.
- **session-resume:** one thread survives app-server restart, accepts another
  turn, and retains the same `codex-tasks.json` task ID.

These tests do not yet prove standard files were read in trace order, plan
approval continuation, TDD red/green ordering, or runtime hook execution.

## Remaining executable scenarios

1. Structured decision scripts validating question IDs/options; approval/reject
   branches and no phase completion before response.
2. Quick-bugfix with observed red/green command results and unrelated regression.
3. Parallel dispatch, overlapping-file exclusion, dependencies, partial failure.
4. Full development Phase 11 resume and explicit compaction with preserved
   issue ledger, checkpoint, and registry IDs.
5. All five full workflows, init, standards operations, routing and review roles.
6. Trusted/untrusted hook runtime interception on disposable sentinel files.
7. Node HTML preview, HTML-off, ASCII fallback, Playwright E2E and screenshots.
8. Separate interactive-terminal acceptance for question UX and session recovery.

Use real runtime traces and independent file/test assertions. A model saying
"done", copied role instructions or successful package installation is not proof.
