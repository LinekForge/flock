import { WebSocketServer, WebSocket } from "ws";
import { Agent, type AgentApprovalRequest, type AgentConfig, type AgentMessage, type AgentState } from "./agent.js";
import { scanSessions, loadSessionHistory } from "./sessions.js";
import { loadPersistedAgents, savePersistedAgents, loadPersistedConversations, savePersistedConversations, type PersistedAgent } from "./persist.js";
import type { Conversation, ConversationInfo, RouteResult } from "./types.js";
import { createHttpApi } from "./http-api.js";
import { ReminderManager } from "./reminders.js";
import { TaskManager } from "./tasks.js";
import { createAccessToken, isAllowedOrigin } from "./auth.js";
import { join } from "path";
import { homedir } from "os";

const PORT = 9800;
const accessToken = await createAccessToken();

const agents = new Map<string, Agent>();
const conversations = new Map<string, Conversation>();
const clients = new Set<WebSocket>();

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
const pendingApprovals = new Map<string, PendingApproval>();
const messageHistory = new Map<string, any[]>();
const activeAgentConv = new Map<string, string>();
let messageSeq = 0;
let approvalTimeoutMs = 60000;
const messagePersistQueues = new Map<string, Promise<void>>();
let shuttingDown = false;

const AGENT_NAME_PATTERN = /^[A-Za-z0-9_\-\u4E00-\u9FFF]+$/u;

function safeAgentName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  return AGENT_NAME_PATTERN.test(name) ? name : fallback;
}

function setApprovalTimeout(seconds: unknown) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return;
  approvalTimeoutMs = Math.max(10, Math.min(300, Math.round(value))) * 1000;
}

function broadcast(msg: any) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function storeMessage(convId: string, msg: any) {
  if (!messageHistory.has(convId)) messageHistory.set(convId, []);
  const stored = { ...msg, msgId: msg.msgId || `d${++messageSeq}-${Date.now()}` };
  messageHistory.get(convId)!.push(stored);
  void queuePersistMessages(convId);
  return stored;
}

function queuePersistMessages(convId: string): Promise<void> {
  const previous = messagePersistQueues.get(convId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => persistMessagesNow(convId))
    .catch((err) => {
      console.error(`Failed to persist messages for ${convId}:`, err);
    });
  messagePersistQueues.set(convId, next);
  void next.finally(() => {
    if (messagePersistQueues.get(convId) === next) {
      messagePersistQueues.delete(convId);
    }
  });
  return next;
}

async function persistMessagesNow(convId: string) {
  const msgs = messageHistory.get(convId);
  if (!msgs) return;
  const { safeWriteFile, safeMkdir } = await import("./path-guard.js");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".flock", "messages");
  await safeMkdir(dir, { recursive: true });
  await safeWriteFile(join(dir, `${convId}.json`), JSON.stringify(msgs));
}

async function flushMessagePersists() {
  await Promise.all(Array.from(messagePersistQueues.values()));
}

function dmConvId(agentId: string) {
  return `dm-${agentId}`;
}

function defaultCodexWorkDir(agentId: string) {
  return join(homedir(), ".flock", "codex-workspaces", agentId);
}

function getAgentConversationId(agentId: string) {
  return activeAgentConv.get(agentId) || dmConvId(agentId);
}

function getPendingApprovalList() {
  return Array.from(pendingApprovals.values()).map((approval) => ({
    id: approval.id,
    agentId: approval.agentId,
    agentName: approval.agentName,
    toolName: approval.toolName,
    inputSummary: approval.inputSummary,
    input: approval.input,
    toolUseId: approval.toolUseId,
    conversationId: approval.conversationId,
    timestamp: approval.timestamp,
  }));
}

function summarizeApprovalInput(toolName: string, input: any): string {
  const fallback = JSON.stringify(input ?? {}).slice(0, 100);
  if (toolName === "Edit" || toolName === "Write") {
    return input?.file_path || fallback;
  }
  if (toolName === "Bash") {
    return input?.command ? String(input.command).slice(0, 100) : "";
  }
  return fallback;
}

