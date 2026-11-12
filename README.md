# Claude Code Sessions (Vicinae extension)

Lists the tmux panes running Claude Code with their live status, highlights the ones waiting on you,
and jumps to the selected one: switches the most recently active tmux client to that pane and focuses
the terminal window hosting that client.

## How it works

- **Status** comes from `claude agents --json`, Claude Code's scripting interface. Interactive
  sessions report `status` (`busy`, `waiting`, `idle`) and, while waiting, `waitingFor`
  (`permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open`).
- **Pane mapping** walks each Claude process's parent chain (`/proc/<pid>/stat`) up to a
  `#{pane_pid}` from `tmux list-panes -a`. Window names are only displayed, never matched. A Claude
  process nested inside another one (e.g. `claude -p` run from a Bash tool call) is skipped.
- **Refresh**: the list re-reads on every change in `~/.claude/sessions` (Claude Code rewrites a
  per-process record there on each status change) and polls every 10 s as a fallback, which also
  picks up tmux-only changes such as window renames.
- **Order**: sections go Needs Attention, Working, Idle; inside each, the most recent status change
  comes first. That time is `statusUpdatedAt` from the session's record in `~/.claude/sessions`,
  an undocumented file, since `claude agents --json` exposes no activity timestamp; when the record
  is unreadable the documented `startedAt` is used instead.
- **Switching** runs `tmux switch-client -c <tty> -t <pane>` on the client with the latest
  `client_activity`, then walks that client's parent chain to a Hyprland window and focuses it with
  `hyprctl dispatch 'hl.dsp.focus({ window = "pid:<pid>" })'`.

Nothing in how Claude Code is started or configured changes: no hooks, no wrappers.

## Requirements

- Vicinae 0.28+, Claude Code with `claude agents --json` (2.1.319 tested), tmux 3.x
- Hyprland with the Lua config (0.55+) for focusing the terminal; elsewhere only tmux is switched

## Build and install

```sh
npm install
npm run build   # installs into ~/.local/share/vicinae/extensions/claude-tmux
npm run dev     # development session with live reload and logs
```

Run it from Vicinae's root search ("Claude Code Sessions") or bind the toggle deeplink to a key:

```lua
hl.bind("ALT + K", hl.dsp.exec_cmd("vicinae vicinae://launch/@coffebar/claude-tmux/claude-sessions?toggle=true"))
```

## Limitations

- Only the default tmux server is inspected.
- With no tmux client attached there is nothing to switch, and a HUD says so.
- Sessions on other machines (over ssh) or in containers are not visible to `claude agents`.
