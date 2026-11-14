"""Check outgoing task packets for explicitly registered Codex coordinators."""

from argparse import ArgumentTypeError
import json
import re
import sys

from codex_compact import identifier, session_dir

PREFIX = 'mcp__codex_app__'
DESTINATIONS = {PREFIX + 'send_message_to_thread': 'threadId', PREFIX + 'create_thread': 'target'}
OTHER_DISPATCH = {PREFIX + 'fork_thread', PREFIX + 'handoff_thread'}
PACKET = re.compile(r'^```workflow-dispatch[ \t]*\n(.*?)\n^```[ \t]*$', re.M | re.S)
EVENTS = {'completed', 'stopped', 'blocked'}
ROLES = {'开发执行者', '独立验证者', '独立监督者', '产品执行者', '设计执行者', '文档执行者'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def field(obj, key):
    value = obj.get(key)
    require(isinstance(value, str) and value.strip(), f'缺少 {key}')
    return value


def section(obj, key):
    value = obj.get(key)
    require(isinstance(value, dict), f'缺少 {key}')
    return value


def validate(args, policy, destination):
    blocks = PACKET.findall(field(args, 'prompt'))
    require(len(blocks) == 1, '派单正文须含一段 workflow-dispatch 回传安排')
    packet = json.loads(blocks[0])
    require(isinstance(packet, dict), '派单段须为 JSON 对象')
    for key in ('task', 'version'):
        require(field(packet, key) == field(policy, key), f'{key} 与登记不符')
    role = field(packet, 'role')
    require(role in ROLES, '填写本次执行身份')
    routes = policy.get('routes')
    require(isinstance(routes, list), '登记缺少 routes')
    target = field(args, destination) if destination == 'threadId' else section(args, destination)
    matches = [route for route in routes if isinstance(route, dict)
               and route.get(destination) == target and route.get('role') == role]
    if destination == 'threadId':
        matches = [route for route in matches if route.get('hostId') == args.get('hostId')]
    require(len(matches) == 1, '派单目标和身份须匹配唯一登记路线')
    route = matches[0]
    reporting = section(packet, 'reporting')
    expected = section(route, 'reporting')
    for key in ('mode', 'authorization', 'recipient', 'entry', 'deliverable'):
        require(field(reporting, key) == field(expected, key), f'回传 {key} 与登记不符')
    events = reporting.get('events')
    require(isinstance(events, list) and all(isinstance(event, str) for event in events)
            and EVENTS.issubset(events) and events == expected.get('events'),
            '回传事件须匹配登记，并含完成、中止及新实质阻塞')
    if reporting['mode'] == 'active':
        require(reporting['authorization'] == 'approved'
                and field(reporting, 'source') == field(expected, 'source'), '主动回传须匹配已登记授权出处')
    else:
        require(reporting['mode'] == 'read-only' and reporting['authorization'] in {'pending', 'not-enabled'}
                and 'source' not in reporting, '只读查收须明确主动回传待答或未启用')
    checkpoint = section(packet, 'checkpoint')
    expected_checkpoint = section(route, 'checkpoint')
    for key in ('owner', 'trigger', 'entry'):
        require(field(checkpoint, key) == field(expected_checkpoint, key), f'检查点 {key} 与登记不符')
    # The operator confirms the trigger is independent when registering. Dispatch cannot change it.


def check(event):
    tool = event.get('tool_name')
    if tool not in DESTINATIONS and tool not in OTHER_DISPATCH:
        return
    session = identifier(field(event, 'session_id'))
    policy_path = session_dir('codex', session).parent.parent / 'dispatch' / (session + '.json')
    try:
        with policy_path.open(encoding='utf-8') as file:
            policy = json.load(file)
    except FileNotFoundError:
        return
    require(isinstance(policy, dict) and policy.get('coordinator') == session, '统筹登记与会话不符')
    require(tool in DESTINATIONS, '已启用的统筹须通过创建或向现有会话发送任务包派单')
    validate(section(event, 'tool_input'), policy, DESTINATIONS[tool])


def main():
    try:
        check(json.load(sys.stdin))
    except (OSError, ValueError, TypeError, ArgumentTypeError) as error:
        reason = str(error) if isinstance(error, ValueError) else '无法读取派单登记或正文'
        print(json.dumps({'hookSpecificOutput': {
            'hookEventName': 'PreToolUse', 'permissionDecision': 'deny',
            'permissionDecisionReason': f'派单校验未通过：{reason}',
        }}, ensure_ascii=False))


if __name__ == '__main__':
    main()