async function requestApproval(data: { agentId: string; toolName: string; input: any; toolUseId?: string }) {
  const { agentId, toolName, input, toolUseId } = data;
  const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const agent = agents.get(agentId);
  const agentName = agent?.config.name || agentId;
  const conversationId = getAgentConversationId(agentId);
  const timestamp = Date.now();
  const timeoutMs = approvalTimeoutMs;
  const inputSummary = summarizeApprovalInput(toolName, input);

  if (agent) {
    const statusMsg = {
      type: "agent:message",
      messageType: "system",
      content: `⏳ Waiting for approval: ${toolName} — ${inputSummary}`,
      conversationId,
      timestamp,
    };
    const stored = storeMessage(conversationId, statusMsg);
    broadcast(stored);
  }

  return await new Promise<any>((resolve) => {
    ctxSetPendingApproval({
      id, agentId, agentName, toolName, inputSummary, input, toolUseId, conversationId, timestamp, resolve,
    });

    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        broadcast({ type: "approval:expired", id });
        if (agent) {
          const expiredMsg = {
            type: "agent:message",
            messageType: "system",
            content: `⏰ Approval timed out (${Math.round(timeoutMs / 1000)}s): ${toolName} — ${inputSummary}`,
            conversationId,
            timestamp: Date.now(),
          };
          const stored = storeMessage(conversationId, expiredMsg);
          broadcast(stored);
        }
        resolve({ behavior: "deny", message: `Approval timed out (${Math.round(timeoutMs / 1000)}s).` });
      }
    }, timeoutMs);
  });
}

function ctxSetPendingApproval(approval: PendingApproval) {
  pendingApprovals.set(approval.id, approval);
  broadcast({
    type: "approval:request",
    id: approval.id,
    agentId: approval.agentId,
    agentName: approval.agentName,
    toolName: approval.toolName,
    inputSummary: approval.inputSummary,
    input: approval.input,
    toolUseId: approval.toolUseId,
    conversationId: approval.conversationId,
    timestamp: approval.timestamp,
  });
}

function ensureDmConversation(agentId: string, agentName: string) {
  const convId = dmConvId(agentId);
  if (!conversations.has(convId)) {
    const conv: Conversation = {
      id: convId,
      type: "dm",
      name: agentName,
      agentIds: [agentId],
      createdAt: Date.now(),
    };
    conversations.set(convId, conv);
    if (!messageHistory.has(convId)) messageHistory.set(convId, []);
  }
  return convId;
}

async function persistState() {
  const persistedAgents: PersistedAgent[] = Array.from(agents.values()).map((a) => ({
    id: a.config.id,
    name: a.config.name,
    model: a.config.model || "sonnet",
    runtime: a.config.runtime || "claude",
    sessionId: a.getSessionId(),
    keepAlive: a.config.keepAlive || false,
  }));
  await savePersistedAgents(persistedAgents);
  await savePersistedConversations(Array.from(conversations.values()));
}

function routeMessage(text: string, conv: Conversation): RouteResult {
  const mentionPattern = /@(\S+)/g;
  const mentioned: string[] = [];
  for (const match of text.matchAll(mentionPattern)) {
    const rawName = match[1].replace(/[，。！？、：；""'',.!?:;'"]+$/, "");
    for (const agentId of conv.agentIds) {
      const agent = agents.get(agentId);
      if (agent && agent.config.name === rawName) {
        mentioned.push(agentId);
      }
    }
  }
  if (mentioned.length > 0) {
    return { targetAgentIds: mentioned, cleanedText: text };
  }
  return {
    targetAgentIds: [conv.defaultAgentId || conv.agentIds[0]],
    cleanedText: text,
  };
}

function buildChannelContext(conv: Conversation, msgs: any[], limit = 5): string {
  const recent = msgs.slice(-limit).filter((m: any) => m.messageType === "text" || m.messageType === "user");
  if (recent.length === 0) return "";
  const lines = recent.map((m: any) => {
    const sender = m.messageType === "user" ? "User" : (agents.get(m.agentId)?.config.name || "Agent");
    return `[${sender}]: ${(m.content || "").slice(0, 200)}`;
  });
  return `[Channel: ${conv.name} · Recent context — reply directly, your response goes to this channel]\n${lines.join("\n")}\n\n`;
}

function createAgent(config: AgentConfig, sessionId?: string): Agent {
  const agent = new Agent({ ...config, authToken: accessToken });
  if (sessionId) agent.setSessionId(sessionId);
  const convId = ensureDmConversation(config.id, config.name);

  agent.on("message", (msg: AgentMessage) => {
    const targetConvId = activeAgentConv.get(config.id) || convId;
    const wireMsg = { type: "agent:message", ...msg, conversationId: targetConvId };
    const stored = storeMessage(targetConvId, wireMsg);
    broadcast(stored);

    if (msg.messageType === "text" && targetConvId !== convId) {
      const conv = conversations.get(targetConvId);
      if (conv && conv.type === "channel") {
        const otherAgentIds = conv.agentIds.filter((id) => id !== config.id);
        for (const otherId of otherAgentIds) {
          const other = agents.get(otherId);
          if (other && other.getState() !== "idle" && other.getState() !== "stopped") {
            other.notify(`[Channel #${conv.name}] ${config.name}: ${msg.content}\n\nYou are in this channel — just reply directly, no need to call send_message.`);
          }
        }
      }
    }
  });

  agent.on("status", (info: { agentId: string; state: AgentState; activity: string }) => {
    broadcast({ type: "agent:status", ...info });
    if (info.state === "stopped" || info.state === "idle") {
      activeAgentConv.delete(config.id);
    }
  });

  agent.on("session", (session: { agentId: string; sessionId: string }) => {
    broadcast({ type: "agent:session", ...session });
    persistState();
  });

  agent.on("approval_request", async (approval: AgentApprovalRequest) => {
    const result = await requestApproval(approval);
    approval.resolve(result);
  });

  agents.set(config.id, agent);
  return agent;
}

function getAgentList() {
  return Array.from(agents.values()).map((a) => ({
    id: a.config.id,
    name: a.config.name,
    state: a.getState(),
    activity: a.getActivity(),
    model: a.config.model || "sonnet",
    runtime: a.config.runtime || "claude",
    keepAlive: a.config.keepAlive || false,
  }));
}

function getConversationList(): ConversationInfo[] {
  return Array.from(conversations.values()).map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    agentIds: c.agentIds,
    defaultAgentId: c.defaultAgentId,
  }));
}

