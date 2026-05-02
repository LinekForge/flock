import { readFile } from "fs/promises";
import { safeWriteFile as writeFile, safeMkdir as mkdir } from "./path-guard.js";
import { join } from "path";
import { homedir } from "os";

const DATA_FILE = join(homedir(), ".flock", "tasks.json");

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  assignee: string | null;
  conversationId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export class TaskManager {
  private tasks = new Map<string, Task>();
  private persistQueue: Promise<void> = Promise.resolve();

  async load() {
    try {
      const data = await readFile(DATA_FILE, "utf-8");
      const arr: Task[] = JSON.parse(data);
      for (const t of arr) this.tasks.set(t.id, t);
    } catch {}
  }

  list(convId?: string): Task[] {
    const all = Array.from(this.tasks.values());
    if (convId) return all.filter((t) => t.conversationId === convId);
    return all;
  }

  async create(data: { title: string; description?: string; conversationId?: string; createdBy?: string }): Promise<Task> {
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: data.title,
      description: data.description || "",
      status: "todo",
      assignee: null,
      conversationId: data.conversationId || null,
      createdBy: data.createdBy || "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    await this.persist();
    return task;
  }

  async claim(taskId: string, agentId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (task.assignee) return null;
    task.assignee = agentId;
    task.status = "in_progress";
    task.updatedAt = Date.now();
    await this.persist();
    return task;
  }

  async unclaim(taskId: string, agentId?: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (agentId && task.assignee !== agentId) return null;
    task.assignee = null;
    task.status = "todo";
    task.updatedAt = Date.now();
    await this.persist();
    return task;
  }

  async updateStatus(taskId: string, status: string, agentId?: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (agentId && task.assignee !== agentId) return null;
    if (!["todo", "in_progress", "in_review", "done"].includes(status)) return null;
    task.status = status as Task["status"];
    task.updatedAt = Date.now();
    await this.persist();
    return task;
  }

  private async persist() {
    this.persistQueue = this.persistQueue.catch(() => {}).then(async () => {
      await mkdir(join(homedir(), ".flock"), { recursive: true });
      await writeFile(DATA_FILE, JSON.stringify(Array.from(this.tasks.values()), null, 2));
    });
    await this.persistQueue;
  }

  async flush() {
    await this.persistQueue.catch(() => {});
  }
}
