# Task 3 report: headed Chromium E2E and demo

## Result

Added a reproducible headed Chromium E2E suite and a visible demo launcher. The suite uses a temporary Chromium profile and Tabloom config, loads the unpacked extension with Playwright's Chromium channel, pairs and changes grants only through the popup UI, sends target-page actions only through the real Tabloom bridge, CLI, and MCP process, and uses Playwright for setup and independent assertions.

## Browser coverage

The passing suite verifies:

- Popup pairing through `#port`, `#token`, and `#pair-form`, then Current tab, Full browser, narrowed Current tab, and Stop through their real buttons. Popup state assertions cover `#connected`, `#scope`, and denial behavior.
- Current-tab scope captures the selected normal tab while the popup is active. The permitted tab supports snapshot, type, Backspace and Enter press, click, scroll, PNG screenshot, and two-way navigation. A second existing fixture tab is denied.
- Snapshot selectors round-trip through one and two nested open shadow roots. Tabloom types and clicks those returned selectors, and independent DOM assertions verify both effects.
- A real child-process CLI performs the browser commands using a temporary normal Tabloom config. A real stdio MCP client calls `tabloom_snapshot` and `tabloom_tabs`; the latter verifies an array result remains valid MCP text output.
- Full-browser scope includes both existing HTTP fixture tabs and excludes a `chrome://version/` tab. It opens a future HTTP tab and closes it by returned Chrome tab ID.
- Narrowing Full browser to Current tab immediately denies the second tab while preserving the selected tab.
- Stop changes scope to Off and subsequent page access is denied.
- Closing the bridge changes the popup to Disconnected and revokes the grant. Starting the bridge again and pairing through the popup reconnects with scope still Off.
- Closing and relaunching Chromium with the same persistent profile retains pairing configuration but does not restore a grant. Pairing/reconnecting after restart remains Off and page access is denied.

The test writes ignored evidence to `artifacts/e2e-popup.png`, `artifacts/e2e-target.png`, and `artifacts/e2e-result.json`. The latest record identifies Chromium `153.0.8010.12` and the popup screenshot is cropped to its 400 by 619 pixel application surface.

## Defect found during the first browser run

The first complete browser attempt showed that Tabloom `press` with Enter returned success but did not submit the focused form. The failing assertion timed out with the result still unchanged. The coordinator fixed CDP Enter dispatch in commit `ff6a35a` by sending carriage-return text on keyDown. The suite restored the Enter submission assertion and passed with that product fix. The E2E files do not alter extension product modules.

## Demo

Run:

```bash
npm run demo
```

The demo reads the default Tabloom config and creates it when absent, starts the real bridge and local fixture, loads the extension in a headed isolated temporary profile, pairs through the popup, and leaves the fixture and extension tab open for the user to choose a grant. It prints the fixture URL and shutdown instruction but never prints the token. Closing the browser or pressing Ctrl+C closes the bridge and fixture and removes the temporary profile. A fresh-config smoke run reached the ready state successfully.

## Verification

- `npm run test:e2e`: 1 passed, 0 failed in 10.8 seconds on the final headed run.
- `npm run demo` with a fresh temporary config: reached `Tabloom demo is ready ...`; stopped cleanly with Ctrl+C; no pairing token appeared on stdout.
- `git diff --check`: no whitespace errors.

The suite requires a graphical display and Chromium that permits unpacked extension loading. It intentionally keeps E2E separate from the fast Node test command. Cross-origin iframe targeting remains outside v1 browser coverage, matching the design's documented limitation.
