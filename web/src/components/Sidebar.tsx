import { useState, useRef, useCallback } from "react";
import { useStore, EMPTY_MESSAGES } from "../store";
import { SessionBrowser } from "./SessionBrowser";
import { ChannelCreateDialog } from "./ChannelCreateDialog";
import { SearchPanel } from "./SearchPanel";
import { TasksPanel } from "./TasksPanel";
import { SavedPanel } from "./SavedPanel";
import { SettingsPanel } from "./SettingsPanel";
import { isValidAgentName, sanitizeAgentNameInput } from "../names";
import { getSettings } from "../settings";

const AVATAR_COLORS = [
  "bg-brutal-cyan", "bg-brutal-pink", "bg-brutal-lavender",
  "bg-brutal-orange", "bg-brutal-lime", "bg-brutal-yellow",
];

function avatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function stateLabel(state: string, activity: string) {
  if (state === "thinking") return "Thinking...";
  if (state === "tool_use" && activity) return activity;
  if (state === "tool_use") return "Working...";
  if (state === "starting") return "Starting...";
  if (state === "stopped") return "Stopped";
  return "Ready";
}

function stateDotColor(state: string) {
  if (["running", "thinking", "tool_use"].includes(state)) return "bg-green-500";
  if (state === "starting") return "bg-brutal-yellow";
  return "bg-gray-300";
}

