import json
import sys
import tempfile
import unittest
from pathlib import Path

from harness import Client, ProtocolError, UnexpectedDecision, prepare_fixture, run_tests, snapshot


FAKE = '''
import json, sys
for line in sys.stdin:
 message=json.loads(line)
 if 'id' not in message: continue
 method=message['method']
 if method=='hang': continue
 if method=='bad': print('not json',flush=True);continue
 if method=='decision':
  print(json.dumps({'id':99,'method':'item/tool/requestUserInput','params':{}}),flush=True)
  continue
 print(json.dumps({'method':'status','params':{}}),flush=True)
 print(json.dumps({'id':message['id'],'result':{'ok':True}}),flush=True)
'''


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def client(self, timeout=2):
        return Client([sys.executable, '-u', '-c', FAKE], self.root,
                      self.root / 'evidence', timeout)

    def test_handshake_and_event_evidence(self):
        with self.client() as client:
            self.assertTrue(client.initialize()['ok'])
            self.assertEqual(client.history[0]['method'], 'status')
        events = [json.loads(line) for line in (self.root / 'evidence/events.jsonl').read_text().splitlines()]
        self.assertTrue(any(e['direction'] == 'send' for e in events))
        self.assertTrue(any(e['direction'] == 'receive' for e in events))

    def test_timeout_is_bounded(self):
        with self.client(timeout=0.15) as client, self.assertRaises(TimeoutError):
            client.request('hang', {})

    def test_unexpected_decision_never_approved(self):
        with self.client() as client, self.assertRaises(UnexpectedDecision):
            client.request('decision', {})
        sent = (self.root / 'evidence/events.jsonl').read_text()
        self.assertNotIn('"result"', sent)

    def test_bad_protocol_fails_immediately(self):
        with self.client() as client, self.assertRaises(ProtocolError):
            client.request('bad', {})

    def test_fixture_is_isolated_and_baseline_passes(self):
        source = Path(__file__).parent / 'fixtures/python-project'
        before = snapshot(source)
        workspace = prepare_fixture(source, self.root / 'workspace')
        self.assertEqual(run_tests(workspace).returncode, 0)
        (workspace / 'calculator.py').write_text('changed')
        self.assertEqual(snapshot(source), before)
        self.assertNotEqual(snapshot(workspace), before)

    def test_existing_destination_not_overwritten(self):
        with self.assertRaises(ValueError):
            prepare_fixture(Path(__file__).parent / 'fixtures/python-project', self.root)


if __name__ == '__main__':
    unittest.main()