import { useCallback, useEffect, useMemo, useState } from "react";
import { Fingerprint, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  buildBiometricFriendlyName,
  clearStoredBiometricFactorId,
  getBiometricErrorMessage,
  getBiometricSupport,
  getPreferredBiometricFactor,
  getWebAuthnRpConfig,
  listVerifiedWebAuthnFactors,
  setStoredBiometricFactorId,
  syncPreferredBiometricFactor,
  type BiometricSupport,
  type WebAuthnFactorLike,
} from "@/lib/biometricAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type VerifiedWebAuthnFactor = WebAuthnFactorLike & {
  factor_type: "webauthn";
  status: "verified";
  created_at: string;
};

export function BiometricAccessCard() {
  const { user, refreshUserSession } = useAuth();
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [factors, setFactors] = useState<VerifiedWebAuthnFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "register" | "authenticate" | "disable">(null);

  const loadFactors = useCallback(async (userId?: string | null) => {
    if (!userId) {
      setFactors([]);
      return [] as VerifiedWebAuthnFactor[];
    }

    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;

    const verified = listVerifiedWebAuthnFactors(
      ((data?.all || []) as VerifiedWebAuthnFactor[])
    );

    syncPreferredBiometricFactor(userId, verified);
    setFactors(verified);
    return verified;
  }, []);

  const reload = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [supportState] = await Promise.all([
        getBiometricSupport(),
        loadFactors(user.id),
      ]);
      setSupport(supportState);
    } catch (error) {
      console.error("Biometric setup load error:", error);
      setFactors([]);
      setSupport(await getBiometricSupport());
    } finally {
      setLoading(false);
    }
  }, [loadFactors, user?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const enabledFactor = useMemo(
    () => getPreferredBiometricFactor(user?.id, factors),
    [factors, user?.id]
  );

  const handleEnable = async () => {
    if (!user?.id) return;
    if (!support?.available || !support.platformAuthenticator) {
      toast.error("Biometria indisponível neste aparelho", {
        description: "Face ID, Touch ID ou biometria Android nao foram detectados neste navegador.",
      });
      return;
    }

    setBusy("register");
    try {
      const friendlyName = buildBiometricFriendlyName();
      const { error } = await supabase.auth.mfa.webauthn.register(
        {
          friendlyName,
          webauthn: getWebAuthnRpConfig(),
        },
        {
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "required",
          },
        }
      );

      if (error) throw error;

      const verified = await loadFactors(user.id);
      const enrolledFactor =
        verified.find((factor) => factor.friendly_name === friendlyName) ||
        verified.at(-1) ||
        null;

      if (enrolledFactor) {
        setStoredBiometricFactorId(user.id, enrolledFactor.id);
      }

      await refreshUserSession();
      toast.success("Biometria ativada neste aparelho.");
    } catch (error) {
      console.error("Biometric enroll error:", error);
      toast.error("Nao foi possivel ativar a biometria", {
        description: getBiometricErrorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleAuthenticate = async () => {
    if (!enabledFactor) {
      toast.error("Ative a biometria neste aparelho primeiro.");
      return;
    }

    setBusy("authenticate");
    try {
      const { error } = await supabase.auth.mfa.webauthn.authenticate(
        {
          factorId: enabledFactor.id,
          webauthn: getWebAuthnRpConfig(),
        },
        {
          userVerification: "required",
        }
      );

      if (error) throw error;

      await refreshUserSession();
      toast.success("Biometria confirmada com sucesso.");
    } catch (error) {
      console.error("Biometric auth error:", error);
      toast.error("Nao foi possivel confirmar a biometria", {
        description: getBiometricErrorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async () => {
    if (!user?.id || !enabledFactor) {
      clearStoredBiometricFactorId(user?.id);
      return;
    }

    setBusy("disable");
    try {
      const verifyResult = await supabase.auth.mfa.webauthn.authenticate(
        {
          factorId: enabledFactor.id,
          webauthn: getWebAuthnRpConfig(),
        },
        {
          userVerification: "required",
        }
      );

      if (verifyResult.error) throw verifyResult.error;

      const { error } = await supabase.auth.mfa.unenroll({ factorId: enabledFactor.id });
      if (error) throw error;

      clearStoredBiometricFactorId(user.id);
      await loadFactors(user.id);
      await refreshUserSession();
      toast.success("Biometria desativada neste aparelho.");
    } catch (error) {
      console.error("Biometric disable error:", error);
      toast.error("Nao foi possivel desativar a biometria", {
        description: getBiometricErrorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const statusTone = !support?.secureContext
    ? "destructive"
    : support?.platformAuthenticator
      ? "secondary"
      : "outline";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="h-4 w-4 text-primary" />
          Acesso por Biometria
        </CardTitle>
        <CardDescription>
          Ative Face ID, Touch ID ou biometria Android neste aparelho usando passkeys/WebAuthn. Nao usa SMS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando status da biometria...
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant={statusTone as "destructive" | "secondary" | "outline"}>
                {support?.secureContext ? "HTTPS OK" : "Precisa de HTTPS"}
              </Badge>
              <Badge variant={support?.available ? "secondary" : "outline"}>
                {support?.available ? "WebAuthn disponivel" : "Sem WebAuthn"}
              </Badge>
              <Badge variant={support?.platformAuthenticator ? "secondary" : "outline"}>
                {support?.platformAuthenticator ? "Biometria do aparelho disponivel" : "Sem biometria de aparelho"}
              </Badge>
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                {enabledFactor ? "Este aparelho esta habilitado" : "Este aparelho ainda nao esta habilitado"}
              </div>
              <p className="text-xs text-muted-foreground">
                {enabledFactor
                  ? `Fator local: ${enabledFactor.friendly_name || "Biometria do aparelho"}.`
                  : "A ativacao fica vinculada a este navegador/aparelho para nao atrapalhar seus outros acessos."}
              </p>
              <p className="text-xs text-muted-foreground">
                {factors.length > 0
                  ? `Sua conta tem ${factors.length} passkey(s) verificada(s).`
                  : "Sua conta ainda nao tem passkeys verificadas."}
              </p>
            </div>

            {factors.length > 0 ? (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Smartphone className="h-4 w-4 text-primary" />
                  Passkeys desta conta
                </div>
                <div className="space-y-1">
                  {factors.map((factor) => (
                    <div key={factor.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate">
                        {factor.friendly_name || factor.id}
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        {enabledFactor?.id === factor.id ? "este aparelho" : new Date(factor.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              {!enabledFactor ? (
                <Button
                  type="button"
                  onClick={handleEnable}
                  disabled={busy !== null || !support?.available || !support?.platformAuthenticator}
                  className="sm:flex-1"
                >
                  {busy === "register" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Ativar neste aparelho
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={handleAuthenticate}
                    disabled={busy !== null}
                    className="sm:flex-1"
                  >
                    {busy === "authenticate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Testar biometria
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDisable}
                    disabled={busy !== null}
                    className="sm:flex-1"
                  >
                    {busy === "disable" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Desativar neste aparelho
                  </Button>
                </>
              )}
            </div>

            {!support?.secureContext ? (
              <p className="text-xs text-muted-foreground">
                A biometria do navegador so funciona no dominio oficial com HTTPS.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
