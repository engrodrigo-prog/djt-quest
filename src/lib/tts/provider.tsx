import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import type { TtsVoiceGender } from "./index";

type TtsContextValue = {
  enabled: boolean;
  unlocked: boolean;
  ttsEnabled: boolean;
  voiceGender: TtsVoiceGender;
  rate: number; // 0.25..2
  volume: number; // 0..1
  isSpeaking: boolean;
  setTtsEnabled: (next: boolean) => void;
  setVoiceGender: (next: TtsVoiceGender) => void;
  setRate: (next: number) => void;
  setVolume: (next: number) => void;
  speak: (text: string) => Promise<void>;
  stop: () => void;
};

const TtsContext = createContext<TtsContextValue | undefined>(undefined);

const STORAGE_ENABLED = "djt_tts_enabled";
const STORAGE_GENDER = "djt_tts_voice_gender";
const STORAGE_RATE = "djt_tts_rate";
const STORAGE_VOLUME = "djt_tts_volume";

const DEFAULTS = {
  enabled: false,
  voiceGender: "male" as TtsVoiceGender,
  rate: 1,
  volume: 1,
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const parseBool = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  }
  return null;
};

const isTtsEnabledFlag = () => {
  const raw = (import.meta as any)?.env?.NEXT_PUBLIC_TTS_ENABLED;
  if (raw == null) return true;
  const b = parseBool(raw);
  return b == null ? true : b;
};

const safeReadFromStorage = () => {
  try {
    const enabledRaw = localStorage.getItem(STORAGE_ENABLED);
    const genderRaw = localStorage.getItem(STORAGE_GENDER);
    const rateRaw = localStorage.getItem(STORAGE_RATE);
    const volumeRaw = localStorage.getItem(STORAGE_VOLUME);

    const enabledParsed = parseBool(enabledRaw);
    const voiceGender: TtsVoiceGender = genderRaw === "female" ? "female" : "male";
    const rateParsed = rateRaw == null ? NaN : Number(rateRaw);
    const volumeParsed = volumeRaw == null ? NaN : Number(volumeRaw);

    return {
      ttsEnabled: enabledParsed ?? DEFAULTS.enabled,
      voiceGender,
      rate: Number.isFinite(rateParsed) ? clamp(rateParsed, 0.25, 2) : DEFAULTS.rate,
      volume: Number.isFinite(volumeParsed) ? clamp(volumeParsed, 0, 1) : DEFAULTS.volume,
    };
  } catch {
    return { ttsEnabled: DEFAULTS.enabled, voiceGender: DEFAULTS.voiceGender, rate: DEFAULTS.rate, volume: DEFAULTS.volume };
  }
};

const safeWriteToStorage = (next: { ttsEnabled: boolean; voiceGender: TtsVoiceGender; rate: number; volume: number }) => {
  try {
    localStorage.setItem(STORAGE_ENABLED, next.ttsEnabled ? "1" : "0");
    localStorage.setItem(STORAGE_GENDER, next.voiceGender);
    localStorage.setItem(STORAGE_RATE, String(clamp(next.rate, 0.25, 2)));
    localStorage.setItem(STORAGE_VOLUME, String(clamp(next.volume, 0, 1)));
  } catch {
    /* ignore */
  }
};

