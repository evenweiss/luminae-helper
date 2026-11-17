# Codex workflow integration test

Run `/usr/bin/python3 -B test/codex-workflow/run.py` from the repository. It requires the macOS ChatGPT desktop app and permission to bind local loopback and Unix sockets. Pass the marketplace directory as the first argument to test a packed copy.

The harness installs the plugin in a disposable profile and derives trust for this fixture only from the host's hook hashes. It uses the bundled app-server and desktop MCP bridge with scripted model responses and a mock desktop receiver. No real desktop service, account, or scheduler is connected.

The four scenarios cover write permissions after actual compaction, rejection before delivery through the supported dispatch tools, a manual independent checkpoint when both chats were silent, and default permissions and dispatch behavior in an ordinary chat. The report classification helper is a test fixture. The independent monitor is not deployed and does not send notifications.
