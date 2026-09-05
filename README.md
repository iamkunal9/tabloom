# Tabloom

**Give your agent a tab. Or the whole browser. Take it back whenever you want.**

Tabloom connects an LLM agent to the browser you already use. Open the extension, enable **Current tab** or **Full browser**, and let your agent read pages, click, type, scroll, navigate, and take screenshots. Your existing logins stay in the browser.

No browser restart, remote-debugging port, new daily browser profile, or hosted relay is required. The local bridge must be running. Chrome still requires you to load the extension once.

```text
Agent + skill / MCP tools
          │
     Local bridge
      127.0.0.1
          │
   Tabloom extension
          │
   Tabs you enabled
```

## Set up

Requires **Node.js 22+**, **Chrome 125+** (or a compatible Chromium browser), and Git. This repository is private: your GitHub account must have access. The following uses the GitHub CLI, already authenticated with `gh auth login`.

```sh
gh repo clone iamkunal9/tabloom && cd tabloom && npm ci && npm link && tabloom install-skill --agent all
```

That installs the CLI and skill for both supported agent locations. From an existing clone, the skill alone is one command:

```sh
node src/cli.js install-skill --agent all
```

Use `--agent codex` or `--agent claude` to choose one. The installer refuses to overwrite an existing skill unless you add `--force`. Keep the checkout in place: the installed helper points to this checkout's CLI. After moving the checkout, reinstall the skill with `--force`.

### Load the extension

1. Open `chrome://extensions` in your existing browser.
2. Enable **Developer mode**.
3. Choose **Load unpacked**, then select this repository's `extension` directory.
4. Pin **Tabloom** to the toolbar.

You can do this while the browser and your tabs stay open. There is no build step for the extension. After updating its files, use **Reload** on its card in `chrome://extensions`.

### Pair and enable

Start the bridge and leave it running:

```sh
tabloom serve
```

In another terminal:

```sh
tabloom pair
```

Copy the pairing token into the extension's **Pairing token** field, use the displayed bridge port, and click **Pair bridge**. Open the website you want to use, then choose:

| Mode | Access |
| --- | --- |
| **Current tab** | The tab you enable, including later navigations in that tab. Switching tabs does not move control. |
| **Full browser** | Existing and new normal web tabs in this browser profile, including opening and closing tabs. |
| **Stop all control** | Revokes the grant and detaches active debugger sessions. |

Pairing alone does not enable control. A browser restart or lost bridge connection clears the grant; reconnect and enable it again. Full browser excludes incognito, browser settings, other extensions, and other profiles.

## Use with an agent

Ask your agent to use the **tabloom** skill, for example:

> Use Tabloom to inspect the tab I enabled and fill the search field with “extension APIs”.

The skill discovers permitted tabs, reads a snapshot, acts on observed elements, and verifies the outcome. It uses the CLI, so an agent with shell access does not need an MCP configuration. Your agent may need to refresh skill discovery or start a new conversation after installation; this does not require restarting your browser.

### CLI

```sh
tabloom status
tabloom tabs
tabloom snapshot '{"tabId":123}'
tabloom type '{"tabId":123,"selector":"#search","text":"extension APIs"}'
tabloom click '{"tabId":123,"selector":"button[type=submit]"}'
tabloom press '{"tabId":123,"key":"Enter"}'
tabloom scroll '{"tabId":123,"y":600}'
tabloom navigate '{"tabId":123,"url":"https://example.com"}'
tabloom screenshot '{"tabId":123}'
```

Use tab IDs and selectors returned by `tabs` and `snapshot`; `123` is an example. Commands return JSON, and failures exit nonzero. Screenshots contain PNG data encoded as base64. Opening and closing tabs require **Full browser**:

```sh
tabloom open '{"url":"https://example.com"}'
tabloom close '{"tabId":123}'
```

### MCP

The same operations are available through a stdio MCP server:

```sh
tabloom mcp
```

For an agent that accepts `mcpServers` JSON, use an absolute checkout path:

```json
{
  "mcpServers": {
    "tabloom": {
      "command": "node",
      "args": ["/absolute/path/to/tabloom/src/cli.js", "mcp"]
    }
  }
}
```

Use an absolute path to the Node executable too if your agent does not inherit your terminal's `PATH`. Start `tabloom serve` separately, then pair and enable scope in the extension. MCP cannot enable control for you.

## Boundaries

Tabloom controls web pages and tabs, not your entire computer. Browser-internal pages and incognito tabs are excluded. Cross-origin iframe targeting is not supported in this version. Some websites have custom controls, browser dialogs, or anti-automation behavior that need manual interaction. Chrome can show a debugging indicator, and opening DevTools can interrupt control.

There is no arbitrary JavaScript evaluation or raw CDP tool exposed to the agent. Browser access is enforced by the extension, not by instructions in the skill. The bridge authenticates local callers with a token; keep it private. Page content returned to your agent may be sent to that agent's model provider. See [security and permissions](docs/security.md).

## Development

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
```

The browser suite uses an isolated Chromium profile with the real extension, local fixture pages, and real bridge commands. Extension-loading flags are used by the automated harness; users load the extension through Chrome's UI. See [test coverage and reproduction](docs/testing.md).

```text
extension/       Manifest V3 extension and popup
src/             Local bridge, CLI, MCP adapter, skill installer
skills/tabloom/  Agent instructions and helper
tests/           Protocol, scope, installer, MCP and browser tests
docs/            Security model, test evidence and design
```

## Updating

```sh
git pull --ff-only
npm ci
tabloom install-skill --agent all --force
```

Stop and restart the bridge, reload the extension on `chrome://extensions`, then enable your desired scope again. This restarts Tabloom's components, not your browser.
