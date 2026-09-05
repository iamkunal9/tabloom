# Testing Tabloom

## Local checks

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
```

The end-to-end suite opens a real browser window. On Linux without a display, run it under Xvfb:

```sh
xvfb-run -a npm run test:e2e
```

The tests use a temporary browser profile and local fixture pages. They do not read your everyday browser's profile or tabs. The suite loads the extension, pairs it through its popup, and sends agent operations through the actual local bridge. Independent browser assertions check the resulting page state.

## What each layer proves

| Layer | Purpose |
| --- | --- |
| Scope and action unit tests | Tab selection, URL eligibility, argument validation, and grant invalidation |
| Bridge integration tests | Authentication, origin/host validation, WebSocket pairing, request routing, failures and timeouts |
| Installer tests | Agent locations, repeat installation, overwrite protection, and helper execution |
| MCP integration tests | Tool discovery, argument validation, structured results, and image content |
| Browser end-to-end tests | Actual popup, debugger attachment, page interaction, scope switching, revocation, and reconnect behavior |

A successful unit test does not prove that Chrome accepted a debugger operation. The real browser suite is the required check for that boundary. Likewise, starting a bridge without a connected extension is not an end-to-end test.

## Browser setup versus user setup

The harness launches bundled Chromium with extension-loading flags and a disposable profile. This is necessary for automated setup and is separate from the user workflow. In everyday Chrome, use **Load unpacked** in an already-running browser; no remote-debugging flag or restart is required.

The [Playwright extension documentation](https://playwright.dev/docs/chrome-extensions) describes persistent browser contexts and Chromium extension loading. Tabloom's page control itself uses the extension's [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger). Its live transport follows Chrome's [service-worker WebSocket guidance](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets).

## Failure interpretation

- **Bridge unavailable:** start the bridge and confirm the configured port.
- **Extension disconnected:** pair the extension and wait for Connected.
- **Scope denied:** enable Current tab or Full browser in the extension. A reconnect intentionally clears the previous grant.
- **Debugger interrupted:** close competing DevTools sessions, check Chrome's permission state, and enable control again.
- **Action timeout:** inspect the page before retrying. A timeout cannot roll back a side effect already dispatched to the browser.

Screenshots and browser profiles belong under ignored artifact or temporary directories. Never attach test output containing pairing tokens or private browsing data to a public issue.

## Local release validation

The initial release was exercised on macOS with Node 24 and headed Chromium 153.0.8010.12. Browser actions traveled through the real bridge and extension; the suite exercised CLI calls and an MCP stdio client, including tab-list arrays and page snapshots.

An independent agent also used the installed skill from `/tmp` against the approved local playground. It entered `Tabloom works`, submitted the form, incremented the counter once, and observed `Hello, Tabloom works!` and `Count: 1`. The installed helper resolved the checkout correctly outside its working directory.

Source review and browser tests caught defects in input focus, Enter dispatch, pending approval revocation, shadow selectors, grant cleanup, malformed authentication, MCP result shape, bridge queuing, and executable symlink handling. Regression tests cover the corrected behavior. The CI workflow repeats the automated checks on Linux; local evidence alone does not establish a Linux CI result.
