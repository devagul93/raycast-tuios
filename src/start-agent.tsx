import {
  Action,
  ActionPanel,
  closeMainWindow,
  Form,
  getPreferenceValues,
  Icon,
  LaunchProps,
  List,
  LocalStorage,
  showHUD,
  showToast,
  Toast,
  Keyboard,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { fail } from "./actions";
import { makeWorktree } from "./git";
import { showSession, terminalFor } from "./terminal";
import { expandHome, listAgents, listSessions, startAgent, tildify } from "./tuios";

const NEW_SESSION = "__new__";
const LAST_SESSION = "lastSession";

interface Launch {
  cwd: string;
  session: string;
  agent: string;
  worktreeBranch?: string;
  name?: string;
  prompt?: string;
}

interface SessionInfo {
  name: string;
  app?: string;
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

/**
 * Sessions, most recently used first, each labelled with the terminal showing it,
 * and the one to start in by default: the Default Session setting, else the
 * session used last time, else the most recent session open in a terminal.
 */
async function loadSessions(): Promise<{ list: SessionInfo[]; fallback: string }> {
  const sessions = (await listSessions()).sort((a, b) => b.last_active - a.last_active);
  const list = await Promise.all(
    sessions.map(async (s) => ({ name: s.name, app: (await terminalFor(s.name).catch(() => undefined))?.app })),
  );
  const names = list.map((s) => s.name);
  const pref = getPreferenceValues<Preferences>().defaultSession?.trim();
  const last = await LocalStorage.getItem<string>(LAST_SESSION);
  const fallback =
    pref || (last && names.includes(last) ? last : undefined) || list.find((s) => s.app)?.name || names[0] || "main";
  return { list, fallback };
}

function defaultAgent() {
  return getPreferenceValues<Preferences>().defaultAgent?.trim() || "claude";
}

async function waitForSession(name: string, ms = 5000) {
  for (let t = 0; t < ms; t += 250) {
    if ((await listSessions().catch(() => [])).some((s) => s.name === name)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Start the agent, bring its terminal forward and close Raycast. */
async function launch(o: Launch) {
  const toast = await showToast({ style: Toast.Style.Animated, title: `Starting ${o.agent}…` });
  try {
    const cwd = o.worktreeBranch ? await makeWorktree(o.cwd, o.worktreeBranch) : o.cwd;
    startAgent({ session: o.session, cwd, agent: o.agent, name: o.name, prompt: o.prompt });
    await LocalStorage.setItem(LAST_SESSION, o.session);
    await waitForSession(o.session);
    await new Promise((r) => setTimeout(r, 600)); // let the pane open and take focus
    const app = await showSession(o.session);
    await closeMainWindow({ clearRootSearch: true });
    await showHUD(`${o.agent} · ${basename(cwd)} → ${o.session} · ${app}`);
  } catch (e) {
    toast.style = Toast.Style.Failure;
    toast.title = "Could not start the agent";
    toast.message = e instanceof Error ? e.message : String(e);
  }
}

export default function Command(props: LaunchProps<{ arguments: Arguments.StartAgent }>) {
  const query = props.arguments.project?.trim() ?? "";
  const prompt = props.arguments.prompt?.trim() || undefined;
  const [search, setSearch] = useState(query);
  const projects = usePromise(loadProjects, [], { onError: (e) => fail("Could not list projects", e) });
  const sessions = usePromise(loadSessions, [], { onError: (e) => fail("tuios is not answering", e) });
  const fallback = sessions.data?.fallback;

  // Typed from root search ("Start Agent  api  fix the tests"): one matching project starts at once.
  const tried = useRef(false);
  useEffect(() => {
    if (!query || !projects.data || !fallback || tried.current) return;
    tried.current = true;
    const q = query.toLowerCase();
    const hits = projects.data.filter((p) => basename(p).toLowerCase().includes(q));
    const exact = hits.filter((p) => basename(p).toLowerCase() === q);
    const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : undefined;
    if (pick) launch({ cwd: pick, session: fallback, agent: defaultAgent(), prompt });
  }, [projects.data, fallback]);

  const others = (sessions.data?.list ?? []).filter((s) => s.name !== fallback);
  const label = (s: SessionInfo) => (s.app ? `${s.name} — ${s.app}` : `${s.name} — not open`);

  return (
    <List
      isLoading={projects.isLoading || sessions.isLoading}
      searchText={search}
      onSearchTextChange={setSearch}
      searchBarPlaceholder={`Pick a project · Enter starts ${defaultAgent()} in ${fallback ?? "…"}`}
    >
      <List.EmptyView
        icon={Icon.Folder}
        title="No project matches"
        description="Choose another folder with ⌘Enter, or add project folders in the extension settings."
        actions={
          <ActionPanel>
            <Action.Push
              title="Choose Folder…"
              icon={Icon.Folder}
              target={<StartForm sessions={sessions.data?.list ?? []} session={fallback} prompt={prompt} />}
            />
          </ActionPanel>
        }
      />
      {(projects.data ?? []).map((p) => (
        <List.Item
          key={p}
          icon={Icon.Folder}
          title={basename(p)}
          subtitle={tildify(p)}
          keywords={[p]}
          actions={
            <ActionPanel>
              <Action
                title={`Start ${defaultAgent()} in ${fallback ?? "…"}`}
                icon={Icon.Play}
                onAction={() => fallback && launch({ cwd: p, session: fallback, agent: defaultAgent(), prompt })}
              />
              <Action.Push
                title="Start with Options…"
                icon={Icon.Gear}
                target={
                  <StartForm project={p} sessions={sessions.data?.list ?? []} session={fallback} prompt={prompt} />
                }
              />
              {others.length > 0 && (
                <ActionPanel.Submenu
                  title="Start in Session"
                  icon={Icon.Window}
                  shortcut={Keyboard.Shortcut.Common.Save}
                >
                  {others.map((s) => (
                    <Action
                      key={s.name}
                      title={label(s)}
                      onAction={() => launch({ cwd: p, session: s.name, agent: defaultAgent(), prompt })}
                    />
                  ))}
                </ActionPanel.Submenu>
              )}
              <Action.ShowInFinder path={p} shortcut={Keyboard.Shortcut.Common.Open} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

interface FormValues {
  folder: string[];
  agent: string;
  session: string;
  newSession?: string;
  worktree: boolean;
  branch?: string;
  name: string;
  prompt: string;
}

/** Everything that can differ from the defaults, pre-filled with them. */
function StartForm(props: { project?: string; sessions: SessionInfo[]; session?: string; prompt?: string }) {
  const [session, setSession] = useState(props.session ?? NEW_SESSION);
  const [worktree, setWorktree] = useState(false);

  async function submit(v: FormValues) {
    const cwd = v.folder?.[0];
    const target = v.session === NEW_SESSION ? v.newSession?.trim() : v.session;
    if (!cwd) return void showToast({ style: Toast.Style.Failure, title: "Pick a folder" });
    if (!target) return void showToast({ style: Toast.Style.Failure, title: "Name the new session" });
    if (v.worktree && !v.branch?.trim())
      return void showToast({ style: Toast.Style.Failure, title: "Name the branch" });
    await launch({
      cwd,
      session: target,
      agent: v.agent.trim() || defaultAgent(),
      worktreeBranch: v.worktree ? v.branch?.trim() : undefined,
      name: v.name.trim() || undefined,
      prompt: v.prompt.trim() || undefined,
    });
  }

  return (
    <Form
      navigationTitle={props.project ? `Start in ${basename(props.project)}` : "Start Agent"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Start Agent" icon={Icon.Play} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="folder"
        title="Folder"
        defaultValue={props.project ? [props.project] : undefined}
        canChooseDirectories
        canChooseFiles={false}
        allowMultipleSelection={false}
      />
      <Form.TextField
        id="agent"
        title="Agent"
        defaultValue={defaultAgent()}
        info="As you would type it: claude, codex, gemini, 'claude --model opus'…"
      />
      <Form.Dropdown id="session" title="Session" value={session} onChange={setSession}>
        {props.sessions.map((s) => (
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
      <Form.TextArea
        id="prompt"
        title="First Prompt"
        defaultValue={props.prompt}
        placeholder="optional — typed once the agent is ready"
      />
    </Form>
  );
}
