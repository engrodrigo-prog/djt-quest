import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CompleteProfileProps {
  profile: any;
}

export function CompleteProfile({ profile }: CompleteProfileProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    newPassword: "",
    confirmPassword: "",
    matricula: profile.matricula || "",
    email: profile.email || "",
    operational_base: profile.operational_base || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validar senha
      if (profile.must_change_password) {
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

        if (passwordError) throw passwordError;
      }

      // Atualizar perfil
      const updates: any = {
        must_change_password: false,
        needs_profile_completion: false,
      };

      if (formData.matricula) updates.matricula = formData.matricula;
      if (formData.email) updates.email = formData.email;
      if (formData.operational_base) updates.operational_base = formData.operational_base;

      const { error: profileError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', profile.id);

      if (profileError) throw profileError;

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
                  Você está usando a senha padrão. Por segurança, escolha uma nova senha.
                </AlertDescription>
              </Alert>
            )}

            {profile.must_change_password && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="newPassword">Nova Senha *</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={formData.newPassword}
                    onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                    required
                    minLength={6}
                    placeholder="Mínimo 6 caracteres"
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
                  />
                </div>
              </>
            )}

            {!formData.matricula && (
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

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Salvando...' : 'Continuar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
