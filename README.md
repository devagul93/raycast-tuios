# tuios for Raycast

See every coding agent running in [tuios](https://tuios.dev), jump to the one you want, and answer it, all from Raycast.

```
Raycast ─► Agents list ──► Enter: focus the pane, bring its terminal forward
              │              (Ghostty, WezTerm, kitty, Alacritty, iTerm, Terminal)
              ├─ ⌘Y / ⌘N    approve or deny the prompt it is waiting on
              ├─ ⌘M         leave it a note, or queue its next task
              └─ ⌘⇧M        move the pane to another tuios session
```

## Commands

| Command | What it does |
| --- | --- |
| **Agents** | Every agent in every tuios session, grouped by state: needs you, errored, working, done, idle. The right side shows the pane's last 60 lines and refreshes every 3 seconds. Switch the dropdown to **All Panes** to include shells. |
| **Jump to Pane** | Every pane in every session, agent or not: shells, editors, dev servers. Search by pane name, title, running program, folder or session. Grouped by session and tab. Type a word after the command in Raycast's main search (`Jump to Pane  api`) and, if only one pane matches, it jumps at once. |
| **Jump to Agent Needing Me** | Goes straight to the agent that has waited longest. Give it a hotkey. |
| **Start Agent** | Pick a project and press Enter: your default agent starts there, in your default session, focused, with its terminal in front. `⌘Enter` opens a form, pre-filled with the defaults, to change the agent, session, worktree, pane name or first prompt. `⌘S` starts it in another session. From Raycast's main search, `Start Agent  api  fix the tests` starts at once when one project matches. |

### Agents shortcuts

| Key | Action |
| --- | --- |
| `Enter` | Jump to the pane |
| `⌘Y` | Approve |
| `⌘⇧Y` | Approve always |
| `⌘N` | Deny |
| `⌘⇧K` | Choose a numbered option |
| `⌘M` | Send a message (note or next task) |
| `⌘⇧M` | Move to another session |
| `⌘D` | Show or hide the pane preview |
| `⌘R` | Refresh |
| `⌘O` | Open the pane's folder in Finder |
| `⌘⇧C` | Copy the pane id |

## Install

You need macOS, [Raycast](https://raycast.com), Node 22 or newer, and tuios 0.11 or newer (`brew install tuios`).

```sh
git clone https://github.com/devagul93/raycast-tuios
cd raycast-tuios
npm install
npm run dev     # loads it into Raycast; stop with Ctrl+C, it stays installed
```

## Settings

Open Raycast → Extensions → tuios.

| Setting | Default | Notes |
| --- | --- | --- |
| Default Agent | `claude` | What Start Agent runs. Any command, with arguments. |
| Default Session | empty | Where Start Agent opens agents. Empty: the session you started in last time, else the most recently used session open in a terminal. |
| Project Folders | `~/Developer, ~/Projects, ~/code, ~/src` | Start Agent lists the git repos directly inside these, plus every folder an agent runs in now. Folders that don't exist are skipped. |
| Terminal for Detached Sessions | Terminal | Opened with `tuios attach <session>` when you jump to a session no terminal is showing. |
| tuios Path | found automatically | Looked up in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/go/bin`. |

## Approving prompts from Raycast

By default tuios only takes answers to agent prompts from inside tuios. To answer from Raycast, add this to your tuios config (`tuios config edit`):

```toml
[daemon]
respond_from_shell = true
```

Then run `tuios config apply` from a terminal that is **not** inside tuios.

What this changes: any program on your Mac running outside tuios can then answer agent prompts. Panes inside tuios still can't. Every answer is tied to the exact prompt you saw: if the prompt changed in between, tuios refuses it and nothing is pressed.

Everything else works without this setting.

## How the jump finds your terminal

tuios knows which process is showing each session. The extension walks up from that process to the terminal app that owns it, then brings that app forward. One session can be in Ghostty and another in WezTerm, and you can swap them at any time.

If no terminal is showing the session, it opens the one in your settings and attaches.

## Worktrees

In Start Agent's options form (`⌘Enter`), with **Own git worktree** ticked, it makes a checkout next to the repo, named `<repo>-<branch>` (`api` + `feat/retry` → `../api-feat-retry`). The branch is created if it doesn't exist. If the folder already exists it is reused. The agent starts in it, in the session you picked. Remove it later with `git worktree remove`.

## Troubleshooting

| You see | Do this |
| --- | --- |
| "tuios not found" | Set **tuios Path** in the settings. |
| "The tuios daemon is not running" | Open a terminal and run `tuios`. |
| "tuios only takes answers from outside its panes when you allow it" | See [Approving prompts](#approving-prompts-from-raycast). |
| An agent shows as a shell | tuios didn't recognise it. Run `tuios explain-agent-detect -w <pane>`, or wire its hooks with `tuios integration`. |
| Start Agent can't find `codex` (or another CLI) | Install it somewhere on the usual paths (Homebrew, `~/.local/bin`, mise, Volta, Bun) or use its full path in **Agent**. |

## Limits

- If one terminal app has several windows open, the jump brings forward the app's last-used window, not a specific one.
- Detached-session launchers are written for each terminal's documented command-line flags. Terminal and iTerm use AppleScript.
- Local machine only. tuios panes on other hosts are listed but not started or moved.

## Develop

```sh
npm run dev     # live reload in Raycast
npm run build   # type-check and bundle
npm run lint
```

Code map: `src/tuios.ts` wraps the tuios CLI, `src/terminal.ts` finds and opens terminals, `src/actions.ts` holds the shared jump and move actions, `src/git.ts` makes worktrees, and each command is `src/<command>.tsx`.

## License

MIT
