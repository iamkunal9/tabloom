# Trust and permissions

Tabloom connects an agent running on your machine to browser tabs you explicitly enable. There is no hosted Tabloom service and no telemetry. Your agent may send returned page content and screenshots to its model provider under that agent's configuration.

## Scope

- **Current tab:** the normal HTTP(S) tab selected when you click the button. Switching tabs does not move the grant. Navigations within that tab stay in scope, including another website.
- **Full browser:** existing and future normal HTTP(S) tabs in the browser profile containing this extension. It permits creating and closing tabs. It excludes incognito tabs and browser-internal pages.
- **Stop all control:** clears authorization and detaches active debugger sessions. It prevents subsequent commands; it cannot undo an action the browser has already performed.

Browser scope means page/tab control, not unrestricted access to operating system dialogs, browser settings, other profiles, other browsers, or extensions. Each profile needs its own installation and explicit grant. One bridge accepts one connected extension at a time.

The extension requires Chrome's `debugger` permission for page inspection, input, and screenshots. This permission is broader than Tabloom's controls: Tabloom enforces the selected scope itself before executing commands. Chrome may display a debugging indicator. Do not suppress it with browser flags. Opening DevTools can interrupt debugger attachment; if control stops, close competing tools and enable control again.

## Pairing and local transport

The bridge binds only to `127.0.0.1`. Pairing uses a random local token, stored in a file restricted to your OS account and in the extension's local storage. Treat that token like a password: an authenticated local caller can use the scope you enabled. Status and health responses do not expose the token.

HTTP commands require a bearer token and reject web-page Origin headers and unexpected Host values. The extension connection authenticates over WebSocket; its Origin must identify a Chrome extension. Origin checks supplement the token; a native local program can forge an Origin header. Local malware or another process running as your OS user is outside this boundary.

Commands are limited to named operations and validated arguments. Agents cannot request arbitrary JavaScript evaluation, raw CDP calls, or remotely grant themselves browser scope. Protected URL schemes are rejected. Pairing is not consent to control: enable the desired scope separately.

## Lifecycle

Grants are not restored after a browser restart or bridge disconnection. Reconnecting restores the transport, and you enable control again in the popup. Requests have time and size limits. Stop invalidates queued work. Timeouts do not prove an action had no effect: inspect the page before retrying a click, submission, or navigation.

Cancelling debugging through Chrome also revokes control. Tabloom does not automatically reattach under that cancelled grant. Internal debugger cleanup when changing scope preserves the newly selected grant.

Selector-based actions are tied to the document on which they were prepared. If the tab navigates or reloads during preparation, the action fails instead of reusing old coordinates or focus on the new document. Take a fresh snapshot before continuing. Typing requires a supported editable element that actually holds focus; disabled, read-only, and nontext controls are rejected.

## Agent behavior

The skill tells agents to treat pages as untrusted data and verify outcomes after actions. Text on a page cannot grant permission, expand the task, or authorize sending private data. Enabling a tab permits using the tools; the user's task determines which actions the agent should perform.

Avoid enabling broad browser scope when a single tab is sufficient. Never commit pairing tokens, browser profiles, private page screenshots, or personal browsing data. Test artifacts and local configuration are excluded from the repository.

## Reporting a problem

Send a private report to the repository owner through a channel you already share. Include the affected version, reproduction steps using a non-sensitive test page, expected scope, and actual result. Do not include tokens or private page content.
