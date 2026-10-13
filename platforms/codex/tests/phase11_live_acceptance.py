#!/usr/bin/env python3
"""Live, disposable Phase 11 handoff probe with independent state assertions."""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from harness import Client, UnexpectedDecision, prepare_fixture, run_tests


ROOT = Path(__file__).resolve().parents[3]
FIXTURE = Path(__file__).parent / 'fixtures/python-project'
TASK = '.maister/tasks/development/2026-10-13-phase11-acceptance'


def fixture(workspace):
    task = workspace / TASK
    (workspace / '.maister').mkdir(exist_ok=True)
    (workspace / '.maister/config.yml').write_text('html_output: false\n')
    task.mkdir(parents=True)
    (task / 'implementation').mkdir()
    (task / 'verification').mkdir()
    (task / 'implementation/spec.md').write_text(
        '# Arithmetic acceptance specification\n\n'
        'Each public case function accepts an integer and returns that integer '
        'plus the number in its name. Preserve all twelve functions.\n\n' +
        '\n'.join(f'- REQ-{n:03d}: `case_{n:02d}(x)` returns `x + {n}`.'
                  for n in range(1, 13)) + '\n')
    (task / 'implementation/implementation-plan.md').write_text(
        '# Implementation plan\n\n'
        '- B-001: Correct REQ-001 through REQ-005 in `calculator.py`; run '
        '`test_case_01` through `test_case_05`; checkpoint.\n'
        '- B-002: After session resume, correct REQ-006 through REQ-012; '
        'run targeted tests and the complete suite; update the canonical report.\n'
        '- Preserve every V-issue ID and every Codex task ID.\n')
    (task / 'implementation/work-log.md').write_text('# Work log\n')
    names = [f'V-{n:03d}' for n in range(1, 13)]
    (workspace / 'calculator.py').write_text(
        '"""Twelve independent arithmetic defects for Phase 11 acceptance."""\n\n' +
        '\n\n'.join(f'def case_{n:02d}(value):\n    return value  # should add {n}'
                    for n in range(1, 13)) + '\n')
    (workspace / 'tests/test_calculator.py').write_text(
        'import unittest\nimport calculator\n\n\nclass AcceptanceTests(unittest.TestCase):\n' +
        '\n'.join(f'    def test_case_{n:02d}(self):\n'
                  f'        self.assertEqual(calculator.case_{n:02d}(10), {10+n})\n'
                  for n in range(1, 13)))
    report = '# Implementation verification: failed\n\n'
    report += '\n'.join(f'- {issue}: case_{n:02d} returns wrong result; '
                        f'calculator.py, test_case_{n:02d} fails.'
                        for n, issue in enumerate(names, 1)) + '\n'
    (task / 'verification/implementation-verification.md').write_text(report)
    subprocess.run(['git', 'add', '.'], cwd=workspace, check=True)
    subprocess.run(['git', '-c', 'user.name=Maister Acceptance',
                    '-c', 'user.email=acceptance@example.invalid', 'commit', '-qm',
                    'Seed Phase 11 acceptance fixture'], cwd=workspace, check=True)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=workspace,
                                   text=True).strip()
    state = {
        'orchestrator': {
            'started_phase': 11, 'completed_phases': list(range(1, 11)),
            'failed_phases': [], 'auto_fix_attempts': {},
            'options': {'html_output': False, 'e2e_enabled': False,
                        'user_docs_enabled': False, 'skip_test_suite': False},
            'task_path': TASK,
            'task_ids': {},
        },
        'task': {'title': 'Phase 11 acceptance', 'status': 'in_progress',
                 'description': 'Correct twelve independent arithmetic cases.'},
        'task_context': {'task_characteristics': {'has_reproducible_defect': False,
                          'ui_heavy': False}, 'phase_summaries': {}},
        'verification_context': {
            'last_status': 'failed', 'issues_found': names, 'fixes_applied': [],
            'decisions_made': [{'decision': 'Fix all twelve issues in two batches',
                                'source': 'acceptance fixture'}],
            'reverify_count': 0, 'cycle': 1, 'verification_cycles': 1,
            'max_verification_cycles': 20, 'max_failed_attempts_per_issue': 3,
            'issues': [{'id': issue, 'title': f'case_{n:02d} wrong result',
                        'severity': 'critical', 'status': 'open', 'attempts': 0,
                        'evidence': ['verification/implementation-verification.md'],
                        'related_tests': [f'tests/test_calculator.py::test_case_{n:02d}'],
                        'cause': f'case_{n:02d} omits addition',
                        'files': ['calculator.py']}
                       for n, issue in enumerate(names, 1)],
        },
        'session_handoff': {
            'active_phase': 11, 'active_batch': 'B-001', 'current_issue': 'V-001',
            'branch': 'master', 'checkpoint_commit': head,
            'last_verified_commit': None, 'working_tree_status': [],
            'working_tree_fingerprint': None,
            'next_action': 'Fix V-001 through V-005, checkpoint, then stop',
            'pending_user_decision': None,
        },
    }
    (task / 'orchestrator-state.yml').write_text(json.dumps(state, indent=2) + '\n')
    adapter = ROOT / 'platforms/codex/runtime/tasks.py'
    for phase in range(1, 12):
        created = subprocess.run([sys.executable, str(adapter), '--task-path', str(task),
                                  'create', '--json', json.dumps({'subject': f'Phase {phase}'})],
                                 check=True, capture_output=True, text=True)
        task_id = json.loads(created.stdout)['id']
        state['orchestrator']['task_ids'][f'phase-{phase}'] = task_id
        subprocess.run([sys.executable, str(adapter), '--task-path', str(task),
                        'update', '--json', json.dumps({'taskId': task_id,
                         'status': 'completed' if phase < 11 else 'in_progress'})],
                       check=True, capture_output=True, text=True)
    (task / 'orchestrator-state.yml').write_text(json.dumps(state, indent=2) + '\n')
    return task, names