function formatTimeShort(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function Sidebar() {
  const agents = useStore((s) => s.agents);
  const conversations = useStore((s) => s.conversations);
  const allMessages = useStore((s) => s.messages);
  const activeConvId = useStore((s) => s.activeConversationId);
  const setActiveConv = useStore((s) => s.setActiveConversation);
  const renameAgent = useStore((s) => s.renameAgent);
  const createAgent = useStore((s) => s.createAgent);
  const connected = useStore((s) => s.connected);
  const isSearchOpen = useStore((s) => s.isSearchOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const search = useStore((s) => s.search);
  const getUnreadCount = useStore((s) => s.getUnreadCount);

  const [showCreate, setShowCreate] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showChannelCreate, setShowChannelCreate] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [newModel, setNewModel] = useState(() => getSettings().defaultModel);
  const [newRuntime, setNewRuntime] = useState("claude");
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Math.max(280, parseInt(localStorage.getItem("flock:sidebarWidth") || "280"))
  );
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const w = Math.max(280, Math.min(400, e.clientX));
      setSidebarWidth(w);
      localStorage.setItem("flock:sidebarWidth", String(w));
    };
    const handleUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, []);

  const handleCreate = () => {
    const name = sanitizeAgentNameInput(newName.trim());
    if (!isValidAgentName(name)) return;
    createAgent(name, newModel, newRuntime);
    setNewName("");
    setNewModel("sonnet");
    setNewRuntime("claude");
    setShowCreate(false);
  };

  const commitRename = (agentId?: string) => {
    const name = sanitizeAgentNameInput(editName.trim());
    if (agentId && isValidAgentName(name)) renameAgent(agentId, name);
    setEditingId(null);
  };

  const pinConversation = useStore((s) => s.pinConversation);
  const sortedConvs = [...conversations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const channels = sortedConvs.filter((c) => c.type === "channel");
  const dms = sortedConvs.filter((c) => c.type === "dm");

  return (
    <div className="h-full border-r-2 border-brutal-ink bg-white flex flex-col shrink-0 relative max-md:!w-full overflow-clip" style={{ width: sidebarWidth }}>
      {/* Header */}
      <div className="px-5 py-4 border-b-2 border-brutal-ink bg-brutal-yellow">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">Flock</h1>
          <button
            onClick={() => setSearchOpen(!isSearchOpen)}
            className="text-sm opacity-60 hover:opacity-100 transition-opacity"
            title="Search"
          >
            &#128269;
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="text-sm opacity-60 hover:opacity-100 transition-opacity"
            title="Settings"
          >
            &#9881;
          </button>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-600" : "bg-red-500"}`} />
          <span className="text-xs font-medium opacity-70">{connected ? "Connected" : "Offline"}</span>
        </div>
      </div>

      {/* Search bar */}
      {isSearchOpen && (
        <div className="px-3 py-2 border-b-2 border-brutal-ink bg-gray-50">
          <input
            className="input-brutal text-sm w-full rounded-lg"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchQuery.trim()) search(searchQuery);
              if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
            }}
            autoFocus
          />
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* Channels */}
        {channels.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 px-2 mb-2">
              Channels
            </div>
            <div className="flex flex-col gap-1 mb-3">
              {channels.map((conv) => {
                const isActive = activeConvId === conv.id;
                const convMsgs = allMessages[conv.id] || EMPTY_MESSAGES;
                const lastMsg = convMsgs.filter((m) => m.type === "text" || m.type === "user").at(-1);
                const unread = isActive ? 0 : getUnreadCount(conv.id);
                return (
                  <button
                    key={conv.id}
                    onClick={() => setActiveConv(conv.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all text-sm
                      ${isActive ? "bg-brutal-cream border-2 border-brutal-ink shadow-brutal-sm font-semibold" : "hover:bg-gray-50 border-2 border-transparent"}`}
                  >
                    <div className="w-9 h-9 rounded-lg border-2 border-brutal-ink flex items-center justify-center text-sm font-bold shrink-0 bg-brutal-lime relative">
                      #
                      {unread > 0 && <span className="absolute -top-1.5 -right-1.5 bg-brutal-pink text-white text-[9px] font-bold min-w-4 h-4 px-1 rounded-full flex items-center justify-center border border-white">{unread > 99 ? "99+" : unread}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="truncate">{conv.name}</span>
                        {lastMsg && <span className="text-[9px] text-gray-400 font-mono shrink-0 ml-1">{formatTimeShort(lastMsg.timestamp)}</span>}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate mt-0.5">
                        {lastMsg ? (lastMsg.agentName ? `${lastMsg.agentName}: ` : "") + lastMsg.content.replace(/\n/g, " ").slice(0, 25) : `${conv.agentIds.length} agents`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* DMs */}
        <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 px-2 mb-2">
          {channels.length > 0 ? "私聊" : "Agents"}
        </div>
        {dms.length === 0 && (
          <div className="text-xs text-gray-400 px-2 py-4">No agents yet</div>
        )}
        <div className="flex flex-col gap-1">
          {dms.map((conv, i) => {
            const isActive = activeConvId === conv.id;
            const agentId = conv.agentIds[0];
            const agent = agents.find((a) => a.id === agentId);
            const convMsgs = allMessages[conv.id] || EMPTY_MESSAGES;
            const lastMsg = convMsgs.filter((m) => m.type === "text" || m.type === "user").at(-1);
            const unread = isActive ? 0 : getUnreadCount(conv.id);
            return (
              <button
                key={conv.id}
                onClick={() => setActiveConv(conv.id)}
                onDoubleClick={() => {
                  if (agentId) { setEditingId(agentId); setEditName(conv.name); }
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all text-sm group/item
                  ${isActive ? "bg-brutal-cream border-2 border-brutal-ink shadow-brutal-sm font-semibold" : "hover:bg-gray-50 border-2 border-transparent"}`}
              >
                <div className={`w-9 h-9 rounded-lg border-2 border-brutal-ink flex items-center justify-center text-sm font-bold shrink-0 ${avatarColor(i)} relative`}>
                  {conv.name[0]?.toUpperCase()}
                  {unread > 0 && <span className="absolute -top-1.5 -right-1.5 bg-brutal-pink text-white text-[9px] font-bold min-w-4 h-4 px-1 rounded-full flex items-center justify-center border border-white">{unread > 99 ? "99+" : unread}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  {editingId === agentId ? (
                    <input
                      className="w-full bg-white border-b-2 border-brutal-ink text-sm font-semibold outline-none px-0 py-0"
                      value={editName}
                      onChange={(e) => setEditName(sanitizeAgentNameInput(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitRename(agentId);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => {
                        commitRename(agentId);
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="truncate">
                        {conv.pinned && <span className="text-[9px] mr-0.5">📌</span>}
                        {conv.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); pinConversation(conv.id); }}
                          className={`text-[9px] opacity-0 group-hover/item:opacity-100 transition-opacity ${conv.pinned ? "opacity-100" : ""}`}
                        >{conv.pinned ? "📌" : "📌"}</button>
                        {lastMsg && <span className="text-[9px] text-gray-400 font-mono">{formatTimeShort(lastMsg.timestamp)}</span>}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent ? stateDotColor(agent.state) : "bg-gray-300"}`} />
                    {lastMsg && editingId !== agentId ? (
                      <span className="text-[10px] text-gray-400 truncate">
                        {lastMsg.type === "user" ? "你: " : ""}{lastMsg.content.replace(/\n/g, " ").slice(0, 25)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400 truncate">
                        {agent ? stateLabel(agent.state, agent.activity) : "Ready"}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 pb-3 pt-2 border-t-2 border-brutal-ink">
        {showCreate ? (
          <div className="flex flex-col gap-2">
            <input
              className="input-brutal text-sm w-full rounded-lg"
              placeholder="Name your agent..."
              value={newName}
              onChange={(e) => setNewName(sanitizeAgentNameInput(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setShowCreate(false);
              }}
              autoFocus
            />
            <div className="flex gap-2">
              <select
                className="input-brutal text-sm flex-1 rounded-lg appearance-none"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
              >
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
              <select
                className="input-brutal text-sm w-24 rounded-lg appearance-none"
                value={newRuntime}
                onChange={(e) => setNewRuntime(e.target.value)}
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreate} className="btn-brutal flex-1 bg-brutal-lime text-sm px-3 py-1.5 rounded-lg">Create</button>
              <button onClick={() => setShowCreate(false)} className="btn-brutal flex-1 bg-white text-sm px-3 py-1.5 rounded-lg">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => { setNewModel(getSettings().defaultModel); setShowCreate(true); }}
              disabled={!connected}
              className="btn-brutal w-full bg-brutal-lavender text-sm px-3 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + New Agent
            </button>
            <div className="flex gap-1.5 mr-0.5 mb-0.5">
              <button onClick={() => setShowChannelCreate(true)} disabled={!connected || agents.length < 2} className="flex-1 min-w-0 bg-brutal-cyan text-xs font-bold px-2 py-1.5 rounded-lg border-2 border-brutal-ink shadow-brutal-sm isolate disabled:opacity-40 disabled:cursor-not-allowed">#</button>
              <button onClick={() => setShowSessions(true)} disabled={!connected} className="flex-1 min-w-0 bg-brutal-orange text-xs font-bold px-2 py-1.5 rounded-lg border-2 border-brutal-ink shadow-brutal-sm isolate disabled:opacity-40 disabled:cursor-not-allowed">Resume</button>
              <button onClick={() => setShowTasks(true)} className="flex-1 min-w-0 bg-brutal-lime text-xs font-bold px-2 py-1.5 rounded-lg border-2 border-brutal-ink shadow-brutal-sm isolate">Tasks</button>
              <button onClick={() => setShowSaved(true)} className="flex-1 min-w-0 bg-brutal-pink text-xs font-bold px-2 py-1.5 rounded-lg border-2 border-brutal-ink shadow-brutal-sm isolate">Saved</button>
            </div>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-brutal-yellow transition-colors"
      />

      {showSessions && <SessionBrowser onClose={() => setShowSessions(false)} />}
      {showChannelCreate && <ChannelCreateDialog onClose={() => setShowChannelCreate(false)} />}
      {showTasks && <TasksPanel onClose={() => setShowTasks(false)} />}
      {showSaved && <SavedPanel onClose={() => setShowSaved(false)} />}
      {isSearchOpen && <SearchPanel />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
