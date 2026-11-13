"""Maintain task locators and restore coordination context after context compaction."""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys
import tempfile

SKILL = Path(__file__).resolve().parents[1] / 'SKILL.md'


def identifier(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', value):
        raise argparse.ArgumentTypeError('Use an ID of 1–128 letters, digits, or _ . : -')
    return value


def session_dir(host, session):
    config_var, default = ('CLAUDE_CONFIG_DIR', '.claude') if host == 'claude-code' else ('CODEX_HOME', '.codex')
    config_dir = Path(os.environ.get(config_var) or Path.home() / default).expanduser()
    return config_dir / 'ai-development-workflow' / 'coordinators' / sha256(session.encode()).hexdigest()


def readable_record(path):
    return path.is_absolute() and path.is_file() and os.access(path, os.R_OK)


def update_registration(args):
    directory = session_dir(args.host, args.session)
    entry = directory / (sha256(args.task.encode()).hexdigest() + '.json')
    if args.action == 'unregister':
        entry.unlink(missing_ok=True)
        return
    if not readable_record(args.record):
        raise ValueError('Provide an absolute path to a readable coordination record.')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Each task has its own file, so an update never rewrites other registrations.
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=directory, delete=False) as file:
        pending = Path(file.name)
        try:
            json.dump({'task': args.task, 'record': str(args.record)}, file, ensure_ascii=False)
            file.close()
            pending.replace(entry)
        finally:
            pending.unlink(missing_ok=True)


def registration_context(host, session):
    def quote(value):
        return json.dumps(str(value), ensure_ascii=False)

    tasks = []
    for entry in sorted(session_dir(host, session).glob('*.json')):
        try:
            info = json.loads(entry.read_text(encoding='utf-8'))
            task = identifier(info['task'])
            record = Path(info['record'])
            readable = readable_record(record)
        except (ValueError, OSError, TypeError, KeyError, argparse.ArgumentTypeError):
            continue
        locator = f'- 任务 {quote(task)}，协调记录 {quote(record)}'
        if not readable:
            locator += '（不可读取。先做只读核查，暂缓受影响的写入或实质验证。）'
        tasks.append(locator)
    if not tasks:
        return ''
    return '\n'.join([
        '上下文刚压缩。这条提醒仅适用于下列任务。登记只是查找记录的入口。',
        f'重新读取技能 {quote(SKILL)} 和适用引用。处理下列任务时，逐项核对最新分工、执行者和授权。',
        '确认在该任务仍为统筹时，沿用分工，复用有效派单或按已有授权下发，由执行者实施。',
        '若角色或写入归属未核实，先做只读核查，暂缓该任务受影响的写入或实质验证。',
        '其他任务仍按各自的分工处理。',
        *tasks,
    ])


def run_hook(host):
    event = json.load(sys.stdin)
    if event.get('hook_event_name') != 'SessionStart' or event.get('source') != 'compact':
        return
    context = registration_context(host, identifier(event['session_id']))
    if context:
        print(json.dumps({'hookSpecificOutput': {
            'hookEventName': 'SessionStart', 'additionalContext': context,
        }}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', choices=('codex', 'claude-code'), default='codex')
    actions = parser.add_subparsers(dest='action')
    for action in ('register', 'unregister'):
        command = actions.add_parser(action)
        command.add_argument('session', type=identifier)
        command.add_argument('task', type=identifier)
        if action == 'register':
            command.add_argument('record', type=Path)
    args = parser.parse_args()
    if args.action is None:
        run_hook(args.host)
        return
    try:
        update_registration(args)
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