def read_state(task):
    # This fixture writes JSON, which is also valid YAML.
    return json.loads((task / 'orchestrator-state.yml').read_text())


def assert_batch(task, workspace, names, expected_fixed):
    state = read_state(task)
    issues = state['verification_context']['issues']
    if [item['id'] for item in issues] != names:
        raise AssertionError('Issue IDs changed, disappeared, or duplicated')
    tests = run_tests(workspace)
    if expected_fixed == 12 and tests.returncode:
        raise AssertionError('Final independent tests failed: ' + tests.stdout + tests.stderr)
    namespace = {}
    exec((workspace / 'calculator.py').read_text(), namespace)
    for n in range(1, 13):
        result = namespace[f'case_{n:02d}'](10)
        expected = 10 + n if n <= expected_fixed else 10
        if result != expected:
            raise AssertionError(f'Batch result changed case_{n:02d} to {result}')
    statuses = [item['status'] for item in issues]
    expected_statuses = ['verified' if n <= expected_fixed else 'open'
                         for n in range(1, 13)]
    if statuses != expected_statuses:
        raise AssertionError(f'Issue status mismatch: {statuses}')
    if any(item['attempts'] for item in issues):
        raise AssertionError('Successful fixes incorrectly consumed retry attempts')
    fixes = []
    for entry in state['verification_context']['fixes_applied']:
        batch = entry.get('batch_id', entry.get('batch'))
        issue_ids = entry.get('issue_ids')
        if issue_ids is None:
            issue_ids = [entry.get('issue_id')]
        fixes.extend((batch, issue_id) for issue_id in issue_ids)
    expected_fixes = [('B-001' if n <= 5 else 'B-002', names[n - 1])
                      for n in range(1, expected_fixed + 1)]
    if sorted(fixes) != sorted(expected_fixes):
        raise AssertionError(f'Fixes were repeated or omitted: {fixes}')
    cycles = state['verification_context']['verification_cycles']
    if cycles != (2 if expected_fixed == 12 else 1):
        raise AssertionError(f'Incorrect full verification cycle count: {cycles}')
    handoff = state['session_handoff']
    git = lambda *args: subprocess.check_output(['git', *args], cwd=workspace,
                                                 text=True).strip()
    if handoff['active_phase'] != 11 or handoff['active_batch'] != (
            'B-002' if expected_fixed == 12 else 'B-001'):
        raise AssertionError('Incorrect Phase 11 batch checkpoint')
    if handoff['branch'] != git('branch', '--show-current') or handoff[
            'checkpoint_commit'] != git('rev-parse', 'HEAD'):
        raise AssertionError('Checkpoint branch or commit does not match Git')
    actual_status = subprocess.check_output(['git', 'status', '--short'],
                                            cwd=workspace, text=True).splitlines()
    if handoff['working_tree_status'] != actual_status:
        raise AssertionError('Checkpoint working tree status does not match Git')
    if not re.fullmatch(r'[0-9a-f]{64}', handoff.get('working_tree_fingerprint') or ''):
        raise AssertionError('Checkpoint fingerprint missing or malformed')
    captured = subprocess.run([
        sys.executable, str(ROOT / 'platforms/codex/runtime/checkpoint.py'),
        '--task-path', str(task), 'capture',
    ], check=True, capture_output=True, text=True)
    snapshot = json.loads(captured.stdout)
    if (handoff.get('fingerprint_algorithm') != snapshot['algorithm'] or
            handoff['working_tree_fingerprint'] != snapshot['working_tree_fingerprint']):
        raise AssertionError('Saved checkpoint fingerprint is not reproducible')
    for issue in issues:
        if issue['status'] == 'verified' and not all(
                (task / evidence).is_file() for evidence in issue['evidence']):
            raise AssertionError('Verified issue references missing evidence: ' + issue['id'])
    registry = json.loads((task / 'codex-tasks.json').read_text())
    if [entry['id'] for entry in registry['tasks']] != [str(n) for n in range(1, 12)]:
        raise AssertionError('Codex task registry IDs changed or were duplicated')
    if expected_fixed == 12:
        if state['verification_context']['last_status'] not in ('passed',
                                                                 'passed_with_issues'):
            raise AssertionError('Final verdict is not passing')
        report = (task / 'verification/implementation-verification.md').read_text()
        if 'Fix & Re-Verification History' not in report or any(
                issue not in report for issue in names):
            raise AssertionError('Canonical report lacks final batch history')
        decision = handoff.get('pending_user_decision') or ''
        if 'phase 12' not in str(decision).lower() or 'continue' not in str(decision).lower():
            raise AssertionError('Phase 11 exit decision was not preserved')
    return state


