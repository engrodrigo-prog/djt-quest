import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Search, Trash2, Users, AlertTriangle, CheckCircle, Loader2, UserPlus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiFetch } from '@/lib/api';
import { UserCreationForm } from '@/components/UserCreationForm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalizeTeamId } from '@/lib/constants/points';
import { getActiveLocale } from '@/lib/i18n/activeLocale';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  avatar_thumbnail_url?: string | null;
  created_at: string;
  operational_base: string | null;
  sigla_area: string | null;
  team_id?: string | null;
  matricula?: string | null;
  phone?: string | null;
  telefone?: string | null;
  phone_confirmed_at?: string | null;
  is_leader?: boolean | null;
  studio_access?: boolean | null;
}

export const UserManagement = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserProfile[]>([]);
  const [rolesByUserId, setRolesByUserId] = useState<Record<string, string[]>>({});
  const [primaryRoleByUserId, setPrimaryRoleByUserId] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<'created_desc' | 'created_asc' | 'name_asc' | 'name_desc'>('created_desc');
  const [loading, setLoading] = useState(true);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [testUsers, setTestUsers] = useState<UserProfile[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [primaryRoleForUser, setPrimaryRoleForUser] = useState<string>('');
  const [initialRolesForUser, setInitialRolesForUser] = useState<string[]>([]);
  const [isContentCuratorRole, setIsContentCuratorRole] = useState(false);
  const [isFinanceAnalystRole, setIsFinanceAnalystRole] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState<string>('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    matricula: '',
    phone: '',
    operational_base: '',
    sigla_area: '',
    team_id: '',
    is_leader: false,
    studio_access: false,
  });
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const normalizeRoleLocal = (raw: any) => {
    const r = String(raw || '').trim();
    if (!r) return '';
    if (r === 'gerente') return 'gerente_djt';
    if (r === 'lider_divisao') return 'gerente_divisao_djtx';
    if (r === 'coordenador') return 'coordenador_djtx';
    return r;
  };

  const roleHierarchy = [
    'admin',
    'gerente_djt',
    'gerente_divisao_djtx',
    'coordenador_djtx',
    'lider_equipe',
    'analista_financeiro',
    'content_curator',
    'invited',
    'colaborador',
  ];

  const primaryRoleFromList = (roles: string[]) => {
    const set = new Set((roles || []).map(normalizeRoleLocal).filter(Boolean));
    for (const r of roleHierarchy) {
      if (set.has(r)) return r;
    }
    return '';
  };

  const roleLabel = (r: string) => {
    const v = normalizeRoleLocal(r);
    if (v === 'admin') return 'ADMIN';
    if (v === 'gerente_djt') return 'GERENTE';
    if (v === 'gerente_divisao_djtx') return 'GERENTE DIV.';
    if (v === 'coordenador_djtx') return 'COORD.';
    if (v === 'lider_equipe') return 'LÍDER';
    if (v === 'analista_financeiro') return 'ANALISTA';
    if (v === 'content_curator') return 'CURADOR';
    if (v === 'invited') return 'CONVIDADO';
    if (v === 'colaborador') return 'COLAB.';
    return v ? v.toUpperCase() : '—';
  };

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          name,
          avatar_url,
          avatar_thumbnail_url,
          created_at,
          operational_base,
          sigla_area,
          team_id,
          matricula,
          phone,
          telefone,
          phone_confirmed_at,
          is_leader,
          studio_access
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const baseUsers = (data || []) as UserProfile[];

      // Alguns perfis (ex.: líderes) podem não ter permissão de ler avatar_url via RLS/grants.
      // Fazemos um "hydrate" best-effort via handler server-side (service role) para preencher os avatars.
      let mergedUsers = baseUsers;
      try {
        const ids = (baseUsers || []).map((u) => String((u as any)?.id || '').trim()).filter(Boolean);
        const avatarById: Record<string, { avatar_url?: string | null; avatar_thumbnail_url?: string | null }> = {};
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const resp = await apiFetch('/api/admin?handler=studio-list-user-avatars', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: chunk }),
          });
          if (!resp.ok) continue;
          const json = await resp.json().catch(() => null);
          const items = Array.isArray(json?.items) ? json.items : [];
          for (const item of items) {
            const id = String(item?.id || '').trim();
            if (!id) continue;
            avatarById[id] = {
              avatar_url: (item as any)?.avatar_url ?? null,
              avatar_thumbnail_url: (item as any)?.avatar_thumbnail_url ?? null,
            };
          }
        }
        if (Object.keys(avatarById).length) {
          mergedUsers = (baseUsers || []).map((u) => {
            const id = String((u as any)?.id || '').trim();
            const extra = id ? avatarById[id] : undefined;
            if (!extra) return u;
            return {
              ...u,
              avatar_thumbnail_url: (u as any)?.avatar_thumbnail_url || extra.avatar_thumbnail_url || null,
              avatar_url: (u as any)?.avatar_url || extra.avatar_url || null,
            };
          });
        }
      } catch {
        // ignore hydrate errors
      }

      setUsers(mergedUsers);

      // Mapear roles (para filtro por perfil e visualização). Best-effort: pode falhar dependendo de RLS.
      try {
        const ids = (mergedUsers || []).map((u) => String((u as any)?.id || '')).filter(Boolean);
        const rolesRows: any[] = [];
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { data: rows } = await supabase.from('user_roles').select('user_id, role').in('user_id', chunk);
          (rows || []).forEach((r: any) => rolesRows.push(r));
        }
        const byUser: Record<string, string[]> = {};
        for (const r of rolesRows) {
          const uid = String((r as any)?.user_id || '').trim();
          const role = normalizeRoleLocal((r as any)?.role);
          if (!uid || !role) continue;
          if (!byUser[uid]) byUser[uid] = [];
          byUser[uid].push(role);
        }
        for (const k of Object.keys(byUser)) {
          byUser[k] = Array.from(new Set(byUser[k].map(normalizeRoleLocal).filter(Boolean)));
        }
        const primaryBy: Record<string, string> = {};
        for (const u of mergedUsers || []) {
          const uid = String((u as any)?.id || '').trim();
          if (!uid) continue;
          primaryBy[uid] = primaryRoleFromList(byUser[uid] || []);
        }
        setRolesByUserId(byUser);
        setPrimaryRoleByUserId(primaryBy);
      } catch {
        setRolesByUserId({});
        setPrimaryRoleByUserId({});
      }
      
      // Detectar usuários de teste
      const testUsersList = (mergedUsers || []).filter(u => 
        u.email?.includes('@djtquest') || 
        u.email?.includes('@test') ||
        u.email?.includes('@exemplo')
      );
      setTestUsers(testUsersList);
    } catch (error: any) {
      toast({
        title: 'Erro ao carregar usuários',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openEditor = async (user: UserProfile) => {
    setEditingUser(user);
    setForm({
      name: user.name || '',
      email: user.email || '',
      matricula: user.matricula || '',
      phone: user.phone || user.telefone || '',
      sigla_area: user.sigla_area || '',
      operational_base: user.operational_base || '',
      team_id: '',
      is_leader: Boolean(user.is_leader),
      studio_access: Boolean(user.studio_access),
    });
    setDateOfBirth('');

    try {
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      const roles = Array.isArray(rolesData) ? rolesData.map((r: any) => String(r?.role || '')).filter(Boolean) : [];
      setInitialRolesForUser(roles);
      const has = (r: string) => roles.includes(r);
      const primary =
        has('admin')
          ? 'admin'
          : has('gerente_djt')
          ? 'gerente_djt'
          : has('gerente_divisao_djtx')
          ? 'gerente_divisao_djtx'
          : has('coordenador_djtx')
          ? 'coordenador_djtx'
          : has('lider_equipe')
          ? 'lider_equipe'
          : has('analista_financeiro')
          ? 'analista_financeiro'
          : has('invited')
          ? 'invited'
          : has('colaborador')
          ? 'colaborador'
          : '';
      setPrimaryRoleForUser(primary);
      setIsContentCuratorRole(has('content_curator'));
      setIsFinanceAnalystRole(has('analista_financeiro'));
    } catch {
      setInitialRolesForUser([]);
      setPrimaryRoleForUser('');
      setIsContentCuratorRole(false);
      setIsFinanceAnalystRole(false);
    }

    setEditOpen(true);
  };

  const saveEditor = async () => {
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      const payload: any = {
        userId: editingUser.id,
        name: form.name,
        email: form.email,
        matricula: form.matricula || null,
        phone: form.phone?.trim() || null,
        sigla_area: form.sigla_area || null,
        operational_base: form.operational_base || null,
        is_leader: form.is_leader,
        // Curador de conteúdo e analista financeiro precisam entrar no Studio (módulos restritos).
        studio_access: Boolean(form.studio_access || isContentCuratorRole || isFinanceAnalystRole),
      };
      if (dateOfBirth) payload.date_of_birth = dateOfBirth;
      if (primaryRoleForUser) payload.role = primaryRoleForUser;

      // Differential role updates (avoid destructive role replacement)
      const addRoles: string[] = [];
      const removeRoles: string[] = [];

      const hadCurator = initialRolesForUser.includes('content_curator');
      if (!hadCurator && isContentCuratorRole) addRoles.push('content_curator');
      if (hadCurator && !isContentCuratorRole) removeRoles.push('content_curator');

      const hadAnalyst = initialRolesForUser.includes('analista_financeiro');
      if (!hadAnalyst && isFinanceAnalystRole) addRoles.push('analista_financeiro');
      if (hadAnalyst && !isFinanceAnalystRole) removeRoles.push('analista_financeiro');

      if (addRoles.length) payload.add_roles = addRoles;
      if (removeRoles.length) payload.remove_roles = removeRoles;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const resp = await apiFetch('/api/admin?handler=studio-update-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Falha ao salvar');
      toast({
        title: 'Usuário atualizado',
        description: data?.warning ? `${form.name} salvo. ${String(data.warning)}` : `${form.name} salvo com sucesso`,
      });
      setEditOpen(false);
      await loadUsers();
    } catch (error: any) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const updateForm = (key: keyof typeof form, value: any) => setForm((prev) => ({ ...prev, [key]: value }));
  const handleSiglaChange = (value: string) => {
    const formatted = value.toUpperCase();
    updateForm('sigla_area', formatted);
  };

  const filterUsers = useCallback(() => {
    const term = searchTerm.trim().toLowerCase();
    const selectedTeam = normalizeTeamId(teamFilter);

    const teamKeyOf = (u: UserProfile) =>
      normalizeTeamId(u.team_id || u.sigla_area);

    let next = (users || []).filter((user) => {
      if (!term) return true;
      const uid = String(user.id || '');
      const roles = rolesByUserId[uid] || [];
      const primary = primaryRoleByUserId[uid] || '';
      const roleText = [primary, ...roles].filter(Boolean).join(' ').toLowerCase();
      return (
        user.email?.toLowerCase().includes(term) ||
        user.name?.toLowerCase().includes(term) ||
        user.phone?.toLowerCase().includes(term) ||
        user.operational_base?.toLowerCase().includes(term) ||
        user.sigla_area?.toLowerCase().includes(term) ||
        user.team_id?.toLowerCase().includes(term) ||
        roleText.includes(term)
      );
    });

    if (teamFilter !== 'all') {
      if (teamFilter === 'none') {
        next = next.filter((u) => !teamKeyOf(u));
      } else {
        next = next.filter((u) => teamKeyOf(u) === selectedTeam);
      }
    }

    if (roleFilter !== 'all') {
      next = next.filter((u) => {
        const uid = String(u.id || '');
        const roles = rolesByUserId[uid] || [];
        const primary = primaryRoleByUserId[uid] || '';
        if (roleFilter === 'none') return roles.length === 0;
        if (roleFilter === 'lider') {
          const leaderish = new Set(['lider_equipe', 'coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt', 'admin']);
          return Boolean((u as any)?.is_leader) || leaderish.has(primary);
        }
        return roles.includes(roleFilter) || primary === roleFilter;
      });
    }

    const compareByName = (a: UserProfile, b: UserProfile) =>
      String(a.name || '').localeCompare(String(b.name || ''), getActiveLocale());

    next.sort((a, b) => {
      if (sortKey === 'name_asc') return compareByName(a, b);
      if (sortKey === 'name_desc') return compareByName(b, a);
      const ad = Date.parse(String(a.created_at || '')) || 0;
      const bd = Date.parse(String(b.created_at || '')) || 0;
      return sortKey === 'created_asc' ? ad - bd : bd - ad;
    });

    setFilteredUsers(next);
  }, [primaryRoleByUserId, roleFilter, rolesByUserId, searchTerm, sortKey, teamFilter, users]);

  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of users || []) {
      const key = normalizeTeamId(u.team_id || u.sigla_area);
      if (key) set.add(key);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [users]);

  useEffect(() => {
    filterUsers();
  }, [filterUsers]);

  const toggleSelect = (userId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const selected = users.filter(u => selectedIds.has(u.id));
    const emailsToDelete = selected.map(u => u.email).filter(Boolean) as string[];
    const idsToDelete = selected.map(u => u.id);
    if (!confirm(`Deletar permanentemente ${emailsToDelete.length} usuário(s)?`)) return;
    try {
      const { data, error } = await supabase.functions.invoke('studio-cleanup-users', {
        body: { emailsToDelete, idsToDelete }
      });
      if (error) throw error;
      setSelectedIds(new Set());
      toast({ title: 'Exclusão concluída', description: `${emailsToDelete.length} removidos` });
      await loadUsers();
    } catch (error: any) {
      toast({ title: 'Erro ao excluir selecionados', description: error.message, variant: 'destructive' });
    }
  };

  const handleCleanupTestUsers = async () => {
    if (testUsers.length === 0) {
      toast({
        title: 'Nenhum usuário de teste encontrado',
        variant: 'default',
      });
      return;
    }

    try {
      setCleanupLoading(true);

      // Deletar explicitamente apenas os usuários de teste detectados
      const emailsToDelete = testUsers
        .map(u => u.email)
        .filter(Boolean) as string[];
      const idsToDelete = testUsers.map(u => u.id);

      const { data, error } = await supabase.functions.invoke('studio-cleanup-users', {
        body: { emailsToDelete, idsToDelete }
      });

      if (error) throw error;

      toast({
        title: '🧹 Limpeza concluída!',
        description: `${data.summary.totalDeleted} usuários de teste removidos`,
      });

      setShowCleanupDialog(false);
      await loadUsers();
    } catch (error: any) {
      toast({
        title: 'Erro na limpeza',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCleanupLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    if (!confirm(`Tem certeza que deseja deletar ${userEmail}?`)) return;

    try {
      // Usar função de limpeza (com Service Role no backend)
      const { data, error } = await supabase.functions.invoke('studio-cleanup-users', {
        body: { emailsToDelete: [userEmail], idsToDelete: [userId] }
      });
      if (error) throw error;

      toast({
        title: 'Usuário deletado',
        description: `${userEmail} foi removido com sucesso`,
      });

      await loadUsers();
    } catch (error: any) {
      toast({
        title: 'Erro ao deletar usuário',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const stats = {
    total: users.length,
    testUsers: testUsers.length,
    realUsers: users.length - testUsers.length,
    withTeam: users.filter(u => normalizeTeamId(u.team_id || u.sigla_area)).length,
    withoutTeam: users.filter(u => !normalizeTeamId(u.team_id || u.sigla_area)).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold text-blue-50 mb-2">Gerenciamento de Usuários</h2>
        <p className="text-blue-100/80">Visualizar, buscar e gerenciar todos os usuários do sistema</p>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-black/20 border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-blue-100/70">Total</CardTitle>
            <div className="text-2xl font-bold text-blue-50">{stats.total}</div>
          </CardHeader>
        </Card>
        <Card className="bg-black/20 border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-blue-100/70">Usuários Reais</CardTitle>
            <div className="text-2xl font-bold text-green-600">{stats.realUsers}</div>
          </CardHeader>
        </Card>
        <Card className="bg-black/20 border-orange-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-blue-100/70">Usuários Teste</CardTitle>
            <div className="text-2xl font-bold text-orange-600">{stats.testUsers}</div>
          </CardHeader>
        </Card>
        <Card className="bg-black/20 border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-blue-100/70">Com Equipe</CardTitle>
            <div className="text-2xl font-bold text-blue-50">{stats.withTeam}</div>
          </CardHeader>
        </Card>
        <Card className="bg-black/20 border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-blue-100/70">Sem Equipe</CardTitle>
            <div className="text-2xl font-bold text-yellow-600">{stats.withoutTeam}</div>
          </CardHeader>
        </Card>
      </div>

      {/* Ações e Busca */}
      <Card className="bg-black/20 border-white/10">
        <CardHeader>
          <CardTitle className="text-blue-50">Ações Rápidas</CardTitle>
          <CardDescription className="text-blue-100/70">Busca, criação e limpeza</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por email, nome, base ou área..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={() => setCreateOpen(true)} className="gap-2">
                <UserPlus className="h-4 w-4" />
                Criar Usuário
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowCleanupDialog(true)}
                disabled={testUsers.length === 0}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Limpar Usuários de Teste ({testUsers.length})
              </Button>
            </div>
          </div>

          {testUsers.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-orange-600">
                  {testUsers.length} usuário(s) de teste detectado(s)
                </p>
                <p className="text-blue-100/70 mt-1">
                  Emails: {testUsers.slice(0, 3).map(u => u.email).join(', ')}
                  {testUsers.length > 3 && ` e mais ${testUsers.length - 3}...`}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
            <DialogDescription className="sr-only">
              Crie um novo usuário definindo equipe, acesso ao Studio e papel.
            </DialogDescription>
          </DialogHeader>
          <UserCreationForm />
        </DialogContent>
      </Dialog>

      {/* Lista de Usuários */}
      <Card className="bg-black/20 border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Usuários ({filteredUsers.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Filtrar por equipe</Label>
              <Select value={teamFilter} onValueChange={setTeamFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as equipes" />
                </SelectTrigger>
                <SelectContent position="item-aligned">
                  <SelectItem value="all">Todas as equipes</SelectItem>
                  <SelectItem value="none">Sem equipe</SelectItem>
                  {teamOptions.map((team) => (
                    <SelectItem key={team} value={team}>
                      {team}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Filtrar por perfil</Label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent position="item-aligned">
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="admin">ADMIN</SelectItem>
                  <SelectItem value="gerente_djt">GERENTE</SelectItem>
                  <SelectItem value="gerente_divisao_djtx">GERENTE DIV.</SelectItem>
                  <SelectItem value="coordenador_djtx">COORD.</SelectItem>
                  <SelectItem value="lider">LÍDER</SelectItem>
                  <SelectItem value="analista_financeiro">ANALISTA (Financeiro)</SelectItem>
                  <SelectItem value="content_curator">CURADOR</SelectItem>
                  <SelectItem value="invited">CONVIDADO</SelectItem>
                  <SelectItem value="colaborador">COLAB.</SelectItem>
                  <SelectItem value="none">Sem role</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Ordenar</Label>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="item-aligned">
                  <SelectItem value="created_desc">Cadastro: mais recentes</SelectItem>
                  <SelectItem value="created_asc">Cadastro: mais antigos</SelectItem>
                  <SelectItem value="name_asc">Nome: A–Z</SelectItem>
                  <SelectItem value="name_desc">Nome: Z–A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">Selecionados: {selectedIds.size}</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set(filteredUsers.map(u => u.id)))} disabled={filteredUsers.length === 0}>Selecionar filtrados</Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set(users.map(u => u.id)))} disabled={users.length === 0}>Selecionar todos</Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}>Limpar seleção</Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteSelected} disabled={selectedIds.size === 0} className="gap-2">
                <Trash2 className="h-4 w-4" /> Excluir selecionados
              </Button>
            </div>
          </div>
	          <ScrollArea className="h-[460px] pr-4">
	            <div className="space-y-2">
	              {filteredUsers.map((user) => {
	                const isTestUser = testUsers.find(tu => tu.id === user.id);
	                const avatar = (user as any)?.avatar_thumbnail_url || (user as any)?.avatar_url || null;
	                return (
	                  <div
	                    key={user.id}
	                    className={`flex items-center justify-between p-4 rounded-lg border ${
	                      isTestUser ? 'border-orange-500/30 bg-orange-500/5' : 'border-border'
	                    } hover:bg-muted/50 transition-colors`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('button') || target.closest('input[type="checkbox"]')) return;
                      openEditor(user);
                    }}
                  >
	                    <div className="flex items-start gap-3 flex-1 min-w-0">
	                      <input
	                        type="checkbox"
	                        checked={selectedIds.has(user.id)}
	                        onChange={() => toggleSelect(user.id)}
	                        className="mt-1"
	                      />
	                      <div className="mt-0.5 h-10 w-10 flex-shrink-0 rounded-full overflow-hidden bg-transparent">
	                        {avatar ? (
	                          <img
	                            src={avatar}
	                            alt={user.name || 'Avatar'}
	                            className="h-full w-full object-cover"
	                            loading="lazy"
	                            decoding="async"
	                          />
	                        ) : null}
	                      </div>
	                      <div className="space-y-1 min-w-0 flex-1">
	                        <div className="flex items-center gap-2">
	                        <p className="font-medium text-foreground truncate">{user.name}</p>
	                          <Badge variant={primaryRoleByUserId[String(user.id || '')] ? "secondary" : "outline"} className="text-[10px]">
	                            {primaryRoleByUserId[String(user.id || '')] ? roleLabel(primaryRoleByUserId[String(user.id || '')]) : "Sem role"}
                          </Badge>
                          {isTestUser && (
                            <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/20">
                              Teste
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                        {user.phone || user.telefone ? (
                          <p className="text-xs text-muted-foreground truncate">WhatsApp: {user.phone || user.telefone}</p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {normalizeTeamId(user.team_id || user.sigla_area) ? (
                            <span className="font-semibold text-primary">
                              {normalizeTeamId(user.team_id || user.sigla_area)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Sem equipe</span>
                          )}
                          <span className="text-muted-foreground">
                            Cadastro: {new Date(user.created_at).toLocaleDateString(getActiveLocale())}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditor(user)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteUser(user.id, user.email || 'Sem email')}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Editor Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription className="sr-only">
              Edite os dados do usuário selecionado e salve as alterações.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <div className="grid gap-1">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => updateForm('name', e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Matrícula</Label>
              <Input value={form.matricula} onChange={(e) => updateForm('matricula', e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Telefone (WhatsApp)</Label>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+55 11 91234-5678"
                value={form.phone}
                onChange={(e) => updateForm('phone', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Ao salvar aqui, o número é considerado confirmado.</p>
            </div>
            <div className="grid gap-1">
              <Label>Equipe / Sigla</Label>
              <Input value={form.sigla_area} onChange={(e) => handleSiglaChange(e.target.value)} placeholder="Ex: DJTB-CUB" />
              <p className="text-xs text-muted-foreground">Equipe/sigla é usada para escopo e relatórios internos.</p>
            </div>
            <div className="grid gap-1">
              <Label>Base operacional (cidade)</Label>
              <Input
                value={form.operational_base}
                onChange={(e) => updateForm('operational_base', e.target.value)}
                placeholder="Ex: Piraju, Cubatão, Santos..."
              />
              <p className="text-xs text-muted-foreground">Campo não editável pelo usuário; ajustado por líderes/admin.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 items-center">
              <div className="flex items-center justify-between border rounded-md p-2">
                <div>
                  <Label>É Líder</Label>
                </div>
                <Switch checked={form.is_leader} onCheckedChange={(v) => updateForm('is_leader', v as boolean)} />
              </div>
              <div className="flex items-center justify-between border rounded-md p-2">
                <div>
                  <Label>Acesso Studio</Label>
                </div>
                <Switch checked={form.studio_access} onCheckedChange={(v) => updateForm('studio_access', v as boolean)} />
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Data de Nascimento</Label>
              <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Papel principal (opcional)</Label>
              <select className="border rounded-md h-9 px-2 bg-background" value={primaryRoleForUser} onChange={(e) => setPrimaryRoleForUser(e.target.value)}>
                <option value="">Manter</option>
                <option value="colaborador">Colaborador</option>
                <option value="invited">Convidado (INVITED)</option>
                <option value="lider_equipe">Líder de Equipe</option>
                <option value="analista_financeiro">Analista Financeiro</option>
                <option value="coordenador_djtx">Coordenador DJTX</option>
                <option value="gerente_divisao_djtx">Gerente Divisão DJTX</option>
                <option value="gerente_djt">Gerente DJT</option>
                <option value="admin">Admin</option>
              </select>
              <div className="flex items-center justify-between border rounded-md p-2 mt-2">
                <div>
                  <Label>Curador de Conteúdo</Label>
                  <p className="text-xs text-muted-foreground">Acesso apenas ao HUB de curadoria no Studio.</p>
                </div>
                <Switch checked={isContentCuratorRole} onCheckedChange={(v) => setIsContentCuratorRole(Boolean(v))} />
              </div>
              <div className="flex items-center justify-between border rounded-md p-2 mt-2">
                <div>
                  <Label>Analista Financeiro</Label>
                  <p className="text-xs text-muted-foreground">Acesso ao Studio apenas para Reembolso &amp; Adiantamento.</p>
                </div>
                <Switch checked={isFinanceAnalystRole} onCheckedChange={(v) => setIsFinanceAnalystRole(Boolean(v))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={saveEditor} disabled={savingEdit}>
              {savingEdit ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Confirmação */}
      <AlertDialog open={showCleanupDialog} onOpenChange={setShowCleanupDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Confirmar Limpeza de Usuários de Teste
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Esta ação irá <strong>deletar permanentemente</strong> {testUsers.length} usuário(s) de teste:
                </p>
                <div className="bg-muted p-3 rounded-lg max-h-48 overflow-y-auto">
                  <ul className="text-sm space-y-1">
                    {testUsers.map(u => (
                      <li key={u.id} className="text-destructive">• {u.email} ({u.name})</li>
                    ))}
                  </ul>
                </div>
                <p className="text-green-600 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  {stats.realUsers} usuários reais serão mantidos
                </p>
                <p className="font-semibold text-foreground">Esta ação não pode ser desfeita!</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanupLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCleanupTestUsers}
              disabled={cleanupLoading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {cleanupLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar Limpeza
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
