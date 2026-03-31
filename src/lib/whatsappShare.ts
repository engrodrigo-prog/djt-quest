export const DJT_CANONICAL_ORIGIN = "https://djt-quest.vercel.app";
const BANNED_HOST_PATTERNS = [/(\.|^)enerlytics\.pro$/i];

export function isBannedProjectHost(hostOrUrl: string) {
  const raw = String(hostOrUrl || "").trim();
  if (!raw) return false;
  try {
    const value = raw.includes("://") ? new URL(raw).hostname : raw;
    return BANNED_HOST_PATTERNS.some((pattern) => pattern.test(String(value || "").trim()));
  } catch {
    return BANNED_HOST_PATTERNS.some((pattern) => pattern.test(raw));
  }
}

export function buildWhatsAppUrl(message: string) {
  const text = String(message || "").trim();
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function getAppOrigin() {
  return DJT_CANONICAL_ORIGIN;
}

export function buildAbsoluteAppUrl(pathWithQueryAndHash: string) {
  const base = DJT_CANONICAL_ORIGIN;
  const p = String(pathWithQueryAndHash || "");
  if (!base) return p;
  if (!p.startsWith("/")) return `${base}/${p}`;
  return `${base}${p}`;
}

export function openWhatsAppShare(params: { message: string; url?: string }) {
  try {
    const msg = String(params?.message || "").trim();
    const url = params?.url ? String(params.url).trim() : "";
    const combined = url ? `${msg}\n${url}`.trim() : msg;
    if (!combined) return;
    const waUrl = buildWhatsAppUrl(combined);
    window.open(waUrl, "_blank", "noopener,noreferrer");
  } catch {
    // ignore
  }
}
