import { useStore } from "../store";

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SearchPanel() {
  const results = useStore((s) => s.searchResults);
  const setActiveConv = useStore((s) => s.setActiveConversation);
  const setSearchOpen = useStore((s) => s.setSearchOpen);

  if (results.length === 0) return null;

  return (
    <div className="fixed left-64 top-0 w-80 h-full bg-white border-r-2 border-brutal-ink z-40 flex flex-col shadow-brutal">
      <div className="px-4 py-3 border-b-2 border-brutal-ink bg-brutal-yellow flex items-center justify-between">
        <h2 className="text-sm font-bold">Search Results ({results.length})</h2>
        <button onClick={() => setSearchOpen(false)} className="text-lg font-bold opacity-60 hover:opacity-100">&times;</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() => {
              setActiveConv(r.conversationId);
              setSearchOpen(false);
            }}
            className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-brutal-cream transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold">{r.conversationName}</span>
              <span className="text-[9px] text-gray-400 font-mono">{formatTime(r.timestamp)}</span>
            </div>
            {r.agentName && <div className="text-[10px] text-gray-500 mb-1">{r.agentName}</div>}
            <div className="text-xs text-gray-600 line-clamp-2">{r.content}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
