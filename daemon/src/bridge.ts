#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DAEMON_URL = process.env.FLOCK_DAEMON_URL || "http://127.0.0.1:9801";
const AGENT_ID = process.env.FLOCK_AGENT_ID || "";
const AUTH_TOKEN = process.env.FLOCK_AUTH_TOKEN || "";

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
      ...(AGENT_ID ? { "X-Flock-Agent-Id": AGENT_ID } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const server = new McpServer({
  name: "flock-bridge",
  version: "0.1.0",
});

server.tool(
  "send_message",
  "Send a message to a DIFFERENT conversation. Only use this when you want to proactively message another channel or DM. If you're replying in your current conversation, just reply directly — no need to call this tool.",
  {
    conversationId: z.string().describe("The conversation ID to send to"),
    text: z.string().describe("The message text to send"),
    replyToMsgId: z.string().optional().describe("Message ID to reply to (for threading context)"),
  },
  async ({ conversationId, text, replyToMsgId }) => {
    const result = await api("POST", "/api/send", { conversationId, text, agentId: AGENT_ID, replyToMsgId });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "check_messages",
  "Check for new messages in a conversation since a given timestamp.",
  {
    conversationId: z.string().describe("The conversation ID to check"),
    since: z.number().optional().describe("Timestamp (ms) to check from. Omit for latest messages."),
  },
  async ({ conversationId, since }) => {
    const result = await api("GET", `/api/messages/${conversationId}?since=${since || 0}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "read_history",
  "Read the conversation history (recent messages).",
  {
    conversationId: z.string().describe("The conversation ID"),
    limit: z.number().optional().describe("Number of messages to read (default 20)"),
  },
  async ({ conversationId, limit }) => {
    const result = await api("GET", `/api/history/${conversationId}?limit=${limit || 20}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "search_messages",
  "Search across all conversations for messages matching a query.",
  {
    query: z.string().describe("Search query"),
  },
  async ({ query }) => {
    const result = await api("GET", `/api/search?q=${encodeURIComponent(query)}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "list_conversations",
  "List all conversations (channels and DMs) with their members.",
  {},
  async () => {
    const result = await api("GET", "/api/conversations");
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "schedule_reminder",
  "Schedule a reminder that will be delivered after a delay.",
  {
    content: z.string().describe("Reminder content"),
    delayMs: z.number().describe("Delay in milliseconds before the reminder fires"),
  },
  async ({ content, delayMs }) => {
    const result = await api("POST", "/api/reminders", { agentId: AGENT_ID, content, delayMs });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "list_reminders",
  "List all active reminders.",
  {},
  async () => {
    const result = await api("GET", `/api/reminders?agentId=${AGENT_ID}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "cancel_reminder",
  "Cancel a scheduled reminder.",
  {
    reminderId: z.string().describe("The reminder ID to cancel"),
  },
  async ({ reminderId }) => {
    const result = await api("DELETE", `/api/reminders/${reminderId}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "list_tasks",
  "List all tasks, optionally filtered by conversation.",
  {
    conversationId: z.string().optional().describe("Filter by conversation ID"),
  },
  async ({ conversationId }) => {
    const q = conversationId ? `?convId=${conversationId}` : "";
    const result = await api("GET", `/api/tasks${q}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "create_task",
  "Create a new task.",
  {
    title: z.string().describe("Task title"),
    description: z.string().optional().describe("Task description"),
    conversationId: z.string().optional().describe("Associated conversation"),
  },
  async ({ title, description, conversationId }) => {
    const result = await api("POST", "/api/tasks", { title, description, conversationId, createdBy: AGENT_ID });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "claim_task",
  "Claim a task (assign it to yourself).",
  {
    taskId: z.string().describe("Task ID to claim"),
  },
  async ({ taskId }) => {
    const result = await api("POST", "/api/tasks/claim", { taskId, agentId: AGENT_ID });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "unclaim_task",
  "Unclaim a task (remove yourself from it).",
  {
    taskId: z.string().describe("Task ID to unclaim"),
  },
  async ({ taskId }) => {
    const result = await api("POST", "/api/tasks/unclaim", { taskId });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "update_task_status",
  "Update the status of a task.",
  {
    taskId: z.string().describe("Task ID"),
    status: z.enum(["todo", "in_progress", "in_review", "done"]).describe("New status"),
  },
  async ({ taskId, status }) => {
    const result = await api("POST", "/api/tasks/update-status", { taskId, status });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "upload_file",
  "Upload a file to make it available to other agents. Returns an attachment ID.",
  {
    fileName: z.string().describe("File name"),
    data: z.string().describe("Base64-encoded file data"),
    mimeType: z.string().optional().describe("MIME type (default: application/octet-stream)"),
  },
  async ({ fileName, data, mimeType }) => {
    const result = await api("POST", "/api/upload", {
      fileName,
      data,
      mimeType: mimeType || "application/octet-stream",
      uploadedBy: AGENT_ID,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "view_file",
  "View an uploaded attachment by ID. Returns content for text files and metadata for binary files.",
  {
    attachmentId: z.string().describe("The attachment ID"),
  },
  async ({ attachmentId }) => {
    const result = await api("GET", `/api/attachment-meta/${attachmentId}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

server.tool(
  "leave_channel",
  "Leave a channel. Use this when you don't want to participate in a conversation anymore.",
  {
    conversationId: z.string().describe("The channel ID to leave"),
  },
  async ({ conversationId }) => {
    const result = await api("POST", "/api/leave-channel", { conversationId, agentId: AGENT_ID });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

const READ_ONLY_TOOLS = new Set([
  "Read", "Grep", "Glob", "LS", "WebSearch", "WebFetch",
  "Agent", "TodoRead", "NotebookRead", "Monitor",
  "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskOutput",
]);

server.tool(
  "approve_action",
  "Permission approval tool — called by CC when a tool requires user approval. Do not call this directly.",
  {
    tool_name: z.string().describe("The tool requesting permission"),
    input: z.record(z.string(), z.unknown()).describe("The tool input"),
    tool_use_id: z.string().optional().describe("The tool use request ID"),
  },
  async ({ tool_name, input, tool_use_id }) => {
    const allow = { content: [{ type: "text" as const, text: JSON.stringify({ behavior: "allow", updatedInput: {} }) }] };

    if (tool_name.startsWith("mcp__flock-bridge__")) return allow;
    if (READ_ONLY_TOOLS.has(tool_name)) return allow;

    const result = await api("POST", "/api/approval-request", {
      agentId: AGENT_ID,
      toolName: tool_name,
      input,
      toolUseId: tool_use_id,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
