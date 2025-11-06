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
    name: profile?.name || "",
    operational_base: profile?.operational_base || "",
    sigla_area: profile?.sigla_area || "",
    date_of_birth: profile?.date_of_birth || "",
  });

  useEffect(() => {
    setFormData({
      name: profile?.name || "",
      operational_base: profile?.operational_base || "",
      sigla_area: profile?.sigla_area || "",
      date_of_birth: profile?.date_of_birth || "",
    });
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const changes = [];
      
      if (formData.name && formData.name !== profile?.name) {
        changes.push({ field: 'name', value: formData.name });
      }

      if (formData.operational_base !== profile?.operational_base) {
        changes.push({
          field: 'operational_base',
          value: formData.operational_base,
        });
      }
      
      if (formData.sigla_area !== profile?.sigla_area) {
        changes.push({
          field: 'sigla_area',
          value: formData.sigla_area,
        });
      }

      if ((formData.date_of_birth || '') !== (profile?.date_of_birth || '')) {
        changes.push({ field: 'date_of_birth', value: formData.date_of_birth || '' });
      }

      if (changes.length === 0) {
        toast.info("Nenhuma alteração detectada");
        setLoading(false);
        return;
      }

      // Solicitar cada mudança
      const { error } = await supabase.functions.invoke('request-profile-change', {
        body: {
          changes: changes.map(({ field, value }) => ({ field_name: field, new_value: value })),
        },
      });

      if (error) throw error;

      await refreshUserSession();

      toast.success("Solicitação enviada para aprovação!");
    } catch (error) {
      console.error('Error requesting profile change:', error);
      toast.error('Erro ao solicitar alteração');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editar Perfil</CardTitle>
        <CardDescription>
          Altere sua base operacional ou sigla da área. Mudanças requerem aprovação do seu líder.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            {loading ? 'Enviando...' : 'Solicitar Alteração'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
