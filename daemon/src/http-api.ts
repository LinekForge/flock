import type { Agent } from "./agent.js";
import type { Conversation } from "./types.js";
import * as attachments from "./attachments.js";
import { authMatches, corsHeaders, isAllowedOrigin, isLocalAddress } from "./auth.js";

interface PendingApproval {
  id: string;
  agentId: string;
  agentName: string;
  toolName: string;
  inputSummary: string;
  input: any;
  toolUseId?: string;
  conversationId?: string;
  timestamp: number;
  resolve: (result: any) => void;
}

interface ApiContext {
  authToken: string;
  agents: Map<string, Agent>;
  conversations: Map<string, Conversation>;
  messageHistory: Map<string, any[]>;
  pendingApprovals: Map<string, PendingApproval>;
  deliverToAgent: (agentId: string, text: string, convId: string) => void;
  setAgentConv: (agentId: string, convId: string) => void;
  storeMessage: (convId: string, msg: any) => any;
  broadcast: (msg: any) => void;
  persistState: () => Promise<void>;
  getAgentConversationId: (agentId: string) => string | undefined;
  getApprovalTimeoutMs: () => number;
  requestApproval: (data: {
    agentId: string;
    toolName: string;
    input: any;
    toolUseId?: string;
  }) => Promise<any>;
  reminders: {
    schedule: (agentId: string, content: string, delayMs: number) => Promise<string>;
    list: (agentId: string) => any[];
    cancel: (id: string) => Promise<boolean>;
  };
  tasks: {
    list: (convId?: string) => any[];
    create: (task: any) => Promise<any>;
    claim: (taskId: string, agentId: string) => Promise<any>;
    unclaim: (taskId: string, agentId?: string) => Promise<any>;
    updateStatus: (taskId: string, status: string, agentId?: string) => Promise<any>;
  };
}

export function createHttpApi(ctx: ApiContext) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 9801,
    fetch(req, server) {
      const url = new URL(req.url);
      const path = url.pathname;
      const origin = req.headers.get("origin");
      const headers = corsHeaders(origin);

      if (req.method === "OPTIONS") {
        return Object.keys(headers).length > 0
          ? new Response(null, { status: 204, headers })
          : new Response("Forbidden", { status: 403 });
      }

      if (req.method === "GET" && path === "/api/health") {
        return json({ ok: true, app: "flock", version: "0.1.0" }, 200, headers);
      }

      if (req.method === "GET" && path === "/api/auth-token") {
        const ip = server.requestIP(req)?.address;
        if (!isAllowedOrigin(origin) || !isLocalAddress(ip)) {
          return json({ error: "Forbidden" }, 403, headers);
        }
        return json({ token: ctx.authToken }, 200, headers);
      }

      if (!authMatches(req.headers.get("authorization"), ctx.authToken)) {
        return json({ error: "Unauthorized" }, 401, headers);
      }

      if (req.method === "POST" && path === "/api/send") {
        return handleSend(req, ctx, headers);
      }
      if (req.method === "GET" && path.startsWith("/api/messages/")) {
        return handleGetMessages(path, url, ctx, headers);
      }
      if (req.method === "GET" && path.startsWith("/api/history/")) {
        return handleGetHistory(path, url, ctx, headers);
      }
      if (req.method === "GET" && path === "/api/search") {
        return handleSearch(url, ctx, headers);
      }
      if (req.method === "GET" && path === "/api/conversations") {
        return handleListConversations(ctx, headers);
      }
      if (req.method === "POST" && path === "/api/reminders") {
        return handleScheduleReminder(req, ctx, headers);
      }
      if (req.method === "GET" && path === "/api/reminders") {
        return handleListReminders(url, ctx, headers);
      }
      if (req.method === "DELETE" && path.startsWith("/api/reminders/")) {
        return handleCancelReminder(path, ctx, headers);
      }
      if (req.method === "GET" && path === "/api/tasks") {
        return handleListTasks(url, ctx, headers);
      }
      if (req.method === "POST" && path === "/api/tasks") {
        return handleCreateTask(req, ctx, headers);
      }
      if (req.method === "POST" && path === "/api/tasks/claim") {
        return handleClaimTask(req, ctx, headers);
      }
      if (req.method === "POST" && path === "/api/tasks/unclaim") {
        return handleUnclaimTask(req, ctx, headers);
      }
      if (req.method === "POST" && path === "/api/tasks/update-status") {
        return handleUpdateTaskStatus(req, ctx, headers);
      }

      if (req.method === "POST" && path === "/api/upload") {
        return handleUpload(req, headers);
      }
      if (req.method === "GET" && path.startsWith("/api/attachments/")) {
        return handleGetAttachment(path, headers);
      }
      if (req.method === "GET" && path.startsWith("/api/attachment-meta/")) {
        return handleGetAttachmentMeta(path, headers);
      }

      if (req.method === "POST" && path === "/api/leave-channel") {
        return handleLeaveChannel(req, ctx, headers);
      }

      if (req.method === "POST" && path === "/api/approval-request") {
        return handleApprovalRequest(req, ctx, headers);
      }

      return new Response("Not found", { status: 404, headers });
    },
  });
}

