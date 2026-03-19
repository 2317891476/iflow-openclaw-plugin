import { getChatBridgeManager, pluginConfig } from "../shared";

function buildBridgeContext(ctx: any) {
  return {
    workspaceDir: ctx?.workspaceDir,
    messageChannel: ctx?.messageChannel ?? ctx?.channelId ?? ctx?.channel,
    agentId: ctx?.agentId,
    agentAccountId: ctx?.agentAccountId ?? ctx?.accountId,
    conversationId: ctx?.conversationId,
    sessionKey: ctx?.sessionKey ?? pluginConfig.defaultChatSessionKey,
  };
}

function registerAlias(api: any, name: string, description: string) {
  api.registerCommand({
    name,
    description,
    acceptsArgs: true,
    async handler(ctx: any) {
      const bridge = getChatBridgeManager();
      if (!bridge) return { text: "Error: Chat bridge not initialized." };

      console.log(`[${name}] ctx keys=${Object.keys(ctx || {}).sort().join(",")}`);
      console.log(`[${name}] ctx channel=${ctx?.channel} channelId=${ctx?.channelId} messageChannel=${ctx?.messageChannel} from=${ctx?.from} to=${ctx?.to} accountId=${ctx?.accountId} conversationId=${ctx?.conversationId} sessionKey=${ctx?.sessionKey}`);

      const text = await bridge.handleInput(ctx.args ?? "", buildBridgeContext(ctx));
      return { text };
    },
  });
}

/**
 * Simple chat-oriented façade over the session manager.
 */
export function registerIFlowChatCommand(api: any) {
  registerAlias(api, "iflow_chat", "Simple chat mode for iFlow. Use /iflow_chat <message>, plus /iflow_chat status|stop.");
  registerAlias(api, "i", "Short iFlow chat alias. Use /i <message>, plus /i status|stop|new <message>. Uses plugin config defaultChatSessionKey when command context lacks a reliable sessionKey.");
}
