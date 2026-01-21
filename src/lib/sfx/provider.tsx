import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { SfxEvent } from "./index";

type SfxContextValue = {
  enabled: boolean;
  unlocked: boolean;
  muted: boolean;
  volume: number; // 0..1
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  play: (event: SfxEvent) => void;
};

const SfxContext = createContext<SfxContextValue | undefined>(undefined);

const STORAGE_MUTED = "djt_sfx_muted";
const STORAGE_VOLUME = "djt_sfx_volume";
const DEFAULT_VOLUME = 0.6;
const POOL_SIZE = 4;
const DUCKING_FACTOR = 0.18;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const parseBool = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  }
  return null;
};

const isSfxEnabledFlag = () => {
  const raw = (import.meta as any)?.env?.VITE_SFX_ENABLED;
  if (raw == null) return false;
  const b = parseBool(raw);
  return b == null ? false : b;
};

const safeReadFromStorage = () => {
  try {
    const mutedRaw = localStorage.getItem(STORAGE_MUTED);
    const volumeRaw = localStorage.getItem(STORAGE_VOLUME);

    const mutedParsed = parseBool(mutedRaw);
    const volumeParsed = volumeRaw == null ? NaN : Number(volumeRaw);

    return {
      muted: mutedParsed ?? false,
      volume: Number.isFinite(volumeParsed) ? clamp01(volumeParsed) : DEFAULT_VOLUME,
    };
  } catch {
    return { muted: false, volume: DEFAULT_VOLUME };
  }
};

const safeWriteToStorage = (next: { muted: boolean; volume: number }) => {
  try {
    localStorage.setItem(STORAGE_MUTED, next.muted ? "1" : "0");
    localStorage.setItem(STORAGE_VOLUME, String(clamp01(next.volume)));
  } catch {
    /* ignore */
  }
};

const canPlayOggVorbis = () => {
  try {
    const audio = document.createElement("audio");
    const v = audio.canPlayType('audio/ogg; codecs="vorbis"');
    return v === "probably" || v === "maybe";
  } catch {
    return false;
  }
};

const isDisabledEl = (el: Element) => {
  if (!el) return true;
  const ariaDisabled = (el as HTMLElement).getAttribute?.("aria-disabled");
  if (ariaDisabled === "true") return true;
  if (el instanceof HTMLButtonElement) return el.disabled;
  if (el instanceof HTMLInputElement) return el.disabled;
  return false;
};

