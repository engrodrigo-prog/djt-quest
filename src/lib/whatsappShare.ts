export function buildWhatsAppUrl(message: string) {
  const text = String(message || "").trim();
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildAbsoluteAppUrl(pathWithQueryAndHash: string) {
  const base = typeof window !== "undefined" ? window.location.origin : "";
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

