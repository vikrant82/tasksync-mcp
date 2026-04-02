import type { ImageAttachment } from "./session-state-store.js";

export function formatFeedbackResponse(content: string, images?: ImageAttachment[]): { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] } {
  const blocks: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
  blocks.push({ type: "text", text: content });
  if (images && images.length > 0) {
    for (const img of images) {
      blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }
  return { content: blocks };
}

export function normalizeAlias(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function inferAliasFromInitializeBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object") return "";
  const clientInfo = (params as { clientInfo?: unknown }).clientInfo;
  if (!clientInfo || typeof clientInfo !== "object") return "";

  const name = normalizeAlias((clientInfo as { name?: unknown }).name);
  const version = normalizeAlias((clientInfo as { version?: unknown }).version);
  if (!name) return "";
  return version ? `${name} ${version}` : name;
}

export function slugifyForSessionId(clientAlias: string): string {
  const namePart = clientAlias.split(/\s+/)[0] || "session";
  return namePart.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "session";
}
