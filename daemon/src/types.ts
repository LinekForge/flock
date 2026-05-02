export interface Conversation {
  id: string;
  type: "dm" | "channel";
  name: string;
  agentIds: string[];
  defaultAgentId?: string;
  createdAt: number;
}

export interface ConversationInfo {
  id: string;
  type: "dm" | "channel";
  name: string;
  agentIds: string[];
  defaultAgentId?: string;
}

export interface SearchResult {
  conversationId: string;
  conversationName: string;
  agentId: string;
  agentName: string;
  messageType: string;
  content: string;
  timestamp: number;
  contextBefore?: string;
  contextAfter?: string;
}

export interface RouteResult {
  targetAgentIds: string[];
  cleanedText: string;
}