function json(data: any, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function getAgentActor(req: Request): string | null {
  return req.headers.get("x-flock-agent-id");
}

async function handleSend(req: Request, ctx: ApiContext, headers: HeadersInit) {
  const body = await req.json();
  const { conversationId, text, replyToMsgId } = body;
  const agentId = getAgentActor(req);
  if (!agentId) return json({ error: "Agent identity required" }, 403, headers);

  const conv = ctx.conversations.get(conversationId);
  if (!conv) return json({ error: "Conversation not found" }, 404, headers);
  if (!conv.agentIds.includes(agentId)) return json({ error: "Agent is not in conversation" }, 403, headers);

  let replyTo: any = undefined;
  if (replyToMsgId) {
    const convMsgs = ctx.messageHistory.get(conversationId) || [];
    const referenced = convMsgs.find((m: any) => m.msgId === replyToMsgId);
    if (referenced) {
      const refAgentName = referenced.agentId
        ? ctx.agents.get(referenced.agentId)?.config.name
        : undefined;
      replyTo = {
        msgId: replyToMsgId,
        content: (referenced.content || "").slice(0, 200),
        agentName: refAgentName || (referenced.messageType === "user" ? "User" : undefined),
      };
    }
  }

  const msg: any = {
    type: "agent:message",
    messageType: "text",
    content: text,
    agentId,
    conversationId,
    timestamp: Date.now(),
  };
  if (replyTo) msg.replyTo = replyTo;
  const stored = ctx.storeMessage(conversationId, msg);
  ctx.broadcast(stored);

  if (conv.type === "channel") {
    const senderName = ctx.agents.get(agentId)?.config.name || agentId;
    const otherAgentIds = conv.agentIds.filter((id) => id !== agentId);
    for (const otherId of otherAgentIds) {
      const other = ctx.agents.get(otherId);
      if (other) {
        if (other.getState() === "idle" || other.getState() === "stopped") {
          ctx.deliverToAgent(otherId, `[Channel #${conv.name}] New message from ${senderName}. Use check_messages to read.`, conversationId);
        } else {
          ctx.setAgentConv(otherId, conversationId);
          other.notify(`[New messages] #${conv.name}: 1 new message. Use check_messages to read.`);
        }
      }
    }
  }

  return json({ ok: true, msgId: stored.msgId }, 200, headers);
}

function handleGetMessages(path: string, url: URL, ctx: ApiContext, headers: HeadersInit) {
  const convId = path.replace("/api/messages/", "");
  const since = parseInt(url.searchParams.get("since") || "0");
  const msgs = (ctx.messageHistory.get(convId) || [])
    .filter((m: any) => m.timestamp > since && m.messageType !== "turn_end");
  return json({ messages: msgs.slice(-50) }, 200, headers);
}

function handleGetHistory(path: string, url: URL, ctx: ApiContext, headers: HeadersInit) {
  const convId = path.replace("/api/history/", "");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const msgs = (ctx.messageHistory.get(convId) || [])
    .filter((m: any) => m.messageType === "text" || m.messageType === "user");
  return json({ messages: msgs.slice(-limit) }, 200, headers);
}

function handleSearch(url: URL, ctx: ApiContext, headers: HeadersInit) {
  const q = (url.searchParams.get("q") || "").toLowerCase();
  if (!q) return json({ results: [] }, 200, headers);

  const results: any[] = [];
  for (const [convId, msgs] of ctx.messageHistory) {
    const conv = ctx.conversations.get(convId);
    for (const m of msgs) {
      if (!m.content || m.messageType === "turn_end" || m.messageType === "system") continue;
      if (!m.content.toLowerCase().includes(q)) continue;
      results.push({
        conversationId: convId,
        conversationName: conv?.name || convId,
        agentId: m.agentId || "",
        content: m.content.slice(0, 200),
        timestamp: m.timestamp,
      });
      if (results.length >= 30) break;
    }
    if (results.length >= 30) break;
  }
  return json({ results }, 200, headers);
}

function handleListConversations(ctx: ApiContext, headers: HeadersInit) {
  const convs = Array.from(ctx.conversations.values()).map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    agentIds: c.agentIds,
    agents: c.agentIds.map((id) => {
      const a = ctx.agents.get(id);
      return a ? { id: a.config.id, name: a.config.name } : { id, name: id };
    }),
  }));
  return json({ conversations: convs }, 200, headers);
}

async function handleScheduleReminder(req: Request, ctx: ApiContext, headers: HeadersInit) {
  const body = await req.json();
  const id = await ctx.reminders.schedule(body.agentId, body.content, body.delayMs || 60000);
  return json({ id }, 200, headers);
}

function handleListReminders(url: URL, ctx: ApiContext, headers: HeadersInit) {
  const agentId = url.searchParams.get("agentId") || "";
  return json({ reminders: ctx.reminders.list(agentId) }, 200, headers);
}

async function handleCancelReminder(path: string, ctx: ApiContext, headers: HeadersInit) {
  const id = path.replace("/api/reminders/", "");
  const ok = await ctx.reminders.cancel(id);
  return json({ ok }, 200, headers);
}

