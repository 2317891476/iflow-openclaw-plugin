import type { Session } from "./session";
import type { SessionManager } from "./session-manager";
import { getNotificationRouter, pluginConfig, resolveAgentChannel, resolveOriginChannel } from "./shared";

export interface ChatBridgeBinding {
  key: string;
  channelId: string;
  sessionId: string;
  sessionName: string;
  pendingMessages: string[];
  lastUpdatedAt: number;
}

export interface ChatBridgeCommandContext {
  workspaceDir?: string;
  messageChannel?: string;
  agentId?: string;
  agentAccountId?: string;
  conversationId?: string;
}

export interface ChatBridgeSessionInfo {
  binding: ChatBridgeBinding;
  session?: Session;
}

function buildChatBindingKey(ctx: ChatBridgeCommandContext): string {
  return [
    ctx.messageChannel || "unknown",
    ctx.agentAccountId || "-",
    ctx.conversationId || "-",
  ].join("::");
}

function summarize(text: string, n = 80): string {
  return text.length > n ? text.slice(0, n) + "..." : text;
}

export class ChatBridgeManager {
  private bindings = new Map<string, ChatBridgeBinding>();
  private sessionToBindingKey = new Map<string, string>();

  constructor(private readonly sm: SessionManager) {}

  getBinding(ctx: ChatBridgeCommandContext): ChatBridgeBinding | undefined {
    return this.bindings.get(buildChatBindingKey(ctx));
  }

  getSessionInfo(ctx: ChatBridgeCommandContext): ChatBridgeSessionInfo | undefined {
    const binding = this.getBinding(ctx);
    if (!binding) return undefined;
    const session = this.sm.resolve(binding.sessionId) ?? this.sm.resolve(binding.sessionName);
    return { binding, session };
  }

  stop(ctx: ChatBridgeCommandContext): { ok: boolean; message: string } {
    const key = buildChatBindingKey(ctx);
    const binding = this.bindings.get(key);
    if (!binding) {
      return { ok: false, message: "No active iFlow chat binding in this conversation." };
    }

    const session = this.sm.resolve(binding.sessionId) ?? this.sm.resolve(binding.sessionName);
    if (session && ctx.messageChannel) {
      session.saveFgOutputOffset(ctx.messageChannel);
      session.foregroundChannels.delete(ctx.messageChannel);
    }

    this.bindings.delete(key);
    this.sessionToBindingKey.delete(binding.sessionId);
    return {
      ok: true,
      message: `🛑 Detached iFlow chat from \"${binding.sessionName}\" [${binding.sessionId}]. Advanced commands still work if you want to manage it manually.`,
    };
  }

  status(ctx: ChatBridgeCommandContext): string {
    const binding = this.getBinding(ctx);
    if (!binding) return "No active iFlow chat binding in this conversation. Use /iflow_chat <message> to start one.";

    const session = this.sm.resolve(binding.sessionId) ?? this.sm.resolve(binding.sessionName);
    if (!session) {
      return [
        `⚠️ This conversation was bound to \"${binding.sessionName}\" [${binding.sessionId}], but that session is no longer active.`,
        `Use /iflow_chat <message> to start a fresh bound chat.`,
      ].join("\n");
    }

    const lines = [
      `💬 iFlow chat is bound to \"${session.name}\" [${session.id}]`,
      `   Status: ${session.status}${session.isWaitingForInput ? " (waiting for input)" : ""}`,
      `   Pending queued replies: ${binding.pendingMessages.length}`,
      `   Use /iflow_chat stop to detach, /iflow_fg ${session.name} for raw streaming, /iflow_sessions for all sessions.`,
    ];
    return lines.join("\n");
  }

