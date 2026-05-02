import { create } from "zustand";
import { isValidAgentName, sanitizeAgentNameInput } from "./names";
import { getSettings, settingsUpdatePayload } from "./settings";

export const API_BASE = "http://127.0.0.1:9801";
const WS_BASE = "ws://127.0.0.1:9800";

export interface Reaction {
  emoji: string;
  count: number;
}

export interface ReplyRef {
  msgId: string;
  content: string;
  agentName?: string;
}

export interface Message {
  id: string;
  msgId?: string;
  clientMsgId?: string;
  type: "user" | "text" | "thinking" | "tool_use" | "system" | "turn_end";
  content: string;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  conversationId?: string;
  timestamp: number;
  reactions?: Reaction[];
  pinned?: boolean;
  replyTo?: ReplyRef;
}

export interface AgentInfo {
  id: string;
  name: string;
  state: string;
  activity: string;
  model: string;
  runtime: string;
  keepAlive: boolean;
}

export interface ConversationInfo {
  id: string;
  type: "dm" | "channel";
  name: string;
  agentIds: string[];
  defaultAgentId?: string;
  pinned?: boolean;
}

export interface SearchResult {
  conversationId: string;
  conversationName: string;
  agentId: string;
  agentName: string;
  messageType: string;
  content: string;
  timestamp: number;
}

export interface ApprovalRequest {
  id: string;
  agentId: string;
  agentName: string;
  toolName: string;
  inputSummary: string;
  input?: unknown;
  toolUseId?: string;
  conversationId?: string;
  timestamp: number;
}

interface FlockState {
  ws: WebSocket | null;
  authToken: string | null;
  connected: boolean;
  agents: AgentInfo[];
  conversations: ConversationInfo[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  approvals: ApprovalRequest[];
  searchResults: SearchResult[];
  isSearchOpen: boolean;
  replyingTo: (Message & { conversationId: string }) | null;
  lastReadTimestamp: Record<string, number>;

  connect: () => void;
  setActiveConversation: (id: string) => void;
  getUnreadCount: (convId: string) => number;
  respondApproval: (id: string, approved: boolean) => void;
  renameAgent: (id: string, name: string) => void;
  stopAgent: (id: string) => void;
  removeAgent: (id: string) => void;
  toggleKeepAlive: (id: string) => void;
  reactToMessage: (convId: string, msgId: string, emoji: string) => void;
  pinMessage: (convId: string, msgId: string) => void;
  unpinMessage: (convId: string, msgId: string) => void;
  getPinnedMessages: () => Message[];
  pinConversation: (id: string) => void;
  sendMessage: (text: string) => void;
  setReplyingTo: (msg: Message, conversationId: string) => void;
  clearReply: () => void;
  createAgent: (name: string, model?: string, runtime?: string) => void;
  createChannel: (name: string, agentIds: string[], defaultAgentId?: string) => void;
  search: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
}

let msgId = 0;
const EMPTY_MESSAGES: Message[] = [];

function saveUiStateToServer() {
  const ws = useStore.getState().ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const pins: Record<string, boolean> = {};
  const reactions: Record<string, Reaction[]> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith("flock:pin:")) pins[key.replace("flock:pin:", "")] = true;
    if (key.startsWith("flock:react:")) {
      try {
        reactions[key.replace("flock:react:", "")] = JSON.parse(localStorage.getItem(key)!);
      } catch {
        // Ignore stale UI cache entries.
      }
    }
  }

  ws.send(JSON.stringify({
    type: "ui-state:save",
    state: {
      pinnedConvs: JSON.parse(localStorage.getItem("flock:pinnedConvs") || "[]"),
      settings: JSON.parse(localStorage.getItem("flock:settings") || "{}"),
      pins,
      reactions,
    },
  }));
}

export function makeClientMsgId(prefix = "u") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchAuthToken() {
  const res = await fetch(`${API_BASE}/api/auth-token`);
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json();
  return data.token as string;
}

