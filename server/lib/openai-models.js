const DEFAULT_FAST_MODEL = "gpt-4.1-mini";
const DEFAULT_PREMIUM_MODEL = "gpt-4.1";

const isChatModelName = (value) => {
  const lower = String(value || "").toLowerCase().trim();
  return lower.startsWith("gpt-") || lower.startsWith("ft:gpt-");
};

const isLikelyInvalidChatModel = (value) => {
  const lower = String(value || "").toLowerCase().trim();
  return /^(?:ft:)?gpt-5(\b|[-:.])/.test(lower);
};

const normalizeChatModel = (value, fallback = DEFAULT_FAST_MODEL) => {
  const model = String(value || "").trim();
  if (!model) return fallback;
  if (!isChatModelName(model)) return fallback;
  if (isLikelyInvalidChatModel(model)) return fallback;
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