export function TtsProvider({ children }: { children: React.ReactNode }) {
  const enabled = isTtsEnabledFlag();
  const { user, profile } = useAuth();
  const { locale } = useI18n();

  const initial = useMemo(() => safeReadFromStorage(), []);
  const [unlocked, setUnlocked] = useState(false);
  const [ttsEnabled, setTtsEnabledState] = useState(initial.ttsEnabled);
  const [voiceGender, setVoiceGenderState] = useState<TtsVoiceGender>(initial.voiceGender);
  const [rate, setRateState] = useState(initial.rate);
  const [volume, setVolumeState] = useState(initial.volume);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const persistToProfile = useCallback(
    async (patch: { tts_enabled?: boolean; tts_voice_gender?: TtsVoiceGender; tts_rate?: number; tts_volume?: number }) => {
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

  // Hydrate from profile preference once available (backend wins over localStorage)
  useEffect(() => {
    if (!enabled) return;
    const p = profile as any;
    if (typeof p?.tts_enabled === "boolean") setTtsEnabledState(Boolean(p.tts_enabled));
    if (p?.tts_voice_gender === "male" || p?.tts_voice_gender === "female") setVoiceGenderState(p.tts_voice_gender);
    if (typeof p?.tts_rate === "number" && Number.isFinite(p.tts_rate)) setRateState(clamp(p.tts_rate, 0.25, 2));
    if (typeof p?.tts_volume === "number" && Number.isFinite(p.tts_volume)) setVolumeState(clamp(p.tts_volume, 0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, (profile as any)?.tts_enabled, (profile as any)?.tts_voice_gender, (profile as any)?.tts_rate, (profile as any)?.tts_volume]);

  // Persist to localStorage
  useEffect(() => {
    safeWriteToStorage({ ttsEnabled, voiceGender, rate, volume });
  }, [rate, ttsEnabled, voiceGender, volume]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.src = "";
      } catch {
        /* ignore */
      }
    }
    if (isSpeaking) {
      setIsSpeaking(false);
      window.dispatchEvent(new CustomEvent("tts:end"));
    }
  }, [isSpeaking]);

  useEffect(() => () => stop(), [stop]);

  const speak = useCallback(
    async (rawText: string) => {
      const text = String(rawText || "").trim();
      if (!enabled) return;
      if (!ttsEnabled) return;
      if (!unlocked) return;
      if (!text) return;

      stop();

      const ctl = new AbortController();
      abortRef.current = ctl;
      window.dispatchEvent(new CustomEvent("tts:start"));

      setIsSpeaking(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Unauthorized");

        const resp = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text,
            locale,
            voiceGender,
            rate,
          }),
          signal: ctl.signal,
        });

        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "TTS failed");
        let url = String(json?.url || "").trim();
        if (!url) {
          const b64 = String(json?.audioBase64 || json?.audio_base64 || "").trim();
          const mime = String(json?.mime || "audio/mpeg").trim() || "audio/mpeg";
          if (b64) url = `data:${mime};base64,${b64}`;
        }
        if (!url) throw new Error("TTS missing url");

        const audio = audioRef.current || new Audio();
        audioRef.current = audio;
        audio.volume = clamp(volume, 0, 1);
        audio.src = url;

        await audio.play();
        audio.onended = () => {
          setIsSpeaking(false);
          window.dispatchEvent(new CustomEvent("tts:end"));
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          window.dispatchEvent(new CustomEvent("tts:end"));
        };
      } catch (e) {
        setIsSpeaking(false);
        window.dispatchEvent(new CustomEvent("tts:end"));
        throw e;
      } finally {
        abortRef.current = null;
      }
    },
    [enabled, locale, rate, stop, ttsEnabled, unlocked, voiceGender, volume],
  );

  const setTtsEnabled = useCallback(
    (next: boolean) => {
      setTtsEnabledState(Boolean(next));
      if (enabled) void persistToProfile({ tts_enabled: Boolean(next) });
    },
    [enabled, persistToProfile],
  );

  const setVoiceGender = useCallback(
    (next: TtsVoiceGender) => {
      const v: TtsVoiceGender = next === "female" ? "female" : "male";
      setVoiceGenderState(v);
      if (enabled) void persistToProfile({ tts_voice_gender: v });
    },
    [enabled, persistToProfile],
  );

  const setRate = useCallback(
    (next: number) => {
      const v = clamp(Number(next) || 1, 0.25, 2);
      setRateState(v);
      if (enabled) void persistToProfile({ tts_rate: v });
    },
    [enabled, persistToProfile],
  );

  const setVolume = useCallback(
    (next: number) => {
      const v = clamp(Number(next) || 0, 0, 1);
      setVolumeState(v);
      if (enabled) void persistToProfile({ tts_volume: v });
    },
    [enabled, persistToProfile],
  );

  const value = useMemo<TtsContextValue>(
    () => ({
      enabled,
      unlocked,
      ttsEnabled,
      voiceGender,
      rate,
      volume,
      isSpeaking,
      setTtsEnabled,
      setVoiceGender,
      setRate,
      setVolume,
      speak,
      stop,
    }),
    [enabled, isSpeaking, rate, speak, stop, ttsEnabled, unlocked, voiceGender, volume, setTtsEnabled, setVoiceGender, setRate, setVolume],
  );

  return <TtsContext.Provider value={value}>{children}</TtsContext.Provider>;
}

export function useTts() {
  const ctx = useContext(TtsContext);
  if (!ctx) throw new Error("useTts must be used within <TtsProvider />");
  return ctx;
}