  async handleInput(input: string, ctx: ChatBridgeCommandContext): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      return [
        "Usage:",
        "  /iflow_chat <message>        Start or continue the bound chat",
        "  /iflow_chat start <message>  Force a fresh bound iFlow session",
        "  /iflow_chat status           Show current binding",
        "  /iflow_chat stop             Detach this conversation from iFlow chat mode",
      ].join("\n");
    }

    if (/^status$/i.test(trimmed)) return this.status(ctx);
    if (/^stop$/i.test(trimmed)) return this.stop(ctx).message;

    const forceStart = /^(start|new)\s+/i.test(trimmed);
    const message = forceStart ? trimmed.replace(/^(start|new)\s+/i, "").trim() : trimmed;
    if (!message) return "Usage: /iflow_chat start <message>";

    const key = buildChatBindingKey(ctx);
    const existing = this.bindings.get(key);
    const existingSession = existing ? (this.sm.resolve(existing.sessionId) ?? this.sm.resolve(existing.sessionName)) : undefined;

    if (forceStart || !existing || !existingSession || existingSession.status !== "running") {
      return this.launchBoundSession(message, ctx, existing);
    }

    if (ctx.messageChannel) {
      existingSession.foregroundChannels.add(ctx.messageChannel);
      existingSession.markFgOutputSeen(ctx.messageChannel);
    }

    if (existingSession.isWaitingForInput) {
      existingSession.resetAutoRespond();
      await existingSession.sendMessage(message);
      return [
        `↩️ Sent to bound iFlow chat \"${existingSession.name}\" [${existingSession.id}].`,
        `   Message: \"${summarize(message, 120)}\"`,
      ].join("\n");
    }

    existing.pendingMessages.push(message);
    existing.lastUpdatedAt = Date.now();
    return [
      `⏳ iFlow is still working in \"${existingSession.name}\" [${existingSession.id}].`,
      `   Queued your message and will forward it automatically when iFlow explicitly asks for input.`,
      `   Queued: \"${summarize(message, 120)}\"`,
    ].join("\n");
  }

  onWaitingForInput(session: Session): void {
    const binding = this.getBindingBySession(session.id);
    if (!binding) return;
    if (binding.pendingMessages.length === 0) return;

    const message = binding.pendingMessages.shift()!;
    binding.lastUpdatedAt = Date.now();

    session.resetAutoRespond();
    session.sendMessage(message)
      .then(() => {
        const nr = getNotificationRouter();
        nr?.emitToChannel(binding.channelId, [
          `↩️ Auto-forwarded your queued message to \"${session.name}\" [${session.id}] because iFlow is now waiting for input.`,
          `   Message: \"${summarize(message, 120)}\"`,
        ].join("\n"));
      })
      .catch((err: any) => {
        binding.pendingMessages.unshift(message);
        const nr = getNotificationRouter();
        nr?.emitToChannel(binding.channelId, `⚠️ Failed to auto-forward queued chat message to \"${session.name}\": ${err?.message ?? err}`);
      });
  }

  onSessionComplete(session: Session): void {
    const binding = this.getBindingBySession(session.id);
    if (!binding) return;

    if (binding.pendingMessages.length > 0) {
      const nr = getNotificationRouter();
      nr?.emitToChannel(binding.channelId, [
        `ℹ️ Bound iFlow chat \"${session.name}\" [${session.id}] finished with ${binding.pendingMessages.length} queued message(s) still waiting.`,
        `   Send /iflow_chat <message> again to start a fresh bound session, or use /iflow_resume ${session.name} to continue manually.`,
      ].join("\n"));
    }
  }

  private launchBoundSession(message: string, ctx: ChatBridgeCommandContext, previous?: ChatBridgeBinding): string {
    const workdir = ctx.workspaceDir || pluginConfig.defaultWorkdir || process.cwd();
    const channelId = ctx.messageChannel || "unknown";
    let originChannel = resolveOriginChannel({ id: "chat" }, resolveAgentChannel(workdir) || channelId);
    if (originChannel === "unknown") {
      const agentChannel = resolveAgentChannel(workdir);
      if (agentChannel) originChannel = agentChannel;
    }

    const session = this.sm.spawn({
      prompt: message,
      workdir,
      multiTurn: true,
      originChannel,
      originAgentId: ctx.agentId,
    });

    if (ctx.messageChannel) {
      session.foregroundChannels.add(ctx.messageChannel);
      session.markFgOutputSeen(ctx.messageChannel);
    }

    const key = buildChatBindingKey(ctx);
    const binding: ChatBridgeBinding = {
      key,
      channelId,
      sessionId: session.id,
      sessionName: session.name,
      pendingMessages: [],
      lastUpdatedAt: Date.now(),
    };
    this.bindings.set(key, binding);
    this.sessionToBindingKey.set(session.id, key);
    if (previous) this.sessionToBindingKey.delete(previous.sessionId);

    return [
      previous
        ? `🔄 Started a fresh bound iFlow chat, replacing \"${previous.sessionName}\".`
        : `💬 Started a bound iFlow chat for this conversation.`,
      `   Name: ${session.name}`,
      `   ID: ${session.id}`,
      `   Dir: ${workdir}`,
      `   Input: \"${summarize(message, 120)}\"`,
      `   From now on, keep using /iflow_chat <message> for the simple flow. Advanced commands still work: /iflow_sessions, /iflow_fg, /iflow_kill.`,
    ].join("\n");
  }

  private getBindingBySession(sessionId: string): ChatBridgeBinding | undefined {
    const key = this.sessionToBindingKey.get(sessionId);
    return key ? this.bindings.get(key) : undefined;
  }
}

export { buildChatBindingKey };
