import { spawn, execFileSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentConfig } from "./agent.js";
import type { AgentDriver, DriverContext, DriverEvent } from "./driver.js";

const CODEX_TOOL_LABELS: Record<string, string> = {
  shell: "Running command",
  file_change: "Editing file",
  web_search: "Searching web",
  "mcp_chat_send_message": "Sending message",
  "mcp_chat_check_messages": "Checking messages",
  "mcp_chat_read_history": "Reading history",
};

function resolveCodexCommand(): string | null {
  const candidates = [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const which = execFileSync("which", ["codex"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (which) return which;
  } catch {}
  return null;
}

function ensureGitRepo(cwd: string) {
  mkdirSync(cwd, { recursive: true });
  if (existsSync(join(cwd, ".git"))) return;
  try {
    execFileSync("git", ["init"], { cwd, stdio: "pipe" });
    execFileSync("git", ["-c", "user.name=flock", "-c", "user.email=flock@local", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "init"], { cwd, stdio: "pipe" });
  } catch {}
}

type JsonRpcId = string | number;

function isApprovalMethod(method: unknown): method is string {
  return method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method === "item/permissions/requestApproval"
    || method === "execCommandApproval"
    || method === "applyPatchApproval";
}

function inferApprovalMethod(params: any): string | null {
  if (typeof params?.command === "string" || Array.isArray(params?.command)) return "item/commandExecution/requestApproval";
  if (params?.fileChanges || params?.grantRoot) return "item/fileChange/requestApproval";
  if (params?.permissions) return "item/permissions/requestApproval";
  return null;
}

function approvalToolName(method: string): string {
  if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") return "Bash";
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") return "Write";
  return "Permissions";
}

function approvalInput(method: string, params: any): Record<string, unknown> {
  if (method === "item/commandExecution/requestApproval") {
    return {
      command: params.command || "",
      cwd: params.cwd || "",
      reason: params.reason || "",
      additionalPermissions: params.additionalPermissions,
      networkApprovalContext: params.networkApprovalContext,
    };
  }
  if (method === "execCommandApproval") {
    return {
      command: Array.isArray(params.command) ? params.command.join(" ") : "",
      cwd: params.cwd || "",
      reason: params.reason || "",
      parsedCmd: params.parsedCmd,
    };
  }
  if (method === "applyPatchApproval") {
    return {
      file_path: Object.keys(params.fileChanges || {}).join(", ") || params.grantRoot || "",
      reason: params.reason || "",
      fileChanges: params.fileChanges,
      grantRoot: params.grantRoot,
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      file_path: params.grantRoot || params.itemId || "",
      reason: params.reason || "",
      grantRoot: params.grantRoot,
    };
  }
  return params && typeof params === "object" ? params : {};
}

function approvalToolUseId(method: string, requestId: JsonRpcId, params: any): string {
  return String(params?.approvalId || params?.callId || params?.itemId || `${method}:${requestId}`);
}

function grantedPermissions(params: any) {
  const requested = params?.permissions || {};
  return {
    ...(requested.network ? { network: requested.network } : {}),
    ...(requested.fileSystem ? { fileSystem: requested.fileSystem } : {}),
  };
}

export class CodexDriver implements AgentDriver {
  id = "codex";
  busyDeliveryMode = "direct" as const;

  private requestId = 0;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private initializeRequestId: number | null = null;
  private sessionAnnounced = false;
  private proc: ChildProcess | null = null;
  private workDir: string = "";
  private systemPromptContent: string = "";
  private streamedAgentMessageIds = new Set<string>();

  getExecutable(): string {
    return resolveCodexCommand() || "codex";
  }

  buildSpawnArgs(ctx: DriverContext): string[] {
    const args = ["app-server", "--listen", "stdio://"];

    const bridgePath = ctx.bridgePath;
    const bunPath = process.env.BUN_PATH || "bun";
    args.push(
      "-c", `mcp_servers.chat.command="${bunPath}"`,
      "-c", `mcp_servers.chat.args=["run","${bridgePath}"]`,
      "-c", `mcp_servers.chat.env.FLOCK_DAEMON_URL="http://127.0.0.1:9801"`,
      "-c", `mcp_servers.chat.env.FLOCK_AGENT_ID="${ctx.config.id}"`,
      "-c", `mcp_servers.chat.env.FLOCK_AUTH_TOKEN="${ctx.config.authToken || ""}"`,
      "-c", "mcp_servers.chat.enabled=true",
      "-c", "mcp_servers.chat.startup_timeout_sec=30",
      "-c", "mcp_servers.chat.tool_timeout_sec=120",
    );

    return args;
  }

  spawn(ctx: DriverContext): ChildProcess {
    const cwd = ctx.config.workDir || join(homedir(), ".flock", "codex-workspaces", ctx.config.id);
    ensureGitRepo(cwd);

    this.workDir = cwd;
    this.threadId = ctx.sessionId || null;
    this.requestId = 0;
    this.activeTurnId = null;
    this.initializeRequestId = null;
    this.sessionAnnounced = false;

    const args = this.buildSpawnArgs(ctx);
    const proc = spawn(this.getExecutable(), args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
      shell: false,
    });

    this.proc = proc;

    queueMicrotask(() => {
      this.initializeRequestId = this.sendRequest("initialize", {
        clientInfo: { name: "flock-daemon", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
    });

    return proc;
  }

  parseLine(line: string): DriverEvent[] {
    let message: any;
    try { message = JSON.parse(line); } catch { return []; }

    const events: DriverEvent[] = [];

    if (message.result) {
      if (message.id === this.initializeRequestId) {
        this.initializeRequestId = null;
        this.sendNotification("initialized", {});
        this.startThread();
        return events;
      }
      const thread = message.result.thread;
      if (thread && typeof thread.id === "string") {
        this.handleThreadReady(thread.id, events);
        return events;
      }
      const turn = message.result.turn;
      if (turn && typeof turn.id === "string") {
        this.activeTurnId = turn.id;
        return events;
      }
    }

    if (message.error) {
      events.push({ kind: "error", message: message.error.message || "Codex app-server error" });
      return events;
    }

    const approvalMethod = isApprovalMethod(message.method)
      ? message.method
      : message.method === undefined && message.id !== undefined
      ? inferApprovalMethod(message.params)
      : null;
    if (approvalMethod && message.id !== undefined) {
      const requestId = message.id as JsonRpcId;
      const params = message.params || {};
      events.push({
        kind: "approval_request",
        toolName: approvalToolName(approvalMethod),
        input: approvalInput(approvalMethod, params),
        toolUseId: approvalToolUseId(approvalMethod, requestId, params),
        respond: (approved) => this.respondToApproval(requestId, approvalMethod, params, approved),
      });
      return events;
    }

    switch (message.method) {
      case "thread/started": {
        const threadId = message.params?.thread?.id;
        if (typeof threadId === "string") {
          this.handleThreadReady(threadId, events);
        }
        break;
      }

      case "turn/started": {
        const turnId = message.params?.turn?.id;
        if (typeof turnId === "string") {
          this.activeTurnId = turnId;
        }
        events.push({ kind: "thinking", text: "" });
        break;
      }

      case "item/agentMessage/delta": {
        const delta = message.params?.delta;
        const itemId = this.itemIdFromParams(message.params);
        if (itemId) this.streamedAgentMessageIds.add(itemId);
        if (typeof delta === "string" && delta.length > 0) {
          events.push({ kind: "text", text: delta });
        }
        break;
      }

      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const delta = message.params?.delta;
        if (typeof delta === "string" && delta.length > 0) {
          events.push({ kind: "thinking", text: delta });
        }
        break;
      }

      case "item/started":
      case "item/completed": {
        const item = message.params?.item;
        if (!item || typeof item.type !== "string") break;
        const isStarted = message.method === "item/started";
        const isCompleted = message.method === "item/completed";

        switch (item.type) {
          case "commandExecution":
            if (isStarted && typeof item.command === "string") {
              events.push({ kind: "tool_call", name: CODEX_TOOL_LABELS.shell || "shell", input: item.command });
            }
            if (isCompleted) {
              events.push({ kind: "tool_output", name: "shell" });
            }
            break;
          case "fileChange":
            if (isStarted && Array.isArray(item.changes)) {
              for (const change of item.changes) {
                events.push({ kind: "tool_call", name: CODEX_TOOL_LABELS.file_change || "file_change", input: change?.path });
              }
            }
            break;
          case "mcpToolCall":
            if (isStarted) {
              const toolName = `mcp_chat_${item.tool}`;
              events.push({ kind: "tool_call", name: CODEX_TOOL_LABELS[toolName] || toolName, input: JSON.stringify(item.arguments || {}).slice(0, 300) });
            }
            if (isCompleted) {
              const toolName = `mcp_chat_${item.tool}`;
              events.push({ kind: "tool_output", name: toolName });
            }
            break;
          case "contextCompaction":
            if (isStarted) events.push({ kind: "compaction_started" });
            if (isCompleted) events.push({ kind: "compaction_finished" });
            break;
          case "agentMessage":
            if (
              isCompleted
              && typeof item.text === "string"
              && item.text.length > 0
              && !(typeof item.id === "string" && this.streamedAgentMessageIds.has(item.id))
            ) {
              events.push({ kind: "text", text: item.text });
            }
            if (isCompleted && typeof item.id === "string") {
              this.streamedAgentMessageIds.delete(item.id);
            }
            break;
          case "reasoning":
            if (isCompleted) {
              const summary = Array.isArray(item.summary) ? item.summary.filter((s: any) => typeof s === "string") : [];
              const content = Array.isArray(item.content) ? item.content.filter((s: any) => typeof s === "string") : [];
              const text = [...summary, ...content].join("\n").trim();
              if (text) events.push({ kind: "thinking", text });
            }
            break;
        }
        break;
      }

      case "turn/completed": {
        const turn = message.params?.turn;
        if (turn?.status === "failed" && turn?.error?.message) {
          events.push({ kind: "error", message: turn.error.message });
        }
        this.activeTurnId = null;
        this.streamedAgentMessageIds.clear();
        events.push({ kind: "turn_end", sessionId: this.threadId || undefined });
        break;
      }

      case "error":
        events.push({ kind: "error", message: message.params?.message || "Unknown Codex error" });
        break;
    }

    return events;
  }

  encodeMessage(text: string, _sessionId: string | null, mode: "idle" | "busy"): string | null {
    if (!this.threadId) return null;

    if (mode === "busy" && this.activeTurnId) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextRequestId(),
        method: "turn/steer",
        params: {
          threadId: this.threadId,
          expectedTurnId: this.activeTurnId,
          input: [{ type: "text", text }],
        },
      });
    }

    return JSON.stringify({
      jsonrpc: "2.0",
      id: this.nextRequestId(),
      method: "turn/start",
      params: {
        threadId: this.threadId,
        input: [{ type: "userMessage", text }],
      },
    });
  }

  encodeImageMessage(_base64: string, _mediaType: string, _fileName: string, _sessionId: string | null): string | null {
    return null;
  }

  buildSystemPrompt(_config: AgentConfig, flockPrompt: string): string {
    const content = flockPrompt + `\n\n**IMPORTANT**: Your process stays alive across turns. New messages may be delivered directly while you are working.\n`;
    this.systemPromptContent = content;
    return content;
  }

  buildMcpConfig(_config: AgentConfig, _bridgePath: string): object {
    return {};
  }

  // --- Internal ---

  private startThread() {
    const params: any = {
      cwd: this.workDir || join(homedir(), ".flock", "codex-workspaces", "default"),
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      ...(this.systemPromptContent ? { developerInstructions: this.systemPromptContent } : {}),
    };
    if (this.threadId) {
      this.sendRequest("thread/resume", { threadId: this.threadId, ...params });
    } else {
      this.sendRequest("thread/start", params);
    }
  }

  private handleThreadReady(threadId: string, events: DriverEvent[]) {
    this.threadId = threadId;
    if (!this.sessionAnnounced) {
      events.push({ kind: "session_init", sessionId: threadId });
      this.sessionAnnounced = true;
    }
  }

  private nextRequestId(): number {
    return ++this.requestId;
  }

  private itemIdFromParams(params: any): string | null {
    const id = params?.itemId || params?.item_id || params?.item?.id;
    return typeof id === "string" ? id : null;
  }

  private sendRequest(method: string, params: any): number {
    const id = this.nextRequestId();
    this.proc?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return id;
  }

  private respondToApproval(id: JsonRpcId, method: string, params: any, approved: boolean) {
    let result: any;
    if (method === "execCommandApproval" || method === "applyPatchApproval") {
      result = { decision: approved ? "approved" : "denied" };
    } else if (method === "item/permissions/requestApproval") {
      result = approved
        ? { permissions: grantedPermissions(params), scope: "session" }
        : { permissions: {}, scope: "turn" };
    } else {
      result = { decision: approved ? "accept" : "decline" };
    }
    this.proc?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  private sendNotification(method: string, params: any) {
    this.proc?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
}
