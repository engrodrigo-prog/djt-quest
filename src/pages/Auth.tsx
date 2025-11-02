import { useState, useEffect } from "react";
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
import djtCover from '@/assets/backgrounds/djt-quest-cover.png';

interface UserOption {
  id: string;
  name: string;
  email: string;
  matricula?: string;
}

const LAST_USER_KEY = 'djt_last_user_id';

const Auth = () => {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserName, setSelectedUserName] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [password, setPassword] = useState("123456");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const normalizedQuery = query.trim().toLowerCase();

  const matchesSearch = (user: UserOption, needle: string) => {
    if (!needle) return true;
    const matricula = (user.matricula ?? "").toLowerCase();
    const name = (user.name ?? "").toLowerCase();
    const email = (user.email ?? "").toLowerCase();
    return (
      matricula.includes(needle) ||
      name.includes(needle) ||
      email.includes(needle)
    );
  };

  const filteredUsers = users.filter((user) => matchesSearch(user, normalizedQuery));

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
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
          setSelectedUserId(lastUser.id);
          setSelectedUserName(lastUser.name);
          setQuery(lastUser.matricula ?? "");
        }
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Erro ao carregar usuários');
    }
  };

  const attemptLogin = async (user: UserOption) => {
    setLoading(true);
    try {
      await signIn(user.email, password);
      localStorage.setItem(LAST_USER_KEY, user.id);
      navigate("/dashboard");
    } catch (error) {
      console.error("Login error:", error);
      toast.error("Email ou senha incorretos");
    } finally {
      setLoading(false);
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
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                      }}
                      onFocus={() => setOpen(true)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Escape') {
                          setOpen(false);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          const q = query.trim().toLowerCase();
                          const exactMatch = users.find((u) => {
                            const matricula = (u.matricula ?? "").trim().toLowerCase();
                            const name = (u.name ?? "").trim().toLowerCase();
                            return matricula === q || name === q;
                          });
                          
                          if (exactMatch) {
                            setSelectedUserId(exactMatch.id);
                            setSelectedUserName(exactMatch.name);
                            setQuery(exactMatch.matricula ?? "");
                            setOpen(false);
                            await attemptLogin(exactMatch);
                          } else if (filteredUsers.length === 1) {
                            const onlyUser = filteredUsers[0];
                            setSelectedUserId(onlyUser.id);
                            setSelectedUserName(onlyUser.name);
                            setQuery(onlyUser.matricula ?? onlyUser.name);
                            setOpen(false);
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
                              setSelectedUserId(user.id);
                              setSelectedUserName(user.name);
                              setQuery(user.matricula ?? user.name);
                              setOpen(false);
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
              />
              <p className="text-xs text-muted-foreground">
                Senha padrão: <code className="bg-muted px-1 rounded">123456</code>
              </p>
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
    </div>
  );
};

export default Auth;
