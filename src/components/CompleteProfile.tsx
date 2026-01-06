import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import { AvatarCapture } from "@/components/AvatarCapture";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { apiFetch } from "@/lib/api";
import { getProfileCompletionStatus } from "@/lib/profileCompletion";

interface CompleteProfileProps {
  profile: any;
}

export function CompleteProfile({ profile }: CompleteProfileProps) {
  const navigate = useNavigate();
  const { refreshUserSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    profile?.avatar_url || profile?.avatar_thumbnail_url || null,
  );
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [formData, setFormData] = useState({
    newPassword: "",
    confirmPassword: "",
    matricula: profile.matricula || "",
    email: profile.email || "",
    operational_base: profile.operational_base || "",
    date_of_birth: profile.date_of_birth || "",
  });

  const completionStatus = useMemo(
    () =>
      getProfileCompletionStatus({
        ...profile,
        avatar_url: avatarUrl || profile?.avatar_url,
        avatar_thumbnail_url: avatarUrl || profile?.avatar_thumbnail_url,
        date_of_birth: formData.date_of_birth || profile?.date_of_birth,
        email: formData.email || profile?.email,
        matricula: formData.matricula || profile?.matricula,
        operational_base: formData.operational_base || profile?.operational_base,
      }),
    [avatarUrl, formData, profile],
  );

  const handleAvatarCaptured = async (imageBase64: string) => {
    if (avatarUploading) return;
    try {
      setAvatarUploading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const resp = await apiFetch("/api/admin?handler=upload-avatar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: profile.id, imageBase64 }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || "Falha ao salvar a foto");
      setAvatarUrl(data?.avatarUrl || avatarUrl);
      toast.success("Foto salva com sucesso!");
    } catch (error) {
      console.error("Error saving avatar:", error);
      toast.error("Erro ao salvar a foto");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (avatarUploading) {
        toast.error("Aguarde o upload da foto terminar.");
        setLoading(false);
        return;
      }
      if (completionStatus.missingAvatar) {
        toast.error("Envie ou capture uma foto antes de continuar.");
        setLoading(false);
        return;
      }
      if (completionStatus.missingDob) {
        toast.error("Informe sua data de nascimento.");
        setLoading(false);
        return;
      }
      if (completionStatus.missingEmail) {
        toast.error("Informe seu email.");
        setLoading(false);
        return;
      }
      if (completionStatus.missingMatricula) {
        toast.error("Informe sua matrícula.");
        setLoading(false);
        return;
      }
      if (completionStatus.missingOperationalBase) {
        toast.error("Informe sua base operacional.");
        setLoading(false);
        return;
      }

      // Validar senha
      if (profile.must_change_password) {
        // Não permitir senha igual à atual
        if (formData.newPassword === '123456') {
          toast.error('A nova senha não pode ser igual à senha padrão (123456)');
          setLoading(false);
          return;
        }

        if (formData.newPassword.length < 6) {
          toast.error("A senha deve ter no mínimo 6 caracteres");
          setLoading(false);
          return;
        }
        if (formData.newPassword !== formData.confirmPassword) {
          toast.error("As senhas não coincidem");
          setLoading(false);
          return;
        }

        // Atualizar senha
        const { error: passwordError } = await supabase.auth.updateUser({
          password: formData.newPassword,
        });

        if (passwordError) {
          // Detectar erro específico de senha igual
          if (passwordError.message?.includes('same_password') || 
              passwordError.message?.includes('should be different')) {
            toast.error('A nova senha não pode ser igual à senha atual (123456)');
            setLoading(false);
            return;
          }
          throw passwordError;
        }
      }

      // Atualizar perfil
      const updates: any = {
        must_change_password: false,
        needs_profile_completion: false,
      };

      if (formData.matricula) updates.matricula = formData.matricula;
      if (formData.email) updates.email = formData.email;
      if (formData.operational_base) updates.operational_base = formData.operational_base;
      if (formData.date_of_birth) updates.date_of_birth = formData.date_of_birth;

      const { error: profileError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', profile.id);

      if (profileError) throw profileError;

      await refreshUserSession();

      toast.success("Perfil completado com sucesso!");
      navigate('/dashboard');
    } catch (error) {
      console.error('Error completing profile:', error);
      toast.error('Erro ao completar perfil');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/20 via-background to-secondary/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Complete seu Perfil</CardTitle>
          <CardDescription>
            {profile.must_change_password 
              ? "Por favor, altere sua senha e complete seus dados."
              : "Complete os dados obrigatórios do seu perfil."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {profile.must_change_password && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Você está usando a senha padrão (123456). Por segurança, escolha uma nova senha <strong>diferente</strong>.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Foto do Perfil *</Label>
              {!completionStatus.missingAvatar && avatarUrl && (
                <div className="flex items-center gap-3">
                  <AvatarDisplay avatarUrl={avatarUrl} name={profile.name || "Avatar"} size="md" />
                  <span className="text-xs text-muted-foreground">Foto registrada.</span>
                </div>
              )}
              {completionStatus.missingAvatar && (
                <div className="space-y-2">
                  <AvatarCapture onCapture={handleAvatarCaptured} />
                  {avatarUploading && (
                    <p className="text-xs text-muted-foreground">Salvando foto...</p>
                  )}
                </div>
              )}
            </div>

            {profile.must_change_password && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="newPassword">
                    Nova Senha * 
                    <span className="text-xs text-muted-foreground ml-2">
                      (não use 123456)
                    </span>
                  </Label>
                  <input type="text" name="username" autoComplete="username" hidden readOnly />
                  <Input
                    id="newPassword"
                    type="password"
                    value={formData.newPassword}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setFormData({ ...formData, newPassword: newValue });
                      
                      // Mostrar aviso se tentar usar senha padrão
                      if (newValue === '123456') {
                        toast.warning('Não use a senha padrão como nova senha!', {
                          duration: 2000,
                        });
                      }
                    }}
                    required
                    minLength={6}
                    placeholder="Mínimo 6 caracteres (não use 123456)"
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar Senha *</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    required
                    placeholder="Digite a senha novamente"
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            {!formData.matricula && !completionStatus.isExternal && (
              <div className="space-y-2">
                <Label htmlFor="matricula">Matrícula *</Label>
                <Input
                  id="matricula"
                  value={formData.matricula}
                  onChange={(e) => setFormData({ ...formData, matricula: e.target.value })}
                  required
                  placeholder="Digite sua matrícula"
                />
              </div>
            )}

            {!formData.date_of_birth && (
              <div className="space-y-2">
                <Label htmlFor="date_of_birth">Data de Nascimento *</Label>
                <Input
                  id="date_of_birth"
                  type="date"
                  value={formData.date_of_birth}
                  onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                  required
                />
              </div>
            )}

            {!formData.email && (
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  placeholder="seu.email@exemplo.com"
                />
              </div>
            )}

            {!formData.operational_base && (
              <div className="space-y-2">
                <Label htmlFor="operational_base">Base Operacional *</Label>
                <Input
                  id="operational_base"
                  value={formData.operational_base}
                  onChange={(e) => setFormData({ ...formData, operational_base: e.target.value })}
                  required
                  placeholder="Ex: Votorantim, DJT, etc."
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading || avatarUploading}>
              {loading ? 'Salvando...' : 'Continuar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
