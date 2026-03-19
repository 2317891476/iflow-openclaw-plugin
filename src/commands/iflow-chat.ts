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

      console.log(`[iflow-chat] ctx keys=${Object.keys(ctx || {}).sort().join(",")}`);
      console.log(`[iflow-chat] ctx channel=${ctx?.channel} channelId=${ctx?.channelId} messageChannel=${ctx?.messageChannel} from=${ctx?.from} to=${ctx?.to} accountId=${ctx?.accountId} conversationId=${ctx?.conversationId} sessionKey=${ctx?.sessionKey}`);
      const conversationId = ctx?.conversationId;
      const resolvedSessionKey = ctx?.sessionKey ?? getConversationSessionKey(conversationId);
      console.log(`[iflow-chat] resolvedSessionKey=${resolvedSessionKey} for conversationId=${conversationId}`);
      const text = await bridge.handleInput(ctx.args ?? "", {
        workspaceDir: ctx?.workspaceDir,
        messageChannel: ctx?.messageChannel ?? ctx?.channelId ?? ctx?.channel,
        agentId: ctx?.agentId,
        agentAccountId: ctx?.agentAccountId ?? ctx?.accountId,
        conversationId,
        sessionKey: resolvedSessionKey,
      });

      return { text };
    },
  });
}
