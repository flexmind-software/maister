import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


RUNTIME = Path(__file__).resolve().parents[1] / 'runtime/checkpoint.py'
SPEC = importlib.util.spec_from_file_location('checkpoint', RUNTIME)
CHECKPOINT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKPOINT)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(['git', 'init', '-q', '-b', 'master', str(self.root)], check=True)
        (self.root / 'app.py').write_text('value = 1\n')
        subprocess.run(['git', '-C', str(self.root), 'add', 'app.py'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Acceptance',
                        '-c', 'user.email=acceptance@example.invalid', 'commit',
                        '-qm', 'Initial'], check=True)
        self.task = self.root / '.maister/tasks/development/example'
        self.task.mkdir(parents=True)
        (self.task / 'orchestrator-state.yml').write_text('cycle: 1\n')
        (self.task / 'dashboard.html').write_text('<p>one</p>\n')
        (self.task / 'dashboard-data.js').write_text('const value = 1;\n')

    def command(self, *args):
        return subprocess.run([sys.executable, str(RUNTIME), '--task-path',
                               str(self.task), *args], capture_output=True, text=True)

    def test_excluded_state_is_stable_and_source_changes_are_detected(self):
        subprocess.run(['git', '-C', str(self.root), 'add', '.maister'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Acceptance',
                        '-c', 'user.email=acceptance@example.invalid', 'commit',
                        '-qm', 'Track task state'], check=True)
        original = CHECKPOINT.snapshot(self.task)
        (self.task / 'orchestrator-state.yml').write_text('cycle: 2\n')
        (self.task / 'dashboard.html').write_text('<p>two</p>\n')
        self.assertEqual(CHECKPOINT.snapshot(self.task)['working_tree_fingerprint'],
                         original['working_tree_fingerprint'])
        (self.root / 'app.py').write_text('value = 2\n')
        changed = CHECKPOINT.snapshot(self.task)
        self.assertNotEqual(changed['working_tree_fingerprint'],
                            original['working_tree_fingerprint'])
        self.assertEqual(self.command('verify', '--expected-algorithm',
                                     original['algorithm'], '--expected-fingerprint',
                                     original['working_tree_fingerprint']).returncode, 1)
        self.assertEqual(self.command('verify', '--expected-algorithm',
                                     changed['algorithm'], '--expected-fingerprint',
                                     changed['working_tree_fingerprint']).returncode, 0)

    def test_staged_unstaged_and_untracked_contents_affect_fingerprint(self):
        (self.root / 'app.py').write_text('value = 2\n')
        subprocess.run(['git', '-C', str(self.root), 'add', 'app.py'], check=True)
        staged = CHECKPOINT.snapshot(self.task)['working_tree_fingerprint']
        (self.root / 'app.py').write_text('value = 3\n')
        unstaged = CHECKPOINT.snapshot(self.task)['working_tree_fingerprint']
        self.assertNotEqual(staged, unstaged)
        (self.root / 'name with spaces.txt').write_text('first\n')
        untracked = CHECKPOINT.snapshot(self.task)['working_tree_fingerprint']
        self.assertNotEqual(unstaged, untracked)
        (self.root / 'name with spaces.txt').write_text('second\n')
        self.assertNotEqual(untracked,
                            CHECKPOINT.snapshot(self.task)['working_tree_fingerprint'])

    def test_unknown_algorithm_fails_closed(self):
        result = self.command('verify', '--expected-algorithm', 'unknown',
                              '--expected-fingerprint', '0' * 64)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Unknown fingerprint algorithm',
                      json.loads(result.stderr)['error'])


if __name__ == '__main__':
    unittest.main()