function deliverToAgent(agentId: string, text: string, convId: string) {
  const agent = agents.get(agentId);
  if (!agent) return;
  activeAgentConv.set(agentId, convId);
  if (agent.getState() === "idle" || agent.getState() === "stopped") {
    agent.start(text);
  } else {
    agent.deliver(text);
  }
}

async function restoreAgents() {
  const persisted = await loadPersistedAgents();
  const persistedConvs = await loadPersistedConversations();

  await loadPersistedMessages();

  for (const p of persisted) {
    if (!p.sessionId) continue;
    const config: AgentConfig = { id: p.id, name: p.name, model: p.model, runtime: p.runtime, keepAlive: p.keepAlive };
    const convId = dmConvId(p.id);
    const hasPersistedMessages = (messageHistory.get(convId)?.length || 0) > 0;
    const agent = createAgent(config, p.sessionId);
    if (p.sessionId && !hasPersistedMessages) {
      const history = await loadSessionHistory(p.sessionId);
      for (const m of history) {
        storeMessage(convId, { ...m, agentId: p.id, conversationId: convId });
      }
    }
    if (p.keepAlive) {
      agent.start();
    }
  }

  for (const c of persistedConvs) {
    if (c.type === "channel") {
      conversations.set(c.id, c);
      if (!messageHistory.has(c.id)) messageHistory.set(c.id, []);
    }
  }

  const total = persisted.length + persistedConvs.filter((c) => c.type === "channel").length;
  if (total > 0) {
    console.log(`  restored ${persisted.length} agent(s), ${persistedConvs.filter((c) => c.type === "channel").length} channel(s)`);
  }
}

