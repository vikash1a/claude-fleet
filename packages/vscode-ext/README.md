# Claude Fleet — VSCode Extension

A sidebar panel for monitoring and managing multiple [Claude Code](https://claude.ai/code) sessions without leaving VSCode.

## Features

- **Session list** — all Claude Code sessions sorted by most-recent activity, each showing goal, git branch, elapsed time, token usage, and status chip
- **Status bar badge** — at a glance: `N/M active` or a warning when sessions need resuming
- **Focus / Resume** — one click to jump to the linked terminal, or spawn a new `claude --resume <id>` terminal if the original is gone
- **New session** — `+` button in the sidebar header prompts for a working directory and goal, then opens a terminal and runs Claude
- **Terminal persistence** — terminals are named with a short session-ID prefix (`fleet: <repo> [<id-prefix>]`) so they survive VSCode window reloads and are re-linked automatically on startup

## Installation

### From a `.vsix` file

```bash
code --install-extension claude-fleet-0.1.0.vsix
```

Or: VSCode → Extensions → `···` menu → *Install from VSIX…*

### From source

```bash
# from the repo root
npm install && npm run build

# package
cd packages/vscode-ext
npm run package        # produces claude-fleet-<version>.vsix
```

## Usage

1. Open any VSCode window — the extension activates automatically on startup.
2. Click the **Claude Fleet** icon in the Activity Bar (circuit-board icon) to open the sidebar.
3. Each session card shows:
   - **Goal** — first user message, truncated to 120 chars
   - **Status chip** — only shown for states that need attention (`needs-resume`, `idle`, `dead`)
   - **Branch** — current git branch in the session's working directory
   - **Duration** — time since the session started
   - **Tokens** — cumulative token count across all turns
4. **Focus** — shown when a live terminal is linked to the session; brings it to the front.
5. **Resume** — shown when no terminal is linked; opens a new terminal and runs `claude --resume <sessionId>`.
6. **New session** — click `+` in the panel header, pick a folder, enter a goal.

## Development

```bash
# from repo root
npm install

# watch mode — rebuilds core + extension on save
cd packages/vscode-ext && npm run dev
```

Press `F5` in VSCode to launch an Extension Development Host.

## Architecture

```
src/
├── extension.ts       # activate(): wires registry → terminal manager → fleet view
├── fleet-view.ts      # WebviewViewProvider — renders session cards as HTML
└── terminal-manager.ts # Creates/links/focuses VSCode terminals per session
```

`extension.ts` owns the event loop: `SessionRegistry` fires `session:added/updated/removed`, and the extension forwards those updates to both the webview and the terminal manager.

`TerminalManager` uses named terminals (`fleet: <repo> [<7-char-id>]`) to survive window reloads. On startup, `relinkAfterReload()` walks all open terminals and matches them back to sessions by ID prefix.
