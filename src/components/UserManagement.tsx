import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Search, Trash2, Users, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  created_at: string;
  team_id: string | null;
  operational_base: string | null;
  sigla_area: string | null;
  teams: { name: string } | null;
}

export const UserManagement = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [testUsers, setTestUsers] = useState<UserProfile[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    filterUsers();
  }, [searchTerm, users]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          name,
          created_at,
          team_id,
          operational_base,
          sigla_area,
          teams:team_id (name)
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
  };

  const filterUsers = () => {
    if (!searchTerm) {
      setFilteredUsers(users);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = users.filter(user =>
      user.email?.toLowerCase().includes(term) ||
      user.name?.toLowerCase().includes(term) ||
      user.operational_base?.toLowerCase().includes(term) ||
      user.sigla_area?.toLowerCase().includes(term)
    );
    setFilteredUsers(filtered);
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

      // Manter usuários reais - deletar apenas os de teste
      const realUsers = users.filter(u => !testUsers.find(tu => tu.id === u.id));
      const emailsToKeep = realUsers.map(u => u.email).filter(Boolean) as string[];

      const { data, error } = await supabase.functions.invoke('studio-cleanup-users', {
        body: { emailsToKeep }
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
      // Deletar do banco de dados
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (profileError) throw profileError;

      // Deletar da autenticação (apenas admin pode fazer)
      const { error: authError } = await supabase.auth.admin.deleteUser(userId);
      
      if (authError) {
        console.warn('Não foi possível deletar do auth (requer service role):', authError);
      }

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
    withTeam: users.filter(u => u.team_id).length,
    withoutTeam: users.filter(u => !u.team_id).length,
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
        <h2 className="text-3xl font-bold text-foreground mb-2">Gerenciamento de Usuários</h2>
        <p className="text-muted-foreground">Visualizar, buscar e gerenciar todos os usuários do sistema</p>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Usuários Reais</CardTitle>
            <div className="text-2xl font-bold text-green-600">{stats.realUsers}</div>
          </CardHeader>
        </Card>
        <Card className="border-orange-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Usuários Teste</CardTitle>
            <div className="text-2xl font-bold text-orange-600">{stats.testUsers}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Com Equipe</CardTitle>
            <div className="text-2xl font-bold text-foreground">{stats.withTeam}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sem Equipe</CardTitle>
            <div className="text-2xl font-bold text-yellow-600">{stats.withoutTeam}</div>
          </CardHeader>
        </Card>
      </div>

      {/* Ações e Busca */}
      <Card>
        <CardHeader>
          <CardTitle>Ações Rápidas</CardTitle>
          <CardDescription>Limpeza e gerenciamento em massa</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por email, nome, base ou área..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
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

          {testUsers.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-orange-600">
                  {testUsers.length} usuário(s) de teste detectado(s)
                </p>
                <p className="text-muted-foreground mt-1">
                  Emails: {testUsers.slice(0, 3).map(u => u.email).join(', ')}
                  {testUsers.length > 3 && ` e mais ${testUsers.length - 3}...`}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lista de Usuários */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Usuários ({filteredUsers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-2">
              {filteredUsers.map((user) => {
                const isTestUser = testUsers.find(tu => tu.id === user.id);
                return (
                  <div
                    key={user.id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      isTestUser ? 'border-orange-500/30 bg-orange-500/5' : 'border-border'
                    } hover:bg-muted/50 transition-colors`}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate">{user.name}</p>
                        {isTestUser && (
                          <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/20">
                            Teste
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        {user.teams && <span className="bg-muted px-2 py-1 rounded">{user.teams.name}</span>}
                        {user.operational_base && <span>{user.operational_base}</span>}
                        {user.sigla_area && <span>{user.sigla_area}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteUser(user.id, user.email || 'Sem email')}
                      className="ml-4 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Dialog de Confirmação */}
      <AlertDialog open={showCleanupDialog} onOpenChange={setShowCleanupDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Confirmar Limpeza de Usuários de Teste
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>Esta ação irá <strong>deletar permanentemente</strong> {testUsers.length} usuário(s) de teste:</p>
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
