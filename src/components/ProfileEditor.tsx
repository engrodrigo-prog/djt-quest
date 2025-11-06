import { useEffect, useMemo, useState } from "react";
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
    name: profile?.name || "",
    email: (profile as any)?.email || "",
    operational_base: (profile as any)?.operational_base || "",
    sigla_area: (profile as any)?.sigla_area || "",
    date_of_birth: (profile as any)?.date_of_birth || "",
  });

  useEffect(() => {
    setFormData({
      name: profile?.name || "",
      email: (profile as any)?.email || "",
      operational_base: (profile as any)?.operational_base || "",
      sigla_area: (profile as any)?.sigla_area || "",
      date_of_birth: (profile as any)?.date_of_birth || "",
    });
  }, [profile]);

  const normalizeSigla = (value?: string | null) => {
    if (typeof value !== 'string') return '';
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const deriveOrg = (sigla?: string | null) => {
    const s = normalizeSigla(sigla);
    if (!s) return null;
    const parts = s.split('-').filter(Boolean);
    const divisionId = parts[0] || 'DJT';
    const coordTag = parts[1] || 'SEDE';
    return {
      division_id: divisionId,
      coord_id: `${divisionId}-${coordTag}`,
      team_id: s,
      sigla_area: s,
      operational_base: s,
    } as const;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Atualiza Auth (nome/email) do próprio usuário
      const wantEmail = formData.email?.trim();
      const wantName = formData.name?.trim();
      if (wantEmail || wantName) {
        const { error: authErr } = await supabase.auth.updateUser({
          email: wantEmail || undefined,
          data: wantName ? { name: wantName } : undefined,
        });
        if (authErr) {
          console.warn('Falha ao atualizar auth user:', authErr.message);
        }
      }

      // Deriva organização e normaliza sigla/base
      const org = deriveOrg(formData.sigla_area || formData.operational_base);

      // Atualiza perfil diretamente (RLS permite self-update)
      const updates: Record<string, unknown> = {
        name: formData.name,
        email: formData.email?.toLowerCase(),
        date_of_birth: formData.date_of_birth || null,
      };
      if (org) {
        updates.sigla_area = org.sigla_area;
        updates.operational_base = org.operational_base;
        updates.division_id = org.division_id;
        updates.coord_id = org.coord_id;
        updates.team_id = org.team_id;
      } else {
        updates.operational_base = formData.operational_base || null;
        updates.sigla_area = formData.sigla_area || null;
      }

      const { error: profErr } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', (await supabase.auth.getUser()).data.user?.id);
      if (profErr) throw profErr;

      await refreshUserSession();

      toast.success("Perfil atualizado com sucesso!");
    } catch (error) {
      console.error('Error requesting profile change:', error);
      toast.error('Erro ao salvar alterações');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editar Perfil</CardTitle>
        <CardDescription>
          Atualize seus dados. As alterações entram em vigor imediatamente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <div className="space-y-2">
            <Label htmlFor="name">Nome Completo</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Digite seu nome"
            />
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

          <div className="space-y-2">
            <Label htmlFor="date_of_birth">Data de Nascimento</Label>
            <Input
              id="date_of_birth"
              type="date"
              value={formData.date_of_birth || ''}
              onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
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
