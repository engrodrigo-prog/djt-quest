const BIOMETRIC_FACTOR_KEY_PREFIX = "djt_biometric_factor_id";

export interface WebAuthnFactorLike {
  id: string;
  friendly_name?: string;
  factor_type?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface BiometricSupport {
  available: boolean;
  secureContext: boolean;
  platformAuthenticator: boolean;
}

const getStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const getBiometricStorageKey = (userId: string) =>
  `${BIOMETRIC_FACTOR_KEY_PREFIX}:${userId}`;

export const getStoredBiometricFactorId = (userId?: string | null) => {
  if (!userId) return null;
  return getStorage()?.getItem(getBiometricStorageKey(userId)) || null;
};

export const setStoredBiometricFactorId = (userId: string, factorId: string) => {
  getStorage()?.setItem(getBiometricStorageKey(userId), factorId);
};

export const clearStoredBiometricFactorId = (userId?: string | null) => {
  if (!userId) return;
  getStorage()?.removeItem(getBiometricStorageKey(userId));
};

export const listVerifiedWebAuthnFactors = <T extends WebAuthnFactorLike>(factors: T[] = []) =>
  factors.filter((factor) => factor.factor_type === "webauthn" && factor.status === "verified");

export const getPreferredBiometricFactor = <T extends WebAuthnFactorLike>(
  userId: string | null | undefined,
  factors: T[] = []
) => {
  const preferredId = getStoredBiometricFactorId(userId);
  if (!preferredId) return null;
  return listVerifiedWebAuthnFactors(factors).find((factor) => factor.id === preferredId) || null;
};

export const syncPreferredBiometricFactor = <T extends WebAuthnFactorLike>(
  userId: string | null | undefined,
  factors: T[] = []
) => {
  const factor = getPreferredBiometricFactor(userId, factors);
  if (!factor) {
    clearStoredBiometricFactorId(userId);
  }
  return factor;
};

export const getBiometricSupport = async (): Promise<BiometricSupport> => {
  const secureContext = typeof window !== "undefined" && window.isSecureContext;
  const available = secureContext && typeof PublicKeyCredential !== "undefined";
  let platformAuthenticator = false;

  if (
    available &&
    typeof (PublicKeyCredential as typeof PublicKeyCredential & {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    }).isUserVerifyingPlatformAuthenticatorAvailable === "function"
  ) {
    try {
      platformAuthenticator = await (
        PublicKeyCredential as typeof PublicKeyCredential & {
          isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
        }
      ).isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      platformAuthenticator = false;
    }
  }

  return {
    available,
    secureContext,
    platformAuthenticator,
  };
};

export const buildBiometricFriendlyName = () => {
  if (typeof navigator === "undefined") return "DJT Quest";

  const uaNavigator = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
      brands?: Array<{ brand: string }>;
    };
  };

  const platform =
    uaNavigator.userAgentData?.platform ||
    navigator.platform ||
    "Dispositivo";

  const userAgent = navigator.userAgent || "";
  const browser = uaNavigator.userAgentData?.brands?.[0]?.brand ||
    (userAgent.includes("Edg/") ? "Edge" :
      userAgent.includes("Chrome/") ? "Chrome" :
      userAgent.includes("Firefox/") ? "Firefox" :
      userAgent.includes("Safari/") ? "Safari" :
      "Navegador");

  const timestamp = new Date().toLocaleDateString("pt-BR");
  return `DJT Quest ${platform} ${browser} ${timestamp}`.slice(0, 64);
};

export const getWebAuthnRpConfig = () => {
  if (typeof window === "undefined") {
    throw new Error("WebAuthn indisponivel fora do navegador");
  }

  return {
    rpId: window.location.hostname,
    rpOrigins: [window.location.origin],
  };
};

export const getBiometricErrorMessage = (error: unknown) => {
  const code = String((error as any)?.code || "");
  const message = String((error as any)?.message || "");
  const lower = message.toLowerCase();

  if (
    code === "mfa_webauthn_enroll_not_enabled" ||
    code === "mfa_webauthn_verify_not_enabled"
  ) {
    return "WebAuthn ainda nao esta habilitado no Supabase deste projeto.";
  }

  if (lower.includes("abort") || lower.includes("cancel")) {
    return "A confirmacao biometrica foi cancelada.";
  }

  if (lower.includes("not supported") || lower.includes("browser does not support webauthn")) {
    return "Este navegador nao suporta biometria/passkeys neste fluxo.";
  }

  if (lower.includes("secure context") || lower.includes("security")) {
    return "A biometria exige o dominio oficial em HTTPS.";
  }

  return message || "Nao foi possivel concluir a biometria.";
};
