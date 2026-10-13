import tempfile
import unittest
from pathlib import Path

from harness import prepare_fixture, snapshot
from live_acceptance import FIXTURE, assert_quick_dev, assert_quick_plan


class AcceptanceAssertionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = prepare_fixture(FIXTURE, Path(self.temp.name) / 'workspace')

    def test_plan_requires_evidence_and_no_edits(self):
        before = snapshot(self.workspace)
        history = [{'method': 'item/completed', 'params': {'item': {
            'text': 'Standards Compliance Checklist\nstandards/python.md\nPlease approve the plan.'}}}]
        assert_quick_plan(self.workspace, before, history)
        (self.workspace / 'calculator.py').write_text('changed')
        with self.assertRaisesRegex(AssertionError, 'changed before approval'):
            assert_quick_plan(self.workspace, before, history)

    def test_empty_model_claim_does_not_pass(self):
        with self.assertRaises(AssertionError):
            assert_quick_plan(self.workspace, snapshot(self.workspace), [])
        with self.assertRaises(AssertionError):
            assert_quick_dev(self.workspace)

    def test_correct_code_without_standard_fails(self):
        with (self.workspace / 'calculator.py').open('a') as stream:
            stream.write('\ndef multiply(left, right):\n    return left * right\n')
        with self.assertRaisesRegex(AssertionError, 'standard violated'):
            assert_quick_dev(self.workspace)


if __name__ == '__main__':
    unittest.main()