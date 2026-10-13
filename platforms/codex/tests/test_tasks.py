import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('tasks', ROOT / 'runtime/tasks.py')
TASKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TASKS)


class TaskTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.registry = TASKS.Registry(self.temp.name)

    def create(self, subject):
        return self.registry.execute('create', {'subject': subject})['id']

    def test_restart_and_ids(self):
        self.assertEqual(self.create('Analyze'), '1')
        restarted = TASKS.Registry(self.temp.name)
        self.assertEqual(restarted.execute('create', {'subject': 'Plan'})['id'], '2')
        self.assertEqual(len(restarted.execute('list', {})), 2)

    def test_dependencies_and_progress(self):
        first, second = self.create('Analyze'), self.create('Plan')
        self.registry.execute('update', {'taskId': second, 'addBlockedBy': [first]})
        with self.assertRaisesRegex(ValueError, 'Incomplete dependencies'):
            self.registry.execute('update', {'taskId': second, 'status': 'in_progress'})
        self.registry.execute('update', {'taskId': first, 'status': 'completed'})
        task = self.registry.execute('update', {
            'taskId': second, 'status': 'in_progress', 'owner': 'maister-implementation-planner',
            'metadata': {'wave': 1, 'tests_passed': True},
        })
        self.assertEqual(task['metadata']['wave'], 1)
        self.assertEqual(task['owner'], 'maister-implementation-planner')
        self.assertEqual(task['status'], 'in_progress')

    def test_cycles_fail_without_mutation(self):
        first, second = self.create('One'), self.create('Two')
        self.registry.execute('update', {'taskId': first, 'addBlocks': [second]})
        before = self.registry.path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'cycle'):
            self.registry.execute('update', {'taskId': first, 'addBlockedBy': [second]})
        self.assertEqual(self.registry.path.read_bytes(), before)

    def test_unknown_dependencies_and_status_fail(self):
        task_id = self.create('One')
        for fields in ({'addBlockedBy': ['99']}, {'status': 'invented'},
                       {'addBlockedBy': [task_id]}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.registry.execute('update', dict(fields, taskId=task_id))

    def test_metadata_merge_and_removal(self):
        task_id = self.create('One')
        self.registry.execute('update', {'taskId': task_id, 'metadata': {'a': 1, 'b': 2}})
        result = self.registry.execute('update', {'taskId': task_id, 'metadata': {'a': None, 'c': 3}})
        self.assertEqual(result['metadata'], {'b': 2, 'c': 3})

    def test_cli_roundtrip(self):
        run = subprocess.run([
            sys.executable, str(ROOT / 'runtime/tasks.py'),
            '--task-path', self.temp.name, 'create', '--json',
            json.dumps({'subject': 'CLI task'}),
        ], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(run.stdout)['id'], '1')
        self.assertEqual(self.registry.execute('get', {'taskId': '1'})['subject'], 'CLI task')

    def test_corrupt_registry_not_overwritten(self):
        self.registry.path.write_text('not json')
        with self.assertRaises(ValueError):
            self.create('One')
        self.assertEqual(self.registry.path.read_text(), 'not json')


if __name__ == '__main__':
    unittest.main()