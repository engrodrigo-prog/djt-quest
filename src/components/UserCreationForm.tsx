import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { UserPlus } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface Team {
  id: string;
  name: string;
}

const GUEST_TEAM_ID = 'CONVIDADOS';
const REGISTRATION_TEAM_IDS = [
  'DJT',
  'DJT-PLAN',
  'DJTV',
  'DJTV-VOT',
  'DJTV-JUN',
  'DJTV-PJU',
  'DJTV-ITA',
  'DJTB',
  'DJTB-CUB',
  'DJTB-SAN',
  GUEST_TEAM_ID,
] as const;

const REGISTRATION_TEAM_ORDER = new Map(REGISTRATION_TEAM_IDS.map((id, idx) => [id, idx]));

const normalizeTeamId = (id: unknown) => String(id ?? '').trim().toUpperCase();

const filterAndOrderRegistrationTeams = (raw: Array<{ id: string; name?: string | null }>) => {
  const byId = new Map<string, Team>();
  for (const t of raw) {
    const id = normalizeTeamId(t.id);
    if (!REGISTRATION_TEAM_ORDER.has(id)) continue;
    const name = String(t.name ?? '').trim();
    byId.set(id, { id, name: name || id });
  }

  for (const id of REGISTRATION_TEAM_IDS) {
    if (!byId.has(id)) {
      byId.set(id, { id, name: id === GUEST_TEAM_ID ? 'Convidados (externo)' : id });
    }
  }

  return REGISTRATION_TEAM_IDS.map((id) => byId.get(id)!).filter(Boolean);
};

export const UserCreationForm = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<Team[]>(() => filterAndOrderRegistrationTeams([]));
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    matricula: '',
    team_id: '',
    role: 'colaborador' as 'gerente_djt' | 'gerente_divisao_djtx' | 'coordenador_djtx' | 'colaborador'
  });

  useEffect(() => {
    loadTeams();
  }, []);

  const loadTeams = async () => {
    try {
      const resp = await fetch('/api/registration-options', { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      const list = Array.isArray(json?.teams) ? json.teams : [];
      const mapped = list
        .map((t: any) => ({ id: String(t?.id || '').trim(), name: String(t?.name || '').trim() }))
        .filter((t: any) => t.id)
        .map((t: any) => ({ id: t.id, name: t.name || t.id }));
      setTeams(filterAndOrderRegistrationTeams(mapped));
    } catch {
      const { data } = await supabase.from('teams').select('id, name').order('name');
      if (data) setTeams(filterAndOrderRegistrationTeams(data as any));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Prefer Vercel API route (deploys with git push); fallback to Edge Function
      try {
        const resp = await apiFetch('/api/admin?handler=studio-create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            password: '123456',
            name: formData.name,
            matricula: formData.matricula || null,
            team_id: formData.team_id || null,
            role: formData.role,
          }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || 'Erro ao criar usuário');
        if (!json?.success) throw new Error(json?.error || 'Erro ao criar usuário');
      } catch (apiErr: any) {
        const { data, error } = await supabase.functions.invoke('studio-create-user', {
          body: {
            email: formData.email,
            password: '123456',
            name: formData.name,
            matricula: formData.matricula || null,
            team_id: formData.team_id || null,
            role: formData.role,
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || apiErr?.message || 'Erro ao criar usuário');
      }

      toast({
        title: 'Usuário criado com sucesso!',
        description: `Conta criada para ${formData.name} (senha inicial 123456) • role ${formData.role}`
      });

      // Reset form
      setFormData({
        email: '',
        name: '',
        matricula: '',
        team_id: '',
        role: 'colaborador'
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao criar usuário',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Criar Novo Usuário
        </CardTitle>
        <CardDescription>
          Preencha todos os campos para criar uma nova conta
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome Completo *</Label>
            <Input
              id="name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="João Silva"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="joao@empresa.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="matricula">Matrícula (opcional)</Label>
            <Input
              id="matricula"
              value={formData.matricula}
              onChange={(e) => setFormData({ ...formData, matricula: e.target.value.replace(/\D/g, '') })}
              placeholder="486146"
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">
              Senha inicial padrão: <span className="font-semibold">123456</span> (o usuário será orientado a trocar no primeiro acesso)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Função/Cargo *</Label>
            <Select 
              value={formData.role} 
              onValueChange={(value: any) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a função" />
              </SelectTrigger>
              <SelectContent position="item-aligned">
                <SelectItem value="colaborador">Colaborador</SelectItem>
                <SelectItem value="coordenador_djtx">Coordenador</SelectItem>
                <SelectItem value="gerente_divisao_djtx">Gerente de Divisão</SelectItem>
                <SelectItem value="gerente_djt">Gerente de Departamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="team">Equipe</Label>
            <Select 
              value={formData.team_id} 
              onValueChange={(value) => setFormData({ ...formData, team_id: value === "none" ? "" : value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma equipe" />
              </SelectTrigger>
              <SelectContent position="item-aligned">
                <SelectItem value="none">Sem equipe</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Criando...' : 'Criar Usuário'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
