import { randomBytes } from "crypto";
import { chmod } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { safeWriteFile as writeFile, safeMkdir as mkdir } from "./path-guard.js";

const DATA_DIR = join(homedir(), ".flock");
const TOKEN_FILE = join(DATA_DIR, "access-token");

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5800",
  "http://127.0.0.1:5800",
]);

export async function createAccessToken(): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, token);
  await chmod(TOKEN_FILE, 0o600).catch(() => {});
  return token;
}

export function isAllowedOrigin(origin: string | null): boolean {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

export function isLocalAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function authMatches(header: string | null, token: string): boolean {
  return header === `Bearer ${token}`;
}

export function corsHeaders(origin: string | null): HeadersInit {
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    Vary: "Origin",
  };
}
