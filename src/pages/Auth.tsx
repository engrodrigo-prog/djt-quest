import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
}

const LAST_USER_KEY = 'djt_last_user_id';

const Auth = () => {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserName, setSelectedUserName] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email')
        .order('name');

      if (error) throw error;
      setUsers(data || []);

      // Check for last user in localStorage
      const lastUserId = localStorage.getItem(LAST_USER_KEY);
      if (lastUserId && data) {
        const lastUser = data.find(u => u.id === lastUserId);
        if (lastUser) {
          setSelectedUserId(lastUser.id);
          setSelectedUserName(lastUser.name);
        }
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Erro ao carregar usuários');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedUserId) {
      toast.error("Selecione um usuário");
      return;
    }

    setLoading(true);

    try {
      const selectedUser = users.find(u => u.id === selectedUserId);
      if (!selectedUser) {
        toast.error("Usuário não encontrado");
        return;
      }

      await signIn(selectedUser.email, password);
      
      // Save user to localStorage
      localStorage.setItem(LAST_USER_KEY, selectedUserId);
      
      navigate("/dashboard");
    } catch (error) {
      console.error("Login error:", error);
      toast.error("Email ou senha incorretos");
    } finally {
      setLoading(false);
    }
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
      <Card className="w-full max-w-md bg-background/90 backdrop-blur-md shadow-2xl relative z-10">
        <CardHeader>
          <CardTitle>DJT Quest - Login</CardTitle>
          <CardDescription>
            {selectedUserName ? `Bem-vindo de volta, ${selectedUserName}!` : 'Comece digitando seu nome'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user">Usuário</Label>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                    onClick={() => setOpen(true)}
                  >
                    {selectedUserName || "Selecione ou digite seu nome..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-[var(--radix-popover-trigger-width)] p-0 z-50 bg-popover border shadow-lg" 
                  align="start"
                  sideOffset={4}
                >
                  <Command>
                    <CommandInput placeholder="Digite seu nome..." autoFocus />
                    <CommandList>
                      <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                      <CommandGroup heading={users.length > 0 ? `${users.length} usuários` : undefined}>
                        {users.map((user) => (
                          <CommandItem
                            key={user.id}
                            value={user.name}
                            onSelect={() => {
                              setSelectedUserId(user.id);
                              setSelectedUserName(user.name);
                              setOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedUserId === user.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {user.name}
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
            
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
