import { getSessionManager, pluginConfig } from "../shared";

/**
 * /iflow_respond <session> <message> — Send a follow-up message to a session
 */
export function registerIFlowRespondCommand(api: any) {
  api.registerCommand({
    name: "iflow_respond",
    description: "Send a follow-up message to a running iFlow session. Usage: /iflow_respond <session> <message>",
    acceptsArgs: true,
    async handler(ctx: any) {
      const args = ctx?.args ?? "";
      const sm = getSessionManager();
      if (!sm) return { text: "Error: SessionManager not initialized." };

      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        return {
          text: [
            "Usage: /iflow_respond <session-id-or-name> <message>",
            "",
            "Example: /iflow_respond fix-auth Also add unit tests",
          ].join("\n"),
        };
      }

      const ref = parts[0];
      const message = parts.slice(1).join(" ");

      const session = sm.resolve(ref);
      if (!session) return { text: `Error: Session "${ref}" not found. Use /iflow_sessions to list sessions.` };

      if (session.status !== "running") {
        return { text: `Error: Session "${session.name}" is not running (status: ${session.status}).` };
      }

      // User command — reset auto-respond counter
      session.resetAutoRespond();

      try {
        await session.sendMessage(message);
        const msgSummary = message.length > 60 ? message.slice(0, 60) + "..." : message;
        return {
          text: [
            `↩️ Message sent to "${session.name}" [${session.id}].`,
            `   Message: "${msgSummary}"`,
          ].join("\n"),
        };
      } catch (err: any) {
        return { text: `Error sending message: ${err.message}` };
      }
    },
  });
}
