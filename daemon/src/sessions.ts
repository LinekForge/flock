import { readdir, stat, readFile } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";

export interface SessionInfo {
  sessionId: string;
  mtime: number;
  time: string;
  firstMsg: string;
  size: number;
}

export async function scanSessions(): Promise<SessionInfo[]> {
  const base = join(homedir(), ".claude", "projects");
  const sessions: SessionInfo[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(base);
  } catch {
    return [];
  }

  for (const dir of projectDirs) {
    const projectPath = join(base, dir);
    let files: string[];
    try {
      const dirStat = await stat(projectPath);
      if (!dirStat.isDirectory()) continue;
      files = await readdir(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(projectPath, file);
      const sessionId = basename(file, ".jsonl");

      try {
        const fileStat = await stat(filePath);
        if (fileStat.size < 500) continue;

        const firstMsg = await extractFirstMessage(filePath);
        if (firstMsg === null) continue;

        const mtime = fileStat.mtimeMs;
        const date = new Date(mtime);
        const time = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

        sessions.push({ sessionId, mtime, time, firstMsg, size: fileStat.size });
      } catch {
        continue;
      }
    }
  }

  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions.slice(0, 50);
}

async function extractFirstMessage(filePath: string): Promise<string | null> {
  const handle = await readFile(filePath, "utf-8");
  const lines = handle.split("\n").slice(0, 100);

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "user" && obj.message?.content) {
        const content = obj.message.content;
        let text = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              text = block.text.trim();
              break;
            }
          }
        } else if (typeof content === "string") {
          text = content.trim();
        }
        text = text.replace(/^(\/\S+\s+)+/, "");
        if (text.startsWith("<") || text.length < 3) continue;
        text = text.replace(/[\n\r]/g, " ");
        return text.slice(0, 60);
      }
    } catch {
      continue;
    }
  }
  return "...";
}

export async function loadSessionHistory(sessionId: string): Promise<any[]> {
  const base = join(homedir(), ".claude", "projects");
  let filePath: string | null = null;

  const projectDirs = await readdir(base);
  for (const dir of projectDirs) {
    const candidate = join(base, dir, `${sessionId}.jsonl`);
    try {
      await stat(candidate);
      filePath = candidate;
      break;
    } catch {
      continue;
    }
  }

  if (!filePath) return [];

  const content = await readFile(filePath, "utf-8");
  const messages: any[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "user" && obj.message?.content) {
        const isExternal = obj.userType === "external";
        for (const block of obj.message.content) {
          if (block.type === "text" && block.text?.trim()) {
            const text = block.text.trim();
            const isSystemPrompt = !isExternal
              || text === "Ready."
              || text === "你好"
              || text === "Continue from where you left off."
              || text.startsWith("No response requested")
              || text.startsWith("[Channel #")
              || text.startsWith("[System]");
            messages.push({
              type: "agent:message",
              messageType: isSystemPrompt ? "system" : "user",
              content: isSystemPrompt ? `→ ${text}` : text,
              agentId: "",
              timestamp: obj.timestamp || Date.now(),
            });
          }
        }
      } else if (obj.type === "assistant" && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === "text" && block.text?.trim()) {
            messages.push({
              type: "agent:message",
              messageType: "text",
              content: block.text.trim(),
              agentId: "",
              timestamp: obj.timestamp || Date.now(),
            });
          } else if (block.type === "thinking" && block.thinking?.trim()) {
            messages.push({
              type: "agent:message",
              messageType: "thinking",
              content: block.thinking.trim(),
              agentId: "",
              timestamp: obj.timestamp || Date.now(),
            });
          }
        }
      }
    } catch {
      continue;
    }
  }

  return messages;
}
