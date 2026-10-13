#!/usr/bin/env python3
"""Optional real Codex discovery test in an isolated home; no model calls."""

import argparse
import json
import os
import queue
import subprocess
import tempfile
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex', default='codex')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='maister-codex-smoke-') as home:
        env = dict(os.environ, CODEX_HOME=home)
        for command in (
            ['plugin', 'marketplace', 'add', str(ROOT)],
            ['plugin', 'add', 'maister@maister-local', '--json'],
        ):
            subprocess.run([args.codex] + command, env=env, check=True,
                           capture_output=True, text=True, timeout=30)
        with tempfile.TemporaryFile(mode='w+') as errors:
            process = subprocess.Popen(
                [args.codex, 'app-server', '--stdio'], env=env,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=errors, text=True,
            )
            responses = queue.Queue()

            def read_output():
                for line in process.stdout:
                    responses.put(json.loads(line))

            thread = threading.Thread(target=read_output, daemon=True)
            thread.start()

            def send(message):
                process.stdin.write(json.dumps(message) + '\n')
                process.stdin.flush()

            def request(identifier, method, params):
                send({'id': identifier, 'method': method, 'params': params})
                while True:
                    message = responses.get(timeout=30)
                    if message.get('id') == identifier:
                        if 'error' in message:
                            raise RuntimeError(message['error'])
                        return message['result']

            try:
                request(1, 'initialize', {
                    'clientInfo': {'name': 'maister-smoke', 'version': '0.1'},
                    'capabilities': {'experimentalApi': True},
                })
                send({'method': 'initialized'})
                result = request(2, 'skills/list', {
                    'cwds': [str(ROOT)], 'forceReload': True,
                })
                expected = {'maister:' + p.parent.name
                            for p in (ROOT / 'plugins/maister-codex/skills').glob('*/SKILL.md')}
                found = set()
                for item in result['data']:
                    if item.get('errors'):
                        raise RuntimeError(item['errors'])
                    found.update(skill['name'] for skill in item['skills']
                                 if skill['name'].startswith('maister:'))
                if found != expected:
                    raise RuntimeError({'missing': sorted(expected - found),
                                        'unexpected': sorted(found - expected)})
                print('Codex installed and discovered all {} Maister entry points; no skill errors.'.format(len(found)))
                print('This is a parser/discovery test, not model-driven functional acceptance.')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                process.stdin.close()
                process.stdout.close()
                thread.join(timeout=2)


if __name__ == '__main__':
    main()
