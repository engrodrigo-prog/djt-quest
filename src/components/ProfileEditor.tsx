import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const AREA_OPTIONS = [
  "DJT", "DJT-PLA", "DJTV", "DJTB", "DJTV-ITP", "DJTV-VOT", "DJTB-ITU", "DJTB-CCP", "DJTB-SOR"
];

export function ProfileEditor() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    operational_base: profile?.operational_base || "",
    sigla_area: profile?.sigla_area || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const changes = [];
      
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

      if (changes.length === 0) {
        toast.info("Nenhuma alteração detectada");
        setLoading(false);
        return;
      }

      // Solicitar cada mudança
      for (const change of changes) {
        const { error } = await supabase.functions.invoke('request-profile-change', {
          body: {
            field_name: change.field,
            new_value: change.value,
          },
        });

        if (error) throw error;
      }

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
            <Label htmlFor="operational_base">Base Operacional</Label>
            <Input
              id="operational_base"
              value={formData.operational_base}
              onChange={(e) => setFormData({ ...formData, operational_base: e.target.value })}
              placeholder="Ex: Votorantim, DJT"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sigla_area">Sigla da Área</Label>
            <Select
              value={formData.sigla_area}
              onValueChange={(value) => setFormData({ ...formData, sigla_area: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a área" />
              </SelectTrigger>
              <SelectContent>
                {AREA_OPTIONS.map((area) => (
                  <SelectItem key={area} value={area}>
                    {area}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Enviando...' : 'Solicitar Alteração'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
