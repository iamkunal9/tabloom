# Tabloom design

Tabloom lets an agent operate existing browser tabs after the user enables control in an extension. One private repository contains a Manifest V3 extension, Node.js local bridge and CLI, an MCP adapter, reusable skill, installer, tests, and documentation. The user approved implementation and private GitHub publication in this session.

## Experience and scope

The popup offers Current tab and Full browser. Current tab captures the tab ID at the moment of approval; switching tabs never changes the grant. Full browser includes existing and future normal HTTP(S) tabs in this profile, excluding incognito and browser-internal pages. Full browser permits opening/closing tabs. The popup states this scope explicitly and offers Stop all control. No remote command can grant scope. Revoking scope invalidates queued commands and detaches debugger sessions. A lost bridge connection revokes scope; reconnect requires fresh user enablement. A browser restart does not restore grants.

The extension pairs to a local bridge by pasting a random token from the CLI. Token is stored locally, never committed, and HTTP/WS traffic stays on 127.0.0.1. The local bridge is trusted with authorized page data. The agent's configured model provider may receive tool results; no separate cloud service, analytics, or embedded model credentials are used.

## Architecture

Node 22+ ESM. Chrome 125+ MV3 with debugger, tabs, storage, alarms permissions and loopback host permission. No website-wide content script injection or externally_connectable. `chrome.debugger` sends bounded CDP actions to approved tab IDs. No arbitrary CDP forwarding or JavaScript evaluation exposed to agents. CDP Runtime.evaluate is used internally with serialized parameters to read the page and resolve selectors. Support main document and open shadow roots for snapshots/interaction; cross-origin iframe targeting can remain a documented limitation in v1.

The bridge listens on 127.0.0.1:17653 (configurable port for tests). HTTP POST /command uses Authorization: Bearer TOKEN with JSON `{method,params}` and returns `{ok:true,result}` or `{ok:false,error:{code,message}}`. GET /health exposes only non-sensitive liveness. Reject browser Origin headers for HTTP control, wrong Host headers, oversized bodies, invalid methods, and unauthenticated calls. WebSocket /extension accepts only chrome-extension origins, authenticates first message `{type:'hello',token}`, and replies `{type:'hello',ok:true}`. One extension at a time; never silently replace a paired connection. Server requests `{type:'command',id,method,params}`, extension replies `{type:'result',id,ok,result?,error?}`. Heartbeat `{type:'ping'}` / `{type:'pong'}` every 20 seconds. Commands time out, disconnected pending work fails, and payload size is bounded. Extension rechecks grant/version immediately before side effects.

## Commands

`status {}` returns mode (off/tab/browser), tabId if tab-scoped, connected state. `tabs {}` returns only permitted tabs with id/title/url. `snapshot {tabId}` returns title/url/text and an array of interactive elements with selectors (bounded text and count). `click {tabId,selector}` resolves a unique visible element then CDP mouse events. `type {tabId,selector,text}` focuses, selects existing content, and inserts text; `press {tabId,key}` supports Enter/Tab/Escape/Backspace and arrow keys. `scroll {tabId,x?,y?}` scrolls by deltas. `navigate {tabId,url}` accepts HTTP(S) only. `screenshot {tabId}` returns `{mimeType:'image/png',data:base64}`. `open {url}` and `close {tabId}` require full-browser grant. Invalid selectors/arguments, forbidden scopes/URLs, detached debugger, bridge disconnects and timeouts return readable errors. A session's commands are serialized, but revocation does not wait on the queue.

## Distribution

CLI: `tabloom serve`, `tabloom pair` (print local pairing token), `tabloom status`, `tabloom tabs`, `tabloom <method> '<JSON params>'`, `tabloom mcp`, `tabloom install-skill --agent codex|claude|all [--force]`. Standard skill locations and custom `--dir` for tests. Installer refuses overwrite unless --force; copies real skill and helper with an absolute CLI path so agent execution is independent of cwd. Private repo bootstrap uses `gh repo clone iamkunal9/tabloom && cd tabloom && npm ci && npm link && tabloom install-skill --agent all`; no public npm package is promised. README also gives one-command skill install from a cloned repo. Extension is load-unpacked with no browser restart; Chrome still requires the user's installation interaction.

## Validation

Node tests cover protocol/authentication, pending-request lifecycle, scope denial and revocation, input validation, installer behavior, and MCP tool transport. A real headed Chromium test loads the extension, pairs through its UI, grants current tab, drives a local fixture via the bridge/CLI, verifies typing/clicking/snapshot/screenshots/navigation, denies an unapproved second tab, enables full browser and verifies existing/new tab access, open/close, then stops and proves access is denied. Reconnect and browser restart must not restore grants. Automated test browser may use extension-loading flags in an isolated profile; this is test harness setup and not the user workflow. Keep a visible demo browser open at completion if practical. Record actual evidence and limitations, never infer end-to-end success from mocks.

## Repository conventions

No assistant attribution, co-author trailer, generated-by branding, or assistant name in commits/docs. Agent client names appear only where needed for compatibility instructions. No credentials, profiles, screenshots of personal browsing, or local pairing tokens in git. Private GitHub repository `iamkunal9/tabloom` after reviews and checks. Work in this fresh dedicated directory on build/tabloom; there is no pre-existing branch/work to isolate.