async function loadPersistedMessages() {
  try {
    const { readdir, readFile } = await import("fs/promises");
    const msgDir = join(homedir(), ".flock", "messages");
    const files = await readdir(msgDir).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const convId = file.replace(".json", "");
      try {
        const data = JSON.parse(await readFile(join(msgDir, file), "utf-8"));
        if (Array.isArray(data) && data.length > 0) {
          messageHistory.set(convId, data);
          if (data.length > messageSeq) messageSeq = data.length;
        }
      } catch {}
    }
  } catch {}
}

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: PORT,
  verifyClient(info, done) {
    const origin = info.origin || info.req.headers.origin || null;
    const url = new URL(info.req.url || "/", `ws://${info.req.headers.host || "127.0.0.1"}`);
    const token = url.searchParams.get("token");
    done(isAllowedOrigin(origin) && token === accessToken, 401, "Unauthorized");
  },
});

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);

  ws.send(JSON.stringify({
    type: "welcome",
    agents: getAgentList(),
    conversations: getConversationList(),
    approvals: getPendingApprovalList(),
  }));

  const allHistory: any[] = [];
  for (const [, msgs] of messageHistory) {
    for (const msg of msgs) {
      allHistory.push(msg);
    }
  }
  ws.send(JSON.stringify({ type: "history:batch", messages: allHistory }));

  ws.on("message", async (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "agent:create": {
        const safeId = `agent-${Date.now()}`;
        const runtime = msg.runtime || "claude";
        const config: AgentConfig = {
          id: safeId,
          name: safeAgentName(msg.name, "Agent"),
          model: msg.model,
          runtime,
          ...(runtime === "codex" ? { workDir: msg.workDir || defaultCodexWorkDir(safeId) } : {}),
        };
        const agent = createAgent(config);
        const convId = dmConvId(config.id);
        agent.start(msg.prompt);
        broadcast({
          type: "agent:created",
          id: config.id,
          name: config.name,
          state: "running",
          activity: "",
          model: config.model || "sonnet",
          runtime: config.runtime,
          keepAlive: false,
        });
        { const c = conversations.get(convId)!; broadcast({ type: "conv:created", id: c.id, convType: c.type, name: c.name, agentIds: c.agentIds, defaultAgentId: c.defaultAgentId }); }
        persistState();
        break;
      }

      case "agent:resume": {
        const sessionId = msg.sessionId;
        if (!sessionId) break;
        const agentId = `agent-${Date.now()}`;
        const config: AgentConfig = {
          id: agentId,
          name: safeAgentName(msg.name, sessionId.slice(0, 8)),
          model: msg.model || "sonnet",
          workDir: msg.workDir,
        };

        const history = await loadSessionHistory(sessionId);
        const agent = createAgent(config, sessionId);
        const convId = dmConvId(agentId);

        broadcast({
          type: "agent:created",
          id: agentId,
          name: config.name,
          state: "running",
          activity: "",
          model: config.model || "sonnet",
          keepAlive: false,
        });
        { const c = conversations.get(convId)!; broadcast({ type: "conv:created", id: c.id, convType: c.type, name: c.name, agentIds: c.agentIds, defaultAgentId: c.defaultAgentId }); }

        for (const m of history) {
          const tagged = { ...m, agentId, conversationId: convId };
          const stored = storeMessage(convId, tagged);
          broadcast(stored);
        }

        agent.start();
        persistState();
        break;
      }

      case "conv:create": {
        const conv: Conversation = {
          id: `conv-${Date.now()}`,
          type: "channel",
          name: msg.name || "Channel",
          agentIds: msg.agentIds || [],
          defaultAgentId: msg.defaultAgentId || msg.agentIds?.[0],
          createdAt: Date.now(),
        };
        conversations.set(conv.id, conv);
        messageHistory.set(conv.id, []);
        broadcast({ type: "conv:created", id: conv.id, convType: conv.type, name: conv.name, agentIds: conv.agentIds, defaultAgentId: conv.defaultAgentId });

        for (const agentId of conv.agentIds) {
          const agent = agents.get(agentId);
          if (agent && (agent.getState() === "idle" || agent.getState() === "stopped")) {
            agent.start(`[Flock-Platform] You have been added to channel #${conv.name} (id: ${conv.id}). Use list_conversations and check_messages to see what's going on.`);
          }
        }

        persistState();
        break;
      }

      case "conv:deliver": {
        const conv = conversations.get(msg.conversationId);
        if (!conv) break;

        const userMsg: any = {
          type: "agent:message",
          messageType: "user",
          content: msg.text,
          conversationId: msg.conversationId,
          clientMsgId: msg.clientMsgId,
          timestamp: Date.now(),
        };
        if (msg.replyTo) userMsg.replyTo = msg.replyTo;
        const storedUserMsg = storeMessage(msg.conversationId, userMsg);
        broadcast(storedUserMsg);

        if (conv.type === "dm") {
          const agentId = conv.agentIds[0];
          if (agentId) deliverToAgent(agentId, msg.text, msg.conversationId);
        } else {
          const route = routeMessage(msg.text, conv);
          const convMsgs = messageHistory.get(msg.conversationId) || [];
          for (const agentId of route.targetAgentIds) {
            const context = buildChannelContext(conv, convMsgs);
            deliverToAgent(agentId, context + route.cleanedText, msg.conversationId);
          }

          const otherAgentIds = conv.agentIds.filter((id) => !route.targetAgentIds.includes(id));
          const primaryName = route.targetAgentIds.map((id) => agents.get(id)?.config.name || id).join(", ");
          for (const agentId of otherAgentIds) {
            const agent = agents.get(agentId);
            if (agent && agent.getState() !== "idle" && agent.getState() !== "stopped") {
              agent.notify(`[Channel #${conv.name}] User: ${msg.text}\n\n${primaryName} is responding. Just reply directly if you have something important to add.`);
            }
          }
        }
        break;
      }

      case "agent:deliver": {
        const agent = agents.get(msg.agentId);
        if (agent) {
          const convId = dmConvId(msg.agentId);
          const userMsg = { type: "agent:message", messageType: "user", content: msg.text, agentId: msg.agentId, conversationId: convId, clientMsgId: msg.clientMsgId, timestamp: Date.now() };
          const storedUserMsg = storeMessage(convId, userMsg);
          broadcast(storedUserMsg);
          deliverToAgent(msg.agentId, msg.text, convId);
        }
        break;
      }

      case "agent:send-image": {
        const convId = msg.conversationId || dmConvId(msg.agentId);
        const conv = conversations.get(convId);
        const targetAgentId = conv?.type === "channel" ? (conv.defaultAgentId || conv.agentIds[0]) : msg.agentId;
        const agent = targetAgentId ? agents.get(targetAgentId) : null;
        if (agent) {
          activeAgentConv.set(targetAgentId, convId);
          const userMsg = {
            type: "agent:message",
            messageType: "user",
            content: `[Image: ${msg.fileName}]`,
            conversationId: convId,
            clientMsgId: msg.clientMsgId,
            timestamp: Date.now(),
          };
          const storedUserMsg = storeMessage(convId, userMsg);
          broadcast(storedUserMsg);
          agent.deliverImage(msg.base64, msg.mediaType, msg.fileName);
        }
        break;
      }

      case "session:list": {
        const sessions = await scanSessions();
        ws.send(JSON.stringify({ type: "session:list", sessions }));
        break;
      }

      case "search:query": {
        const results: any[] = [];
        const q = (msg.query || "").toLowerCase();
        if (!q) break;
        for (const [convId, msgs] of messageHistory) {
          const conv = conversations.get(convId);
          for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            if (!m.content || m.messageType === "turn_end" || m.messageType === "system") continue;
            if (!m.content.toLowerCase().includes(q)) continue;
            results.push({
              conversationId: convId,
              conversationName: conv?.name || convId,
              agentId: m.agentId || "",
              agentName: m.agentId ? (agents.get(m.agentId)?.config.name || "") : "",
              messageType: m.messageType,
              content: m.content.slice(0, 200),
              timestamp: m.timestamp,
            });
            if (results.length >= 50) break;
          }
          if (results.length >= 50) break;
        }
        ws.send(JSON.stringify({ type: "search:results", query: msg.query, results }));
        break;
      }

      case "agent:keep-alive": {
        const agent = agents.get(msg.agentId);
        if (agent) {
          (agent.config as any).keepAlive = !!msg.keepAlive;
          persistState();
          broadcast({ type: "agent:keep-alive", agentId: msg.agentId, keepAlive: !!msg.keepAlive });
        }
        break;
      }

      case "agent:rename": {
        const agent = agents.get(msg.agentId);
        const nextName = safeAgentName(msg.name, "");
        if (agent && nextName) {
          const oldName = agent.config.name;
          (agent.config as any).name = nextName;
          const conv = conversations.get(dmConvId(msg.agentId));
          if (conv) conv.name = nextName;
          persistState();
          const convId = dmConvId(msg.agentId);
          const sysMsg = {
            type: "agent:message",
            messageType: "system",
            content: `${oldName} → ${nextName}`,
            conversationId: convId,
            timestamp: Date.now(),
          };
          const stored = storeMessage(convId, sysMsg);
          broadcast(stored);
          if (agent.getState() !== "idle" && agent.getState() !== "stopped") {
            agent.notify(`[Flock-Platform] 你的平台显示名已从「${oldName}」改为「${nextName}」。其他人会用新名字称呼你。这不影响你的核心身份。`);
          }
        }
        break;
      }

      case "settings:update": {
        setApprovalTimeout(msg.approvalTimeout);
        break;
      }

      case "ui-state:save": {
        const { safeWriteFile, safeMkdir } = await import("./path-guard.js");
        const { join } = await import("path");
        const { homedir } = await import("os");
        const dir = join(homedir(), ".flock");
        await safeMkdir(dir, { recursive: true });
        await safeWriteFile(join(dir, "ui-state.json"), JSON.stringify(msg.state || {}));
        break;
      }

      case "ui-state:load": {
        try {
          const { join } = await import("path");
          const { homedir } = await import("os");
          const { readFile } = await import("fs/promises");
          const data = await readFile(join(homedir(), ".flock", "ui-state.json"), "utf-8");
          ws.send(JSON.stringify({ type: "ui-state:loaded", state: JSON.parse(data) }));
        } catch {
          ws.send(JSON.stringify({ type: "ui-state:loaded", state: {} }));
        }
        break;
      }

      case "agent:stop": {
        const agent = agents.get(msg.agentId);
        if (agent) agent.stop();
        break;
      }

      case "agent:remove": {
        const agent = agents.get(msg.agentId);
        if (agent) agent.stop();
        agents.delete(msg.agentId);
        const convId = dmConvId(msg.agentId);
        conversations.delete(convId);
        messageHistory.delete(convId);
        for (const [, conv] of conversations) {
          if (conv.type === "channel" && conv.agentIds.includes(msg.agentId)) {
            conv.agentIds = conv.agentIds.filter((id) => id !== msg.agentId);
            if (conv.defaultAgentId === msg.agentId) {
              conv.defaultAgentId = conv.agentIds[0] || undefined;
            }
            broadcast({ type: "conv:updated", id: conv.id, agentIds: conv.agentIds, defaultAgentId: conv.defaultAgentId });
          }
        }
        persistState();
        break;
      }

      case "approval:respond": {
        const pending = pendingApprovals.get(msg.approvalId);
        if (pending) {
          if (msg.approved) {
            pending.resolve({ behavior: "allow", updatedInput: {} });
            const approvedMsg = {
              type: "agent:message", messageType: "system",
              content: `✅ Approved: ${pending.toolName} — ${pending.inputSummary}`,
              conversationId: pending.conversationId,
              timestamp: Date.now(),
            };
            storeMessage(pending.conversationId!, approvedMsg);
            broadcast(approvedMsg);
          } else {
            pending.resolve({ behavior: "deny", message: "User denied the operation." });
            const deniedMsg = {
              type: "agent:message", messageType: "system",
              content: `❌ Denied: ${pending.toolName} — ${pending.inputSummary}`,
              conversationId: pending.conversationId,
              timestamp: Date.now(),
            };
            storeMessage(pending.conversationId!, deniedMsg);
            broadcast(deniedMsg);
          }
          pendingApprovals.delete(msg.approvalId);
          broadcast({ type: "approval:resolved", id: msg.approvalId });
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

const reminderMgr = new ReminderManager((agentId, content) => {
  const agent = agents.get(agentId);
  if (agent) {
    const convId = activeAgentConv.get(agentId) || dmConvId(agentId);
    const msg = { type: "agent:message", messageType: "system", content, conversationId: convId, timestamp: Date.now() };
    const stored = storeMessage(convId, msg);
    broadcast(stored);
    if (agent.getState() !== "idle" && agent.getState() !== "stopped") {
      agent.deliver(content);
    }
  }
});
await reminderMgr.load();

const taskMgr = new TaskManager();
await taskMgr.load();

createHttpApi({
  authToken: accessToken,
  agents,
  conversations,
  messageHistory,
  pendingApprovals,
  deliverToAgent,
  storeMessage,
  broadcast,
  persistState,
  getAgentConversationId,
  getApprovalTimeoutMs: () => approvalTimeoutMs,
  requestApproval,
  reminders: {
    schedule: (agentId, content, delayMs) => reminderMgr.schedule(agentId, content, delayMs),
    list: (agentId) => reminderMgr.list(agentId),
    cancel: (id) => reminderMgr.cancel(id),
  },
  tasks: {
    list: (convId) => taskMgr.list(convId),
    create: (data) => taskMgr.create(data),
    claim: (taskId, agentId) => taskMgr.claim(taskId, agentId),
    unclaim: (taskId, agentId) => taskMgr.unclaim(taskId, agentId),
    updateStatus: (taskId, status, agentId) => taskMgr.updateStatus(taskId, status, agentId),
  },
});

await restoreAgents();
console.log(`Flock daemon · ws://127.0.0.1:${PORT} · API http://127.0.0.1:9801`);

process.on("SIGINT", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    for (const agent of agents.values()) agent.stop();
    wss.close();
    await flushMessagePersists();
    await taskMgr.flush();
    await reminderMgr.flush();
    process.exit(0);
  })();
});
