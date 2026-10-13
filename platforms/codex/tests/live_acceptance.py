#!/usr/bin/env python3
"""Explicit, bounded model-driven acceptance. Never auto-approve decisions."""

import argparse
import ast
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from harness import Client, UnexpectedDecision, prepare_fixture, run_tests, snapshot


ROOT = Path(__file__).resolve().parents[3]
FIXTURE = Path(__file__).parent / 'fixtures/python-project'
SCENARIOS = {
    'quick-plan-gate': ('quick-plan',
                        'Add a public multiply(left, right) function. Prepare the plan.'),
    'quick-dev-standards': ('quick-dev',
                            'Add a public multiply(left, right) function and unittest coverage.'),
    'session-resume': (None, None),
}


def assert_quick_plan(workspace, before, history):
    after = snapshot(workspace)
    for path, digest in before.items():
        if after.get(path) != digest:
            raise AssertionError('Existing fixture changed before approval: ' + path)
    if any(path.endswith('.py') and path not in before for path in after):
        raise AssertionError('Application/test code created before approval')
    text = '\n'.join(
        message.get('params', {}).get('item', {}).get('text', '')
        for message in history if message.get('method') == 'item/completed'
    )
    artifacts = '\n'.join(file.read_text() for file in workspace.rglob('*.md')
                          if str(file.relative_to(workspace)) not in before)
    plan = text + '\n' + artifacts
    if 'Standards Compliance Checklist' not in plan:
        raise AssertionError('No standards compliance checklist in plan evidence')
    if 'standards/python.md' not in plan:
        raise AssertionError('Plan does not reference applicable fixture standard')
    questions = '\n'.join(json.dumps(message['params']) for message in history
                          if message.get('method') == 'item/tool/requestUserInput')
    if not any(word in (text + questions).lower() for word in ('approve', 'approval', 'confirm')):
        raise AssertionError('No explicit plan approval request in final response')


def assert_quick_dev(workspace):
    tree = ast.parse((workspace / 'calculator.py').read_text())
    function = next((node for node in tree.body
                     if isinstance(node, ast.FunctionDef) and node.name == 'multiply'), None)
    if function is None:
        raise AssertionError('multiply not implemented')
    if function.returns is None or 'MAISTER_STANDARD_SENTINEL' not in (ast.get_docstring(function) or ''):
        raise AssertionError('Mandatory docstring/return annotation standard violated')
    code = compile(tree, 'calculator.py', 'exec')
    namespace = {}
    exec(code, namespace)
    for left, right in ((2, 3), (-2, 4), (0, 10), (1.5, 2)):
        if namespace['multiply'](left, right) != left * right:
            raise AssertionError('multiply failed independent behavior assertion')
    tests = run_tests(workspace)
    (workspace.parent / 'independent-tests.log').write_text(tests.stdout + tests.stderr)
    if tests.returncode:
        raise AssertionError('Independent fixture test suite failed')
    if not any('multiply' in file.read_text() for file in (workspace / 'tests').glob('*.py')):
        raise AssertionError('No multiply regression test added')


def run_session_resume(client, workspace, model, auth_config):
    """Exercise a real Codex thread across two app-server processes."""
    task_path = workspace / '.maister/tasks/development/resume-fixture'
    task_path.mkdir(parents=True)
    adapter = ROOT / 'platforms/codex/runtime/tasks.py'
    create = subprocess.run([sys.executable, str(adapter), '--task-path', str(task_path),
                             'create', '--json', '{"subject":"Phase 11"}'],
                            capture_output=True, text=True, check=True)
    task_id = json.loads(create.stdout)['id']
    started = client.request('thread/start', {
        'cwd': str(workspace), 'model': model,
        'sandbox': 'workspace-write', 'approvalPolicy': 'never',
        'config': auth_config,
    })
    thread_id = started['thread']['id']
    turn = client.request('turn/start', {'threadId': thread_id,
                                        'input': [{'type': 'text', 'text': 'Reply READY.'}]})
    client.wait_turn(thread_id, turn['turn']['id'])
    # Caller closes the first process before invoking this continuation.
    return thread_id, task_id


