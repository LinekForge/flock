import { spawn, type ChildProcess } from "child_process";
import type { AgentConfig } from "./agent.js";
import type { AgentDriver, DriverContext, DriverEvent } from "./driver.js";

const TOOL_LABELS: Record<string, string> = {
  Read: "Reading file",
  Edit: "Editing file",
  Write: "Writing file",
  Bash: "Running command",
  Grep: "Searching code",
  Glob: "Finding files",
  LS: "Listing directory",
  Agent: "Spawning agent",
  WebSearch: "Searching web",
  WebFetch: "Fetching page",
  "mcp__flock-bridge__send_message": "Sending message",
  "mcp__flock-bridge__check_messages": "Checking messages",
  "mcp__flock-bridge__read_history": "Reading history",
  "mcp__flock-bridge__search_messages": "Searching messages",
};

export class ClaudeDriver implements AgentDriver {
  id = "claude";
  busyDeliveryMode = "gated" as const;

  getExecutable(): string {
    return process.env.CLAUDE_PATH || "claude";
  }

  buildSpawnArgs(ctx: DriverContext): string[] {
    const args = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--model", ctx.config.model || "sonnet",
      "--mcp-config", ctx.mcpConfigPath,
      "--append-system-prompt-file", ctx.systemPromptPath,
      "--permission-prompt-tool", "mcp__flock-bridge__approve_action",
    ];
    if (ctx.sessionId) {
      args.push("--resume", ctx.sessionId);
    }
    return args;
  }

  spawn(ctx: DriverContext): ChildProcess {
    const args = this.buildSpawnArgs(ctx);
    const cwd = ctx.config.workDir || process.env.HOME || "/tmp";
    return spawn(this.getExecutable(), args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        DISABLE_ERROR_REPORTING: "1",
        DISABLE_FEEDBACK_COMMAND: "1",
        CLAUDE_CODE_PROXY_RESOLVES_HOSTS: "1",
      },
    });
  }

  parseLine(line: string): DriverEvent[] {
    let parsed: any;
    try { parsed = JSON.parse(line); } catch { return []; }

    const events: DriverEvent[] = [];

    if (parsed.type === "system" && parsed.subtype === "init" && parsed.session_id) {
      events.push({ kind: "session_init", sessionId: parsed.session_id });
      return events;
    }

    if (parsed.type === "system" && parsed.subtype === "status" && parsed.status === "compacting") {
      events.push({ kind: "compaction_started" });
      return events;
    }

    if (parsed.type === "system" && parsed.subtype === "compact_boundary") {
      events.push({ kind: "compaction_finished" });
      return events;
    }

    if (parsed.type === "assistant" && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === "text") {
          events.push({ kind: "text", text: block.text });
        } else if (block.type === "thinking") {
          events.push({ kind: "thinking", text: block.thinking });
        } else if (block.type === "tool_use") {
          const label = TOOL_LABELS[block.name] || block.name;
          events.push({ kind: "tool_call", name: label, input: JSON.stringify(block.input).slice(0, 300) });
        }
      }
    }

    if (parsed.type === "user" && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === "tool_result") {
          events.push({ kind: "tool_output", name: "tool_result" });
        }
      }
    }

    if (parsed.type === "result") {
      events.push({ kind: "turn_end", sessionId: undefined });
    }

    return events;
  }

  encodeMessage(text: string, sessionId: string | null, _mode: "idle" | "busy"): string | null {
    return JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      ...(sessionId ? { session_id: sessionId } : {}),
    });
  }

  encodeImageMessage(base64: string, mediaType: string, fileName: string, sessionId: string | null): string | null {
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: `[Image: ${fileName}]` },
        ],
      },
      ...(sessionId ? { session_id: sessionId } : {}),
    });
  }

  buildSystemPrompt(_config: AgentConfig, flockPrompt: string): string {
    return flockPrompt;
  }

  buildMcpConfig(config: AgentConfig, bridgePath: string): object {
    return {
      mcpServers: {
        "flock-bridge": {
          command: process.env.BUN_PATH || "bun",
          args: ["run", bridgePath],
          env: {
            FLOCK_DAEMON_URL: "http://127.0.0.1:9801",
            FLOCK_AGENT_ID: config.id,
            FLOCK_AUTH_TOKEN: config.authToken || "",
          },
        },
      },
    };
  }
}
