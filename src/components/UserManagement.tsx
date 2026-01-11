import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('all');
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

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          name,
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

      setUsers(data || []);
      
      // Detectar usuários de teste
      const testUsersList = (data || []).filter(u => 
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
      sigla_area: user.sigla_area || user.operational_base || '',
      operational_base: user.sigla_area || user.operational_base || '',
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
          : has('invited')
          ? 'invited'
          : has('colaborador')
          ? 'colaborador'
          : '';
      setPrimaryRoleForUser(primary);
      setIsContentCuratorRole(has('content_curator'));
    } catch {
      setInitialRolesForUser([]);
      setPrimaryRoleForUser('');
      setIsContentCuratorRole(false);
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
        operational_base: form.sigla_area || null,
        is_leader: form.is_leader,
        // Curador de conteúdo precisa entrar no Studio (hub de curadoria)
        studio_access: Boolean(form.studio_access || isContentCuratorRole),
      };
      if (dateOfBirth) payload.date_of_birth = dateOfBirth;
      if (primaryRoleForUser) payload.role = primaryRoleForUser;

      // Differential role updates (avoid destructive role replacement)
      const hadCurator = initialRolesForUser.includes('content_curator');
      if (!hadCurator && isContentCuratorRole) payload.add_roles = ['content_curator'];
      if (hadCurator && !isContentCuratorRole) payload.remove_roles = ['content_curator'];

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
      normalizeTeamId(u.team_id || u.sigla_area || u.operational_base);

    let next = (users || []).filter((user) => {
      if (!term) return true;
      return (
        user.email?.toLowerCase().includes(term) ||
        user.name?.toLowerCase().includes(term) ||
        user.phone?.toLowerCase().includes(term) ||
        user.operational_base?.toLowerCase().includes(term) ||
        user.sigla_area?.toLowerCase().includes(term) ||
        user.team_id?.toLowerCase().includes(term)
      );
    });

    if (teamFilter !== 'all') {
      if (teamFilter === 'none') {
        next = next.filter((u) => !teamKeyOf(u));
      } else {
        next = next.filter((u) => teamKeyOf(u) === selectedTeam);
      }
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
  }, [searchTerm, sortKey, teamFilter, users]);

  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of users || []) {
      const key = normalizeTeamId(u.team_id || u.sigla_area || u.operational_base);
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
    withTeam: users.filter(u => normalizeTeamId(u.team_id || u.sigla_area || u.operational_base)).length,
    withoutTeam: users.filter(u => !normalizeTeamId(u.team_id || u.sigla_area || u.operational_base)).length,
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
        <DialogContent
          className="sm:max-w-lg"
          aria-describedby="create-user-description"
        >
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
            <p id="create-user-description" className="sr-only">
              Crie um novo usuário definindo equipe, acesso ao Studio e papel.
            </p>
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate">{user.name}</p>
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
                          {normalizeTeamId(user.team_id || user.sigla_area || user.operational_base) ? (
                            <span className="font-semibold text-primary">
                              {normalizeTeamId(user.team_id || user.sigla_area || user.operational_base)}
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
        <DialogContent
          className="sm:max-w-lg"
          aria-describedby="edit-user-description"
        >
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <p id="edit-user-description" className="sr-only">
              Edite os dados do usuário selecionado e salve as alterações.
            </p>
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
              <p className="text-xs text-muted-foreground">A base operacional pode ser ajustada depois via pedido de alteração de perfil.</p>
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