export function SfxProvider({ children }: { children: React.ReactNode }) {
  const enabled = isSfxEnabledFlag();
  const { user, profile } = useAuth();

  const [unlocked, setUnlocked] = useState(false);
  const [muted, setMutedState] = useState(() => safeReadFromStorage().muted);
  const [volume, setVolumeState] = useState(() => safeReadFromStorage().volume);
  const [ducked, setDucked] = useState(false);

  const extRef = useRef<"ogg" | "mp3">(canPlayOggVorbis() ? "ogg" : "mp3");
  const poolsRef = useRef<Record<SfxEvent, HTMLAudioElement[]>>({} as any);
  const rrIndexRef = useRef<Record<SfxEvent, number>>({} as any);

  const effectiveVolume = clamp01((muted ? 0 : volume) * (ducked ? DUCKING_FACTOR : 1));

  useEffect(() => {
    if (!enabled) return;
    extRef.current = canPlayOggVorbis() ? "ogg" : "mp3";
  }, [enabled]);

  // Unlock autoplay after first user gesture (never play before that).
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => setUnlocked(true);
    window.addEventListener("pointerdown", unlock, { capture: true, once: true });
    window.addEventListener("keydown", unlock, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true } as any);
      window.removeEventListener("keydown", unlock, { capture: true } as any);
    };
  }, [enabled]);

  // Duck SFX while TTS plays (integration via window events for now)
  useEffect(() => {
    const onStart = () => setDucked(true);
    const onEnd = () => setDucked(false);
    window.addEventListener("tts:start", onStart as any);
    window.addEventListener("tts:end", onEnd as any);
    return () => {
      window.removeEventListener("tts:start", onStart as any);
      window.removeEventListener("tts:end", onEnd as any);
    };
  }, []);

  // Hydrate from profile preference once available (backend wins over localStorage)
  useEffect(() => {
    if (!enabled) return;
    const nextMuted = typeof (profile as any)?.sfx_muted === "boolean" ? Boolean((profile as any).sfx_muted) : null;
    const nextVolRaw = (profile as any)?.sfx_volume;
    const nextVol = typeof nextVolRaw === "number" && Number.isFinite(nextVolRaw) ? clamp01(nextVolRaw) : null;

    if (nextMuted != null) setMutedState(nextMuted);
    if (nextVol != null) setVolumeState(nextVol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, (profile as any)?.sfx_muted, (profile as any)?.sfx_volume]);

  // Persist to localStorage
  useEffect(() => {
    safeWriteToStorage({ muted, volume });
  }, [muted, volume]);

  const persistToProfile = useCallback(
    async (patch: { sfx_muted?: boolean; sfx_volume?: number }) => {
      if (!user) return;
      try {
        const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
        if (error) throw error;
      } catch {
        /* ignore */
      }
    },
    [user],
  );

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(Boolean(next));
      if (enabled) void persistToProfile({ sfx_muted: Boolean(next) });
    },
    [enabled, persistToProfile],
  );

  const setVolume = useCallback(
    (next: number) => {
      const v = clamp01(Number(next) || 0);
      setVolumeState(v);
      if (enabled) void persistToProfile({ sfx_volume: v });
    },
    [enabled, persistToProfile],
  );

  const ensurePool = useCallback(
    (event: SfxEvent) => {
      if (!enabled) return [];
      if (!unlocked) return [];

      const existing = poolsRef.current[event];
      if (existing?.length) return existing;

      const ext = extRef.current;
      const src = `/sfx/${event}.${ext}`;

      const pool: HTMLAudioElement[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.volume = effectiveVolume;
        pool.push(audio);
      }
      poolsRef.current[event] = pool;
      rrIndexRef.current[event] = 0;
      return pool;
    },
    [effectiveVolume, enabled, unlocked],
  );

  // Keep pool volumes in sync with global settings
  useEffect(() => {
    for (const pool of Object.values(poolsRef.current)) {
      for (const audio of pool) audio.volume = effectiveVolume;
    }
  }, [effectiveVolume]);

  const play = useCallback(
    (event: SfxEvent) => {
      if (!enabled) return;
      if (!unlocked) return;
      if (effectiveVolume <= 0) return;

      const pool = ensurePool(event);
      if (!pool.length) return;

      const idx = rrIndexRef.current[event] || 0;
      rrIndexRef.current[event] = (idx + 1) % pool.length;
      const audio = pool[idx];

      try {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = effectiveVolume;
        const p = audio.play();
        if (p && typeof (p as any).catch === "function") {
          (p as any).catch(() => {
            /* ignore */
          });
        }
      } catch {
        /* ignore */
      }
    },
    [effectiveVolume, enabled, ensurePool, unlocked],
  );

  // Global click/select SFX (best-effort, does not change business logic)
  useEffect(() => {
    if (!enabled) return;
    if (!unlocked) return;
    if (effectiveVolume <= 0) return;

    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest?.('[data-sfx="none"]')) return;

      const clickable = target.closest?.('button, a, [role="button"], input[type="button"], input[type="submit"]');
      if (!clickable) return;
      if (isDisabledEl(clickable)) return;

      play("click");
    };

    const onChange = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest?.('[data-sfx="none"]')) return;

      const el =
        target.closest?.('input[type="radio"], input[type="checkbox"], select, [role="radio"], [role="checkbox"]') || null;
      if (!el) return;
      if (isDisabledEl(el)) return;

      play("select");
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
    };
  }, [effectiveVolume, enabled, play, unlocked]);

  const value = useMemo<SfxContextValue>(
    () => ({ enabled, unlocked, muted, volume, setMuted, setVolume, play }),
    [enabled, muted, play, setMuted, setVolume, unlocked, volume],
  );

  return <SfxContext.Provider value={value}>{children}</SfxContext.Provider>;
}

export function useSfx() {
  const ctx = useContext(SfxContext);
  if (!ctx) throw new Error("useSfx must be used within <SfxProvider />");
  return ctx;
}
