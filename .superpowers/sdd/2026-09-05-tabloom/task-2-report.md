# Task 2 report: local bridge, CLI, MCP, and skill installer

## Result

Implemented the loopback bridge, authenticated extension WebSocket, CLI/client/config support, typed MCP adapter, and installable Tabloom skill. The bridge binds only to `127.0.0.1`, validates Host, Origin, bearer authentication, envelope shape, command name, and command parameters before dispatch.

The timeout policy follows the preflight ruling: a command timeout calls `terminate()` on the WebSocket. All active requests are rejected, queued requests fail when they reach the disconnected session, and the extension receives a socket close so it immediately revokes its grant. An unauthenticated WebSocket has a five-second default hello deadline. Heartbeats default to a 20-second send interval and a 45-second last-pong deadline; a missed deadline terminates the socket and rejects pending work.

## Interfaces for E2E integration

- `startServer({ port, token, commandTimeoutMs?, helloTimeoutMs?, heartbeatIntervalMs?, heartbeatDeadlineMs?, maxPending? })` binds `127.0.0.1`. Port `0` is supported for tests. It resolves to `{ port, close() }`, where `close()` is asynchronous.
- `GET /health` returns exactly `{"ok":true}` and contains no token or connection details.
- `POST /command` requires `Authorization: Bearer TOKEN`, no `Origin`, a loopback Host, and JSON `{"method":"METHOD","params":{...}}`. Success is `{"ok":true,"result":...}`; failure is `{"ok":false,"error":{"code":"...","message":"..."}}` with an appropriate non-2xx status.
- `ws://127.0.0.1:PORT/extension` requires a `chrome-extension://` Origin with a 32-character Chrome extension ID. The first message must be `{"type":"hello","token":"TOKEN"}` and the response is `{"type":"hello","ok":true}`. A second connection is closed with policy code 1008.
- Bridge dispatch is `{"type":"command","id":"STRING","method":"METHOD","params":{...}}`. Extension replies `{"type":"result","id":"STRING","ok":true,"result":...}` or `{"type":"result","id":"STRING","ok":false,"error":{"code":"...","message":"..."}}`.
- Heartbeats are JSON `{"type":"ping"}` and `{"type":"pong"}` in either direction. Request and WebSocket payloads are capped at 1,000,000 bytes; pending plus queued commands default to 100; execution is serialized.
- Supported methods and validation match `extension/actions.js`: `status`, `tabs`, `snapshot`, `click`, `type`, `press`, `scroll`, `navigate`, `screenshot`, `open`, and `close`. URLs are HTTP(S), tab IDs are non-negative integers, selectors are non-empty and at most 2,048 characters, type text is at most 100,000 characters, and keys use the extension whitelist.
- Config is `${TABLOOM_CONFIG_DIR:-~/.config/tabloom}/config.json`; the directory mode is `0700` and file mode is `0600`. `TABLOOM_PORT` overrides the stored port for clients and serving.
- CLI: `tabloom pair [--port N]`, `tabloom serve [--port N]`, `tabloom status`, `tabloom tabs`, `tabloom METHOD '{...}'`, `tabloom mcp`, and `tabloom install-skill --agent codex|claude|all [--dir DIR] [--force]`. Both `serve` and `pair` initialize a missing config. `pair` reuses the existing token; an explicit changed port preserves the token and returns `restartRequired:true`. `serve --port 0` records its actual bound port for test and integration use. `pair` is the only operation that prints a token. Errors are JSON on stderr with a nonzero exit.
- MCP tools are named `tabloom_status`, `tabloom_tabs`, `tabloom_snapshot`, `tabloom_click`, `tabloom_type`, `tabloom_press`, `tabloom_scroll`, `tabloom_navigate`, `tabloom_screenshot`, `tabloom_open`, and `tabloom_close`. Screenshot output is MCP image content with the extension-provided MIME type and base64 data.
- With a custom `--dir`, a single agent installs at `DIR/tabloom`; `--agent all` installs at `DIR/codex/tabloom` and `DIR/claude/tabloom`. Default locations are `~/.codex/skills/tabloom` and `~/.claude/skills/tabloom`. Existing destinations fail before changes unless `--force` is present. The installed helper embeds the absolute `src/cli.js` path.

## Test-driven development evidence

The first test run failed because `src/server.js`, `src/install-skill.js`, and `src/mcp.js` did not exist. Implementation followed that observed red state. The initial green run found one invalid test mechanism: Node fetch does not permit overriding Host as expected, so the hostile-Host assertion was corrected to use a real `node:http` request. The resulting bridge, installer, and MCP tests passed. A subsequent cycle added configuration permission and live missed-heartbeat coverage.

Final validation:

- `npm test`: 30 passed, 0 failed. This includes the existing extension tests and all Task 2 tests under `tests/*.test.js`, including a child-process lifecycle test proving that fresh `serve` followed by `pair` uses the live bridge token.
- `python3 /Users/iamkunal9/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/tabloom`: `Skill is valid!`
- Direct CLI usage-error check: nonzero exit and one JSON error object on stderr.
- Dependency audit during install: 0 vulnerabilities.

E2E remains deliberately separate under `npm run test:e2e`; Task 2 did not claim a real browser run.
