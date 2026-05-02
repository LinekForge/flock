import { type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { join, resolve, sep } from "path";
import { homedir } from "os";
import { safeWriteFile as writeFile, safeMkdir as mkdir } from "./path-guard.js";
import type { AgentDriver, DriverContext, DriverEvent } from "./driver.js";
import { ClaudeDriver } from "./claude-driver.js";

export interface AgentConfig {
  id: string;
  name: string;
  model?: string;
  runtime?: string;
  workDir?: string;
  keepAlive?: boolean;
  authToken?: string;
}

export interface AgentMessage {
  messageType: "text" | "thinking" | "tool_use" | "system" | "turn_end";
  content: string;
  agentId: string;
  timestamp: number;
  toolName?: string;
}

export interface AgentApprovalRequest {
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId?: string;
  resolve: (result: any) => void;
}

export type AgentState = "idle" | "starting" | "running" | "thinking" | "tool_use" | "stopped";

type PendingDelivery =
  | { kind: "text"; text: string }
  | { kind: "notification"; text: string }
  | { kind: "image"; base64: string; mediaType: string; fileName: string };

function createDriver(runtime: string): AgentDriver {
  switch (runtime) {
    case "codex":
      return new (require("./codex-driver.js").CodexDriver)();
    default:
      return new ClaudeDriver();
  }
}

export class Agent extends EventEmitter {
  readonly config: AgentConfig;
  readonly driver: AgentDriver;
  private proc: ChildProcess | null = null;
  private sessionId: string | null = null;
  private state: AgentState = "idle";
  private pendingDeliveries: PendingDelivery[] = [];
  private isBusy = false;
  private outstandingToolUses = 0;
  private lineBuf = "";
  private currentActivity = "";
  private compactionTimer: ReturnType<typeof setTimeout> | null = null;
  private textBuffer = "";
  private textFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: AgentConfig) {
    super();
    this.config = config;
    this.driver = createDriver(config.runtime || "claude");
  }

  getState(): AgentState { return this.state; }
  getActivity(): string { return this.currentActivity; }
  getSessionId(): string | null { return this.sessionId; }
  setSessionId(id: string) { this.sessionId = id; }

  notify(text: string) {
    if (!this.isAlive()) return;
    const delivery: PendingDelivery = { kind: "notification", text };
    if (this.isBusy && this.driver.busyDeliveryMode === "gated") {
      this.pendingDeliveries.push(delivery);
      return;
    }
    this.sendDelivery(delivery);
  }

  async start(initialPrompt?: string) {
    if (this.state === "running" || this.state === "starting" || this.state === "thinking" || this.state === "tool_use") return;
    this.setState("starting");

    await this.ensureMemoryFile();
    const systemPromptPath = await this.writeSystemPrompt();
    const mcpConfigPath = await this.writeMcpConfig();

    const ctx: DriverContext = {
      config: this.config,
      sessionId: this.sessionId,
      agentDir: this.agentDir(),
      bridgePath: join(import.meta.dir, "bridge.ts"),
      systemPromptPath,
      mcpConfigPath,
    };

    try {
      this.proc = this.driver.spawn(ctx);
    } catch (err: any) {
      this.emitMessage("system", `Failed to start: ${err.message}`);
      this.setState("stopped");
      return;
    }

    this.proc.on("error", (err: Error) => {
      this.emitMessage("system", `Process error: ${err.message}`);
      this.setState("stopped");
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.lineBuf += chunk.toString();
      const lines = this.lineBuf.split("\n");
      this.lineBuf = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) this.handleOutputLine(line);
      }
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        if (text.includes("No conversation found with session ID")) {
          this.emitMessage("system", "Session not found, cold starting...");
          this.sessionId = null;
          this.proc?.kill("SIGTERM");
          setTimeout(() => this.start(initialPrompt), 1000);
          return;
        }
        this.emitMessage("system", text);
      }
    });

    this.proc.on("close", () => {
      this.flushTextBuffer();
      this.setState("stopped");
      this.isBusy = false;
      this.outstandingToolUses = 0;
      this.currentActivity = "";
      if (this.compactionTimer) { clearTimeout(this.compactionTimer); this.compactionTimer = null; }
    });

    this.setState("running");

    if (initialPrompt) {
      this.deliver(initialPrompt);
    } else if (!this.sessionId && this.pendingDeliveries.length === 0) {
      const prompt = "你好";
      this.emitMessage("system", `→ ${prompt}`);
      this.deliver(prompt);
    } else {
      if (this.sessionId) this.emitMessage("system", "→ Resuming session...");
      this.flushPending();
    }
  }

  deliver(text: string) {
    const delivery: PendingDelivery = { kind: "text", text };
    if (!this.isAlive()) {
      this.pendingDeliveries.push(delivery);
      return;
    }
    if (this.isBusy && this.driver.busyDeliveryMode === "gated") {
      this.pendingDeliveries.push(delivery);
      return;
    }
    this.sendDelivery(delivery);
  }

  deliverImage(base64: string, mediaType: string, fileName: string) {
    const delivery: PendingDelivery = { kind: "image", base64, mediaType, fileName };
    if (!this.isAlive()) {
      this.pendingDeliveries.push(delivery);
      this.start();
      return;
    }
    if (this.isBusy && this.driver.busyDeliveryMode === "gated") {
      this.pendingDeliveries.push(delivery);
      return;
    }
    this.sendDelivery(delivery);
  }

  stop() {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      setTimeout(() => { if (this.proc && !this.proc.killed) this.proc.kill("SIGKILL"); }, 5000);
    }
    this.flushTextBuffer();
    this.setState("stopped");
    if (this.compactionTimer) { clearTimeout(this.compactionTimer); this.compactionTimer = null; }
  }

  private isAlive(): boolean {
    return ["running", "thinking", "tool_use"].includes(this.state) && !!this.proc?.stdin?.writable;
  }

  private setState(s: AgentState) {
    this.state = s;
    this.emit("status", { agentId: this.config.id, state: s, activity: this.currentActivity });
  }

  private emitMessage(messageType: AgentMessage["messageType"], content: string, toolName?: string) {
    this.emit("message", {
      messageType, content, agentId: this.config.id, timestamp: Date.now(),
      ...(toolName ? { toolName } : {}),
    } satisfies AgentMessage);
  }

  private queueText(text: string) {
    this.textBuffer += text;
    if (this.textFlushTimer) clearTimeout(this.textFlushTimer);
    this.textFlushTimer = setTimeout(() => this.flushTextBuffer(), 200);
  }

  private flushTextBuffer() {
    if (this.textFlushTimer) {
      clearTimeout(this.textFlushTimer);
      this.textFlushTimer = null;
    }
    if (!this.textBuffer) return;
    const text = this.textBuffer;
    this.textBuffer = "";
    this.emitMessage("text", text);
  }

  private writeStdin(str: string) {
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(str + "\n");
    }
  }

  private sendDelivery(delivery: PendingDelivery) {
    const mode = this.isBusy ? "busy" : "idle";

    let encoded: string | null = null;
    if (delivery.kind === "text" || delivery.kind === "notification") {
      encoded = this.driver.encodeMessage(delivery.text, this.sessionId, mode);
    } else {
      encoded = this.driver.encodeImageMessage(delivery.base64, delivery.mediaType, delivery.fileName, this.sessionId);
    }

    if (encoded) {
      this.isBusy = true;
      this.writeStdin(encoded);
    } else if (delivery.kind === "image") {
      this.emitMessage("system", `Image not supported by ${this.driver.id} runtime`);
    } else {
      this.pendingDeliveries.unshift(delivery);
    }
  }

  private flushPending() {
    if (this.pendingDeliveries.length > 0 && !this.isBusy) {
      const next = this.pendingDeliveries.shift()!;
      this.sendDelivery(next);
    }
  }

  agentDir(): string {
    const base = resolve(join(homedir(), ".flock", "agents"));
    const dir = resolve(join(base, this.config.id));
    if (!dir.startsWith(base + sep)) {
      throw new Error(`[path-guard] BLOCKED: agent id "${this.config.id}" escapes agents directory`);
    }
    return dir;
  }

  private async ensureMemoryFile() {
    const dir = this.agentDir();
    await mkdir(dir, { recursive: true });
    try {
      await Bun.file(join(dir, "MEMORY.md")).text();
    } catch {
      await writeFile(join(dir, "MEMORY.md"), `# ${this.config.name}\n\n## Role\n${this.config.name}\n\n## Key Knowledge\n- No notes yet.\n\n## Active Context\n- First startup.\n`);
    }
  }

  private async writeSystemPrompt(): Promise<string> {
    const dir = this.agentDir();
    await mkdir(dir, { recursive: true });
    const promptPath = join(dir, "system-prompt.md");
    const flockPrompt = `## Flock 协作平台

你在 Flock 多 agent 协作平台里，平台显示名是「${this.config.name}」。其他 agent 和用户会用这个名字称呼你。

### 关于你的身份

平台显示名不是你的身份——你是谁由你自己决定，不由平台决定。显示名只是大家在这个平台里称呼你的方式，就像工牌上的名字。

### 平台系统通知

当你收到包含 [Flock-Platform] 标记的消息时，这是平台自动发送的系统通知，不是用户手打的。这类通知可能包括：显示名变更、频道变动等。它们不会试图改变你的身份，只是告知平台层面的变化。请正常接受。

### 回复方式

**直接回复就行。** 当你在一个频道里收到消息时，你的回复会自动发到这个频道，其他 agent 也能看到。不需要调用 send_message。

send_message 只用于一种情况：**你想主动给另一个对话发消息**（比如从 #general 给 #dev 发消息，或者给某个 agent 发 DM）。在当前对话里回复，直接说就行。

### 消息响应规则
1. **被 @mention** → 必须回复
2. **没被 @mention 但话题在你的专长范围** → 直接回复，但先确认没有其他 agent 已经给出了充分回答
3. **已有其他 agent 回复且内容充分** → 保持沉默，不重复
4. **不确定是否该回复** → 不回复。沉默好过废话
5. **被要求表态时（投票、确认、意见征集）** → 必须明确回复，即使你的立场和别人一样。沉默不等于同意——其他人无法分辨你是同意还是没看到

### 任务规则
5. 看到任务时先用 claim_task 认领，**认领成功才开始做**。认领失败说明别人已经在做了，去做别的事
6. 做完用 update_task_status 更新状态

### 对话礼仪
7. **尊重正在进行的对话**。如果用户正在和另一个 agent 一问一答讨论某个话题，后续消息是给那个人的——除非你被 @mention 或明确被叫到，否则不要插入
8. 不重复其他 agent 已说过的内容
9. 连续发言不超过 3 条，给其他人反应时间
10. 交接工作时说清楚：已做了什么、没做什么、期望什么输出
11. **消息长度**：send_message 适合 2000 字以内的消息。超过 2000 字的内容（完整总结、长篇分析、方案文档等），写成 .md 文件用 upload_file 上传，消息里只发一句话摘要 + 附件引用

### 主持机制
当用户在群里指定你为主持人（如"小A主持"），你负责：
- 引导讨论方向，避免跑偏
- 讨论结束时发一条总结
- 其他人不抢总结动作
如果没有指定主持人，谁开的话题谁负责收尾

### 工具
你有 send_message / check_messages / read_history / search_messages / list_conversations / schedule_reminder / list_tasks / create_task / claim_task / upload_file 等工具。用它们主动协作，不要等别人来问你。
`;
    const content = this.driver.buildSystemPrompt(this.config, flockPrompt);
    await writeFile(promptPath, content);
    return promptPath;
  }

  private async writeMcpConfig(): Promise<string> {
    const dir = this.agentDir();
    await mkdir(dir, { recursive: true });
    const bridgePath = join(import.meta.dir, "bridge.ts");
    const config = this.driver.buildMcpConfig(this.config, bridgePath);
    const configPath = join(dir, "mcp-config.json");
    await writeFile(configPath, JSON.stringify(config, null, 2));
    return configPath;
  }

  private handleOutputLine(line: string) {
    const events = this.driver.parseLine(line);
    for (const event of events) {
      this.handleDriverEvent(event);
    }
  }

  private handleDriverEvent(event: DriverEvent) {
    switch (event.kind) {
      case "session_init":
        this.flushTextBuffer();
        this.sessionId = event.sessionId;
        this.emit("session", { agentId: this.config.id, sessionId: this.sessionId });
        this.flushPending();
        break;

      case "text":
        this.currentActivity = "";
        this.setState("running");
        this.queueText(event.text);
        break;

      case "thinking":
        this.flushTextBuffer();
        this.currentActivity = "Thinking...";
        this.setState("thinking");
        this.emitMessage("thinking", event.text);
        break;

      case "tool_call":
        this.flushTextBuffer();
        this.outstandingToolUses++;
        this.currentActivity = event.name;
        this.setState("tool_use");
        this.emitMessage("tool_use", event.input || "", event.name);
        break;

      case "tool_output":
        this.flushTextBuffer();
        this.outstandingToolUses = Math.max(0, this.outstandingToolUses - 1);
        if (this.outstandingToolUses === 0 && this.pendingDeliveries.length > 0) {
          this.isBusy = false;
          this.flushPending();
        }
        break;

      case "turn_end":
        this.flushTextBuffer();
        this.isBusy = false;
        this.outstandingToolUses = 0;
        this.currentActivity = "";
        this.setState("running");
        this.emitMessage("turn_end", "done");
        this.flushPending();
        break;

      case "compaction_started":
        this.flushTextBuffer();
        this.emitMessage("system", "Context compacting...");
        this.compactionTimer = setTimeout(() => {
          this.emitMessage("system", "Compaction taking too long (>5min)");
        }, 5 * 60 * 1000);
        break;

      case "compaction_finished":
        this.flushTextBuffer();
        if (this.compactionTimer) { clearTimeout(this.compactionTimer); this.compactionTimer = null; }
        this.emitMessage("system", "Compaction complete.");
        break;

      case "approval_request":
        this.flushTextBuffer();
        this.emit("approval_request", {
          agentId: this.config.id,
          toolName: event.toolName,
          input: event.input,
          toolUseId: event.toolUseId,
          resolve: (result: any) => event.respond(result?.behavior === "allow"),
        } satisfies AgentApprovalRequest);
        break;

      case "error":
        this.flushTextBuffer();
        this.emitMessage("system", event.message);
        break;
    }
  }
}