function handleListTasks(url: URL, ctx: ApiContext, headers: HeadersInit) {
  const convId = url.searchParams.get("convId") || undefined;
  return json({ tasks: ctx.tasks.list(convId) }, 200, headers);
}

async function handleCreateTask(req: Request, ctx: ApiContext, headers: HeadersInit) {
  const body = await req.json();
  const actor = getAgentActor(req);
  const task = await ctx.tasks.create({ ...body, createdBy: actor || body.createdBy || "user" });
  return json({ task }, 200, headers);
}

async function handleClaimTask(req: Request, ctx: ApiContext, headers: HeadersInit) {
  const body = await req.json();
  const actor = getAgentActor(req);
  if (!actor) return json({ error: "Agent identity required" }, 403, headers);
  const task = await ctx.tasks.claim(body.taskId, actor);
  return json({ task }, task ? 200 : 403, headers);
}

async function handleUnclaimTask(req: Request, ctx: ApiContext, headers: HeadersInit) {
  const body = await req.json();
  const task = await ctx.tasks.unclaim(body.taskId, getAgentActor(req) || undefined);
  return json({ task }, task ? 200 : 403, headers);
}

async function handleUpdateTaskStatus(req: Request, ctx: ApiContext, headers: HeadersInit) {
  const body = await req.json();
  const task = await ctx.tasks.updateStatus(body.taskId, body.status, getAgentActor(req) || undefined);
  return json({ task }, task ? 200 : 403, headers);
}

async function handleUpload(req: Request, headers: HeadersInit) {
  const body = await req.json();
  const { data, fileName, mimeType, uploadedBy } = body;
  if (!data || !fileName) return json({ error: "Missing data or fileName" }, 400, headers);
  if (typeof data !== "string") return json({ error: "Attachment data must be base64" }, 400, headers);
  if (attachments.estimateBase64DecodedSize(data) > attachments.MAX_ATTACHMENT_BYTES) {
    return json({ error: "Attachment too large" }, 413, headers);
  }
  try {
    const meta = await attachments.store(data, String(fileName), String(mimeType || "application/octet-stream"), uploadedBy || "");
    return json({ attachment: meta }, 200, headers);
  } catch (err: any) {
    return json({ error: err?.message || "Upload failed" }, 400, headers);
  }
}

async function handleGetAttachment(path: string, headers: HeadersInit) {
  const id = path.replace("/api/attachments/", "");
  const result = await attachments.getData(id);
  if (!result) return new Response("Not found", { status: 404, headers });
  return new Response(new Uint8Array(result.data), {
    headers: {
      ...headers,
      "Content-Type": result.meta.mimeType,
      "Content-Disposition": `inline; filename="${result.meta.fileName}"`,
    },
  });
}

async function handleGetAttachmentMeta(path: string, headers: HeadersInit) {
  const id = path.replace("/api/attachment-meta/", "");
  const meta = await attachments.getMeta(id);
  if (!meta) return json({ error: "Not found" }, 404, headers);
  if (!attachments.isTextLikeMimeType(meta.mimeType)) {
    return json({
      attachment: meta,
      binary: true,
      message: "Binary attachment; use /api/attachments/:id to download it.",
    }, 200, headers);
  }

  const result = await attachments.getData(id);
  if (!result) return json({ error: "Not found" }, 404, headers);
  const preview = result.data.subarray(0, attachments.TEXT_PREVIEW_BYTES).toString("utf-8");
  return json({
    attachment: meta,
    content: preview,
    truncated: result.data.length > attachments.TEXT_PREVIEW_BYTES,
  }, 200, headers);
}

async function handleLeaveChannel(req: Request, ctx: ApiContext, headers: HeadersInit) {
  const body = await req.json();
  const { conversationId } = body;
  const agentId = getAgentActor(req);
  if (!agentId) return json({ error: "Agent identity required" }, 403, headers);
  const conv = ctx.conversations.get(conversationId);
  if (!conv) return json({ error: "Conversation not found" }, 404, headers);
  conv.agentIds = conv.agentIds.filter((id: string) => id !== agentId);
  if (conv.defaultAgentId === agentId) {
    conv.defaultAgentId = conv.agentIds[0] || undefined;
  }
  const msg = {
    type: "agent:message",
    messageType: "system",
    content: `${ctx.agents.get(agentId)?.config.name || agentId} left the channel.`,
    conversationId,
    timestamp: Date.now(),
  };
  const stored = ctx.storeMessage(conversationId, msg);
  ctx.broadcast(stored);
  ctx.broadcast({ type: "conv:updated", id: conversationId, agentIds: conv.agentIds, defaultAgentId: conv.defaultAgentId });
  await ctx.persistState();
  return json({ ok: true }, 200, headers);
}

async function handleApprovalRequest(req: Request, ctx: ApiContext, headers: HeadersInit) {
  const body = await req.json();
  const { agentId, toolName, input, toolUseId } = body;
  const result = await ctx.requestApproval({ agentId, toolName, input, toolUseId });
  return json(result, 200, headers);
}
