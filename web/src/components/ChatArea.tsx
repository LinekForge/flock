import { useEffect, useRef, useState, useCallback } from "react";
import Markdown from "react-markdown";
import { useStore, EMPTY_MESSAGES, makeClientMsgId, type ApprovalRequest, type Message } from "../store";

const AVATAR_COLORS = [
  "bg-brutal-cyan", "bg-brutal-pink", "bg-brutal-lavender",
  "bg-brutal-orange", "bg-brutal-lime", "bg-brutal-yellow",
];

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  if (src?.startsWith("data:")) {
    return <img src={src} alt={alt || ""} />;
  }
  const label = alt || src || "image";
  return src ? (
    <a href={src} target="_blank" rel="noopener noreferrer">
      [Image: {label}]
    </a>
  ) : (
    <span>[Image: {label}]</span>
  );
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function ThinkingBubble({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 150;

  return (
    <div className="px-6 py-1 flex justify-start group">
      <div className="max-w-[70%]">
        <div
          className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-[11px] text-gray-400 italic font-mono leading-relaxed cursor-pointer"
          onClick={() => isLong && setExpanded(!expanded)}
        >
          {isLong && !expanded ? content.slice(0, 150) + "..." : content}
          {isLong && (
            <span className="not-italic text-gray-500 ml-1">{expanded ? " ▲" : " ▼"}</span>
          )}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
          <CopyButton text={content} />
        </div>
      </div>
    </div>
  );
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🤔", "👀"];

function CopyButton({ text, icon }: { text: string; icon?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className={`text-[10px] px-1 transition-all ${copied ? "text-green-500 scale-110" : "text-gray-400 hover:text-gray-600"}`}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? "✓" : (icon || "📋")}
    </button>
  );
}

function MessageActions({ msg, convId }: { msg: Message; convId: string }) {
  const [showEmojis, setShowEmojis] = useState(false);
  const react = useStore((s) => s.reactToMessage);
  const pin = useStore((s) => s.pinMessage);
  const unpin = useStore((s) => s.unpinMessage);
  const setReplyingTo = useStore((s) => s.setReplyingTo);

  return (
    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mt-0.5">
      <button
        onClick={() => setReplyingTo(msg, convId)}
        className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
        title="Reply"
      >&#8617;</button>
      <div className="relative">
        <button onClick={() => setShowEmojis(!showEmojis)} className="text-[10px] text-gray-400 hover:text-gray-600 px-1" title="React">&#128578;</button>
        {showEmojis && (
          <div className="absolute bottom-full mb-1 left-0 card-brutal bg-white rounded-lg p-1 flex gap-0.5 z-10">
            {QUICK_EMOJIS.map((e) => (
              <button key={e} onClick={() => { react(convId, msg.id, e); setShowEmojis(false); }} className="hover:bg-brutal-cream rounded px-1 py-0.5 text-sm">{e}</button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => msg.pinned ? unpin(convId, msg.id) : pin(convId, msg.id)}
        className={`text-[10px] px-1 ${msg.pinned ? "text-brutal-yellow" : "text-gray-400 hover:text-gray-600"}`}
        title={msg.pinned ? "Unpin" : "Pin"}
      >&#128204;</button>
      <CopyButton text={msg.content} />
      <CopyButton text={`flock://${convId}/${msg.id}`} icon="🔗" />
    </div>
  );
}

function approvalDetails(a: ApprovalRequest) {
  const input = a.input as Record<string, unknown> | undefined;
  if (!input) return "";
  if (a.toolName === "Bash") return String(input.command || "");
  if (a.toolName === "Edit" || a.toolName === "Write") {
    const parts = [
      input.file_path ? `file_path: ${String(input.file_path)}` : "",
      input.old_string ? `old_string:\n${String(input.old_string)}` : "",
      input.new_string ? `new_string:\n${String(input.new_string)}` : "",
      input.content ? `content:\n${String(input.content)}` : "",
    ].filter(Boolean);
    return parts.join("\n\n");
  }
  return JSON.stringify(input, null, 2);
}

function ApprovalCard({ approval }: { approval: ApprovalRequest }) {
  const [expanded, setExpanded] = useState(false);
  const respondApproval = useStore((s) => s.respondApproval);
  const detail = approvalDetails(approval);

  return (
    <div className="px-6 py-2">
      <div className="card-brutal bg-yellow-50 rounded-xl p-4 max-w-[70%]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">&#9888;</span>
          <span className="text-sm font-bold">{approval.agentName} 请求权限</span>
        </div>
        <div className="text-xs font-mono bg-white rounded-lg px-3 py-2 border border-yellow-200 mb-3 whitespace-pre-wrap break-words">
          <span className="font-semibold">{approval.toolName}</span>: {approval.inputSummary}
        </div>
        {detail && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] font-bold text-gray-500 hover:text-brutal-ink mb-3"
            >
              {expanded ? "隐藏详情" : "展开详情"}
            </button>
            {expanded && (
              <pre className="text-[11px] font-mono bg-white rounded-lg px-3 py-2 border border-yellow-200 mb-3 max-h-64 overflow-auto whitespace-pre-wrap break-words">
                {detail}
              </pre>
            )}
          </>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => respondApproval(approval.id, true)}
            className="btn-brutal bg-brutal-lime text-xs px-4 py-1.5 rounded-lg"
          >
            批准
          </button>
          <button
            onClick={() => respondApproval(approval.id, false)}
            className="btn-brutal bg-white text-xs px-4 py-1.5 rounded-lg"
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, isChannel, convId }: { msg: Message; isChannel: boolean; convId: string }) {
  if (msg.type === "turn_end") return null;

  if (msg.type === "system") {
    return (
      <div className="px-6 py-1">
        <div className="text-[11px] text-gray-400 font-mono leading-relaxed">{msg.content}</div>
      </div>
    );
  }

  if (msg.type === "thinking") {
    return <ThinkingBubble content={msg.content} />;
  }

  if (msg.type === "tool_use") {
    return (
      <div className="px-6 py-1 flex justify-start">
        <div className="px-3 py-1.5 rounded-lg bg-brutal-cream border-2 border-brutal-ink text-[11px] font-mono shadow-brutal-sm inline-flex items-center gap-1.5">
          <span className="opacity-60">&#9881;</span>
          <span className="font-semibold">{msg.toolName || "tool"}</span>
        </div>
      </div>
    );
  }

  const isUser = msg.type === "user";

  return (
    <div className={`px-6 py-1.5 flex flex-col group ${isUser ? "items-end" : "items-start"}`}>
      {!isUser && isChannel && msg.agentName && (
        <div className="flex items-center gap-1.5 mb-1 ml-1">
          <div className={`w-5 h-5 rounded-md border border-brutal-ink flex items-center justify-center text-[9px] font-bold ${AVATAR_COLORS[(msg.agentName.charCodeAt(0)) % AVATAR_COLORS.length]}`}>
            {msg.agentName[0]?.toUpperCase()}
          </div>
          <span className="text-[11px] font-semibold">{msg.agentName}</span>
        </div>
      )}
      {msg.pinned && (
        <div className="text-[10px] text-brutal-yellow font-bold mb-0.5 ml-1">&#128204; Pinned</div>
      )}
      <div className="max-w-[70%]">
        {msg.replyTo && (
          <div className="px-3 py-1.5 mb-1 rounded-lg bg-gray-50 border border-gray-200 text-[11px] text-gray-500 truncate">
            <span className="font-semibold">{msg.replyTo.agentName || "User"}</span>
            {": "}
            {msg.replyTo.content.slice(0, 100)}
          </div>
        )}
        <div
          className={`px-4 py-2.5 text-sm break-words leading-relaxed
            ${isUser
              ? "bg-brutal-yellow border-2 border-brutal-ink shadow-brutal-sm rounded-2xl rounded-br-md whitespace-pre-wrap"
              : "bg-white border-2 border-brutal-ink shadow-brutal-sm rounded-2xl rounded-bl-md prose prose-sm prose-neutral max-w-none [&_pre]:bg-brutal-ink [&_pre]:text-white [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0"
            }`}
        >
          {isUser ? msg.content : <Markdown components={{ img: MarkdownImage }}>{msg.content}</Markdown>}
        </div>
      </div>
      {msg.reactions && msg.reactions.length > 0 && (
        <div className="flex gap-1 mt-1 ml-1">
          {msg.reactions.map((r) => (
            <span key={r.emoji} className="text-xs bg-gray-100 border border-gray-200 rounded-full px-1.5 py-0.5">
              {r.emoji} {r.count > 1 ? r.count : ""}
            </span>
          ))}
        </div>
      )}
      <div className={`flex items-center gap-1 ${isUser ? "flex-row-reverse" : ""}`}>
        <span className="text-[10px] text-gray-400 px-1 font-mono">{formatTime(msg.timestamp)}</span>
        <MessageActions msg={msg} convId={convId} />
      </div>
    </div>
  );
}

function TypingIndicator({ names }: { names: string[] }) {
  const label = names.length > 0
    ? `${names.join(", ")} typing...`
    : "typing...";
  return (
    <div className="px-6 py-2 flex justify-start">
      <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-white border-2 border-brutal-ink shadow-brutal-sm inline-flex items-center gap-2">
        <span className="inline-flex gap-1">
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms", animationDuration: "0.8s" }} />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "200ms", animationDuration: "0.8s" }} />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "400ms", animationDuration: "0.8s" }} />
        </span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
    </div>
  );
}

export function ChatArea() {
  const activeConvId = useStore((s) => s.activeConversationId);
  const conversations = useStore((s) => s.conversations);
  const agents = useStore((s) => s.agents);
  const allMessages = useStore((s) => s.messages);
  const messages = activeConvId ? (allMessages[activeConvId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES;
  const approvals = useStore((s) => s.approvals);
  const sendMessage = useStore((s) => s.sendMessage);
  const replyingTo = useStore((s) => s.replyingTo);
  const clearReply = useStore((s) => s.clearReply);
  const draftKey = activeConvId ? `flock:draft:${activeConvId}` : null;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const input = draftKey ? (drafts[draftKey] ?? localStorage.getItem(draftKey) ?? "") : "";
  const [showMentions, setShowMentions] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const pinnedMessages = messages.filter((m) => m.pinned);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportSelected = () => {
    const selected = messages.filter((m) => selectedIds.has(m.id));
    const lines = selected.map((m) => {
      const time = new Date(m.timestamp);
      const ts = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}`;
      if (m.type === "user") return `**You** (${ts})\n${m.content}\n`;
      if (m.type === "thinking") return `> *${m.agentName || "thinking"}* (${ts})\n> ${m.content.replace(/\n/g, "\n> ")}\n`;
      if (m.type === "system") return `*${m.content}*\n`;
      if (m.type === "tool_use") return `\`${m.toolName || "tool"}\`: ${m.content}\n`;
      return `**${m.agentName || "Agent"}** (${ts})\n${m.content}\n`;
    });
    const md = `# ${activeConv?.name || "Chat"}\n\n${lines.join("\n---\n\n")}`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeConv?.name || "chat"}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setSelectMode(false);
    setSelectedIds(new Set());
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const justEndedComposingRef = useRef(false);

  const updateInput = (val: string) => {
    if (draftKey) setDrafts((prev) => ({ ...prev, [draftKey]: val }));
    if (draftKey) localStorage.setItem(draftKey, val);
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const isChannel = activeConv?.type === "channel";
  const convAgents = activeConv ? agents.filter((a) => activeConv.agentIds.includes(a.id)) : [];
  const visibleApprovals = approvals.filter((a) =>
    a.conversationId ? a.conversationId === activeConvId : activeConv?.agentIds.includes(a.agentId)
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    updateInput("");
    setShowMentions(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const insertMention = (name: string) => {
    const lastAt = input.lastIndexOf("@");
    updateInput(input.slice(0, lastAt) + `@${name} `);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  if (!activeConvId || !activeConv) {
    return (
      <div className="flex-1 flex items-center justify-center bg-brutal-cream">
        <div className="text-center">
          <div className="text-7xl mb-6">&#x1f411;</div>
          <h2 className="text-3xl font-bold mb-2 tracking-tight">Flock</h2>
          <p className="text-gray-400 text-sm">Create an agent to start chatting</p>
        </div>
      </div>
    );
  }

  const busyAgents = convAgents.filter((a) => ["thinking", "tool_use", "starting"].includes(a.state));
  const busyNames = busyAgents.map((a) => a.name);
  const showTyping = busyAgents.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-brutal-cream min-w-0">
      {/* Header */}
      <div className="h-14 border-b-2 border-brutal-ink bg-white flex items-center px-5 gap-3 shrink-0">
        {isChannel ? (
          <>
            <div className="w-9 h-9 rounded-lg border-2 border-brutal-ink flex items-center justify-center text-sm font-bold bg-brutal-lime shrink-0">#</div>
            <div className="min-w-0">
              <div className="font-bold text-sm truncate">{activeConv.name}</div>
              <div className="text-[10px] text-gray-400 truncate">
                {convAgents.map((a) => a.name).join(", ")}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="w-9 h-9 rounded-lg border-2 border-brutal-ink flex items-center justify-center text-sm font-bold bg-brutal-cyan shrink-0">
              {activeConv.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm truncate">{activeConv.name}</div>
              <div className="text-[10px] text-gray-400 font-mono truncate">
                {showTyping ? "working..." : convAgents[0]?.model}
              </div>
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {pinnedMessages.length > 0 && (
            <button
              onClick={() => setShowPinned(!showPinned)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${showPinned ? "text-brutal-yellow bg-yellow-50 border-yellow-200" : "text-gray-400 bg-gray-50 border-gray-200"}`}
            >
              &#128204; {pinnedMessages.length}
            </button>
          )}
          {!isChannel && convAgents[0] && (
            <button
              onClick={() => useStore.getState().toggleKeepAlive(convAgents[0].id)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
                convAgents[0].keepAlive
                  ? "text-green-600 bg-green-50 border-green-200"
                  : "text-gray-400 bg-gray-50 border-gray-200 hover:text-green-600 hover:bg-green-50 hover:border-green-200"
              }`}
            >
              {convAgents[0].keepAlive ? "Always On" : "Keep Alive"}
            </button>
          )}
          {!isChannel && convAgents[0]?.state !== "stopped" && (
            <button
              onClick={() => { if (convAgents[0]) useStore.getState().stopAgent(convAgents[0].id); }}
              className="text-[10px] font-bold text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 px-2 py-0.5 rounded-full border border-gray-200 hover:border-red-200 transition-colors"
            >
              Stop
            </button>
          )}
          {!isChannel && (
            <button
              onClick={() => {
                if (convAgents[0] && confirm("Remove this agent?")) {
                  useStore.getState().removeAgent(convAgents[0].id);
                }
              }}
              className="text-[10px] font-bold text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 px-2 py-0.5 rounded-full border border-gray-200 hover:border-red-200 transition-colors"
            >
              Remove
            </button>
          )}
          <button
            onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelectedIds(new Set()); }}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${selectMode ? "text-blue-600 bg-blue-50 border-blue-200" : "text-gray-400 bg-gray-50 border-gray-200 hover:text-blue-600 hover:bg-blue-50"}`}
          >
            {selectMode ? "Cancel" : "Export"}
          </button>
        </div>
      </div>

      {/* Pinned panel */}
      {showPinned && pinnedMessages.length > 0 && (
        <div className="border-b-2 border-brutal-ink bg-yellow-50 px-5 py-2 max-h-40 overflow-y-auto">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">&#128204; Pinned Messages</div>
          {pinnedMessages.map((m) => (
            <div key={m.id} className="text-xs text-gray-700 py-1 border-b border-yellow-100 last:border-0 truncate">
              {m.agentName && <span className="font-semibold">{m.agentName}: </span>}
              {m.content.slice(0, 80)}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-4"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = Array.from(e.dataTransfer.files);
          for (const file of files) {
            if (file.type.startsWith("image/")) {
              const reader = new FileReader();
              reader.onload = () => {
                const base64 = (reader.result as string).split(",")[1];
                const { ws } = useStore.getState();
                const agentId = convAgents[0]?.id;
                if (!ws || !agentId) return;
                const clientMsgId = makeClientMsgId("img");
                ws.send(JSON.stringify({ type: "agent:send-image", agentId, conversationId: activeConvId, fileName: file.name, mediaType: file.type, base64, clientMsgId }));
                const userMsg = { id: clientMsgId, clientMsgId, type: "user" as const, content: `[Image: ${file.name}]`, conversationId: activeConvId, timestamp: Date.now() };
                useStore.setState((s) => ({
                  messages: { ...s.messages, [activeConvId]: [...(s.messages[activeConvId] || []), userMsg] },
                }));
              };
              reader.readAsDataURL(file);
            } else {
              const reader = new FileReader();
              reader.onload = () => {
                const content = reader.result as string;
                const preview = content.length > 5000 ? content.slice(0, 5000) + "\n...(truncated)" : content;
                sendMessage(`[File: ${file.name}]\n\n${preview}`);
              };
              reader.readAsText(file);
            }
          }
        }}
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {isChannel ? `Send a message to #${activeConv.name}` : "Send a message to get started"}
          </div>
        )}
        {messages.map((msg, idx) => {
          const lastRead = useStore.getState().lastReadTimestamp[activeConvId] || 0;
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const showUnreadLine = lastRead > 0 && prevMsg && prevMsg.timestamp <= lastRead && msg.timestamp > lastRead;
          return (
          <div key={msg.id}>
            {showUnreadLine && (
              <div className="flex items-center gap-3 px-6 py-2">
                <div className="flex-1 h-0.5 bg-brutal-pink" />
                <span className="text-[10px] font-bold text-brutal-pink uppercase tracking-wider">New</span>
                <div className="flex-1 h-0.5 bg-brutal-pink" />
              </div>
            )}
          <div className={`flex items-start ${selectMode ? "gap-2" : ""}`}>
            {selectMode && msg.type !== "turn_end" && msg.type !== "system" && (
              <div className="pt-3 pl-2 shrink-0">
                <input
                  type="checkbox"
                  checked={selectedIds.has(msg.id)}
                  onChange={() => toggleSelect(msg.id)}
                  className="accent-brutal-ink w-3.5 h-3.5 cursor-pointer"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <MessageBubble msg={msg} isChannel={!!isChannel} convId={activeConvId} />
            </div>
          </div>
          </div>
          );
        })}
        {visibleApprovals.map((a) => <ApprovalCard key={a.id} approval={a} />)}
        {showTyping && <TypingIndicator names={busyNames} />}
      </div>

      {/* Export bar */}
      {selectMode && (
        <div className="px-4 py-2 border-t-2 border-brutal-ink bg-blue-50 flex items-center justify-between shrink-0">
          <span className="text-xs text-blue-600 font-medium">{selectedIds.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => { const all = messages.filter((m) => m.type !== "turn_end" && m.type !== "system").map((m) => m.id); setSelectedIds(new Set(all)); }}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-800 px-2 py-1"
            >
              Select All
            </button>
            <button
              onClick={exportSelected}
              disabled={selectedIds.size === 0}
              className="btn-brutal bg-brutal-lime text-xs px-3 py-1 rounded-lg disabled:opacity-40"
            >
              Export .md
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t-2 border-brutal-ink bg-white shrink-0 relative">
        {replyingTo && replyingTo.conversationId === activeConvId && (
          <div className="mb-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between text-xs text-gray-500">
            <div className="truncate">
              Replying to <span className="font-semibold">{replyingTo.agentName || "User"}</span>: {replyingTo.content.slice(0, 80)}
            </div>
            <button onClick={clearReply} className="ml-2 text-gray-400 hover:text-gray-600 shrink-0">&times;</button>
          </div>
        )}
        {showMentions && isChannel && (
          <div className="absolute bottom-full left-4 mb-1 card-brutal bg-white rounded-lg overflow-hidden w-48">
            {convAgents.map((a) => (
              <button
                key={a.id}
                onClick={() => insertMention(a.name)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-brutal-cream transition-colors"
              >
                @{a.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            className="input-brutal flex-1 rounded-xl text-sm resize-none leading-relaxed"
            rows={1}
            placeholder={isChannel ? `Message #${activeConv.name}... (@ to mention)` : `Message ${activeConv.name}...`}
            value={input}
            onChange={(e) => {
              updateInput(e.target.value);
              autoResize();
              if (isChannel) {
                const lastChar = e.target.value.slice(-1);
                const beforeLast = e.target.value.slice(-2, -1);
                setShowMentions(lastChar === "@" && (beforeLast === "" || beforeLast === " "));
              }
            }}
            onCompositionStart={() => { composingRef.current = true; justEndedComposingRef.current = false; }}
            onCompositionEnd={() => { composingRef.current = false; justEndedComposingRef.current = true; setTimeout(() => { justEndedComposingRef.current = false; }, 0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current && !justEndedComposingRef.current) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === "Escape") setShowMentions(false);
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="btn-brutal bg-brutal-yellow px-5 py-2 rounded-xl text-sm disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