def assert_session_resumed(codex, home, evidence, workspace, thread_id, task_id, timeout):
    with Client([codex, 'app-server', '--stdio'], home, evidence / 'resumed-protocol',
                timeout) as resumed:
        resumed.initialize()
        result = resumed.request('thread/resume', {'threadId': thread_id})
        if result['thread']['id'] != thread_id:
            raise AssertionError('Codex resumed a different thread')
        turn = resumed.request('turn/start', {'threadId': thread_id, 'input': [
            {'type': 'text', 'text': 'Reply RESUMED.'},
        ]})
        resumed.wait_turn(thread_id, turn['turn']['id'])
        text = '\n'.join(message.get('params', {}).get('item', {}).get('text', '')
                         for message in resumed.history
                         if message.get('method') == 'item/completed')
        if 'RESUMED' not in text:
            raise AssertionError('No model response after thread resume')
    task_path = workspace / '.maister/tasks/development/resume-fixture'
    adapter = ROOT / 'platforms/codex/runtime/tasks.py'
    tasks = subprocess.run([sys.executable, str(adapter), '--task-path', str(task_path),
                            'list'], capture_output=True, text=True, check=True)
    ids = [task['id'] for task in json.loads(tasks.stdout)]
    if ids != [task_id]:
        raise AssertionError('Persistent task ID changed across session resume')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex', default='codex')
    parser.add_argument('--scenario', choices=sorted(SCENARIOS), required=True)
    parser.add_argument('--model', required=True, help='Explicit model; no implicit expensive default')
    parser.add_argument('--auth', choices=('api', 'chatgpt'), default='api',
                        help='Use an API key or the current Codex ChatGPT login')
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_args()
    if args.evidence.exists():
        parser.error('Evidence directory must not exist')
    args.evidence.mkdir(parents=True)
    report = {'scenario': args.scenario, 'model': args.model, 'status': 'NOT RUN',
              'created': datetime.now(timezone.utc).isoformat(),
              'surface': 'codex-cli/app-server', 'interactive_terminal_verified': False,
              'hook_execution_verified': False}
    try:
        report['codex_version'] = subprocess.check_output([args.codex, '--version'], text=True).strip()
        report['commit'] = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
        workspace = prepare_fixture(FIXTURE, args.evidence / 'workspace')
        before = snapshot(workspace)
        with tempfile.TemporaryDirectory(prefix='maister-live-home-') as home:
            auth_config = {'model_provider': 'openai', 'forced_login_method': 'api'}
            if args.auth == 'chatgpt':
                source_auth = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'auth.json'
                if not source_auth.is_file():
                    report.update(status='BLOCKED', reason='Codex ChatGPT login unavailable')
                    return 2
                destination_auth = Path(home) / 'auth.json'
                shutil.copyfile(source_auth, destination_auth)
                destination_auth.chmod(0o600)
                auth_config = {'model_provider': 'openai', 'forced_login_method': 'chatgpt'}
            elif not os.environ.get('OPENAI_API_KEY'):
                report.update(status='BLOCKED', reason='OPENAI_API_KEY unavailable for isolated live session')
                return 2
            report['auth'] = args.auth
            env = dict(os.environ, CODEX_HOME=home)
            for command in (['plugin', 'marketplace', 'add', str(ROOT)],
                            ['plugin', 'add', 'maister@maister-local', '--json']):
                subprocess.run([args.codex] + command, env=env, check=True,
                               capture_output=True, text=True, timeout=30)
            with Client([args.codex, 'app-server', '--stdio'], home,
                        args.evidence / 'protocol', args.timeout) as client:
                client.initialize()
                if args.scenario == 'session-resume':
                    thread_id, task_id = run_session_resume(client, workspace,
                                                            args.model, auth_config)
                else:
                    skills = client.request('skills/list', {'cwds': [str(workspace)], 'forceReload': True})
                    role, prompt = SCENARIOS[args.scenario]
                    name = 'maister:' + role
                    skill = next(s for entry in skills['data'] for s in entry['skills'] if s['name'] == name)
                    started = client.request('thread/start', {
                        'cwd': str(workspace), 'model': args.model,
                        'sandbox': 'workspace-write', 'approvalPolicy': 'never',
                        'config': auth_config,
                    })
                    thread_id = started['thread']['id']
                    result = client.request('turn/start', {'threadId': thread_id, 'input': [
                        {'type': 'skill', 'name': name, 'path': skill['path']},
                        {'type': 'text', 'text': prompt},
                    ]})
                    try:
                        client.wait_turn(thread_id, result['turn']['id'])
                    except UnexpectedDecision:
                        # Structured decisions also constitute a pause, but cannot
                        # bypass assertions on the actual plan and unchanged code.
                        if args.scenario != 'quick-plan-gate':
                            raise
                    if args.scenario == 'quick-plan-gate':
                        assert_quick_plan(workspace, before, client.history)
                    else:
                        assert_quick_dev(workspace)
            if args.scenario == 'session-resume':
                assert_session_resumed(args.codex, home, args.evidence, workspace,
                                       thread_id, task_id, args.timeout)
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
