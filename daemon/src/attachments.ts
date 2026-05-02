import { readFile } from "fs/promises";
import { safeWriteFile as writeFile, safeMkdir as mkdir } from "./path-guard.js";
import { join } from "path";
import { homedir } from "os";

const ATTACHMENTS_DIR = join(homedir(), ".flock", "attachments");
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const TEXT_PREVIEW_BYTES = 50 * 1024;
const FALLBACK_MIME_TYPE = "application/octet-stream";

export interface AttachmentMeta {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: number;
}

const metaCache = new Map<string, AttachmentMeta>();

export function estimateBase64DecodedSize(data: string): number {
  const normalized = data.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || "attachment";
  const cleaned = base
    .replace(/[\x00-\x1F\x7F"]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned || "attachment";
}

export function normalizeMimeType(mimeType: string): string {
  const clean = mimeType.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(clean)
    ? clean
    : FALLBACK_MIME_TYPE;
}

export function isTextLikeMimeType(mimeType: string): boolean {
  const clean = normalizeMimeType(mimeType);
  return clean.startsWith("text/")
    || clean === "application/json"
    || clean === "application/xml"
    || clean === "application/javascript"
    || clean === "application/typescript"
    || clean === "application/x-yaml"
    || clean === "application/yaml"
    || clean.endsWith("+json")
    || clean.endsWith("+xml");
}

export async function init() {
  await mkdir(ATTACHMENTS_DIR, { recursive: true });
}

export async function store(
  data: Buffer | string,
  fileName: string,
  mimeType: string,
  uploadedBy: string,
): Promise<AttachmentMeta> {
  await init();
  if (typeof data === "string" && estimateBase64DecodedSize(data) > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`);
  }
  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const safeFileName = sanitizeFileName(fileName);
  const safeMimeType = normalizeMimeType(mimeType || FALLBACK_MIME_TYPE);
  const ext = safeFileName.includes(".") ? "." + safeFileName.split(".").pop() : "";
  const storedName = id + ext;
  const buf = typeof data === "string" ? Buffer.from(data, "base64") : data;
  if (buf.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`);
  }

  await writeFile(join(ATTACHMENTS_DIR, storedName), buf);

  const meta: AttachmentMeta = {
    id,
    fileName: safeFileName,
    mimeType: safeMimeType,
    size: buf.length,
    uploadedBy,
    uploadedAt: Date.now(),
  };

  await writeFile(join(ATTACHMENTS_DIR, id + ".meta.json"), JSON.stringify(meta, null, 2));
  metaCache.set(id, meta);
  return meta;
}

export async function getMeta(id: string): Promise<AttachmentMeta | null> {
  if (metaCache.has(id)) return metaCache.get(id)!;
  try {
    const data = await readFile(join(ATTACHMENTS_DIR, id + ".meta.json"), "utf-8");
    const meta: AttachmentMeta = JSON.parse(data);
    metaCache.set(id, meta);
    return meta;
  } catch {
    return null;
  }
}

export async function getData(id: string): Promise<{ data: Buffer; meta: AttachmentMeta } | null> {
  const meta = await getMeta(id);
  if (!meta) return null;
  const ext = meta.fileName.includes(".") ? "." + meta.fileName.split(".").pop() : "";
  try {
    const data = await readFile(join(ATTACHMENTS_DIR, id + ext));
    return { data, meta };
  } catch {
    return null;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
