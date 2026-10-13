"""Protocol tests use real subprocess stdin/stdout; never execute sample commands."""

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('guard', ROOT / 'hooks/guard.py')
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)


class HookTests(unittest.TestCase):
    def invoke(self, payload):
        run = subprocess.run(
            [sys.executable, str(ROOT / 'hooks/guard.py')],
            input=payload, text=True, capture_output=True, check=True,
        )
        return json.loads(run.stdout)

    def test_dangerous_commands(self):
        for command in (
            'git stash', 'git reset --hard HEAD', 'git checkout -- .',
            'git checkout .', 'git clean -fd', 'git push --force origin main',
            'git push -f', 'git push --force-with-lease', 'git restore .',
            'rm -rf folder', 'rm -fr folder', 'rm -r -f folder',
            'rm --recursive --force folder', '/bin/rm -Rf folder',
            'git -C repo reset --hard', 'echo ok && git stash',
            'bash -c "git reset --hard"', 'git\tstash',
        ):
            with self.subTest(command=command):
                response = self.invoke(json.dumps({
                    'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
                    'tool_input': {'command': command},
                }))
                self.assertEqual(response['hookSpecificOutput']['permissionDecision'], 'deny')

    def test_safe_commands(self):
        for command in ('git status', 'git diff --check', 'git commit -m "change"',
                        'python3 -m unittest', 'rm temporary.txt', 'git reset --soft HEAD~1'):
            with self.subTest(command=command):
                self.assertEqual(GUARD.handle({
                    'hook_event_name': 'PreToolUse',
                    'tool_input': {'command': command},
                }), {})

    def test_fail_closed(self):
        for raw in ('not json', 'null', '[]', '{}',
                    '{"hook_event_name":"PreToolUse"}',
                    '{"hook_event_name":"PreToolUse","tool_input":{"command":42}}'):
            with self.subTest(raw=raw):
                self.assertEqual(self.invoke(raw)['hookSpecificOutput']['permissionDecision'], 'deny')

    def test_malformed_shell_fails_closed(self):
        self.assertTrue(GUARD.destructive("echo 'unterminated"))

    def test_compaction_and_agent_context(self):
        for event in ('SessionStart', 'SubagentStart'):
            response = self.invoke(json.dumps({'hook_event_name': event, 'source': 'compact'}))
            output = response['hookSpecificOutput']
            self.assertEqual(output['hookEventName'], event)
            self.assertIn('explicit response', output['additionalContext'])
            self.assertIn('orchestrator-state.yml', output['additionalContext'])

    def test_registered_scripts_exist(self):
        manifest = json.loads((ROOT / 'hooks/hooks.json').read_text())
        self.assertEqual(set(manifest['hooks']), {'SessionStart', 'SubagentStart', 'PreToolUse'})
        for entries in manifest['hooks'].values():
            for entry in entries:
                for hook in entry['hooks']:
                    self.assertIn('${PLUGIN_ROOT}/hooks/guard.py', hook['command'])
                    self.assertTrue((ROOT / 'hooks/guard.py').is_file())


if __name__ == '__main__':
    unittest.main()