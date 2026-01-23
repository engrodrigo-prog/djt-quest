import { isExternalProfile } from "@/lib/profileCompletion";

export type ParsedPhone = {
  country: string;
  area: string;
  subscriber: string;
};

export function parsePhoneInput(raw: string): ParsedPhone | null {
  const input = String(raw ?? "").trim();
  const digits = input.replace(/\D+/g, "");
  if (!digits) return null;

  let normalizedDigits = digits;
  if (!input.startsWith("+") && digits.length === 11) {
    normalizedDigits = `55${digits}`;
  }

  const countryLen = normalizedDigits.length - 11;
  if (countryLen < 1 || countryLen > 3) return null;

  const country = normalizedDigits.slice(0, countryLen);
  const area = normalizedDigits.slice(countryLen, countryLen + 2);
  const subscriber = normalizedDigits.slice(countryLen + 2);
  if (!/^\d{1,3}$/.test(country) || !/^\d{2}$/.test(area) || !/^\d{9}$/.test(subscriber)) return null;
  return { country, area, subscriber };
}

export function formatPhone(p: ParsedPhone): string {
  const a = p.subscriber.slice(0, 5);
  const b = p.subscriber.slice(5);
  return `+${p.country} ${p.area} ${a}-${b}`;
}

export function normalizePhone(raw: string): string | null {
  const parsed = parsePhoneInput(raw);
  return parsed ? formatPhone(parsed) : null;
}

export const PHONE_CONFIRM_REQUIRED_AFTER = '2026-01-11T00:00:00.000Z';

export function requiresPhoneConfirmation(profile: any, roles?: unknown): boolean {
  if (!profile) return false;
  // Convidados/externos: não bloquear acesso por confirmação de WhatsApp.
  if (isExternalProfile(profile, roles)) return false;
  const confirmedAt = profile.phone_confirmed_at ? Date.parse(String(profile.phone_confirmed_at)) : NaN;
  const cutoff = Date.parse(PHONE_CONFIRM_REQUIRED_AFTER);
  return !Number.isFinite(confirmedAt) || confirmedAt < cutoff;
}
