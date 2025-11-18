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
import { Check, ChevronsUpDown, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import djtCover from '@/assets/backgrounds/djt-quest-cover.png';
import { apiFetch } from "@/lib/api";

interface UserOption {
  id: string;
  name: string;
  email: string;
  matricula?: string;
}

const LAST_USER_KEY = 'djt_last_user_id';
const MATRICULA_LOOKUP_MIN_LENGTH = 6;

const normalizeMatricula = (value?: string | null) =>
  (value ?? '').replace(/\D/g, '');

const Auth = () => {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserName, setSelectedUserName] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [password, setPassword] = useState("");
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
  const digitsQuery = normalizeMatricula(query);
  const nameTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const isMatriculaMode = !!digitsQuery && /^[0-9]+$/.test(digitsQuery);
  const allowSuggestions =
    (isMatriculaMode && digitsQuery.length >= MATRICULA_LOOKUP_MIN_LENGTH) ||
    (!isMatriculaMode && nameTokens.length >= 2 && nameTokens[1].length >= 1);

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

  const filteredUsers = allowSuggestions
    ? users.filter(u => matchesSearch(u, normalizedQuery))
    : [];

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

  const selectUser = useCallback((user: UserOption) => {
    setSelectedUserId(user.id);
    setSelectedUserName(user.name);
    setQuery(user.matricula ?? user.name);
    setOpen(false);
    requestAnimationFrame(() => {
      passwordRef.current?.focus();
    });
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setOpen(true);

    // Sempre que o usuário começar a digitar de novo, limpe seleção e senha
    if (!value) {
      setSelectedUserId("");
      setSelectedUserName("");
      setPassword("");
    }

    const digitsOnly = normalizeMatricula(value);
    // Só dispara lookup remoto após 6 dígitos da matrícula
    if (digitsOnly.length >= MATRICULA_LOOKUP_MIN_LENGTH) {
      fetchUserByMatriculaDigits(digitsOnly);
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
        selectUser(option);
    } catch (error) {
      console.error('Lookup error:', error);
    } finally {
      if (matriculaLookupRef.current === digits) {
        matriculaLookupRef.current = null;
      }
    }
  }, [selectUser]);

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

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleForgotSubmit = async () => {
    if (!resetIdentifier.trim()) {
      toast.error("Informe sua matrícula ou email");
      return;
    }
    setResetLoading(true);
    try {
      const response = await apiFetch('/api/admin?handler=request-password-reset', {
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
      <Card className="w-full max-w-md bg-background shadow-2xl relative z-10">
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
                      autoComplete="off"
                      inputMode="numeric"
                      onChange={(e) => handleQueryChange(e.target.value)}
                      onFocus={() => setOpen(true)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Escape') {
                          setOpen(false);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          const q = query.trim().toLowerCase();
                          const digitsOnly = normalizeMatricula(query);
                          const words = q.split(/\s+/).filter(Boolean);
                          let exactMatch = users.find((u) =>
                            (u.matricula ?? '').trim().toLowerCase() === q ||
                            (u.name ?? '').trim().toLowerCase() === q
                          );
                          
                          // Se não achou local, aplica regra de busca:
                          // - Matrícula: só depois de 6 dígitos
                          // - Nome: depois de digitar ao menos 2 palavras (nome + primeira letra do segundo nome)
                          if (!exactMatch) {
                            if (digitsOnly && digitsOnly.length >= MATRICULA_LOOKUP_MIN_LENGTH) {
                              const { data: remote } = await supabase
                                .from('profiles')
                                .select('id, name, email, matricula')
                                .or(`matricula.eq.${digitsOnly},matricula.ilike.%${digitsOnly}%`)
                                .limit(5);
                              if (remote && remote.length > 0) {
                                setUsers(remote);
                                exactMatch = remote.find((u) => normalizeMatricula(u.matricula) === digitsOnly) || remote[0];
                              }
                            } else if (words.length >= 2 && words[1].length >= 1) {
                              const { data: remote } = await supabase
                                .from('profiles')
                                .select('id, name, email, matricula')
                                .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
                                .limit(5);
                              if (remote && remote.length > 0) {
                                setUsers(remote);
                                exactMatch = remote[0];
                              }
                            } else {
                              toast.error('Digite ao menos 6 dígitos da matrícula ou o nome e a primeira letra do segundo nome para buscar.');
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
              <input type="text" name="username" autoComplete="username" hidden readOnly />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Digite sua senha"
                autoFocus={!!selectedUserName}
                autoComplete={selectedUserId ? "current-password" : "off"}
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

            <Button
              type="button"
              variant="outline"
              className="w-full mt-1 text-sm"
              onClick={() => {
                try {
                  const url = `${window.location.origin}/auth`;
                  const text = `Acesse o DJT Quest pelo link:\n${url}`;
                  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
                  window.open(waUrl, '_blank', 'noopener,noreferrer');
                } catch {
                  // fallback silencioso
                }
              }}
            >
              Compartilhar acesso pelo WhatsApp
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
              <div className="flex items-center justify-between">
                <Label htmlFor="reset-reason">Motivo (opcional)</Label>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={async () => {
                    const text = resetReason.trim();
                    if (!text) return;
                    try {
                      const resp = await apiFetch("/api/ai?handler=cleanup-text", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: "Motivo do reset de senha", description: text, language: "pt-BR" }),
                      });
                      const json = await resp.json().catch(() => ({}));
                      if (!resp.ok || !json?.cleaned?.description) {
                        throw new Error(json?.error || "Falha na revisão automática");
                      }
                      setResetReason(String(json.cleaned.description || text));
                      toast.success("Motivo revisado (ortografia e pontuação).");
                    } catch (e: any) {
                      toast.error(e?.message || "Não foi possível revisar agora.");
                    }
                  }}
                  title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
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
