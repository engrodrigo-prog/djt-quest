import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "djt_app_version";
const CHECK_COOLDOWN_MS = 20_000;

async function readServerVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const resp = await fetch("/api/version", { cache: "no-store", signal });
    const json = await resp.json().catch(() => ({} as any));
    const v = String(json?.version || "").trim();
    return v || null;
  } catch {
    return null;
  }
}

async function clearCacheStorageBestEffort() {
  try {
    if (typeof caches === "undefined" || !caches?.keys) return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }
}

export function RouteRefreshManager() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const lastCheckRef = useRef<number>(0);
  const lastPathRef = useRef<string>("");

  useEffect(() => {
    const path = `${location.pathname}${location.search}${location.hash}`;
    if (lastPathRef.current === path) return;
    lastPathRef.current = path;

    // Soft refresh for in-memory caches (does not touch auth/localStorage).
    try {
      queryClient.invalidateQueries();
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new CustomEvent("djt-soft-refresh"));
    } catch {
      /* ignore */
    }

    const now = Date.now();
    if (now - lastCheckRef.current < CHECK_COOLDOWN_MS) return;
    lastCheckRef.current = now;

    const controller = new AbortController();
    (async () => {
      const serverVersion = await readServerVersion(controller.signal);
      if (!serverVersion) return;
      let localVersion: string | null = null;
      try {
        localVersion = sessionStorage.getItem(STORAGE_KEY);
      } catch {
        localVersion = null;
      }

      if (!localVersion) {
        try {
          sessionStorage.setItem(STORAGE_KEY, serverVersion);
        } catch {
          /* ignore */
        }
        return;
      }

      if (localVersion !== serverVersion) {
        try {
          await clearCacheStorageBestEffort();
        } finally {
          try {
            sessionStorage.setItem(STORAGE_KEY, serverVersion);
          } catch {
            /* ignore */
          }
          window.location.reload();
        }
      }
    })();

    return () => controller.abort();
  }, [location.hash, location.pathname, location.search, queryClient]);

  return null;
}

