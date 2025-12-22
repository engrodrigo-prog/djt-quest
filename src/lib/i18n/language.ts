import type { Locale } from "@/contexts/I18nContext";

export const localeToSpeechLanguage = (locale: Locale): "pt" | "en" | "zh" => {
  if (locale === "pt-BR") return "pt";
  if (locale === "zh-CN") return "zh";
  return "en";
};

export const localeToOpenAiLanguageTag = (locale: Locale): string => locale;

