# Security Policy

## 报告漏洞

发现安全问题请**不要**直接 PR 或 public issue。

**唯一报告渠道**：GitHub Security Advisory—— 到 [https://github.com/LinekForge/flock/security/advisories/new](https://github.com/LinekForge/flock/security/advisories/new) 提交 private advisory。

我们尽量在 7 天内回复，30 天内提供 fix 或缓解方案。

## 安全模型

Flock daemon 和 Web UI 是**本机进程**（绑 `127.0.0.1`）。Flock 自身的配置、消息历史、任务、提醒和附件都存储在本地文件系统。

### 模型服务数据流

Flock daemon 和 Web UI 仅在 localhost 运行。但 agent 的 prompt、工具调用结果会通过 Claude Code / Codex CLI 发送到模型提供方（Anthropic / OpenAI）。这是 CLI 工具本身的行为，不是 Flock 引入的额外远程服务。用户应了解所选模型提供方的数据政策。

### 信任边界

- **daemon** 绑定 `127.0.0.1:9800`（WebSocket）和 `127.0.0.1:9801`（HTTP API）
- **Web UI** 在 `localhost:5800`
- **认证**：每次启动生成 session token + Origin 白名单 + loopback 校验
- **path-guard**：Flock 代码禁止写 `~/.claude/`
- **agent 隔离**：daemon 生成 agent ID，写入前断言路径在 `~/.flock/agents/` 内，防止路径穿越
- **权限审批**：Edit / Write / MultiEdit / Bash / NotebookEdit 等写入或执行类工具通过 `--permission-prompt-tool` 委托给 UI 审批；明确只读工具和 MCP 工具自动放行

### 已知限制

- `~/.flock/` 数据未加密存储
- 无多用户认证（仅单用户 localhost）
- Claude Code 子进程继承用户的完整文件系统权限
- 同机其他进程理论上可访问 daemon API（单用户 Mac 场景风险低）
