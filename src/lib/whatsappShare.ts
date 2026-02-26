export function buildWhatsAppUrl(message: string) {
  const text = String(message || "").trim();
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function getAppOrigin() {
  const envOriginRaw = (import.meta as any).env?.VITE_APP_ORIGIN;
  const envOrigin = String(envOriginRaw || "").trim().replace(/\/+$/, "");
  if (envOrigin) return envOrigin;
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function buildAbsoluteAppUrl(pathWithQueryAndHash: string) {
  const base = getAppOrigin();
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