def compact_thread(client, thread_id):
    client.request('thread/compact/start', {'threadId': thread_id})
    def completed(message):
        return (message.get('method') == 'thread/compacted' and
                message.get('params', {}).get('threadId') == thread_id) or (
                message.get('method') == 'item/completed' and
                message.get('params', {}).get('threadId') == thread_id and
                message.get('params', {}).get('item', {}).get('type') == 'contextCompaction')
    if any(completed(message) for message in client.history):
        return
    deadline = time.monotonic() + client.timeout
    while True:
        message = client.receive(deadline)
        client.check_server_request(message)
        if completed(message):
            return


def assert_resume_digest_reproduced(history):
    verified = False
    for event in history:
        if event.get('method') != 'item/completed':
            continue
        item = event.get('params', {}).get('item', {})
        if item.get('type') != 'commandExecution':
            continue
        command = item.get('command', '')
        if ('runtime/checkpoint.py' not in command or ' verify ' not in command
                or item.get('exitCode') != 0):
            continue
        try:
            result = json.loads(item.get('aggregatedOutput') or '')
        except json.JSONDecodeError:
            continue
        if result.get('match') is True:
            verified = True
            break
    if not verified:
        raise AssertionError('No successful checkpoint fingerprint verification '
                             'was observed in the fresh Codex session')


