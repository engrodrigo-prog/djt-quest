const VERSION_URL = "/api/version";
const STORAGE_KEY = "djt_app_version";
const RELOAD_GUARD_KEY = "djt_version_reload_ts";

async function fetchVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const resp = await fetch(VERSION_URL, {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
      signal,
    });
    if (!resp.ok) return null;
    const json: any = await resp.json().catch(() => null);
    const v = String(json?.version || "").trim();
    return v || null;
  } catch {
    return null;
  }
}

function shouldReloadNow() {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
    if (now - last < 15_000) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}

async function checkAndReload() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3500);
  try {
    const remote = await fetchVersion(ctl.signal);
    if (!remote) return;

    let local = "";
    try {
      local = String(localStorage.getItem(STORAGE_KEY) || "").trim();
    } catch {
      local = "";
    }

    // First run: just persist
    if (!local) {
      try {
        localStorage.setItem(STORAGE_KEY, remote);
      } catch {
        // ignore
      }
      return;
    }

    if (local !== remote) {
      if (!shouldReloadNow()) return;
      try {
        localStorage.setItem(STORAGE_KEY, remote);
      } catch {
        // ignore
      }
      window.location.reload();
    }
  } finally {
    clearTimeout(t);
  }
}

export function installAppVersionAutoReload() {
  if (typeof window === "undefined") return;

  // Warm up once on load
  void checkAndReload();

  // Check when returning to the tab (common case for stale deployments)
  window.addEventListener("focus", () => void checkAndReload());
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkAndReload();
  });

  // Low-frequency safety net
  const interval = window.setInterval(() => void checkAndReload(), 90_000);
  return () => window.clearInterval(interval);
}

