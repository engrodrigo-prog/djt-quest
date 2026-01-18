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
  status: "idle" | "loading" | "playing" | "paused";
  isSpeaking: boolean;
  isPaused: boolean;
  currentText: string | null;
  setTtsEnabled: (next: boolean) => void;
  setVoiceGender: (next: TtsVoiceGender) => void;
  setRate: (next: number) => void;
  setVolume: (next: number) => void;
  speak: (text: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  togglePause: () => void;
  stop: () => void;
};

const TtsContext = createContext<TtsContextValue | undefined>(undefined);

const STORAGE_ENABLED = "djt_tts_enabled";
const STORAGE_GENDER = "djt_tts_voice_gender";
const STORAGE_RATE = "djt_tts_rate";
const STORAGE_VOLUME = "djt_tts_volume";

const DEFAULTS = {
  // Prefer "on" by default (only plays on explicit user click).
  enabled: true,
  voiceGender: "male" as TtsVoiceGender,
  rate: 1.0,
  volume: 1,
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const isAbortError = (e: any) => Boolean(e && (e.name === "AbortError" || /aborted/i.test(String(e?.message || ""))));

const MAX_TTS_CHARS = 1800;
const CHUNK_TARGET = 1650;

const splitTextForTts = (raw: string, maxChars: number) => {
  const input = String(raw || "").trim();
  if (!input) return [];
  if (input.length <= maxChars) return [input];

  const blocks = input.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    const s = current.trim();
    if (s) chunks.push(s);
    current = "";
  };

  const addPiece = (piece: string) => {
    const p = piece.trim();
    if (!p) return;
    const joiner = current ? "\n\n" : "";
    if ((current + joiner + p).length <= maxChars) {
      current = current ? `${current}${joiner}${p}` : p;
      return;
    }
    if (current) push();
    if (p.length <= maxChars) {
      current = p;
      return;
    }
    // Hard split (very long token/sentence)
    for (let i = 0; i < p.length; i += maxChars) {
      chunks.push(p.slice(i, i + maxChars));
    }
    current = "";
  };

  for (const block of blocks) {
    // Split by sentence-ish boundaries, preserving punctuation (no lookbehind for Safari compatibility).
    const parts = block.split(/([.!?])\s+/g);
    const sentences: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const base = String(parts[i] || "").trim();
      const punct = String(parts[i + 1] || "");
      const s = (base + punct).trim();
      if (s) sentences.push(s);
    }
    if (!sentences.length) {
      addPiece(block);
      continue;
    }
    let buf = "";
    for (const s of sentences) {
      const next = buf ? `${buf} ${s}` : s;
      if (next.length <= maxChars) {
        buf = next;
      } else {
        addPiece(buf);
        buf = s;
      }
    }
    addPiece(buf);
  }

  if (current) push();
  return chunks;
};

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
  const unlockedRef = useRef(false);
  const [ttsEnabled, setTtsEnabledState] = useState(initial.ttsEnabled);
  const [voiceGender, setVoiceGenderState] = useState<TtsVoiceGender>(initial.voiceGender);
  const [rate, setRateState] = useState(initial.rate);
  const [volume, setVolumeState] = useState(initial.volume);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentText, setCurrentText] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const runIdRef = useRef(0);

  // Unlock autoplay after first user gesture (never play before that).
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => {
      unlockedRef.current = true;
      setUnlocked(true);
    };
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
        const { error } = await supabase.from("profiles").update(patch as any).eq("id", user.id);
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
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;

    const audio = audioRef.current;
    if (audio) {
      try {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.currentTime = 0;
        audio.src = "";
      } catch {
        /* ignore */
      }
    }
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      utteranceRef.current = null;
    } catch {
      /* ignore */
    }
    setIsPaused(false);
    setCurrentText(null);
    setStatus("idle");
    if (isSpeaking) {
      setIsSpeaking(false);
      window.dispatchEvent(new CustomEvent("tts:end"));
    }
  }, [isSpeaking]);

  useEffect(() => () => stop(), [stop]);

  const pause = useCallback(() => {
    try {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        audio.pause();
        setIsPaused(true);
        setStatus("paused");
        window.dispatchEvent(new CustomEvent("tts:pause"));
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.pause();
        setIsPaused(true);
        setStatus("paused");
        window.dispatchEvent(new CustomEvent("tts:pause"));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const resume = useCallback(() => {
    try {
      const audio = audioRef.current;
      if (audio && audio.paused && audio.src) {
        void audio.play();
        setIsPaused(false);
        setStatus("playing");
        window.dispatchEvent(new CustomEvent("tts:resume"));
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.resume();
        setIsPaused(false);
        setStatus("playing");
        window.dispatchEvent(new CustomEvent("tts:resume"));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const togglePause = useCallback(() => {
    if (!isSpeaking) return;
    if (isPaused) resume();
    else pause();
  }, [isPaused, isSpeaking, pause, resume]);

  const speak = useCallback(
    async (rawText: string) => {
      const text = String(rawText || "").trim();
      if (!enabled) return;
      if (!ttsEnabled) return;
      const isUnlocked = unlocked || unlockedRef.current;
      if (!isUnlocked) {
        throw new Error("Interaja com a página (toque/clique) para habilitar o áudio.");
      }
      if (!text) return;

      stop();

      const runId = runIdRef.current;
      const ctl = new AbortController();
      abortRef.current = ctl;
      window.dispatchEvent(new CustomEvent("tts:start"));

      setIsSpeaking(true);
      setIsPaused(false);
      setCurrentText(text);
      setStatus("loading");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Unauthorized");

        const fetchUrlForChunk = async (chunk: string) => {
          const resp = await fetch("/api/tts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              text: chunk,
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
          return url;
        };

        const chunks = splitTextForTts(text, Math.min(MAX_TTS_CHARS, CHUNK_TARGET));

        // Prefer server audio when available; fallback to SpeechSynthesis (no server key required).
        let serverOk = true;
        try {
          const urlPromises: Array<Promise<string> | null> = new Array(chunks.length).fill(null);
          const getUrl = (i: number) => {
            urlPromises[i] ||= fetchUrlForChunk(chunks[i]);
            return urlPromises[i] as Promise<string>;
          };

          const audio = audioRef.current || new Audio();
          audioRef.current = audio;
          audio.preload = "auto";
          (audio as any).playsInline = true;
          audio.volume = clamp(volume, 0, 1);

        const playUrl = async (url: string) => {
          if (ctl.signal.aborted || runIdRef.current !== runId) throw new DOMException("Aborted", "AbortError");
          return await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              if (runIdRef.current !== runId) return;
              try {
                audio.onended = null;
                audio.onerror = null;
              } catch {
                /* ignore */
              }
              reject(new DOMException("Aborted", "AbortError"));
            };
            const onEnded = () => {
              if (runIdRef.current !== runId) return;
              ctl.signal.removeEventListener("abort", onAbort);
              resolve();
            };
            const onError = () => {
              if (runIdRef.current !== runId) return;
              ctl.signal.removeEventListener("abort", onAbort);
              reject(new Error("Audio playback failed"));
            };
            ctl.signal.addEventListener("abort", onAbort, { once: true });
            audio.onended = onEnded;
            audio.onerror = onError;
            try {
              audio.src = url;
              audio.currentTime = 0;
              const p = audio.play();
              setStatus("playing");
              setIsPaused(false);
              if (p && typeof (p as any).catch === "function") {
                (p as any).catch((e: any) => reject(e));
              }
            } catch (e) {
              reject(e);
            }
          });
        };

          // Prefetch next chunk while playing the current one.
          for (let i = 0; i < chunks.length; i += 1) {
            setStatus("loading");
            const url = await getUrl(i);
            void (i + 1 < chunks.length ? getUrl(i + 1) : null);
            await playUrl(url);
          }

          setIsSpeaking(false);
          setIsPaused(false);
          setStatus("idle");
          window.dispatchEvent(new CustomEvent("tts:end"));
          return;
        } catch (e: any) {
          if (isAbortError(e)) throw e;
          serverOk = false;
        }

        if (!serverOk) {
          if (typeof window === "undefined" || !("speechSynthesis" in window)) {
            throw new Error("TTS indisponível neste navegador.");
          }
          const synth = window.speechSynthesis;

          const waitForVoices = async () => {
            const v = synth.getVoices();
            if (v && v.length) return v;
            await new Promise<void>((resolve) => {
              let done = false;
              const on = () => {
                if (done) return;
                done = true;
                resolve();
              };
              synth.addEventListener?.("voiceschanged", on as any, { once: true } as any);
              setTimeout(on, 350);
            });
            return synth.getVoices();
          };

          const voices = await waitForVoices();
          const targetLocale = String(locale || "").toLowerCase();
          const preferredLang = targetLocale === "en" ? "en" : targetLocale;
          const byLang = voices.filter((v) => String(v.lang || "").toLowerCase().startsWith(preferredLang));
          const pool = byLang.length ? byLang : voices;
          const isFemale = String(voiceGender || "").toLowerCase() === "female";
          const genderNeedle = isFemale ? "female" : "male";
          const voice =
            pool.find((v) => String((v as any)?.gender || "").toLowerCase() === genderNeedle) ||
            pool.find((v) => new RegExp(genderNeedle, "i").test(String(v.name || ""))) ||
            pool.find((v) => String(v.lang || "").toLowerCase().startsWith(preferredLang)) ||
            pool[0];

          const utter = new SpeechSynthesisUtterance(text);
          utteranceRef.current = utter;
          if (voice) utter.voice = voice;
          if (voice?.lang) utter.lang = voice.lang;
          utter.rate = clamp(rate, 0.25, 2);
          utter.pitch = 1.05;
          utter.volume = clamp(volume, 0, 1);
          setStatus("playing");
          utter.onend = () => {
            setIsSpeaking(false);
            setIsPaused(false);
            setStatus("idle");
            utteranceRef.current = null;
            window.dispatchEvent(new CustomEvent("tts:end"));
          };
          utter.onerror = () => {
            setIsSpeaking(false);
            setIsPaused(false);
            setStatus("idle");
            utteranceRef.current = null;
            window.dispatchEvent(new CustomEvent("tts:end"));
          };
          synth.speak(utter);
          return;
        }
      } catch (e: any) {
        if (isAbortError(e)) return;
        setIsSpeaking(false);
        setIsPaused(false);
        setStatus("idle");
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
      status,
      isSpeaking,
      isPaused,
      currentText,
      setTtsEnabled,
      setVoiceGender,
      setRate,
      setVolume,
      speak,
      pause,
      resume,
      togglePause,
      stop,
    }),
    [
      enabled,
      unlocked,
      ttsEnabled,
      voiceGender,
      rate,
      volume,
      status,
      isSpeaking,
      isPaused,
      currentText,
      setTtsEnabled,
      setVoiceGender,
      setRate,
      setVolume,
      speak,
      pause,
      resume,
      togglePause,
      stop,
    ],
  );

  return <TtsContext.Provider value={value}>{children}</TtsContext.Provider>;
}

export function useTts() {
  const ctx = useContext(TtsContext);
  if (!ctx) throw new Error("useTts must be used within <TtsProvider />");
  return ctx;
}
