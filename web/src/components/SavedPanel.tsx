import { useStore, type Message } from "../store";

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SavedPanel({ onClose }: { onClose: () => void }) {
  const messages = useStore((s) => s.messages);
  const conversations = useStore((s) => s.conversations);
  const setActiveConv = useStore((s) => s.setActiveConversation);

  const saved: (Message & { convName: string })[] = [];
  for (const [convId, msgs] of Object.entries(messages)) {
    const conv = conversations.find((c) => c.id === convId);
    for (const m of msgs) {
      if (m.pinned) {
        saved.push({ ...m, convName: conv?.name || convId });
      }
    }
  }
  saved.sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="card-brutal bg-white w-[480px] max-h-[70vh] flex flex-col rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b-2 border-brutal-ink bg-brutal-pink">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Saved Messages</h2>
            <button onClick={onClose} className="text-xl font-bold opacity-60 hover:opacity-100">&times;</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {saved.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No saved messages. Pin a message to save it here.</div>
          ) : (
            saved.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  const conv = conversations.find((c) => c.id === m.conversationId);
                  if (conv) { setActiveConv(conv.id); onClose(); }
                }}
                className="w-full text-left px-5 py-3 border-b border-gray-100 hover:bg-brutal-cream transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold">{m.convName}</span>
                  <span className="text-[9px] text-gray-400 font-mono">{formatTime(m.timestamp)}</span>
                </div>
                {m.agentName && <div className="text-[10px] text-gray-500 mb-1">{m.agentName}</div>}
                <div className="text-xs text-gray-600 line-clamp-2">{m.content.slice(0, 100)}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
