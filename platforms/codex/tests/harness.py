"""Bounded JSONL client and disposable fixtures for Codex CLI acceptance."""

import hashlib
import json
import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path


class ProtocolError(RuntimeError):
    pass


class UnexpectedDecision(ProtocolError):
    pass


class Client:
    def __init__(self, command, home, evidence, timeout=30):
        self.timeout = timeout
        self.evidence = Path(evidence)
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.log = (self.evidence / 'events.jsonl').open('w')
        self.errors = (self.evidence / 'stderr.log').open('w')
        self.messages = queue.Queue()
        self.history = []
        self.next_id = 1
        self.process = subprocess.Popen(
            command, env=dict(os.environ, CODEX_HOME=str(home)),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors,
            text=True, bufsize=1,
        )
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        try:
            for line in self.process.stdout:
                self.messages.put(json.loads(line))
        except (ValueError, OSError) as error:
            self.messages.put(ProtocolError(str(error)))
        finally:
            self.messages.put(ProtocolError('Codex closed stdout'))

    def send(self, message):
        self.log.write(json.dumps({'direction': 'send', 'message': message}) + '\n')
        self.log.flush()
        self.process.stdin.write(json.dumps(message) + '\n')
        self.process.stdin.flush()

    def receive(self, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Codex response deadline exceeded')
        try:
            message = self.messages.get(timeout=remaining)
        except queue.Empty:
            raise TimeoutError('Codex response deadline exceeded')
        if isinstance(message, Exception):
            raise message
        self.history.append(message)
        self.log.write(json.dumps({'direction': 'receive', 'message': message}) + '\n')
        self.log.flush()
        return message

    @staticmethod
    def check_server_request(message):
        if 'method' in message and 'id' in message:
            raise UnexpectedDecision('Unscripted server request: ' + message['method'])

    def request(self, method, params):
        identifier = self.next_id
        self.next_id += 1
        self.send({'id': identifier, 'method': method, 'params': params})
        deadline = time.monotonic() + self.timeout
        while True:
            message = self.receive(deadline)
            self.check_server_request(message)
            if message.get('id') == identifier:
                if 'error' in message:
                    raise ProtocolError(str(message['error']))
                return message['result']

    def initialize(self):
        result = self.request('initialize', {
            'clientInfo': {'name': 'maister-acceptance', 'version': '0.1'},
            'capabilities': {'experimentalApi': True},
        })
        self.send({'method': 'initialized'})
        return result

    def wait_turn(self, thread_id, turn_id, decision=None):
        deadline = time.monotonic() + self.timeout
        while True:
            message = self.receive(deadline)
            if 'method' in message and 'id' in message:
                if decision is None:
                    self.check_server_request(message)
                # The handler must validate exact questions, options and thread.
                self.send({'id': message['id'], 'result': decision(message)})
                continue
            params = message.get('params', {})
            if message.get('method') == 'turn/completed' and params.get('threadId') == thread_id:
                turn = params['turn']
                if turn['id'] == turn_id:
                    if turn['status'] != 'completed':
                        raise ProtocolError('Turn failed: ' + json.dumps(turn))
                    return turn

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.reader.join(timeout=2)
        self.process.stdin.close()
        self.process.stdout.close()
        self.log.close()
        self.errors.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def snapshot(workspace):
    return {str(file.relative_to(workspace)): hashlib.sha256(file.read_bytes()).hexdigest()
            for file in Path(workspace).rglob('*')
            if file.is_file() and not any(part in ('.git', '__pycache__') for part in file.parts)}


def prepare_fixture(source, destination):
    destination = Path(destination)
    if destination.exists():
        raise ValueError('Fixture destination must not exist')
    shutil.copytree(source, destination)
    subprocess.run(['git', 'init', '-q', str(destination)], check=True)
    return destination


def run_tests(workspace):
    return subprocess.run(
        ['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-v'],
        cwd=workspace, capture_output=True, text=True, timeout=30,
        env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'),
    )