import { Action, ActionPanel, Color, Icon, Keyboard, LaunchProps, List } from "@raycast/api";
import { useCachedPromise, usePromise } from "@raycast/utils";
import { basename } from "node:path";
import { useEffect, useRef, useState } from "react";
import { fail, jump, move } from "./actions";
import { AgentState, capture, cleanName, listPanes, listSessions, Pane, tildify, workspaceNames } from "./tuios";

const STATE: Partial<Record<AgentState, { glyph: string; color: Color; label: string }>> = {
  needs_input: { glyph: "▲", color: Color.Yellow, label: "needs you" },
  errored: { glyph: "✗", color: Color.Red, label: "errored" },
  working: { glyph: "●", color: Color.Blue, label: "working" },
  done: { glyph: "✳", color: Color.Green, label: "done" },
  idle: { glyph: "○", color: Color.SecondaryText, label: "idle" },
};

/** Every field a person might remember a pane by. */
function haystack(p: Pane): string[] {
  return [p.name, p.title, p.command, p.cwd, basename(p.cwd), p.session].filter(Boolean);
}

function matches(p: Pane, q: string): boolean {
  const needle = q.toLowerCase();
  return haystack(p).some((h) => h.toLowerCase().includes(needle));
}

async function load() {
  const [panes, sessions] = await Promise.all([listPanes(), listSessions()]);
  const order = sessions.sort((a, b) => b.last_active - a.last_active).map((s) => s.name);
  const names: Record<string, Record<number, string>> = Object.fromEntries(
    await Promise.all(order.map(async (s) => [s, await workspaceNames(s).catch(() => ({}))] as const)),
  );
  return { panes, order, names };
}

export default function Command(props: LaunchProps<{ arguments: Arguments.Panes }>) {
  const query = props.arguments.query?.trim() ?? "";
  const [search, setSearch] = useState(query);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, revalidate } = useCachedPromise(load, [], {
    keepPreviousData: true,
    onError: (e) => fail("tuios is not answering", e),
  });

  // Typed straight from root search: one match means jump without showing the list.
  const tried = useRef(false);
  useEffect(() => {
    if (!query || !data || isLoading || tried.current) return;
    tried.current = true;
    const hits = data.panes.filter((p) => matches(p, query));
    if (hits.length === 1) jump(hits[0]);
  }, [data, isLoading]);

  const panes = data?.panes ?? [];
  const groups = new Map<string, Pane[]>();
  for (const s of data?.order ?? []) {
    for (const p of panes.filter((x) => x.session === s).sort((a, b) => a.workspace - b.workspace)) {
      const key = `${p.session}\u0000${p.workspace}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
  }
  const sessions = data?.order ?? [];

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail}
      searchText={search}
      onSearchTextChange={setSearch}
      searchBarPlaceholder="Find a pane by name, title, program or folder…"
      onSelectionChange={setSelected}
    >
      <List.EmptyView
        icon={Icon.Window}
        title="No panes match"
        description="Try a folder name or the program running in it."
      />
      {[...groups.entries()].map(([key, list]) => {
        const [session, ws] = key.split("\u0000");
        const tab = data?.names[session]?.[Number(ws)];
        return (
          <List.Section key={key} title={`${session} · ${tab ? tab : `tab ${ws}`}`}>
            {list.map((p) => (
              <PaneItem
                key={p.window_id}
                pane={p}
                tab={tab}
                live={showDetail && selected === p.window_id}
                showDetail={showDetail}
                sessions={sessions}
                toggleDetail={() => setShowDetail((v) => !v)}
                refresh={revalidate}
              />
            ))}
          </List.Section>
        );
      })}
    </List>
  );
}

function PaneItem(props: {
  pane: Pane;
  tab?: string;
  live: boolean;
  showDetail: boolean;
  sessions: string[];
  toggleDetail: () => void;
  refresh: () => void;
}) {
  const { pane: p, showDetail } = props;
  const st = p.agent_state ? STATE[p.agent_state] : undefined;
  const name = cleanName(p.name || p.title || p.command || "pane");
  const title = cleanName(p.title);
  const screen = usePromise((x: Pane) => capture(x), [p], { execute: props.live });
  const where = `${p.session} · ${props.tab ?? `tab ${p.workspace}`}`;

  const accessories: List.Item.Accessory[] = showDetail
    ? []
    : [
        ...(p.focused ? [{ icon: Icon.Eye, tooltip: "Focused in its session" }] : []),
        ...(st ? [{ tag: { value: st.label, color: st.color } }] : []),
        { text: p.command || "", tooltip: "Running" },
        { text: tildify(p.cwd), tooltip: p.cwd },
      ];

  return (
    <List.Item
      id={p.window_id}
      icon={st ? { source: Icon.CircleFilled, tintColor: st.color } : Icon.Terminal}
      title={name}
      subtitle={!showDetail && title && title !== name ? title : undefined}
      keywords={haystack(p)}
      accessories={accessories}
      detail={
        <List.Item.Detail
          isLoading={screen.isLoading}
          markdown={screen.data !== undefined ? "```\n" + screen.data.trimEnd() + "\n```" : ""}
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label title="Where" text={where} />
              <List.Item.Detail.Metadata.Label title="Running" text={p.command || "—"} />
              <List.Item.Detail.Metadata.Label title="Folder" text={tildify(p.cwd)} />
              {st && <List.Item.Detail.Metadata.Label title="Agent" text={`${st.glyph} ${st.label}`} />}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action title="Jump to Pane" icon={Icon.ArrowRight} onAction={() => jump(p)} />
            {props.sessions.length > 1 && (
              <ActionPanel.Submenu
                title="Move to Session"
                icon={Icon.ArrowNe}
                shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
              >
                {props.sessions
                  .filter((s) => s !== p.session)
                  .map((s) => (
                    <Action key={s} title={s} onAction={() => move(p, s, props.refresh)} />
                  ))}
              </ActionPanel.Submenu>
            )}
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title={showDetail ? "Hide Pane Preview" : "Show Pane Preview"}
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              onAction={props.toggleDetail}
            />
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={props.refresh}
            />
            <Action.CopyToClipboard
              title="Copy Pane ID"
              content={p.window_id}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            {p.cwd && (
              <Action.ShowInFinder
                title="Open Folder in Finder"
                path={p.cwd}
                shortcut={Keyboard.Shortcut.Common.Open}
              />
            )}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
