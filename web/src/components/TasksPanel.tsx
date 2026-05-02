import { useState, useEffect, useCallback } from "react";
import { API_BASE, authHeaders, useStore } from "../store";

interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  assignee: string | null;
  createdAt: number;
}

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-gray-100 border-gray-300",
  in_progress: "bg-blue-50 border-blue-300",
  in_review: "bg-yellow-50 border-yellow-300",
  done: "bg-green-50 border-green-300",
};

export function TasksPanel({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const agents = useStore((s) => s.agents);
  const authToken = useStore((s) => s.authToken);

  const fetchTasks = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/tasks`, { headers: authHeaders(authToken) });
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      setTasks([]);
    }
    setLoading(false);
  }, [authToken]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchTasks(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchTasks]);

  const columns = ["todo", "in_progress", "in_review", "done"] as const;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="card-brutal bg-white w-[800px] max-h-[80vh] flex flex-col rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b-2 border-brutal-ink bg-brutal-lime flex items-center justify-between">
          <h2 className="text-lg font-bold">Tasks</h2>
          <button onClick={onClose} className="text-xl font-bold opacity-60 hover:opacity-100">&times;</button>
        </div>
        <div className="flex-1 overflow-x-auto p-4">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">No tasks yet. Agents can create tasks using the create_task tool.</div>
          ) : (
            <div className="flex gap-3 min-w-max">
              {columns.map((status) => {
                const col = tasks.filter((t) => t.status === status);
                return (
                  <div key={status} className="w-48 flex-shrink-0">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                      {STATUS_LABELS[status]} ({col.length})
                    </div>
                    <div className="flex flex-col gap-2">
                      {col.map((t) => (
                        <div key={t.id} className={`p-3 rounded-lg border-2 ${STATUS_COLORS[status]} text-sm`}>
                          <div className="font-semibold text-xs">{t.title}</div>
                          {t.description && <div className="text-[10px] text-gray-500 mt-1">{t.description.slice(0, 60)}</div>}
                          {t.assignee && (
                            <div className="text-[9px] text-gray-400 mt-1">
                              {agents.find((a) => a.id === t.assignee)?.name || t.assignee}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
