const DEFAULT_FAST_MODEL = "gpt-5.2-fast";
const DEFAULT_PREMIUM_MODEL = "gpt-5.2";

const ALLOWED_BASE_MODELS = new Set(["gpt-5.2", "gpt-5.2-fast"]);
const isLegacyAlias = (lower) =>
  lower === "gpt-5.2-thinking" || lower.startsWith("gpt-5.2-thinking-");
const isChatModelName = (value) => {
  const lower = String(value || "").toLowerCase().trim();
  if (isLegacyAlias(lower)) return true;
  if (ALLOWED_BASE_MODELS.has(lower)) return true;
  if (lower.startsWith("ft:gpt-5.2")) return true;
  return false;
};

const normalizeChatModel = (value, fallback = DEFAULT_FAST_MODEL) => {
  const model = String(value || "").trim();
  if (!model) return fallback;
  const lower = model.toLowerCase().trim();
  if (isLegacyAlias(lower)) return "gpt-5.2";
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
