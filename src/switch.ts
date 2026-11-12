import { ancestry, run } from "./proc";

type TmuxClient = {
  tty: string;
  pid: number;
  activity: number;
};

async function mostRecentClient(): Promise<TmuxClient | undefined> {
  const output = await run("tmux", ["list-clients", "-F", "#{client_activity}\t#{client_tty}\t#{client_pid}"]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [activity, tty, pid] = line.split("\t");
      return { activity: Number(activity), tty, pid: Number(pid) };
    })
    .sort((a, b) => b.activity - a.activity)[0];
}

async function focusHyprlandWindowOf(pid: number): Promise<void> {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    return;
  }
  const windows = JSON.parse(await run("hyprctl", ["clients", "-j"])) as { pid: number }[];
  const windowPids = new Set(windows.map((window) => window.pid));
  for await (const ancestor of ancestry(pid)) {
    if (windowPids.has(ancestor)) {
      await run("hyprctl", ["dispatch", `hl.dsp.focus({ window = "pid:${ancestor}" })`]);
      return;
    }
  }
}

export async function switchToPane(paneId: string): Promise<void> {
  const client = await mostRecentClient();
  if (!client) {
    throw new Error("No tmux client is attached");
  }
  await run("tmux", ["switch-client", "-c", client.tty, "-t", paneId]);
  await focusHyprlandWindowOf(client.pid);
}
