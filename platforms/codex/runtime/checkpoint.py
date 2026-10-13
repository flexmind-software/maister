#!/usr/bin/env python3
"""Versioned Git checkpoint fingerprint for Maister Codex sessions."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path


ALGORITHM = 'maister-git-sha256-v1'
EXCLUDED_NAMES = ('orchestrator-state.yml', 'dashboard.html', 'dashboard-data.js')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def repository_and_task(task_path):
    task = Path(task_path).resolve()
    if not task.is_dir():
        raise ValueError('Task directory does not exist: ' + str(task))
    root = Path(git(task, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    try:
        relative = task.relative_to(root)
    except ValueError as error:
        raise ValueError('Task directory is outside the Git repository') from error
    return root, relative


def fingerprint(root, relative_task):
    excluded = {os.fsencode(str(relative_task / name)) for name in EXCLUDED_NAMES}
    pathspec = ['--', '.', *(f':(exclude){relative_task / name}'
                             for name in EXCLUDED_NAMES)]
    digest = hashlib.sha256()
    digest.update(ALGORITHM.encode() + b'\0')
    for label, args in (
        (b'unstaged', ('diff', '--binary', '--no-ext-diff')),
        (b'staged', ('diff', '--cached', '--binary', '--no-ext-diff')),
    ):
        data = git(root, *args, *pathspec)
        digest.update(label + b'\0' + len(data).to_bytes(8, 'big') + data)
    paths = sorted(path for path in git(
        root, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0')
                   if path and path not in excluded)
    for path in paths:
        absolute = os.path.join(os.fsencode(root), path)
        if os.path.islink(absolute):
            content = b'link\0' + os.fsencode(os.readlink(absolute))
        else:
            content = b'file\0' + hashlib.sha256(Path(os.fsdecode(absolute)).read_bytes()).digest()
        digest.update(b'untracked\0' + len(path).to_bytes(8, 'big') + path)
        digest.update(len(content).to_bytes(8, 'big') + content)
    return digest.hexdigest()


def snapshot(task_path):
    root, relative = repository_and_task(task_path)
    return {
        'algorithm': ALGORITHM,
        'branch': git(root, 'branch', '--show-current').decode().strip(),
        'commit': git(root, 'rev-parse', 'HEAD').decode().strip(),
        'working_tree_status': git(root, 'status', '--short').decode().splitlines(),
        'working_tree_fingerprint': fingerprint(root, relative),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task-path', required=True)
    sub = parser.add_subparsers(dest='operation', required=True)
    sub.add_parser('capture')
    verify = sub.add_parser('verify')
    verify.add_argument('--expected-fingerprint', required=True)
    verify.add_argument('--expected-algorithm', required=True)
    args = parser.parse_args()
    try:
        result = snapshot(args.task_path)
        if args.operation == 'verify':
            expected = args.expected_fingerprint.lower()
            if args.expected_algorithm != ALGORITHM:
                raise ValueError('Unknown fingerprint algorithm: ' + args.expected_algorithm)
            if not re.fullmatch(r'[0-9a-f]{64}', expected):
                raise ValueError('Expected fingerprint must be a SHA-256 hex digest')
            result['match'] = result['working_tree_fingerprint'] == expected
            print(json.dumps(result, indent=2))
            return 0 if result['match'] else 1
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
