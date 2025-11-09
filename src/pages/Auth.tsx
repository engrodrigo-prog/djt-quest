import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import djtCover from '@/assets/backgrounds/djt-quest-cover.png';

interface UserOption {
  id: string;
  name: string;
  email: string;
  matricula?: string;
}

const LAST_USER_KEY = 'djt_last_user_id';
const MATRICULA_LOOKUP_MIN_LENGTH = 4;

const normalizeMatricula = (value?: string | null) =>
  (value ?? '').replace(/\D/g, '');

const Auth = () => {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserName, setSelectedUserName] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [password, setPassword] = useState("123456");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const matriculaLookupRef = useRef<string | null>(null);
  const { signIn, refreshUserSession } = useAuth();
  const navigate = useNavigate();

  const normalizedQuery = query.trim().toLowerCase();

  const matchesSearch = (u: UserOption, needle: string) => {
    if (!needle) return true;
    const digitsNeedle = normalizeMatricula(needle);
    const matricula = normalizeMatricula(u.matricula);
    const name = (u.name ?? '').toLowerCase();
    const email = (u.email ?? '').toLowerCase();
    return (
      (digitsNeedle && matricula.includes(digitsNeedle)) ||
      name.includes(needle) ||
      email.includes(needle)
    );
  };

  const filteredUsers = users.filter(u => matchesSearch(u, normalizedQuery));

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setOpen(true);
    const digitsOnly = normalizeMatricula(value);
    if (digitsOnly.length >= 3) {
      const localMatch = users.find(
        (u) => normalizeMatricula(u.matricula) === digitsOnly,
      );
      if (localMatch) {
        selectUser(localMatch, true);
        return;
      }
      if (digitsOnly.length >= MATRICULA_LOOKUP_MIN_LENGTH) {
        fetchUserByMatriculaDigits(digitsOnly);
      }
    }
  };

  const fetchUserByMatriculaDigits = useCallback(async (digits: string) => {
    if (matriculaLookupRef.current === digits) return;
    matriculaLookupRef.current = digits;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, matricula')
        .or(`matricula.eq.${digits},matricula.ilike.%${digits}%`)
        .limit(1)
        .maybeSingle();

      if (error || !data) return;

      const option = data as UserOption;
      setUsers((prev) => {
        if (prev.some((u) => u.id === option.id)) return prev;
        return [option, ...prev];
      });
      selectUser(option, true);
    } catch (error) {
      console.error('Lookup error:', error);
    } finally {
      if (matriculaLookupRef.current === digits) {
        matriculaLookupRef.current = null;
      }
    }
  }, [selectUser]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const attemptLogin = useCallback(async (user: UserOption) => {
    setLoading(true);
    try {
      const { error } = await signIn(user.email, password);

      if (error) {
        console.error("Login error:", error);
        toast.error("Não foi possível entrar", {
          description: error.message ?? "Verifique as credenciais e tente novamente",
        });
        return;
      }

      await refreshUserSession();
      localStorage.setItem(LAST_USER_KEY, user.id);
      // Se ainda está com a senha padrão, direciona ao Perfil e abre o diálogo de troca de senha
      if (password === '123456') {
        navigate('/profile');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open-password-dialog'));
        }, 300);
      } else {
        navigate("/dashboard");
      }
    } catch (error) {
      console.error("Login error:", error);
      toast.error("Falha inesperada ao entrar", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [navigate, password, refreshUserSession, signIn]);

  const selectUser = useCallback((user: UserOption, autoAttempt = false) => {
    setSelectedUserId(user.id);
    setSelectedUserName(user.name);
    setQuery(user.matricula ?? user.name);
    setOpen(false);
    requestAnimationFrame(() => {
      passwordRef.current?.focus();
    });
    if (autoAttempt && password && !loading) {
      attemptLogin(user);
    }
  }, [attemptLogin, loading, password]);

  const fetchUsers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, matricula')
        .order('name', { ascending: true });

      if (error) throw error;
      setUsers(data || []);

      // Check for last user in localStorage
      const lastUserId = localStorage.getItem(LAST_USER_KEY);
      if (lastUserId && data) {
        const lastUser = data.find(u => u.id === lastUserId);
        if (lastUser) {
          selectUser(lastUser);
        }
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Erro ao carregar usuários');
    }
  }, [selectUser]);

  const handleForgotSubmit = async () => {
    if (!resetIdentifier.trim()) {
      toast.error("Informe sua matrícula ou email");
      return;
    }
    setResetLoading(true);
    try {
      const response = await fetch('/api/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: resetIdentifier, reason: resetReason }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Falha ao enviar solicitação');
      toast.success('Solicitação enviada! Aguarde aprovação do líder.');
      setResetIdentifier('');
      setResetReason('');
      setForgotOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao enviar solicitação');
    } finally {
      setResetLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedUserId) {
      toast.error("Selecione um usuário");
      return;
    }

    const selectedUser = users.find(u => u.id === selectedUserId);
    if (!selectedUser) {
      toast.error("Usuário não encontrado");
      return;
    }

    await attemptLogin(selectedUser);
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 animate-fade-in relative"
      style={{
        backgroundImage: `url(${djtCover})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-black/30" />
      <Card className="w-full max-w-md bg-background backdrop-blur-sm shadow-2xl relative z-10">
        <CardHeader>
          <CardTitle>DJT Quest - Login</CardTitle>
          <CardDescription>
            {selectedUserName ? `Bem-vindo de volta, ${selectedUserName}!` : 'Digite nome ou matrícula para localizar seu acesso'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user">Matrícula</Label>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <div className="relative">
                    <Input
                      placeholder="Digite nome ou matrícula..."
                      value={query}
                      inputMode="numeric"
                      onChange={(e) => handleQueryChange(e.target.value)}
                      onFocus={() => setOpen(true)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Escape') {
                          setOpen(false);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          const q = query.trim().toLowerCase();
                          let exactMatch = users.find((u) =>
                            (u.matricula ?? '').trim().toLowerCase() === q ||
                            (u.name ?? '').trim().toLowerCase() === q
                          );
                          
                          // Se não achou, tenta uma busca rápida no servidor
                          if (!exactMatch && q.length >= 3) {
                            const { data: remote } = await supabase
                              .from('profiles')
                              .select('id, name, email, matricula')
                              .or(`matricula.ilike.%${q}%,name.ilike.%${q}%`)
                              .limit(5);
                            if (remote && remote.length > 0) {
                              setUsers(remote);
                              exactMatch = remote.find((u) => (u.matricula ?? '').trim().toLowerCase() === q);
                            }
                          }

                          if (exactMatch) {
                            selectUser(exactMatch);
                            await attemptLogin(exactMatch);
                          } else if (filteredUsers.length === 1) {
                            const onlyUser = filteredUsers[0];
                            selectUser(onlyUser);
                            await attemptLogin(onlyUser);
                          }
                        }
                      }}
                      className="w-full pr-10"
                      aria-expanded={open}
                      aria-controls="user-combobox"
                    />
                    <ChevronsUpDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
                  </div>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-[var(--radix-popover-trigger-width)] p-0 z-50 bg-popover border shadow-lg" 
                  align="start"
                  sideOffset={4}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  id="user-combobox"
                  role="listbox"
                >
                  <Command shouldFilter={false}>
                    <CommandList>
                      <CommandEmpty>
                        Nenhum usuário encontrado para “{query}”. Pesquise pelo nome ou matrícula.
                      </CommandEmpty>
                      <CommandGroup heading={filteredUsers.length > 0 ? `${filteredUsers.length} encontrado(s)` : undefined}>
                        {filteredUsers.map((user) => (
                          <CommandItem
                            key={user.id}
                            value={user.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                            }}
                            onSelect={() => {
                              selectUser(user);
                            }}
                            className={cn(selectedUserId === user.id && "bg-accent")}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedUserId === user.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {user.matricula ? `${user.matricula} — ${user.name}` : user.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Digite sua senha"
                autoFocus={!!selectedUserName}
                ref={passwordRef}
              />
              <p className="text-xs text-muted-foreground">
                Senha padrão: <code className="bg-muted px-1 rounded">123456</code>
              </p>
              <Button
                type="button"
                variant="link"
                className="px-0"
                onClick={() => setForgotOpen(true)}
              >
                Esqueci minha senha
              </Button>
            </div>
            
            <Button type="submit" className="w-full" disabled={!selectedUserId || loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>

            <div className="text-center text-sm mt-4">
              <span className="text-muted-foreground">Não tem conta? </span>
              <Link 
                to="/register" 
                className="text-primary hover:underline font-medium"
              >
                Solicitar Cadastro
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={forgotOpen} onOpenChange={(open) => {
        setForgotOpen(open);
        if (!open) {
          setResetIdentifier('');
          setResetReason('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar reset de senha</DialogTitle>
            <DialogDescription>
              Informe sua matrícula ou email para pedir uma nova senha. Seu líder precisará aprovar o reset.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="reset-identifier">Matrícula ou email</Label>
              <Input
                id="reset-identifier"
                placeholder="Ex.: 601555 ou seu.email@cpfl.com.br"
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-reason">Motivo (opcional)</Label>
              <Textarea
                id="reset-reason"
                placeholder="Descreva o motivo do reset"
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setForgotOpen(false)}>Cancelar</Button>
            <Button onClick={handleForgotSubmit} disabled={resetLoading}>
              {resetLoading ? 'Enviando...' : 'Solicitar reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Auth;
