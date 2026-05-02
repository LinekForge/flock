import { useState } from "react";
import { useStore } from "../store";

export function ChannelCreateDialog({ onClose }: { onClose: () => void }) {
  const agents = useStore((s) => s.agents);
  const createChannel = useStore((s) => s.createChannel);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [defaultAgent, setDefaultAgent] = useState("");

  const handleCreate = () => {
    if (!name.trim() || selected.size < 2) return;
    const agentIds = Array.from(selected);
    createChannel(name.trim(), agentIds, defaultAgent || agentIds[0]);
    onClose();
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    if (!next.has(defaultAgent)) setDefaultAgent(Array.from(next)[0] || "");
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="card-brutal bg-white w-[400px] rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b-2 border-brutal-ink bg-brutal-cyan">
          <h2 className="text-lg font-bold"># New Channel</h2>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1 block">Channel Name</label>
            <input
              className="input-brutal text-sm w-full rounded-lg"
              placeholder="design-team"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 block">
              Select Agents ({selected.size} selected, min 2)
            </label>
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {agents.map((agent) => (
                <label
                  key={agent.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors
                    ${selected.has(agent.id) ? "bg-brutal-cream border-2 border-brutal-ink" : "border-2 border-transparent hover:bg-gray-50"}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(agent.id)}
                    onChange={() => toggle(agent.id)}
                    className="accent-brutal-ink"
                  />
                  <span className="text-sm font-medium">{agent.name}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{agent.model}</span>
                </label>
              ))}
            </div>
          </div>

          {selected.size >= 2 && (
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1 block">Default Responder</label>
              <select
                className="input-brutal text-sm w-full rounded-lg appearance-none"
                value={defaultAgent}
                onChange={(e) => setDefaultAgent(e.target.value)}
              >
                {Array.from(selected).map((id) => {
                  const agent = agents.find((a) => a.id === id);
                  return <option key={id} value={id}>{agent?.name || id}</option>;
                })}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">Responds when no @mention is used</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || selected.size < 2}
              className="btn-brutal flex-1 bg-brutal-lime text-sm px-3 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create Channel
            </button>
            <button onClick={onClose} className="btn-brutal flex-1 bg-white text-sm px-3 py-2 rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
