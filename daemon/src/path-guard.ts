import { writeFile as _writeFile, mkdir as _mkdir } from "fs/promises";
import { resolve, sep } from "path";
import { homedir } from "os";

const PROTECTED_DIR = resolve(homedir(), ".claude");

function assertSafe(targetPath: string) {
  const resolved = resolve(targetPath);
  if (resolved === PROTECTED_DIR || resolved.startsWith(PROTECTED_DIR + sep)) {
    throw new Error(`[path-guard] BLOCKED: attempted write to protected path: ${resolved}`);
  }
}

export async function safeWriteFile(path: string, data: string | Buffer) {
  assertSafe(path);
  return _writeFile(path, data);
}

export async function safeMkdir(path: string, options?: { recursive?: boolean }) {
  assertSafe(path);
  return _mkdir(path, options);
}
