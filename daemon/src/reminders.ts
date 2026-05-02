import { readFile } from "fs/promises";
import { safeWriteFile as writeFile, safeMkdir as mkdir } from "./path-guard.js";
import { join } from "path";
import { homedir } from "os";

const DATA_FILE = join(homedir(), ".flock", "reminders.json");

interface Reminder {
  id: string;
  agentId: string;
  content: string;
  fireAt: number;
  createdAt: number;
}

export class ReminderManager {
  private reminders = new Map<string, Reminder>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private persistQueue: Promise<void> = Promise.resolve();
  private onFire: (agentId: string, content: string) => void;

  constructor(onFire: (agentId: string, content: string) => void) {
    this.onFire = onFire;
  }

  async load() {
    try {
      const data = await readFile(DATA_FILE, "utf-8");
      const arr: Reminder[] = JSON.parse(data);
      const now = Date.now();
      for (const r of arr) {
        if (r.fireAt > now) {
          this.reminders.set(r.id, r);
          this.setTimer(r);
        }
      }
    } catch {}
  }

  async schedule(agentId: string, content: string, delayMs: number): Promise<string> {
    const id = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const reminder: Reminder = {
      id,
      agentId,
      content,
      fireAt: Date.now() + delayMs,
      createdAt: Date.now(),
    };
    this.reminders.set(id, reminder);
    this.setTimer(reminder);
    await this.persist();
    return id;
  }

  list(agentId: string): any[] {
    return Array.from(this.reminders.values())
      .filter((r) => !agentId || r.agentId === agentId)
      .map((r) => ({ id: r.id, content: r.content, fireAt: r.fireAt, agentId: r.agentId }));
  }

  async cancel(id: string): Promise<boolean> {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    const had = this.reminders.delete(id);
    if (had) await this.persist();
    return had;
  }

  private setTimer(r: Reminder) {
    const delay = Math.max(0, r.fireAt - Date.now());
    const timer = setTimeout(async () => {
      this.onFire(r.agentId, `[Reminder] ${r.content}`);
      this.reminders.delete(r.id);
      this.timers.delete(r.id);
      try {
        await this.persist();
      } catch (err) {
        console.error("Failed to persist reminders:", err);
      }
    }, delay);
    this.timers.set(r.id, timer);
  }

  private async persist() {
    this.persistQueue = this.persistQueue.catch(() => {}).then(async () => {
      await mkdir(join(homedir(), ".flock"), { recursive: true });
      await writeFile(DATA_FILE, JSON.stringify(Array.from(this.reminders.values()), null, 2));
    });
    await this.persistQueue;
  }

  async flush() {
    await this.persistQueue.catch(() => {});
  }
}
