import { getSessionManager, getChatBridgeManager, formatDuration } from "./shared";

function ok(respond: any, payload: any): void {
  respond(true, payload);
}

function fail(respond: any, err: any): void {
  const message = err instanceof Error ? err.message : String(err);
  respond(false, undefined, { message });
}

/**
 * Register Gateway methods for iFlow plugin.
 * These allow external systems to interact with iFlow sessions via the OpenClaw gateway.
 */
export function registerGatewayMethods(api: any): void {
  api.registerGatewayMethod?.("iflow.launch", async ({ params, respond }: any) => {
    try {
      const sm = getSessionManager();
      if (!sm) throw new Error("SessionManager not initialized");

      const { prompt, name, workdir, model, timeout, maxTurns, systemPrompt, multiTurn } = params ?? {};
      if (!prompt) throw new Error("prompt is required");

      const session = sm.spawn({
        prompt,
        name,
        workdir: workdir || process.cwd(),
        model,
        timeout,
        maxTurns,
        systemPrompt,
        multiTurn: multiTurn !== false,
      });

      ok(respond, {
        id: session.id,
        name: session.name,
        status: session.status,
        workdir: session.workdir,
      });
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.sessions", async ({ params, respond }: any) => {
    try {
      const sm = getSessionManager();
      if (!sm) throw new Error("SessionManager not initialized");

      const filter = params?.filter ?? "all";
      const sessions = sm.list(filter).map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        workdir: s.workdir,
        prompt: s.prompt,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        duration: formatDuration(s.duration),
        turnCount: s.turnCount,
        error: s.error,
      }));

      ok(respond, sessions);
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.kill", async ({ params, respond }: any) => {
    try {
      const sm = getSessionManager();
      if (!sm) throw new Error("SessionManager not initialized");

      const ref = params?.session;
      if (!ref) throw new Error("session is required");

      const session = sm.resolve(ref);
      if (!session) throw new Error(`Session "${ref}" not found`);

      ok(respond, { success: sm.kill(session.id), id: session.id, name: session.name });
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.output", async ({ params, respond }: any) => {
    try {
      const sm = getSessionManager();
      if (!sm) throw new Error("SessionManager not initialized");

      const ref = params?.session;
      if (!ref) throw new Error("session is required");

      const session = sm.resolve(ref);
      if (!session) {
        const persisted = sm.getPersistedSession(ref);
        if (persisted) {
          ok(respond, { id: persisted.sessionId, name: persisted.name, status: persisted.status, output: [] });
          return;
        }
        throw new Error(`Session "${ref}" not found`);
      }

      const lines = params?.full ? undefined : (params?.lines ?? 50);
      ok(respond, {
        id: session.id,
        name: session.name,
        status: session.status,
        output: session.getOutput(lines),
      });
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.respond", async ({ params, respond }: any) => {
    try {
      const sm = getSessionManager();
      if (!sm) throw new Error("SessionManager not initialized");

      const ref = params?.session;
      const message = params?.message;
      if (!ref) throw new Error("session is required");
      if (!message) throw new Error("message is required");

      const session = sm.resolve(ref);
      if (!session) throw new Error(`Session "${ref}" not found`);
      if (session.status !== "running") throw new Error(`Session "${session.name}" is not running (status: ${session.status})`);

      await session.sendMessage(message);
      ok(respond, { success: true, id: session.id, name: session.name });
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.stats", async ({ respond }: any) => {
    try {
      const sm = getSessionManager();
      if (!sm) throw new Error("SessionManager not initialized");

      const metrics = sm.getMetrics();
      const activeSessions = sm.list("running").length + sm.list("starting").length;
      ok(respond, {
        totalSessions: metrics.totalSessions,
        activeSessions,
        sessionsByStatus: metrics.sessionsByStatus,
        totalDurationMs: metrics.totalDurationMs,
        averageDurationMs: metrics.sessionsWithDuration > 0
          ? Math.floor(metrics.totalDurationMs / metrics.sessionsWithDuration)
          : 0,
        mostExpensive: metrics.mostExpensive,
      });
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.chat", async ({ params, respond }: any) => {
    try {
      const bridge = getChatBridgeManager();
      if (!bridge) throw new Error("Chat bridge not initialized");

      const message = params?.message;
      if (!message || typeof message !== "string") throw new Error("message is required");

      const sessionKey = params?.sessionKey;
      if (!sessionKey || typeof sessionKey !== "string") {
        throw new Error("sessionKey is required for iflow.chat in Control UI/WebChat contexts");
      }

      const conversationId = params?.conversationId ?? params?.chatId ?? sessionKey;
      const ctx = {
        workspaceDir: params?.workdir ?? params?.workspaceDir,
        messageChannel: params?.messageChannel ?? "rpc",
        agentId: params?.agentId,
        agentAccountId: params?.agentAccountId,
        conversationId,
        sessionKey,
      };

      const text = await bridge.handleInput(params?.newSession ? `start ${message}` : message, ctx);
      const info = bridge.getSessionInfo(ctx);
      ok(respond, {
        ok: true,
        mode: "rpc-first-chat",
        text,
        conversationId,
        sessionKey,
        binding: info ? {
          sessionId: info.binding.sessionId,
          sessionName: info.binding.sessionName,
          queuedMessages: info.binding.pendingMessages.length,
        } : undefined,
        session: info?.session ? {
          id: info.session.id,
          name: info.session.name,
          status: info.session.status,
          waitingForInput: info.session.isWaitingForInput,
          workdir: info.session.workdir,
        } : undefined,
      });
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.chat.status", async ({ params, respond }: any) => {
    try {
      const bridge = getChatBridgeManager();
      if (!bridge) throw new Error("Chat bridge not initialized");

      const sessionKey = params?.sessionKey;
      if (!sessionKey || typeof sessionKey !== "string") {
        throw new Error("sessionKey is required for iflow.chat.status in Control UI/WebChat contexts");
      }

      const conversationId = params?.conversationId ?? params?.chatId ?? sessionKey;
      const ctx = {
        workspaceDir: params?.workdir ?? params?.workspaceDir,
        messageChannel: params?.messageChannel ?? "rpc",
        agentId: params?.agentId,
        agentAccountId: params?.agentAccountId,
        conversationId,
        sessionKey,
      };

      const info = bridge.getSessionInfo(ctx);
      ok(respond, {
        ok: true,
        mode: "rpc-first-chat",
        conversationId,
        sessionKey,
        text: bridge.status(ctx),
        bound: !!info,
        binding: info ? {
          sessionId: info.binding.sessionId,
          sessionName: info.binding.sessionName,
          queuedMessages: info.binding.pendingMessages.length,
        } : undefined,
        session: info?.session ? {
          id: info.session.id,
          name: info.session.name,
          status: info.session.status,
          waitingForInput: info.session.isWaitingForInput,
          workdir: info.session.workdir,
        } : undefined,
      });
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.chat.stop", async ({ params, respond }: any) => {
    try {
      const bridge = getChatBridgeManager();
      if (!bridge) throw new Error("Chat bridge not initialized");

      const sessionKey = params?.sessionKey;
      if (!sessionKey || typeof sessionKey !== "string") {
        throw new Error("sessionKey is required for iflow.chat.stop in Control UI/WebChat contexts");
      }

      const conversationId = params?.conversationId ?? params?.chatId ?? sessionKey;
      const ctx = {
        workspaceDir: params?.workdir ?? params?.workspaceDir,
        messageChannel: params?.messageChannel ?? "rpc",
        agentId: params?.agentId,
        agentAccountId: params?.agentAccountId,
        conversationId,
        sessionKey,
      };

      const result = bridge.stop(ctx);
      ok(respond, {
        ok: result.ok,
        mode: "rpc-first-chat",
        conversationId,
        sessionKey,
        text: result.message,
      });
    } catch (err) {
      fail(respond, err);
    }
  });

  api.registerGatewayMethod?.("iflow.chat.output", async ({ params, respond }: any) => {
    try {
      const bridge = getChatBridgeManager();
      const sm = getSessionManager();
      if (!bridge) throw new Error("Chat bridge not initialized");
      if (!sm) throw new Error("SessionManager not initialized");

      const sessionKey = params?.sessionKey;
      if (!sessionKey || typeof sessionKey !== "string") {
        throw new Error("sessionKey is required for iflow.chat.output in Control UI/WebChat contexts");
      }

      const conversationId = params?.conversationId ?? params?.chatId ?? sessionKey;
      const ctx = {
        workspaceDir: params?.workdir ?? params?.workspaceDir,
        messageChannel: params?.messageChannel ?? "rpc",
        agentId: params?.agentId,
        agentAccountId: params?.agentAccountId,
        conversationId,
        sessionKey,
      };

      const info = bridge.getSessionInfo(ctx);
      if (!info) throw new Error(`No active bound chat for conversationId "${conversationId}"`);

      const session = info.session ?? sm.resolve(info.binding.sessionId) ?? sm.resolve(info.binding.sessionName);
      if (!session) throw new Error(`Bound session "${info.binding.sessionName}" is no longer active`);

      ok(respond, {
        ok: true,
        mode: "rpc-first-chat",
        conversationId,
        sessionKey,
        binding: {
          sessionId: info.binding.sessionId,
          sessionName: info.binding.sessionName,
          queuedMessages: info.binding.pendingMessages.length,
        },
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          waitingForInput: session.isWaitingForInput,
          workdir: session.workdir,
        },
        output: session.getOutput(params?.full ? undefined : (params?.lines ?? 50)),
      });
    } catch (err) {
      fail(respond, err);
    }
  });
}
