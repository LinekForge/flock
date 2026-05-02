const AGENT_NAME_CHAR_PATTERN = /^[A-Za-z0-9_\-\u4E00-\u9FFF]$/u;
const AGENT_NAME_PATTERN = /^[A-Za-z0-9_\-\u4E00-\u9FFF]+$/u;

export function sanitizeAgentNameInput(value: string) {
  return Array.from(value).filter((ch) => AGENT_NAME_CHAR_PATTERN.test(ch)).join("");
}

export function isValidAgentName(value: string) {
  return AGENT_NAME_PATTERN.test(value.trim());
}
