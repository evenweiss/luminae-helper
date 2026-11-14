import json
from pathlib import Path
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import socketserver
import struct
import subprocess
from threading import Thread
from queue import Empty, Queue

RES = Path('/Applications/ChatGPT.app/Contents/Resources')
BINARY = RES / 'codex-cli/CodexCLI.app/Contents/MacOS/codex'
BRIDGE = RES / 'plugins/openai-bundled/plugins/codex-app-tools'
NODE = RES / 'cua_node/bin/node'
TOOL = 'send_message_to_thread'
CREATE = 'create_thread'
FORK = 'fork_thread'
HANDOFF = 'handoff_thread'
MOCK_TARGET = '00000000-0000-4000-8000-000000000001'
MOCK_COORDINATOR = '00000000-0000-4000-8000-000000000002'

def receive_exact(socket, size):
    parts = bytearray()
    while len(parts) < size:
        chunk = socket.recv(size - len(parts))
        if not chunk:
            if not parts:
                return None
            raise EOFError('Incomplete fixture frame')
        parts.extend(chunk)
    return parts


class MockDesktop(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True

    def __init__(self, path):
        self.calls = []
        self.reports = {}
        super().__init__(str(path), self.Handler)

    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            while header := receive_exact(self.request, 4):
                length, = struct.unpack('<I', header)
                assert 0 < length < 500_000
                request = json.loads(receive_exact(self.request, length))
                method = request['method']
                if method == 'tools/list':
                    specs = {TOOL: ['threadId', 'prompt', 'hostId'], CREATE: ['target', 'prompt'], FORK: ['threadId'], HANDOFF: ['threadId'], 'read_thread': ['threadId']}
                    result = {'tools': [{
                        'namespace': 'codex_app', 'name': name, 'description': 'Isolated desktop tool fixture',
                        'inputSchema': {'type': 'object', 'properties': {k: ({'type': 'object', 'properties': {'type': {'type': 'string'}}, 'required': ['type']} if k == 'target' else {'type': 'string'}) for k in keys},
                                        'required': [key for key in keys if key != 'hostId'], 'additionalProperties': False},
                        'annotations': {'readOnlyHint': name == 'read_thread',
                                        'destructiveHint': False, 'openWorldHint': False},
                    } for name, keys in specs.items()]}
                elif method == 'tools/call':
                    args = request['params']['arguments']
                    tool = request['params']['tool']
                    if tool != CREATE:
                        assert args['threadId'] in {MOCK_TARGET, MOCK_COORDINATOR}, args
                    self.server.calls.append((tool, args))
                    if tool in {TOOL, CREATE, FORK, HANDOFF}:
                        assert args.get('threadId') == MOCK_TARGET or args.get('target') == {'type': 'projectless'}, args
                        payload = {'mockReceipt': 'NO_REAL_DISPATCH'}
                    else:
                        assert tool == 'read_thread', tool
                        payload = self.server.reports[args['threadId']]
                    result = {'contentItems': [{'type': 'inputText', 'text': json.dumps(payload, ensure_ascii=False)}],
                              'success': True}
                elif method == 'tools/cancel':
                    continue
                else:
                    raise AssertionError(request)
                reply = json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}).encode()
                self.request.sendall(struct.pack('<I', len(reply)) + reply)


class ModelFixture(ThreadingHTTPServer):
    def __init__(self):
        self.steps = []
        self.requests = []
        self.errors = []
        self.index = 0
        super().__init__(('127.0.0.1', 0), self.Handler)

    def use(self, *steps):
        self.steps = list(steps)
        self.index = 0

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            model = self.server
            model.requests.append((self.path, body))
            output = {'id': 'msg_fixture', 'type': 'message', 'role': 'assistant', 'status': 'completed',
                      'content': [{'type': 'output_text', 'text': 'fixture done', 'annotations': []}]}
            if self.path.endswith('/compact'):
                response = {'id': 'resp_compact', 'object': 'response.compaction',
                            'created_at': 1, 'output': [output], 'usage': None}
                data = json.dumps(response)
                mime = 'application/json'
            else:
                if model.index < len(model.steps):
                    tool, arguments = model.steps[model.index]
                    model.index += 1
                    found = []
                    for spec in body.get('tools', []):
                        found.append((spec.get('namespace'), spec.get('name'), spec.get('type'), spec.get('type') == 'namespace' and [x.get('name') for x in spec.get('tools', [])]))
                    match = next((x for x in found if x[1] == tool or x[1] and x[1].endswith('__' + tool) or x[3] and tool in x[3]), None)
                    if not match:
                        model.errors.append((tool, found))
                    else:
                        if match[3]:
                            namespace, name = match[1], tool
                        else:
                            namespace, name = match[:2]
                        output = {'type': 'function_call', 'id': f'fc{model.index}',
                                  'call_id': f'call{model.index}', 'name': name, 'arguments': json.dumps(arguments),
                                  'status': 'completed'}
                        if namespace:
                            output['namespace'] = namespace
                response = {'id': f'resp_{len(model.requests)}', 'object': 'response', 'created_at': 1,
                            'model': 'fixture-model', 'status': 'completed', 'output': [output],
                            'usage': {'input_tokens': 25, 'output_tokens': 5, 'total_tokens': 30,
                                      'input_tokens_details': {'cached_tokens': 0},
                                      'output_tokens_details': {'reasoning_tokens': 0}}}
                events = [('response.created', {'response': {**response, 'status': 'in_progress', 'output': []}}),
                          ('response.output_item.done', {'output_index': 0, 'item': output}),
                          ('response.completed', {'response': response})]
                data = ''.join(f'event: {name}\ndata: {json.dumps(dict(event, type=name))}\n\n' for name, event in events)
                mime = 'text/event-stream'
            data = data.encode()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_):
            pass


