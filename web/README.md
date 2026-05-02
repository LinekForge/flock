# Flock Web

Flock 的浏览器聊天界面。它连接本机 daemon：

- WebSocket：`ws://127.0.0.1:9800`
- HTTP API：`http://127.0.0.1:9801`

前端启动后会先从 daemon 的 `/api/auth-token` 获取本机访问 token，后续 WebSocket 和 HTTP API 都带 token。daemon 只接受可信本机 Origin。

## 启动

```bash
bun install
bun run dev
```

默认端口是 `5800`。

## 验证

```bash
bun run lint
bun run build
```
