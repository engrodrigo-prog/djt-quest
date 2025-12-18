import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import ptBR from "../../locales/pt-BR.json";

export type Locale = "pt-BR" | "en" | "zh-CN";

export const SUPPORTED_LOCALES: readonly Locale[] = ["pt-BR", "en", "zh-CN"] as const;
export const DEFAULT_LOCALE: Locale = "pt-BR";

const LOCALE_STORAGE_KEY = "djt_locale";

type DictValue = string | number | boolean | null | Dict | DictValue[];
type Dict = Record<string, DictValue>;

type TranslateParams = Record<string, string | number | boolean | null | undefined>;

type I18nContextType = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, params?: TranslateParams) => string;
  enabled: boolean;
  isLoading: boolean;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const isSupportedLocale = (value: any): value is Locale => SUPPORTED_LOCALES.includes(value);

const normalizeLocale = (value: any): Locale => (isSupportedLocale(value) ? value : DEFAULT_LOCALE);

const getFromStorage = (): Locale => {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
};

const setToStorage = (locale: Locale) => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
};

const getNested = (dict: Dict, key: string): DictValue | undefined => {
  const parts = key.split(".").filter(Boolean);
  let cur: any = dict;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as any)[p];
  }
  return cur as any;
};

const formatTemplate = (template: string, params?: TranslateParams) => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = params[k];
    if (v == null) return "";
    return String(v);
  });
};

const loadLocaleDict = async (locale: Locale): Promise<Dict> => {
  if (locale === "pt-BR") return ptBR as Dict;

  if (locale === "en") {
    const mod = await import("../../locales/en.json");
    return (mod.default || mod) as Dict;
  }
  if (locale === "zh-CN") {
    const mod = await import("../../locales/zh-CN.json");
    return (mod.default || mod) as Dict;
  }
  return ptBR as Dict;
};

const isI18nEnabled = () => {
  const raw = (import.meta as any)?.env?.NEXT_PUBLIC_I18N_ENABLED;
  if (raw == null) return true;
  const s = String(raw).trim().toLowerCase();
  if (!s) return true;
  return !(s === "0" || s === "false" || s === "off" || s === "no");
};

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const enabled = isI18nEnabled();
  const { user, profile } = useAuth();
  const [locale, setLocaleState] = useState<Locale>(() => getFromStorage());
  const [dict, setDict] = useState<Dict>(() => ptBR as Dict);
  const [isLoading, setIsLoading] = useState(false);
  const inFlightRef = useRef(0);

  // Keep <html lang="..."> in sync
  useEffect(() => {
    try {
      document.documentElement.lang = locale;
    } catch {
      /* ignore */
    }
  }, [locale]);

  // Hydrate locale from profile once available (backend preference wins over localStorage)
  useEffect(() => {
    const next = normalizeLocale((profile as any)?.locale);
    if (!enabled) return;
    if (!next) return;
    if (next === locale) return;
    setLocaleState(next);
    setToStorage(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, (profile as any)?.locale]);

  // Load dict on locale change (lazy-load only active language; pt-BR is embedded fallback)
  useEffect(() => {
    if (!enabled) return;
    const current = ++inFlightRef.current;
    setIsLoading(true);
    loadLocaleDict(locale)
      .then((next) => {
        if (inFlightRef.current !== current) return;
        setDict(next);
      })
      .catch(() => {
        if (inFlightRef.current !== current) return;
        setDict(ptBR as Dict);
      })
      .finally(() => {
        if (inFlightRef.current !== current) return;
        setIsLoading(false);
      });
  }, [enabled, locale]);

  const persistLocaleToProfile = useCallback(
    async (next: Locale) => {
      if (!user) return;
      try {
        // Profiles RLS allows self-update; keep it best-effort
        const { error } = await supabase.from("profiles").update({ locale: next }).eq("id", user.id);
        if (error) throw error;
      } catch {
        /* ignore */
      }
    },
    [user]
  );

  const setLocale = useCallback(
    (nextRaw: Locale) => {
      const next = normalizeLocale(nextRaw);
      setLocaleState(next);
      setToStorage(next);
      if (enabled) void persistLocaleToProfile(next);
    },
    [enabled, persistLocaleToProfile]
  );

  const t = useCallback(
    (key: string, params?: TranslateParams) => {
      if (!enabled) {
        const fallback = getNested(ptBR as Dict, key);
        return typeof fallback === "string" ? formatTemplate(fallback, params) : String(fallback ?? key);
      }

      const raw = getNested(dict, key);
      if (typeof raw === "string") return formatTemplate(raw, params);
      const fallback = getNested(ptBR as Dict, key);
      if (typeof fallback === "string") return formatTemplate(fallback, params);
      return String(raw ?? fallback ?? key);
    },
    [dict, enabled]
  );

  const value = useMemo<I18nContextType>(
    () => ({ locale, setLocale, t, enabled, isLoading }),
    [enabled, isLoading, locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider />");
  return ctx;
}
