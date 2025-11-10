import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export function ProfileEditor() {
  const { profile, refreshUserSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: (profile as any)?.email || "",
    telefone: (profile as any)?.telefone || "",
    operational_base: (profile as any)?.operational_base || "",
    sigla_area: (profile as any)?.sigla_area || "",
  });

  useEffect(() => {
    setFormData({
      email: (profile as any)?.email || "",
      telefone: (profile as any)?.telefone || "",
      operational_base: (profile as any)?.operational_base || "",
      sigla_area: (profile as any)?.sigla_area || "",
    });
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const normalizeSigla = (value?: string | null) => {
        if (typeof value !== 'string') return '';
        return value
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      };

      const trim = (value?: string | null) => (value ?? '').trim();
      const normalizedSigla = normalizeSigla(formData.sigla_area);
      const normalizedBase = trim(formData.operational_base);
      const normalizedEmail = trim(formData.email).toLowerCase();
      const normalizedPhone = trim(formData.telefone);

      const changes: { field_name: string; new_value: string }[] = [];
      const compare = (field: string, newValue: string) => {
        const current = ((profile as any)?.[field] ?? '') + '';
        if (current.trim() !== newValue.trim()) {
          changes.push({ field_name: field, new_value: newValue });
        }
      };

      compare('email', normalizedEmail);
      compare('telefone', normalizedPhone);
      compare('operational_base', normalizedBase);
      compare('sigla_area', normalizedSigla);

      if (changes.length === 0) {
        toast.info('Nenhuma alteração detectada');
        setLoading(false);
        return;
      }

      const res = await supabase.functions.invoke('request-profile-change', {
        body: { changes },
      });
      if (res.error) {
        try {
          const txt = await res.response?.text();
          throw new Error(txt || res.error.message);
        } catch {
          throw res.error;
        }
      }

      toast.success('Solicitação enviada! Seu líder aprovará a mudança.');
      await refreshUserSession();
    } catch (error: any) {
      console.error('Error requesting profile change:', error);
      const detail =
        error?.message ||
        error?.error ||
        error?.data?.error ||
        error?.response?.data?.error ||
        'Erro ao enviar solicitação de alteração';
      toast.error(detail);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editar Perfil</CardTitle>
        <CardDescription>
          As alterações precisam de aprovação do seu líder (coordenador ou superior).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6 pb-4 border-b border-dashed border-border mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome completo</Label>
              <p className="text-base font-medium">
                {profile?.name ?? "Nome pendente"}
              </p>
              <p className="text-xs text-muted-foreground">
                Nome e matrícula vêm do cadastro inicial e são atualizados por líderes superiores.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Matrícula</Label>
              <p className="text-base font-medium">
                {(profile as any)?.matricula ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Essas informações não podem ser alteradas nesta tela.
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Data de nascimento</Label>
            <p className="text-base font-medium">
              {(profile as any)?.date_of_birth ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              As datas são importadas do cadastro oficial, contacte seu líder caso precise mudar.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input
                id="telefone"
                type="tel"
                value={formData.telefone}
                onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                placeholder="(00) 00000-0000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="seu.email@empresa.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="operational_base">Base Operacional</Label>
            <Input
              id="operational_base"
              value={formData.operational_base}
              onChange={(e) => setFormData({ ...formData, operational_base: e.target.value })}
              placeholder="Ex: Votorantim, DJT"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sigla_area">Sigla da Área / Equipe</Label>
            <Input
              id="sigla_area"
              value={formData.sigla_area}
              onChange={(e) => setFormData({ ...formData, sigla_area: e.target.value.toUpperCase() })}
              placeholder="Ex: DJTB-CUB"
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
