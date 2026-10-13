#!/usr/bin/env python3
"""Persistent task-tool adapter. Parent orchestrator is the only writer."""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


STATUSES = {'pending', 'in_progress', 'completed', 'failed', 'blocked'}


def timestamp():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class Registry:
    def __init__(self, task_path):
        self.path = Path(task_path) / 'codex-tasks.json'

    def read(self):
        if not self.path.exists():
            return {'schema_version': 1, 'next_id': 1, 'tasks': []}
        data = json.loads(self.path.read_text())
        if data.get('schema_version') != 1:
            raise ValueError('Unsupported task registry schema')
        return data

    def save(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.codex-tasks-', dir=self.path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(data, stream, indent=2)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @staticmethod
    def find(data, task_id):
        for task in data['tasks']:
            if task['id'] == str(task_id):
                return task
        raise ValueError('Unknown task ID: ' + str(task_id))

    @staticmethod
    def validate_dependencies(data):
        visiting, visited = set(), set()

        def visit(task_id):
            if task_id in visiting:
                raise ValueError('Task dependency cycle')
            if task_id in visited:
                return
            visiting.add(task_id)
            for dependency in Registry.find(data, task_id)['blockedBy']:
                visit(dependency)
            visiting.remove(task_id)
            visited.add(task_id)

        for task in data['tasks']:
            visit(task['id'])

    def execute(self, operation, fields):
        data = self.read()
        if operation == 'list':
            return data['tasks']
        if operation == 'get':
            return self.find(data, fields['taskId'])
        if operation == 'create':
            subject = fields.get('subject')
            if not isinstance(subject, str) or not subject.strip():
                raise ValueError('Task subject is required')
            task = {
                'id': str(data['next_id']), 'subject': subject,
                'description': fields.get('description', ''),
                'activeForm': fields.get('activeForm', ''), 'status': 'pending',
                'owner': None, 'blockedBy': [], 'metadata': {},
                'created': timestamp(), 'updated': timestamp(),
            }
            data['tasks'].append(task)
            data['next_id'] += 1
        elif operation == 'update':
            task = self.find(data, fields['taskId'])
            for field in ('subject', 'description', 'activeForm', 'owner'):
                if field in fields:
                    task[field] = fields[field]
            if 'metadata' in fields:
                if not isinstance(fields['metadata'], dict):
                    raise ValueError('Metadata must be an object')
                for key, value in fields['metadata'].items():
                    if value is None:
                        task['metadata'].pop(key, None)
                    else:
                        task['metadata'][key] = value
            for dependency in fields.get('addBlockedBy', []):
                dependency = str(dependency)
                self.find(data, dependency)
                if dependency not in task['blockedBy']:
                    task['blockedBy'].append(dependency)
            # addBlocks is the reciprocal form used by task planning tools.
            for dependent in fields.get('addBlocks', []):
                other = self.find(data, dependent)
                if task['id'] not in other['blockedBy']:
                    other['blockedBy'].append(task['id'])
            self.validate_dependencies(data)
            status = fields.get('status', task['status'])
            if status not in STATUSES:
                raise ValueError('Invalid task status: ' + str(status))
            if status in ('in_progress', 'completed'):
                unfinished = [dep for dep in task['blockedBy']
                              if self.find(data, dep)['status'] != 'completed']
                if unfinished:
                    raise ValueError('Incomplete dependencies: ' + ', '.join(unfinished))
            task['status'] = status
            task['updated'] = timestamp()
        else:
            raise ValueError('Unknown operation: ' + operation)
        self.save(data)
        return task


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task-path', required=True)
    parser.add_argument('operation', choices=('create', 'update', 'list', 'get'))
    parser.add_argument('--json', default='{}', help='Task-tool fields as JSON')
    args = parser.parse_args()
    try:
        fields = json.loads(args.json)
        if not isinstance(fields, dict):
            raise ValueError('Task fields must be an object')
        result = Registry(args.task_path).execute(args.operation, fields)
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())