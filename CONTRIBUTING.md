# Contributing to Flock

谢谢想 contribute！下面是基本约定。

## 本地开发

```bash
git clone https://github.com/LinekForge/flock.git
cd flock

# 安装
cd daemon && bun install
cd ../web && bun install
```

## 启动

```bash
# 终端 1：daemon
cd daemon && bun run src/index.ts

# 终端 2：Web UI
cd web && bun run dev

# 打开 http://localhost:5800
```

## 改动验证

| 改动范围 | 验证方式 |
|----------|----------|
| `daemon/src/` | `cd daemon && bunx tsc --noEmit` + 本地启动测试 |
| `web/src/` | `cd web && npx tsc --noEmit` + 浏览器验证 |
| 全量 | daemon + web 都启动，创建 agent，发消息，测群聊 |

## PR 流程

1. Fork
2. 建分支（`git checkout -b my-feature`）
3. 改动 + 本地验证
4. commit message 写清楚改了什么、为什么
5. Push + 开 PR

## 代码风格

- 全 TypeScript
- 不写注释，除非 why 不显而易见
- 一个 PR 一个功能或修复

## 安全问题

请通过 [GitHub Security Advisory](https://github.com/LinekForge/flock/security/advisories/new) 报告，不要发在 public issue 里。详见 [SECURITY.md](SECURITY.md)。
