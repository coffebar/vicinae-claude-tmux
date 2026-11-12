import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ancestry, run } from "./proc";

export const CLAUDE_SESSION_RECORDS_DIR = join(homedir(), ".claude", "sessions");

export type ClaudeStatus = "busy" | "waiting" | "idle";

export type ClaudeSession = {
  paneId: string;
  windowId: string;
  tmuxSession: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  windowPanes: number;
  pid: number;
  cwd: string;
  name?: string;
  status?: ClaudeStatus;
  waitingFor?: string;
  lastActivity: number;
};

type AgentEntry = {
  pid?: number;
  cwd: string;
  startedAt: number;
  name?: string;
  status?: ClaudeStatus;
  waitingFor?: string;
};

type Pane = Pick<
  ClaudeSession,
  "paneId" | "windowId" | "tmuxSession" | "windowIndex" | "windowName" | "paneIndex" | "windowPanes"
>;

const PANE_FORMAT = [
  "#{pane_pid}",
  "#{pane_id}",
  "#{window_id}",
  "#{session_name}",
  "#{window_index}",
  "#{pane_index}",
  "#{window_panes}",
  "#{window_name}",
].join("\t");

async function listAgents(): Promise<AgentEntry[]> {
  return JSON.parse(await run("claude", ["agents", "--json"])) as AgentEntry[];
}

async function listPanesByPid(): Promise<Map<number, Pane>> {
  let output: string;
  try {
    output = await run("tmux", ["list-panes", "-a", "-F", PANE_FORMAT]);
  } catch (error) {
    if (error instanceof Error && /no server running|error connecting to/.test(error.message)) {
      return new Map();
    }
    throw error;
  }

  const panes = new Map<number, Pane>();
  for (const line of output.split("\n").filter(Boolean)) {
    const [panePid, paneId, windowId, tmuxSession, windowIndex, paneIndex, windowPanes, ...name] = line.split("\t");
    panes.set(Number(panePid), {
      paneId,
      windowId,
      tmuxSession,
      windowIndex: Number(windowIndex),
      paneIndex: Number(paneIndex),
      windowPanes: Number(windowPanes),
      windowName: name.join("\t"),
    });
  }
  return panes;
}

async function lastStatusChange(pid: number): Promise<number | undefined> {
  try {
    const record = JSON.parse(await readFile(join(CLAUDE_SESSION_RECORDS_DIR, `${pid}.json`), "utf8"));
    return typeof record.statusUpdatedAt === "number" ? record.statusUpdatedAt : undefined;
  } catch {
    return undefined;
  }
}

async function owningPane(pid: number, panes: Map<number, Pane>, claudePids: Set<number>): Promise<Pane | undefined> {
  for await (const ancestor of ancestry(pid)) {
    if (ancestor !== pid && claudePids.has(ancestor)) {
      return undefined;
    }
    const pane = panes.get(ancestor);
    if (pane) {
      return pane;
    }
  }
  return undefined;
}

export async function listClaudeSessions(): Promise<ClaudeSession[]> {
  const [agents, panes] = await Promise.all([listAgents(), listPanesByPid()]);
  const claudePids = new Set(agents.flatMap((agent) => (agent.pid === undefined ? [] : [agent.pid])));

  const sessions = await Promise.all(
    agents.map(async (agent): Promise<ClaudeSession | undefined> => {
      if (agent.pid === undefined) {
        return undefined;
      }
      const pane = await owningPane(agent.pid, panes, claudePids);
      if (!pane) {
        return undefined;
      }
      return {
        ...pane,
        pid: agent.pid,
        cwd: agent.cwd,
        name: agent.name,
        status: agent.status,
        waitingFor: agent.waitingFor,
        lastActivity: (await lastStatusChange(agent.pid)) ?? agent.startedAt,
      };
    }),
  );

  return sessions
    .filter((session): session is ClaudeSession => session !== undefined)
    .sort((a, b) => b.lastActivity - a.lastActivity);
}
