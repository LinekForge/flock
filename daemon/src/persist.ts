import { readFile } from "fs/promises";
import { safeWriteFile as writeFile, safeMkdir as mkdir } from "./path-guard.js";
import { join } from "path";
import { homedir } from "os";
import type { Conversation } from "./types.js";

const DATA_DIR = join(homedir(), ".flock");
const AGENTS_FILE = join(DATA_DIR, "agents.json");
const CONVS_FILE = join(DATA_DIR, "conversations.json");

export interface PersistedAgent {
  id: string;
  name: string;
  model: string;
  runtime?: string;
  sessionId: string | null;
  keepAlive: boolean;
}

export async function loadPersistedAgents(): Promise<PersistedAgent[]> {
  try {
    const data = await readFile(AGENTS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function savePersistedAgents(agents: PersistedAgent[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2));
}

export async function loadPersistedConversations(): Promise<Conversation[]> {
  try {
    const data = await readFile(CONVS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function savePersistedConversations(convs: Conversation[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONVS_FILE, JSON.stringify(convs, null, 2));
}
