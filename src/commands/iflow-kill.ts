import { getSessionManager } from "../shared";

/**
 * /iflow_kill <session> — Terminate a session
 */
export function registerIFlowKillCommand(api: any) {
  api.registerCommand({
    name: "iflow_kill",
    description: "Terminate an iFlow session. Usage: /iflow_kill <session-id-or-name>",
    acceptsArgs: true,
    async handler(ctx: any) {
      const args = ctx?.args ?? "";
      const sm = getSessionManager();
      if (!sm) return { text: "Error: SessionManager not initialized." };

      const ref = args.trim();
      if (!ref) return { text: "Usage: /iflow_kill <session-id-or-name>" };

      const session = sm.resolve(ref);
      if (!session) return { text: `Error: Session "${ref}" not found. Use /iflow_sessions to list sessions.` };

      if (session.status !== "running" && session.status !== "starting") {
        return { text: `Session "${session.name}" is already ${session.status}.` };
      }

      sm.kill(session.id);
      return { text: `⛔ Session "${session.name}" [${session.id}] has been terminated.` };
    },
  });
}