function messageStorageKey(msg: Pick<Message, "id" | "msgId" | "clientMsgId">) {
  return msg.msgId || msg.clientMsgId || msg.id;
}

function loadStoredMessageState(msg: Message): Message {
  const key = messageStorageKey(msg);
  const pinned = localStorage.getItem(`flock:pin:${key}`) === "1";
  const rawReactions = localStorage.getItem(`flock:react:${key}`);
  let reactions: Reaction[] | undefined;
  if (rawReactions) {
    try {
      reactions = JSON.parse(rawReactions) as Reaction[];
    } catch {
      reactions = undefined;
    }
  }
  return {
    ...msg,
    pinned: pinned || msg.pinned,
    ...(reactions ? { reactions } : {}),
  };
}

function loadPinnedConversationIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem("flock:pinnedConvs") || "[]") as string[]);
  } catch {
    return new Set<string>();
  }
}

function hydrateConversation(conv: ConversationInfo): ConversationInfo {
  return { ...conv, pinned: loadPinnedConversationIds().has(conv.id) };
}

export const useStore = create<FlockState>((set, get) => ({
  ws: null,
  authToken: null,
  connected: false,
  agents: [],
  conversations: [],
  activeConversationId: null,
  messages: {},
  searchResults: [],
  approvals: [],
  isSearchOpen: false,
  replyingTo: null,
  lastReadTimestamp: JSON.parse(localStorage.getItem("flock:lastRead") || "{}"),

  connect: async () => {
    const existing = get().ws;
    if (existing && existing.readyState <= 1) return;

    let token = get().authToken;
    try {
      if (!token) {
        token = await fetchAuthToken();
        set({ authToken: token });
      }
    } catch {
      set({ connected: false, ws: null });
      setTimeout(() => get().connect(), 3000);
      return;
    }

    const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);

    ws.onopen = () => {
      set({ connected: true });
      ws.send(JSON.stringify(settingsUpdatePayload()));
      ws.send(JSON.stringify({ type: "ui-state:load" }));
    };

    ws.onclose = () => {
      set({ connected: false, ws: null, authToken: null });
      setTimeout(() => get().connect(), 3000);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);

      switch (msg.type) {
        case "welcome":
          set((s) => ({
            agents: msg.agents,
            conversations: (msg.conversations || []).map(hydrateConversation),
            activeConversationId: s.activeConversationId || (msg.conversations?.[0]?.id) || null,
            approvals: msg.approvals || [],
          }));
          break;

        case "agent:created":
          set((s) => ({
            agents: [...s.agents, {
              id: msg.id,
              name: msg.name,
              state: msg.state,
              activity: msg.activity || "",
              model: msg.model || "sonnet",
              runtime: msg.runtime || "claude",
              keepAlive: msg.keepAlive || false,
            }],
          }));
          break;

        case "conv:created":
          set((s) => {
            const exists = s.conversations.some((c) => c.id === msg.id);
            if (exists) return {};
            const conv = hydrateConversation({
              id: msg.id,
              type: msg.convType || "dm",
              name: msg.name,
              agentIds: msg.agentIds || [],
              defaultAgentId: msg.defaultAgentId,
            });
            return {
              conversations: [...s.conversations, conv],
              activeConversationId: msg.id,
              messages: { ...s.messages, [msg.id]: s.messages[msg.id] || [] },
            };
          });
          break;

        case "conv:updated":
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === msg.id
                ? {
                    ...c,
                    agentIds: msg.agentIds || c.agentIds,
                    defaultAgentId: msg.defaultAgentId,
                  }
                : c
            ),
          }));
          break;

        case "history:batch": {
          const grouped: Record<string, Message[]> = {};
          for (const m of msg.messages || []) {
            const convId = m.conversationId || (m.agentId ? `dm-${m.agentId}` : null);
            if (!convId) continue;
            if (!grouped[convId]) grouped[convId] = [];
            const agentName = m.agentId
              ? get().agents.find((a: AgentInfo) => a.id === m.agentId)?.name
              : undefined;
            const newMsg: Message = {
              id: m.msgId || m.clientMsgId || `m${++msgId}`,
              msgId: m.msgId,
              clientMsgId: m.clientMsgId,
              type: m.messageType || "text",
              content: m.content,
              agentId: m.agentId,
              agentName,
              toolName: m.toolName,
              conversationId: convId,
              timestamp: m.timestamp,
              replyTo: m.replyTo,
            };
            grouped[convId].push(loadStoredMessageState(newMsg));
          }
          set((s) => ({ messages: { ...s.messages, ...grouped } }));
          break;
        }

        case "agent:message": {
          const messageType: Message["type"] = msg.messageType || "text";
          const convId = msg.conversationId || (msg.agentId ? `dm-${msg.agentId}` : null);
          if (!convId) break;

          const agentName = msg.agentId
            ? get().agents.find((a) => a.id === msg.agentId)?.name
            : undefined;

          set((s) => {
            const prev = s.messages[convId] || [];
            const existingIndex = prev.findIndex((m) =>
              (msg.msgId && m.msgId === msg.msgId) ||
              (msg.clientMsgId && m.clientMsgId === msg.clientMsgId)
            );
            const newMsg: Message = {
              id: msg.msgId || msg.clientMsgId || `m${++msgId}`,
              msgId: msg.msgId,
              clientMsgId: msg.clientMsgId,
              type: messageType,
              content: msg.content,
              agentId: msg.agentId,
              agentName,
              toolName: msg.toolName,
              conversationId: convId,
              timestamp: msg.timestamp,
            };
            const hydrated = loadStoredMessageState(newMsg);
            if (existingIndex >= 0) {
              const merged = [...prev];
              const existing = merged[existingIndex];
              if (existing.pinned && hydrated.msgId) {
                localStorage.setItem(`flock:pin:${messageStorageKey(hydrated)}`, "1");
              }
              if (existing.reactions && hydrated.msgId) {
                localStorage.setItem(`flock:react:${messageStorageKey(hydrated)}`, JSON.stringify(existing.reactions));
              }
              merged[existingIndex] = {
                ...existing,
                ...hydrated,
                pinned: existing.pinned || hydrated.pinned,
                reactions: hydrated.reactions || existing.reactions,
              };
              return { messages: { ...s.messages, [convId]: merged } };
            }
            return { messages: { ...s.messages, [convId]: [...prev, hydrated] } };
          });

          if (getSettings().notificationsEnabled && messageType === "text" && document.hidden && agentName) {
            if (Notification.permission === "granted") {
              new Notification(agentName, { body: msg.content.slice(0, 100), tag: convId });
            } else if (Notification.permission !== "denied") {
              Notification.requestPermission();
            }
          }
          break;
        }

        case "agent:status":
          set((s) => ({
            agents: s.agents.map((a) =>
              a.id === msg.agentId ? { ...a, state: msg.state, activity: msg.activity || "" } : a
            ),
          }));
          break;

        case "agent:keep-alive":
          set((s) => ({
            agents: s.agents.map((a) =>
              a.id === msg.agentId ? { ...a, keepAlive: msg.keepAlive } : a
            ),
          }));
          break;

        case "search:results":
          set({ searchResults: msg.results || [] });
          break;

        case "ui-state:loaded": {
          const uiState = msg.state || {};
          if (uiState.pinnedConvs) {
            localStorage.setItem("flock:pinnedConvs", JSON.stringify(uiState.pinnedConvs));
          }
          if (uiState.settings) {
            localStorage.setItem("flock:settings", JSON.stringify(uiState.settings));
          }
          if (uiState.pins) {
            for (const [k, v] of Object.entries(uiState.pins)) {
              if (v) localStorage.setItem(`flock:pin:${k}`, "1");
            }
          }
          if (uiState.reactions) {
            for (const [k, v] of Object.entries(uiState.reactions)) {
              if (v) localStorage.setItem(`flock:react:${k}`, JSON.stringify(v));
            }
          }
          break;
        }

        case "approval:request":
          set((s) => ({
            approvals: [
              ...s.approvals.filter((a) => a.id !== msg.id),
              {
                id: msg.id,
                agentId: msg.agentId,
                agentName: msg.agentName,
                toolName: msg.toolName,
                inputSummary: msg.inputSummary,
                input: msg.input,
                toolUseId: msg.toolUseId,
                conversationId: msg.conversationId,
                timestamp: msg.timestamp,
              },
            ],
          }));
          break;

        case "approval:resolved":
        case "approval:expired":
          set((s) => ({ approvals: s.approvals.filter((a) => a.id !== msg.id) }));
          break;
      }
    };

    set({ ws });
  },

  setActiveConversation: (id) => {
    const now = Date.now();
    const lastRead = { ...get().lastReadTimestamp, [id]: now };
    localStorage.setItem("flock:lastRead", JSON.stringify(lastRead));
    set({ activeConversationId: id, isSearchOpen: false, lastReadTimestamp: lastRead });
  },

  getUnreadCount: (convId) => {
    const { messages, lastReadTimestamp } = get();
    const msgs = messages[convId] || [];
    const lastRead = lastReadTimestamp[convId] || 0;
    return msgs.filter((m) => m.timestamp > lastRead && m.type === "text").length;
  },

  pinConversation: (id) => {
    set((s) => {
      const convs = s.conversations.map((c) => c.id === id ? { ...c, pinned: !c.pinned } : c);
      localStorage.setItem("flock:pinnedConvs", JSON.stringify(convs.filter((c) => c.pinned).map((c) => c.id)));
      return { conversations: convs };
    });
    saveUiStateToServer();
  },

  respondApproval: (id, approved) => {
    const { ws } = get();
    if (ws) ws.send(JSON.stringify({ type: "approval:respond", approvalId: id, approved }));
    set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) }));
  },

  reactToMessage: (convId, msgId, emoji) => {
    set((s) => {
      const msgs = s.messages[convId];
      if (!msgs) return {};
      return {
        messages: {
          ...s.messages,
          [convId]: msgs.map((m) => {
            if (m.id !== msgId) return m;
            const reactions = [...(m.reactions || [])];
            const existing = reactions.find((r) => r.emoji === emoji);
            if (existing) existing.count++;
            else reactions.push({ emoji, count: 1 });
            localStorage.setItem(`flock:react:${messageStorageKey(m)}`, JSON.stringify(reactions));
            return { ...m, reactions };
          }),
        },
      };
    });
    saveUiStateToServer();
  },

  pinMessage: (convId, msgId) => {
    set((s) => {
      const msgs = s.messages[convId];
      if (!msgs) return {};
      return {
        messages: {
          ...s.messages,
          [convId]: msgs.map((m) => {
            if (m.id !== msgId) return m;
            localStorage.setItem(`flock:pin:${messageStorageKey(m)}`, "1");
            return { ...m, pinned: true };
          }),
        },
      };
    });
    saveUiStateToServer();
  },

  unpinMessage: (convId, msgId) => {
    set((s) => {
      const msgs = s.messages[convId];
      if (!msgs) return {};
      return {
        messages: {
          ...s.messages,
          [convId]: msgs.map((m) => {
            if (m.id !== msgId) return m;
            localStorage.removeItem(`flock:pin:${messageStorageKey(m)}`);
            return { ...m, pinned: false };
          }),
        },
      };
    });
    saveUiStateToServer();
  },

  getPinnedMessages: () => {
    const { messages, activeConversationId } = get();
    if (!activeConversationId) return [];
    return (messages[activeConversationId] || []).filter((m) => m.pinned);
  },

  renameAgent: (id, name) => {
    const { ws } = get();
    const safeName = sanitizeAgentNameInput(name.trim());
    if (!isValidAgentName(safeName)) return;
    if (ws) ws.send(JSON.stringify({ type: "agent:rename", agentId: id, name: safeName }));
    set((s) => ({
      agents: s.agents.map((a) => a.id === id ? { ...a, name: safeName } : a),
      conversations: s.conversations.map((c) =>
        c.type === "dm" && c.agentIds[0] === id ? { ...c, name: safeName } : c
      ),
    }));
  },

  stopAgent: (id) => {
    const { ws } = get();
    if (!ws) return;
    ws.send(JSON.stringify({ type: "agent:stop", agentId: id }));
  },

  removeAgent: (id) => {
    const { ws, activeConversationId, conversations: convs } = get();
    if (ws) ws.send(JSON.stringify({ type: "agent:remove", agentId: id }));
    const convId = `dm-${id}`;
    const remaining = convs.filter((c) => c.id !== convId);
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
      conversations: remaining,
      activeConversationId: activeConversationId === convId ? (remaining[0]?.id || null) : activeConversationId,
    }));
  },

  toggleKeepAlive: (id) => {
    const { ws, agents } = get();
    if (!ws) return;
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    const newVal = !agent.keepAlive;
    ws.send(JSON.stringify({ type: "agent:keep-alive", agentId: id, keepAlive: newVal }));
    set((s) => ({
      agents: s.agents.map((a) => a.id === id ? { ...a, keepAlive: newVal } : a),
    }));
  },

  sendMessage: (text) => {
    const { ws, activeConversationId, messages, replyingTo } = get();
    if (!ws || !activeConversationId) return;

    const clientMsgId = makeClientMsgId();
    const replyRef = replyingTo ? {
      msgId: replyingTo.id,
      content: replyingTo.content.slice(0, 200),
      agentName: replyingTo.agentName,
    } : undefined;

    ws.send(JSON.stringify({ type: "conv:deliver", conversationId: activeConversationId, text, clientMsgId, replyTo: replyRef }));

    const userMsg: Message = {
      id: clientMsgId,
      clientMsgId,
      type: "user",
      content: text,
      conversationId: activeConversationId,
      timestamp: Date.now(),
      replyTo: replyRef,
    };
    const prev = messages[activeConversationId] || [];
    set({ messages: { ...messages, [activeConversationId]: [...prev, userMsg] }, replyingTo: null });
  },

  setReplyingTo: (msg, conversationId) => {
    set({ replyingTo: { ...msg, conversationId } });
  },

  clearReply: () => {
    set({ replyingTo: null });
  },

  createAgent: (name, model, runtime) => {
    const { ws } = get();
    if (!ws) return;
    const safeName = sanitizeAgentNameInput(name.trim());
    if (!isValidAgentName(safeName)) return;
    ws.send(JSON.stringify({
      type: "agent:create",
      id: `agent-${Date.now()}`,
      name: safeName,
      model: model || "sonnet",
      runtime: runtime || "claude",
    }));
  },

  createChannel: (name, agentIds, defaultAgentId) => {
    const { ws } = get();
    if (!ws) return;
    ws.send(JSON.stringify({
      type: "conv:create",
      name,
      agentIds,
      defaultAgentId: defaultAgentId || agentIds[0],
    }));
  },

  search: (query) => {
    const { ws } = get();
    if (!ws || !query.trim()) return;
    ws.send(JSON.stringify({ type: "search:query", query: query.trim() }));
    set({ isSearchOpen: true });
  },

  setSearchOpen: (open) => set({ isSearchOpen: open, searchResults: open ? get().searchResults : [] }),
}));

export { EMPTY_MESSAGES };