@contextmanager
def process_app(root, env):
    with (root / 'runtime.log').open('a') as log:
        p = subprocess.Popen([str(BINARY), 'app-server', '--listen', 'stdio://'], cwd=root,
                             env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
        try:
            rpc = Rpc(p)
            rpc.call('initialize', {'clientInfo': {'name': 'workflow-fixture', 'version': '0.1'},
                                    'capabilities': {'experimentalApi': True}})
            rpc.send({'method': 'initialized'})
            yield rpc
        finally:
            p.terminate()
            p.wait(timeout=5)


def new_thread(rpc, cwd, permissions=None):
    settings = {'permissions': permissions} if permissions else {}
    result = rpc.call('thread/start', {'cwd': str(cwd), 'approvalPolicy': 'never', **settings})
    return result


def turn(rpc, model, thread, label, *steps):
    model.use(*steps)
    start = len(model.requests)
    response = rpc.call('turn/start', {'threadId': thread, 'input': [{'type': 'text', 'text': label}]})
    rpc.finish_turn(thread, response['turn']['id'])
    assert not model.errors, model.errors
    assert model.index == len(steps), (label, model.index, steps)
    return [body for _, body in model.requests[start:]]


def setup(root, model, desktop_path, extra=''):
    config = root/'profile'
    config.mkdir()
    # Run the bundled desktop server against exactly one synthetic socket.
    env = {'PATH': '/usr/bin:/bin:/opt/homebrew/bin', 'TMPDIR': str(root),
           'CODEX_HOME': str(config), 'HOME': str(root), 'NO_PROXY': '127.0.0.1,localhost',
           'HTTP_PROXY': 'http://127.0.0.1:1', 'HTTPS_PROXY': 'http://127.0.0.1:1',
           'ALL_PROXY': 'http://127.0.0.1:1'}
    cfg = config/'config.toml'
    cfg.write_text(f'''model = "fixture-model"
model_provider = "fixture"
{extra}
[model_providers.fixture]
name = "Loopback"
base_url = "http://127.0.0.1:{model.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false

[features]
code_mode = false

[mcp_servers.codex_app]
command = {json.dumps(str(BRIDGE/'scripts/launch_codex_app_tools_mcp'))}
args = [{json.dumps(str(BRIDGE/'server.mjs'))}]
env = {{ CODEX_APP_TOOLS_PIPE_PATH = {json.dumps(str(desktop_path))}, CODEX_MCP_NODE_PATH = {json.dumps(str(NODE))} }}
default_tools_approval_mode = "approve"
''')
    return env, cfg


def trust_fixture_hooks(root, env, cfg, cwd):
    with process_app(root, env) as rpc:
        result = rpc.call('hooks/list', {'cwds': [str(cwd)]})['data'][0]
        assert not result['errors'] and result['hooks'], result
        assert {hook['eventName'] for hook in result['hooks']} == {'sessionStart', 'preToolUse'}, result
        for hook in result['hooks']:
            assert hook['source'] == 'plugin' and hook['trustStatus'] == 'untrusted', hook

    with cfg.open('a') as f:
        for hook in result['hooks']:
            hook_hash, _, content_hash = hook['currentHash'].partition('/')
            assert hook_hash and content_hash, hook
            f.write(f'\n[hooks.state.{json.dumps(hook["key"])}]\nenabled = true\n')
            f.write(f'trusted_hash = {json.dumps(hook_hash)}\n')
            f.write(f'trusted_content_hash = {json.dumps(content_hash)}\n')



class Rpc:
    def __init__(self, process):
        self.process = process
        self.messages = Queue()
        self.serial = 0
        self.events = []
        Thread(target=self.receive, daemon=True).start()

    def receive(self):
        for line in self.process.stdout:
            self.messages.put(json.loads(line))

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + '\n')
        self.process.stdin.flush()

    def next(self):
        try:
            message = self.messages.get(timeout=12)
        except Empty as error:
            raise AssertionError('Codex stopped responding') from error
        if 'method' in message:
            self.events.append(message)
        return message

    def call(self, method, params):
        self.serial += 1
        self.send({'id': self.serial, 'method': method, 'params': params})
        while True:
            message = self.next()
            if message.get('id') == self.serial:
                assert 'error' not in message, message
                return message['result']

    def finish_turn(self, thread, turn=None):
        def matches(event):
            if event['method'] != 'turn/completed':
                return False
            params = event['params']
            return params['threadId'] == thread and (turn is None or params['turn']['id'] == turn)

        while not any(map(matches, self.events)):
            self.next()
        event = next(event for event in self.events if matches(event))
        self.events.remove(event)
        assert event['params']['turn']['status'] == 'completed', event



MARKER = '上下文刚压缩。这条提醒仅适用于下列任务'

def developer_context(body):
    return '\n'.join(part.get('text', '') for item in body.get('input', [])
                     if item.get('role') == 'developer' for part in item.get('content', []))