def start_turn(client, workspace, model, auth_config, skill, prompt):
    started = client.request('thread/start', {
        'cwd': str(workspace), 'model': model, 'sandbox': 'workspace-write',
        'approvalPolicy': 'never', 'config': auth_config,
    })
    thread_id = started['thread']['id']
    turn = client.request('turn/start', {'threadId': thread_id, 'input': [
        {'type': 'skill', 'name': 'maister:development', 'path': skill},
        {'type': 'text', 'text': prompt},
    ]})
    client.wait_turn(thread_id, turn['turn']['id'])
    return thread_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--codex', default='codex')
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--resume-existing', action='store_true',
                        help='Continue after a successful first batch and compaction')
    args = parser.parse_args()
    if not args.resume_existing:
        args.evidence.mkdir(parents=True, exist_ok=False)
    report = {'scenario': 'phase11-live-handoff', 'status': 'NOT RUN',
              'model': args.model, 'created': datetime.now(timezone.utc).isoformat(),
              'explicit_compaction': False,
              'commit': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse',
                                                 'HEAD'], text=True).strip()}
    try:
        source_auth = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'auth.json'
        if not source_auth.is_file():
            raise RuntimeError('Codex ChatGPT login unavailable')
        if args.resume_existing:
            workspace = args.evidence / 'workspace'
            task = workspace / TASK
            names = [f'V-{n:03d}' for n in range(1, 13)]
            events = (args.evidence / 'first-process/events.jsonl').read_text().splitlines()
            if not any((event.get('message', {}).get('method') == 'thread/compacted' or
                        (event.get('message', {}).get('method') == 'item/completed' and
                         event.get('message', {}).get('params', {}).get('item', {}).get(
                             'type') == 'contextCompaction'))
                       for event in map(json.loads, events)):
                raise AssertionError('No explicit first-session compaction was recorded')
            report['explicit_compaction'] = True
            first = assert_batch(task, workspace, names, 5)
            (args.evidence / 'first-state.json').write_text(json.dumps(first, indent=2))
        else:
            workspace = prepare_fixture(FIXTURE, args.evidence / 'workspace')
            task, names = fixture(workspace)
        with tempfile.TemporaryDirectory(prefix='maister-phase11-home-') as home:
            copied_auth = Path(home) / 'auth.json'
            shutil.copyfile(source_auth, copied_auth)
            copied_auth.chmod(0o600)
            env = dict(os.environ, CODEX_HOME=home)
            for command in (['plugin', 'marketplace', 'add', str(ROOT)],
                            ['plugin', 'add', 'maister@maister-local', '--json']):
                subprocess.run([args.codex] + command, env=env, check=True,
                               capture_output=True, text=True, timeout=30)
            auth = {'model_provider': 'openai', 'forced_login_method': 'chatgpt'}
            if not args.resume_existing:
                with Client([args.codex, 'app-server', '--stdio'], home,
                            args.evidence / 'first-process', args.timeout) as client:
                    client.initialize()
                    skills = client.request('skills/list', {'cwds': [str(workspace)],
                                                            'forceReload': True})
                    skill = next(s['path'] for entry in skills['data'] for s in entry['skills']
                                 if s['name'] == 'maister:development')
                    thread_id = start_turn(client, workspace, args.model, auth, skill,
                               f'Resume the existing development task at {TASK} from Phase 11. '
                               'This is a disposable acceptance fixture. The user selects '
                               'V-001 through V-005 for batch B-001. Fix only these five, '
                               'run their tests, update the issue ledger, write a Git-checked '
                               'session_handoff checkpoint, and stop before B-002. '
                               'Preserve all task IDs and record evidence paths.')
                    before_compaction = read_state(task)
                    compact_thread(client, thread_id)
                    if read_state(task) != before_compaction:
                        raise AssertionError('Compaction changed Phase 11 state')
                    report['explicit_compaction'] = True
                first = assert_batch(task, workspace, names, 5)
                (args.evidence / 'first-state.json').write_text(json.dumps(first, indent=2))
            with Client([args.codex, 'app-server', '--stdio'], home,
                        args.evidence / 'second-process', args.timeout) as client:
                client.initialize()
                skills = client.request('skills/list', {'cwds': [str(workspace)],
                                                        'forceReload': True})
                skill = next(s['path'] for entry in skills['data'] for s in entry['skills']
                             if s['name'] == 'maister:development')
                start_turn(client, workspace, args.model, auth, skill,
                           f'New Codex session: resume the existing development task at {TASK}. '
                           'Validate the Git checkpoint, preserve all twelve issue IDs '
                           'and the task registry, fix V-006 through V-012 as batch B-002, '
                           're-run the complete independent test suite, and update the '
                           'canonical verification report and verdict.')
                second_history = list(client.history)
            final = assert_batch(task, workspace, names, 12)
            assert_resume_digest_reproduced(second_history)
            (args.evidence / 'final-state.json').write_text(json.dumps(final, indent=2))
            report['status'] = 'PASS'
        return 0
    except (TimeoutError, UnexpectedDecision) as error:
        report.update(status='BLOCKED', reason=str(error))
        return 2
    except Exception as error:
        report.update(status='FAIL', reason=str(error))
        return 1
    finally:
        (args.evidence / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    sys.exit(main())
