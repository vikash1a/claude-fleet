# Claude Fleet

Monitor and manage multiple [Claude Code](https://claude.ai/code) sessions from a single VSCode sidebar.

Claude Fleet polls your local `~/.claude/projects/` directory, parses each session's JSONL log, and surfaces live status, token usage, git branch, and one-click Focus/Resume actions — without any changes to Claude Code itself.

## Packages

| Package | Description |
|---|---|
| [`packages/core`](packages/core/) | Session discovery and state machine — reads `~/.claude/projects/**/*.jsonl` and emits typed events |
| [`packages/vscode-ext`](packages/vscode-ext/) | VSCode extension — sidebar webview, status bar badge, terminal management |

## How it works

1. **Core** polls `~/.claude/projects/` every 5 seconds, parses each session's JSONL file, and derives a status (`active`, `idle`, `needs-resume`, `completed`, `dead`) from message timestamps and stop reasons.
2. **Extension** listens to `session:added / updated / removed` events and updates the webview. It also manages VSCode terminals: terminals it spawns are named with an embedded session-ID prefix so they survive window reloads and can be re-linked automatically.

## Session statuses

| Status | Meaning |
|---|---|
| `active` | Claude replied within the last 2 minutes, or is mid-tool-call |
| `idle` | Claude replied, quiet for 2–30 minutes |
| `needs-resume` | User sent a message that was never answered (session exited or crashed) |
| `completed` | Session exited cleanly after answering the last prompt |
| `dead` | No exit marker, no activity for >30 minutes — likely crashed |

## Getting started

**Prerequisites:** Node 20+, VSCode 1.85+

```bash
npm install
npm run build          # builds core then vscode-ext
```

To run the extension in a development host:

1. Open this repo in VSCode.
2. Press `F5` — VSCode launches an Extension Development Host with Claude Fleet loaded.

To package a `.vsix` for manual installation:

```bash
cd packages/vscode-ext
npm run package        # emits claude-fleet-<version>.vsix
```

## Repo layout

```
claude-fleet/
├── packages/
│   ├── core/          # @claude-fleet/core — session registry
│   └── vscode-ext/    # Claude Fleet VSCode extension
├── tsconfig.base.json
└── package.json       # npm workspaces root
```
