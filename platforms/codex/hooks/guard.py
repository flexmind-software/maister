#!/usr/bin/env python3
"""Codex hook protocol adapter. Hooks require explicit runtime trust."""

import json
import re
import shlex
import sys
from pathlib import Path


REMINDER = (
    "MAISTER: Execute explicitly selected Maister skills, never substitute an "
    "inline shortcut. Skills run in the parent context; delegate agent work "
    "to isolated subagents. At every MANDATORY GATE, ask the user and wait for "
    "an explicit response, regardless of permission mode or previous approvals. "
    "After resume or compaction, reload the active orchestrator-state.yml and "
    "persistent task registry before selecting the next phase. Never automatically "
    "rollback or discard changes."
)


def denial(reason):
    return {"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}


def destructive(command):
    """Conservative lexical guard, not a shell sandbox or a complete firewall."""
    try:
        words = shlex.split(command)
    except ValueError:
        return True
    # Scan across compounds, pipes, wrappers and command substitutions. Embedded
    # commands in shell/python -c strings get scanned recursively as well.
    for index, word in enumerate(words):
        executable = Path(word.strip('();`')).name
        rest = words[index + 1:]
        if executable == 'git':
            for offset, arg in enumerate(rest):
                if arg in ('stash', 'clean'):
                    return True
                tail = rest[offset + 1:]
                if arg == 'reset' and '--hard' in tail:
                    return True
                if arg in ('checkout', 'restore') and '.' in tail:
                    return True
                if arg == 'push' and any(
                    flag == '-f' or flag.startswith('--force')
                    for flag in tail
                ):
                    return True
                if arg in (';', '&&', '||', '|'):
                    break
        if executable == 'rm':
            flags = ''.join(arg[1:] for arg in rest if arg.startswith('-')
                            and not arg.startswith('--'))
            recursive = 'r' in flags or 'R' in flags or '--recursive' in rest
            force = 'f' in flags or '--force' in rest
            if recursive and force:
                return True
        if re.search(r'\s', word) and re.search(r'\b(?:git|rm)\b', word):
            if destructive(word):
                return True
    return False


def handle(payload):
    if not isinstance(payload, dict):
        return denial('Invalid Maister hook input; refusing execution.')
    event = payload.get('hook_event_name')
    if event == 'PreToolUse':
        tool_input = payload.get('tool_input')
        if not isinstance(tool_input, dict):
            return denial('Missing tool input; refusing execution.')
        command = tool_input.get('command')
        if not isinstance(command, str) or not command.strip():
            return denial('Missing shell command; refusing execution.')
        if destructive(command):
            return denial(
                'Destructive command blocked by Maister. Do not discard sibling '
                'work. Ask the user before rollback; a trusted human must '
                'perform destructive recovery outside automated execution.'
            )
        return {}
    if event in ('SessionStart', 'SubagentStart'):
        return {'hookSpecificOutput': {
            'hookEventName': event,
            'additionalContext': REMINDER,
        }}
    return denial('Unsupported Maister hook event; refusing execution.')


def main():
    try:
        result = handle(json.load(sys.stdin))
    except (ValueError, TypeError, RecursionError):
        result = denial('Malformed Maister hook input; refusing execution.')
    print(json.dumps(result))


if __name__ == '__main__':
    main()