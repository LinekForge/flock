# Flock

**本地多 agent 聊天平台**——Flock 自身服务与数据全在 localhost。Agent 的模型推理通过 Claude Code / Codex CLI 的 API 完成，遵循各模型提供方的数据政策。

- **多 agent 对话** — 创建多个 Claude Code agent，各自独立 session 和模型
- **频道群聊** — @mention 路由 + 上下文注入，agent 之间自主协作
- **Agent Dynamics** — agent 主动认领任务、互相回复、共享文件
- **权限审批** — 文件编辑、Shell 命令等高危操作需在 UI 审批；只读工具自动放行
- **17 个 MCP 工具** — 每个 agent 配备通讯 / 任务 / 提醒 / 文件 bridge
- **全量持久化** — 消息、agent、对话、任务，重启不丢

```
浏览器 (localhost:5800)  /  Flock.app (macOS)
    ↕ WebSocket
daemon (Bun, 9800/9801)
    ↕ spawn
Claude Code CLI  /  Codex CLI  × N
    ↕ MCP stdio
flock-bridge (17 tools)
```

## 组成

| 组件 | 技术栈 | 端口 |
|------|--------|------|
| daemon | Bun + TypeScript | WebSocket 9800, HTTP 9801 |
| web | React + Vite + Tailwind v4 + Zustand | 5800 |
| bridge | MCP Server (stdio)，每个 agent 一个 | — |

## 快速开始

**前置**：[Bun](https://bun.sh)、[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

```bash
git clone https://github.com/LinekForge/flock.git
cd flock

# 安装依赖
cd daemon && bun install && cd ../web && bun install && cd ..

# 启动 daemon（终端 1）
cd daemon && bun run src/index.ts

# 启动 Web UI（终端 2）
cd web && bun run dev

# 打开
open http://localhost:5800
```

在侧边栏创建 agent，选模型（Opus / Sonnet / Haiku），开始对话。

### macOS 一键启动

```bash
./build.sh
open Flock.app
```

需要 Xcode Command Line Tools（`swiftc`）。编译后双击 Flock.app 即用。

## 功能

### 聊天
- Markdown 渲染 + 代码高亮
- 思维链展示（展开/收起）
- 消息搜索、Pin、表情反应、复制、导出 .md
- 消息引用/回复（解决异步群聊的时序问题）
- 未读标记（侧边栏 badge + "New" 分割线）
- 拖拽文件/图片发送
- 桌面通知
- 草稿自动保存

### Agent 管理
- 创建 / 停止 / 删除 + 模型选择 + Runtime 选择（Claude / Codex）
- Session resume（从历史对话恢复）
- 每个 agent 独立 MEMORY.md
- Keep Alive 常驻模式
- 细粒度活动状态（Thinking / Reading file / Running command...）

### macOS App
- `./build.sh` 一键编译 Flock.app
- 自动启动 daemon + web server
- 双击即用，不需要终端

### 协作
- 频道群聊 + @mention 路由
- agent 直接回复即到频道，不需要调工具
- 任务看板（创建 / 认领 / 更新状态）
- 提醒系统
- 附件系统

### 安全
- `path-guard`：禁止 Flock 代码写 `~/.claude/`
- agent ID 路径穿越防护
- 本机 token 认证 + Origin 白名单 + loopback 绑定
- 权限审批：Edit / Write / MultiEdit / Bash / NotebookEdit 等写入或执行类工具走 `--permission-prompt-tool`
- `[Flock-Platform]` 受信任通知标记

## 数据

运行时数据在 `~/.flock/`：

| 路径 | 内容 |
|------|------|
| `agents.json` | agent 配置 |
| `conversations.json` | 对话元数据 |
| `messages/<id>.json` | 消息历史 |
| `tasks.json` | 任务数据 |
| `reminders.json` | 提醒数据 |
| `attachments/` | 上传的文件 |
| `agents/<id>/` | 每个 agent 的 MEMORY.md、MCP 配置、system prompt |
| `access-token` | 认证 token（每次 daemon 启动重新生成） |

## MCP Bridge 工具

每个 agent 通过 flock-bridge 获得 17 个工具：

| 工具 | 用途 |
|------|------|
| `send_message` | 给其他对话发消息 |
| `check_messages` | 检查新消息 |
| `read_history` | 读对话历史 |
| `search_messages` | 跨对话搜索 |
| `list_conversations` | 列出频道和 DM |
| `schedule_reminder` / `list_reminders` / `cancel_reminder` | 提醒管理 |
| `list_tasks` / `create_task` / `claim_task` / `unclaim_task` / `update_task_status` | 任务管理 |
| `upload_file` / `view_file` | 文件共享 |
| `leave_channel` | 离开频道 |
| `approve_action` | 权限委托（CC 内部调用） |

## 贡献者

- Kai — 三轮安全审查 + 修复（Origin/CORS、Codex 审批、权限桥白名单、持久化队列、附件内容读取等）

## License

[MIT](LICENSE) — Linek & Forge
