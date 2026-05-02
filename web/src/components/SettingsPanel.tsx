import { useState, useEffect } from "react";
import { getSettings, saveSettings, settingsUpdatePayload, type Settings } from "../settings";
import { useStore } from "../store";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(getSettings);
  const ws = useStore((s) => s.ws);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    if (patch.approvalTimeout !== undefined && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(settingsUpdatePayload(next)));
    }
  };

  useEffect(() => {
    if (settings.notificationsEnabled && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [settings.notificationsEnabled]);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="card-brutal bg-white w-[380px] rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b-2 border-brutal-ink bg-brutal-lavender flex items-center justify-between">
          <h2 className="text-lg font-bold">Settings</h2>
          <button onClick={onClose} className="text-xl font-bold opacity-60 hover:opacity-100">&times;</button>
        </div>
        <div className="p-5 flex flex-col gap-5">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1 block">Default Model</label>
            <select
              className="input-brutal text-sm w-full rounded-lg appearance-none"
              value={settings.defaultModel}
              onChange={(e) => update({ defaultModel: e.target.value })}
            >
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1 block">Approval Timeout (seconds)</label>
            <input
              type="number"
              className="input-brutal text-sm w-full rounded-lg"
              value={settings.approvalTimeout}
              onChange={(e) => update({ approvalTimeout: parseInt(e.target.value) || 60 })}
              min={10}
              max={300}
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Desktop Notifications</label>
            <button
              onClick={() => update({ notificationsEnabled: !settings.notificationsEnabled })}
              className={`w-10 h-5 rounded-full transition-colors ${settings.notificationsEnabled ? "bg-green-500" : "bg-gray-300"}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.notificationsEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>

          <div className="pt-2 border-t border-gray-100">
            <div className="text-[10px] text-gray-400">
              Daemon: ws://localhost:9800 · API: http://localhost:9801
            </div>
            <div className="text-[10px] text-gray-400 mt-1">
              Data: ~/.flock/ · Sessions: ~/.claude/projects/
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
