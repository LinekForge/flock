import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";

interface SessionInfo {
  sessionId: string;
  mtime: number;
  time: string;
  firstMsg: string;
  size: number;
}

export function SessionBrowser({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const ws = useStore((s) => s.ws);

  const loadSessions = useCallback(() => {
    if (!ws) return;
    setLoading(true);

    const handler = (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "session:list") {
        setSessions(msg.sessions);
        setLoading(false);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ type: "session:list" }));

    return () => ws.removeEventListener("message", handler);
  }, [ws]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const timer = setTimeout(() => { cleanup = loadSessions(); }, 0);
    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
  }, [loadSessions]);

  const handleResume = (session: SessionInfo) => {
    if (!ws) return;
    ws.send(JSON.stringify({
      type: "agent:resume",
      sessionId: session.sessionId,
      name: session.firstMsg.slice(0, 15) || session.sessionId.slice(0, 8),
      model: "sonnet",
    }));
    onClose();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="card-brutal bg-white w-[480px] max-h-[70vh] flex flex-col rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b-2 border-brutal-ink bg-brutal-yellow flex items-center justify-between">
          <h2 className="text-lg font-bold">Resume Session</h2>
          <button onClick={onClose} className="text-xl font-bold opacity-60 hover:opacity-100">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No sessions found</div>
          ) : (
            <div className="divide-y-2 divide-brutal-ink/10">
              {sessions.map((s) => (
                <button
                  key={s.sessionId}
                  onClick={() => handleResume(s)}
                  className="w-full text-left px-5 py-3 hover:bg-brutal-cream transition-colors flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{s.firstMsg}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5 font-mono">
                      {s.time} · {formatSize(s.size)} · {s.sessionId.slice(0, 8)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
