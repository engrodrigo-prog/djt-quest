const RELOAD_GUARD_KEY = "djt_chunk_reload_ts";

function getErrorMessage(reason: unknown) {
  if (!reason) return "";
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message || "";
  try {
    const msg = (reason as any)?.message;
    return typeof msg === "string" ? msg : "";
  } catch {
    return "";
  }
}

function isLikelyChunkLoadError(reason: unknown) {
  const msg = getErrorMessage(reason);
  if (!msg) return false;
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("ChunkLoadError") ||
    (msg.includes("/assets/") && msg.includes(".js"))
  );
}

function reloadOnce(reason: string) {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
    // Evita loop de recarregamento em caso de falha persistente.
    if (now - last < 15_000) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    // ignore
  }

  try {
    // eslint-disable-next-line no-console
    console.warn("Recarregando para recuperar erro de chunk:", reason);
  } catch {
    // ignore
  }

  window.location.reload();
}

export function installChunkErrorAutoReload() {
  if (typeof window === "undefined") return;

  window.addEventListener("unhandledrejection", (event) => {
    if (!isLikelyChunkLoadError(event.reason)) return;
    reloadOnce(getErrorMessage(event.reason));
  });

  window.addEventListener(
    "error",
    (event) => {
      // Alguns navegadores não expõem o erro real (script error). Ainda assim, tente recuperar se parecer chunk.
      const anyEvent = event as any;
      const reason = anyEvent?.error || anyEvent?.message || anyEvent?.filename || "";
      if (!isLikelyChunkLoadError(reason)) return;
      reloadOnce(getErrorMessage(reason));
    },
    true,
  );
}

