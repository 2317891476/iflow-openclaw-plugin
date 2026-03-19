import { getSessionManager, pluginConfig, resolveOriginChannel, resolveAgentChannel } from "../shared";

/**
 * /iflow_resume <session> [new prompt] — Resume a completed session
 * Restarts a previously completed session, optionally with a new prompt.
 */
export function registerIFlowResumeCommand(api: any) {
  api.registerCommand({
    name: "iflow_resume",
    description: "Resume a completed iFlow session. Usage: /iflow_resume <session-id-or-name> [new prompt]",
    acceptsArgs: true,
    async handler(ctx: any) {
      const args = ctx?.args ?? "";
      const sm = getSessionManager();
      if (!sm) return { text: "Error: SessionManager not initialized." };

      const parts = args.trim().split(/\s+/);
      if (parts.length < 1 || !parts[0]) {
        return {
          text: [
            "Usage: /iflow_resume <session-id-or-name> [new prompt]",
            "",
            "Examples:",
            "  /iflow_resume fix-auth",
            "  /iflow_resume fix-auth Also add unit tests",
            "",
            "Use /iflow_sessions to see completed sessions.",
          ].join("\n"),
        };
      }

      const ref = parts[0];
      const extraPrompt = parts.slice(1).join(" ").trim();

      // Look up in active sessions first, then persisted
      let originalPrompt: string;
      let originalWorkdir: string;
      let originalName: string;
      let originalModel: string | undefined;

      const activeSession = sm.resolve(ref);
      if (activeSession) {
        if (activeSession.status === "running" || activeSession.status === "starting") {
          return { text: `Session "${activeSession.name}" is still running. Use /iflow_respond to send a message, or /iflow_kill to stop it first.` };
        }
        originalPrompt = activeSession.prompt;
        originalWorkdir = activeSession.workdir;
        originalName = activeSession.name;
        originalModel = activeSession.model;
      } else {
        const persisted = sm.getPersistedSession(ref);
        if (!persisted) {
          return { text: `Error: Session "${ref}" not found. Use /iflow_sessions to list sessions.` };
        }
        originalPrompt = persisted.prompt;
        originalWorkdir = persisted.workdir;
        originalName = persisted.name;
        originalModel = persisted.model;
      }

      // Build the resume prompt
      const resumePrompt = extraPrompt
        ? `${originalPrompt}\n\n--- Resume ---\n${extraPrompt}`
        : originalPrompt;

      const workdir = originalWorkdir || ctx?.workspaceDir || pluginConfig.defaultWorkdir || process.cwd();
      const channelId = ctx?.messageChannel || "unknown";
      const originChannel = resolveOriginChannel({ id: "cmd" }, resolveAgentChannel(workdir) || channelId);

      try {
        const newSession = sm.spawn({
          prompt: resumePrompt,
          name: `${originalName}-resume`,
          workdir,
          model: originalModel,
          multiTurn: true,
          originChannel,
          originAgentId: ctx?.agentId,
        });

        return {
          text: [
            `↩️ Resumed session as "${newSession.name}" [${newSession.id}].`,
            `   Original: "${originalName}"`,
            `   Dir: ${workdir}`,
            ...(extraPrompt ? [`   Added: "${extraPrompt}"`] : []),
            ``,
            `Use /iflow_fg ${newSession.name} to stream output.`,
          ].join("\n"),
        };
      } catch (err: any) {
        return { text: `Error resuming session: ${err.message}` };
      }
    },
  });
}
