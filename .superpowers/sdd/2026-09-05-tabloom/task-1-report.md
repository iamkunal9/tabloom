# Task 1 report: extension and authorization engine

## Outcome

Implemented the Manifest V3 extension, volatile scope grant engine, bounded command executor, loopback WebSocket client, and popup UI. Remote commands cannot grant access or forward arbitrary CDP/evaluation. Scope is granted only by popup messages.

The grant captures a current-tab ID or permits all normal HTTP(S) tabs. Both modes exclude incognito and browser-internal URLs. A generation is captured when work is queued and checked after awaited operations and immediately before subsequent effects. Stop changes the generation synchronously, queued work fails, and debugger detach starts without waiting for the action queue. Disconnect and heartbeat expiry revoke the grant; a later reconnect leaves scope off.

The command executor serializes `tabs`, `snapshot`, `click`, `type`, `press`, `scroll`, `navigate`, `screenshot`, `open`, and `close`. It validates exact argument shapes, URL schemes, sizes, finite coordinates, supported keys, scope, and live tab eligibility. Snapshot and selector actions share a ` >>> ` path format for open shadow roots. Internal `Runtime.evaluate` expressions contain only JSON-serialized selectors and fixed snapshot logic.

The popup displays paired, connected, and scope state, masks the stored pairing token, explains both scope choices, and keeps Stop all control visible. The token and configurable loopback port use `storage.local`; grants remain only in service-worker memory.

## TDD evidence

Initial red run:

```text
node --test tests/scope.test.js tests/actions.test.js
ERR_MODULE_NOT_FOUND: extension/actions.js
ERR_MODULE_NOT_FOUND: extension/scope.js
tests 2, pass 0, fail 2
```

After the first implementation, the validation suite exposed an ambiguous assertion and was split so selector and unexpected-field failures are independently checked. A later regression test required detaching when a tab navigates to an excluded URL during debugger attachment; it failed with `0 !== 1` before cleanup was implemented, then passed after the attach failure path detached the debugger.

Final verification command:

```text
npm test -- --test-reporter=spec
tests 12, pass 12, fail 0
```

Additional verification parsed the MV3 manifest, ran `node --check` over every JavaScript file, and ran `git diff --check`; all exited zero.

## Limitations

- No headed Chrome extension run was performed in this task. Pairing, popup rendering, service-worker suspension behavior, real debugger attachment, screenshots, and shadow-root selector roundtrips still require the planned end-to-end browser test.
- Cross-origin iframe targeting is not supported, as allowed by the v1 design.
- The popup icon is SVG and used inside the popup; packaged toolbar icon rasterization is not included yet.
- A command already sent to Chrome cannot be undone if revocation occurs while that single API call is in flight. Generation and tab eligibility are checked immediately before it, and returned data is suppressed after any post-call revocation or eligibility change.
