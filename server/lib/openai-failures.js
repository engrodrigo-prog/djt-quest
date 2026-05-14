const safeJsonParse = (text) => {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const extractMessage = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parsed = safeJsonParse(text);
  if (!parsed) return text;
  const msg =
    (typeof parsed?.error?.message === "string" && parsed.error.message) ||
    (typeof parsed?.message === "string" && parsed.message) ||
    (typeof parsed?.error_description === "string" && parsed.error_description) ||
    (typeof parsed?.error === "string" && parsed.error) ||
    "";
  return String(msg || text).trim();
};

const clamp = (text, max = 320) => {
  const s = String(text || "");
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 3))}...`;
};

export function classifyOpenAiFailure(raw) {
  const extracted = extractMessage(raw);
  const message = extracted || "IA indisponível no momento. Tente novamente mais tarde.";
  const lower = message.toLowerCase();

  if (
    lower.includes("insufficient_quota") ||
    lower.includes("exceeded your current quota") ||
    (lower.includes("quota") && lower.includes("openai"))
  ) {
    return {
      code: "quota_exceeded",
      message: "IA indisponível: quota da OpenAI esgotada (sem créditos).",
      raw: clamp(message, 480),
    };
  }

  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return {
      code: "rate_limited",
      message: "IA com muitas requisições no momento. Tente novamente em instantes.",
      raw: clamp(message, 480),
    };
  }

  if (
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid_api_key")
  ) {
    return {
      code: "invalid_api_key",
      message: "IA não configurada: OPENAI_API_KEY inválida ou revogada.",
      raw: clamp(message, 480),
    };
  }

  if (lower.includes("unsupported parameter")) {
    return {
      code: "unsupported_parameter",
      message: "Configuração de IA incompatível com o modelo (parâmetro não suportado).",
      raw: clamp(message, 480),
    };
  }

  if (
    lower.includes("model_not_found") ||
    (lower.includes("model") &&
      (lower.includes("does not exist") || lower.includes("not found") || lower.includes("invalid") || lower.includes("permission")))
  ) {
    return {
      code: "model",
      message: "Modelo de IA inválido ou sem permissão no projeto.",
      raw: clamp(message, 480),
    };
  }

  if (lower.includes("context_length_exceeded") || lower.includes("maximum context length")) {
    return {
      code: "context_length_exceeded",
      message: "Conteúdo grande demais para a IA. Reduza o texto/anexo e tente novamente.",
      raw: clamp(message, 480),
    };
  }

  if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("abort")) {
    return {
      code: "timeout",
      message: "Tempo esgotado ao chamar a IA. Tente novamente.",
      raw: clamp(message, 480),
    };
  }

  return { code: "unknown", message: clamp(message, 360), raw: clamp(message, 480) };
}

