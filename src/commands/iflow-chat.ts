import { getChatBridgeManager } from "../shared";

/**
 * /iflow_chat <message> — Simple chat-oriented façade over the session manager.
 */
export function registerIFlowChatCommand(api: any) {
  api.registerCommand({
    name: "iflow_chat",
    description: "Simple chat mode for iFlow. Use /iflow_chat <message>, plus /iflow_chat status|stop.",
    acceptsArgs: true,
    async handler(ctx: any) {
      const bridge = getChatBridgeManager();
      if (!bridge) return { text: "Error: Chat bridge not initialized." };

      const text = await bridge.handleInput(ctx.args ?? "", {
        workspaceDir: ctx?.workspaceDir,
        messageChannel: ctx?.messageChannel,
        agentId: ctx?.agentId,
        agentAccountId: ctx?.agentAccountId,
        conversationId: ctx?.conversationId,
      });

      return { text };
    },
  });
}
