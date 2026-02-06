export const MIN_PASSWORD_LENGTH = 8;

type PasswordErrorInfo = {
  title: string;
  description?: string;
};

export const validateNewPassword = (passwordRaw: string, confirmRaw: string) => {
  const password = String(passwordRaw || "");
  const confirm = String(confirmRaw || "");

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false as const, message: `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres` };
  }
  if (password === "123456") {
    return { ok: false as const, message: "Por segurança, não use a senha padrão (123456)" };
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return { ok: false as const, message: "Use pelo menos 1 letra maiúscula, 1 minúscula e 1 número" };
  }
  if (password !== confirm) {
    return { ok: false as const, message: "As senhas não conferem" };
  }
  return { ok: true as const };
};

export const mapPasswordUpdateError = (error: unknown): PasswordErrorInfo => {
  const anyError = (error as any) || {};
  const msg =
    error instanceof Error
      ? error.message
      : typeof anyError?.message === "string"
        ? String(anyError.message)
        : "";
  const lower = msg.toLowerCase();
  const code = typeof anyError?.code === "string" ? anyError.code.toLowerCase() : "";
  const status = typeof anyError?.status === "number" ? anyError.status : 0;

  if (lower.includes("same_password") || lower.includes("should be different") || lower.includes("same as the old password")) {
    return { title: "A nova senha deve ser diferente da senha atual" };
  }

  const minMatch = msg.match(/at least\s+(\d+)\s+characters?/i) || msg.match(/mínimo\s+de\s+(\d+)/i);
  if (minMatch?.[1]) {
    return { title: `A senha deve ter pelo menos ${minMatch[1]} caracteres` };
  }

  if (lower.includes("one character of each") || lower.includes("upper") || lower.includes("lower") || lower.includes("number")) {
    return { title: "Senha fora da política", description: "Use letras maiúsculas, minúsculas e números." };
  }

  if (lower.includes("reauth") || lower.includes("secure password change") || lower.includes("invalid refresh token") || lower.includes("jwt")) {
    return { title: "Sessão expirada", description: "Entre novamente e tente salvar a nova senha." };
  }

  if (
    status === 422 ||
    code.includes("weak_password") ||
    code.includes("validation_failed") ||
    lower.includes("422") ||
    lower.includes("unprocessable") ||
    lower.includes("password should contain at least one character")
  ) {
    return {
      title: "Senha rejeitada pela política de segurança",
      description: "Use uma senha mais forte (8+ caracteres, maiúscula, minúscula e número).",
    };
  }

  return { title: "Não foi possível atualizar a senha", description: msg || undefined };
};
