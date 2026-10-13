import tempfile
import unittest
from pathlib import Path

from harness import prepare_fixture, run_tests
from phase11_live_acceptance import (
    FIXTURE, assert_resume_digest_reproduced, fixture, read_state,
)


class Phase11LiveFixtureTests(unittest.TestCase):
    def test_seeded_fixture_has_twelve_failing_cases_and_stable_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = prepare_fixture(FIXTURE, Path(directory) / 'workspace')
            task, names = fixture(workspace)
            result = run_tests(workspace)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('failures=12', result.stderr)
            state = read_state(task)
            self.assertEqual([item['id'] for item in state['verification_context']['issues']], names)
            self.assertEqual(len(state['orchestrator']['task_ids']), 11)

    def test_unreproducible_resume_fingerprint_fails(self):
        history = [{'method': 'item/completed', 'params': {'item': {
            'type': 'agentMessage',
            'text': 'The stored fingerprint cannot be reproduced.',
        }}}]
        with self.assertRaisesRegex(AssertionError, 'fingerprint'):
            assert_resume_digest_reproduced(history)

    def test_successful_checkpoint_verify_is_required(self):
        history = [{'method': 'item/completed', 'params': {'item': {
            'type': 'commandExecution',
            'command': 'python3 /plugin/runtime/checkpoint.py --task-path task verify '
                       '--expected-algorithm maister-git-sha256-v1 '
                       '--expected-fingerprint abc',
            'exitCode': 0,
            'aggregatedOutput': '{"match": true}',
        }}}]
        assert_resume_digest_reproduced(history)


if __name__ == '__main__':
    unittest.main()
