const DEFAULT_FAST_MODEL = "gpt-5-2025-08-07";
const DEFAULT_PREMIUM_MODEL = "gpt-5-2025-08-07";

const ALLOWED_BASE_MODELS = new Set(["gpt-5-2025-08-07", "gpt-5-nano-2025-08-07"]);

const legacyAliasToModel = (lower) => {
  if (!lower) return null;
  // Keep legacy UX working when users/configs still refer to "gpt-5.2*"
  if (lower === "gpt-5.2-thinking" || lower.startsWith("gpt-5.2-thinking-")) return "gpt-5-2025-08-07";
  if (lower === "gpt-5.2") return "gpt-5-2025-08-07";
  if (lower === "gpt-5.2-fast" || lower.startsWith("gpt-5.2-fast-")) return "gpt-5-nano-2025-08-07";
  if (lower === "gpt-5.2-nano" || lower.startsWith("gpt-5.2-nano-")) return "gpt-5-nano-2025-08-07";
  return null;
};

const isLegacyAlias = (lower) => Boolean(legacyAliasToModel(lower));
const isChatModelName = (value) => {
  const lower = String(value || "").toLowerCase().trim();
  if (isLegacyAlias(lower)) return true;
  if (ALLOWED_BASE_MODELS.has(lower)) return true;
  if (lower.startsWith("ft:gpt-5-2025-08-07")) return true;
  return false;
};

const normalizeChatModel = (value, fallback = DEFAULT_FAST_MODEL) => {
  const model = String(value || "").trim();
  if (!model) return fallback;
  const lower = model.toLowerCase().trim();
  const mapped = legacyAliasToModel(lower);
  if (mapped) return mapped;
  if (!isChatModelName(model)) return fallback;
  return model;
};

const pickChatModel = (
  preferPremium,
  {
    premium,
    fast,
    fallbackFast = DEFAULT_FAST_MODEL,
    fallbackPremium = DEFAULT_PREMIUM_MODEL,
  } = {},
) => {
  const fallback = preferPremium ? fallbackPremium : fallbackFast;
  const pick = preferPremium ? premium || fast : fast || premium;
  return normalizeChatModel(pick, fallback);
};

export { DEFAULT_FAST_MODEL, DEFAULT_PREMIUM_MODEL, normalizeChatModel, pickChatModel };
