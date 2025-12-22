import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/contexts/I18nContext";

const isSupported = (value: any): value is Locale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(String(value));

export const getActiveLocale = (): Locale => {
  try {
    const lang = (globalThis as any)?.document?.documentElement?.lang;
    if (isSupported(lang)) return lang;
  } catch {
    // ignore
  }

  try {
    const stored = (globalThis as any)?.localStorage?.getItem("djt_locale");
    if (isSupported(stored)) return stored;
  } catch {
    // ignore
  }

  return DEFAULT_LOCALE;
};

