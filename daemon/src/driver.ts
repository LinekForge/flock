import type { ChildProcess } from "child_process";
import type { AgentConfig } from "./agent.js";

export type DriverEvent =
  | { kind: "session_init"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; name: string; input?: string }
  | { kind: "tool_output"; name: string }
  | { kind: "turn_end"; sessionId?: string }
  | { kind: "compaction_started" }
  | { kind: "compaction_finished" }
  | {
      kind: "approval_request";
      toolName: string;
      input: Record<string, unknown>;
      toolUseId?: string;
      respond: (approved: boolean) => void;
    }
  | { kind: "error"; message: string };

export interface DriverContext {
  config: AgentConfig;
  sessionId: string | null;
  agentDir: string;
  bridgePath: string;
  systemPromptPath: string;
  mcpConfigPath: string;
}

export interface AgentDriver {
  id: string;
  busyDeliveryMode: "gated" | "direct";

  spawn(ctx: DriverContext): ChildProcess;
  parseLine(line: string): DriverEvent[];
  encodeMessage(text: string, sessionId: string | null, mode: "idle" | "busy"): string | null;
  encodeImageMessage(base64: string, mediaType: string, fileName: string, sessionId: string | null): string | null;
  buildSystemPrompt(config: AgentConfig, flockPrompt: string): string;
  buildMcpConfig(config: AgentConfig, bridgePath: string): object;
  buildSpawnArgs(ctx: DriverContext): string[];
  getExecutable(): string;
}
