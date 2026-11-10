import {
  Action,
  ActionPanel,
  closeMainWindow,
  Form,
  getPreferenceValues,
  Icon,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { useState } from "react";
import { showSession, terminalFor } from "./terminal";
import { makeWorktree } from "./git";
import { expandHome, listAgents, listSessions, startAgent } from "./tuios";

const NEW_SESSION = "__new__";

interface Values {
  project: string;
  folder: string[];
  agent: string;
  session: string;
  newSession: string;
  worktree: boolean;
  branch: string;
  name: string;
  prompt: string;
}

/** Folders to offer: where agents run now (most recent first), then git repos under the project folders. */
async function loadProjects(): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string) => {
    if (p && !seen.has(p) && existsSync(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  try {
    const agents = await listAgents(true);
    agents.sort((a, b) => b.agent_state_at - a.agent_state_at).forEach((a) => add(a.cwd));
  } catch {
    /* tuios down: still offer the project folders */
  }
  const roots = (getPreferenceValues<Preferences>().projectRoots || "")
    .split(",")
    .map((r) => expandHome(r.trim()))
    .filter((r) => r && existsSync(r));
  for (const root of roots) {
    for (const entry of readdirSync(root).sort()) {
      const dir = join(root, entry);
      if (!entry.startsWith(".") && existsSync(join(dir, ".git")) && statSync(dir).isDirectory()) add(dir);
    }
  }
  return out;
}

/** Sessions, labelled with the terminal showing each, most recently used first. */
async function loadSessions() {
  const sessions = (await listSessions()).sort((a, b) => b.last_active - a.last_active);
  return Promise.all(
    sessions.map(async (s) => ({ name: s.name, app: (await terminalFor(s.name).catch(() => undefined))?.app })),
  );
}

async function waitForSession(name: string, ms = 5000) {
  for (let t = 0; t < ms; t += 250) {
    if ((await listSessions().catch(() => [])).some((s) => s.name === name)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const projects = usePromise(loadProjects);
  const sessions = usePromise(loadSessions);
  const [session, setSession] = useState<string>();
  const [worktree, setWorktree] = useState(false);

  async function submit(v: Values) {
    const cwd = v.folder?.[0] || v.project;
    const target = v.session === NEW_SESSION ? v.newSession.trim() : v.session;
    if (!cwd) return void showToast({ style: Toast.Style.Failure, title: "Pick a project folder" });
    if (!target) return void showToast({ style: Toast.Style.Failure, title: "Name the new session" });
    if (v.worktree && !v.branch.trim()) return void showToast({ style: Toast.Style.Failure, title: "Name the branch" });

    const toast = await showToast({ style: Toast.Style.Animated, title: "Starting…" });
    try {
      const dir = v.worktree ? await makeWorktree(cwd, v.branch.trim()) : cwd;
      const agent = v.agent.trim() || prefs.defaultAgent || "claude";
      startAgent({
        session: target,
        cwd: dir,
        agent,
        name: v.name.trim() || undefined,
        prompt: v.prompt.trim() || undefined,
      });
      await waitForSession(target);
      await new Promise((r) => setTimeout(r, 600)); // let the pane open and take focus
      const app = await showSession(target);
      await closeMainWindow({ clearRootSearch: true });
      await showHUD(`${agent} → ${target} · ${app}`);
    } catch (e) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could not start the agent";
      toast.message = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <Form
      isLoading={projects.isLoading || sessions.isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Start Agent" icon={Icon.Play} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="project" title="Project" throttle>
        {(projects.data ?? []).map((p) => (
          <Form.Dropdown.Item key={p} value={p} title={basename(p)} keywords={[p]} icon={Icon.Folder} />
        ))}
      </Form.Dropdown>
      <Form.FilePicker
        id="folder"
        title="Or Folder"
        info="Overrides Project when set."
        canChooseDirectories
        canChooseFiles={false}
        allowMultipleSelection={false}
      />
      <Form.TextField
        id="agent"
        title="Agent"
        defaultValue={prefs.defaultAgent || "claude"}
        info="As you would type it: claude, codex, gemini, 'codex --model o5'…"
      />
      <Form.Dropdown id="session" title="Session" value={session} onChange={setSession}>
        {(sessions.data ?? []).map((s) => (
          <Form.Dropdown.Item
            key={s.name}
            value={s.name}
            title={s.app ? `${s.name} — ${s.app}` : `${s.name} — not open`}
            icon={Icon.Window}
          />
        ))}
        <Form.Dropdown.Item value={NEW_SESSION} title="New session…" icon={Icon.Plus} />
      </Form.Dropdown>
      {session === NEW_SESSION && <Form.TextField id="newSession" title="Session Name" placeholder="review" />}
      <Form.Checkbox
        id="worktree"
        label="Own git worktree (new branch, separate checkout)"
        value={worktree}
        onChange={setWorktree}
      />
      {worktree && (
        <Form.TextField
          id="branch"
          title="Branch"
          placeholder="feat/retry"
          info="Made next to the repo as <repo>-<branch>. Reused if it exists."
        />
      )}
      <Form.Separator />
      <Form.TextField id="name" title="Pane Name" placeholder="optional, e.g. reviewer" />
      <Form.TextArea id="prompt" title="First Prompt" placeholder="optional — typed once the agent is ready" />
    </Form>
  );
}
