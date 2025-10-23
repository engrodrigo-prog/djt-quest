import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Zap, ArrowRight, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const TestQuickLogin = ({ onTestLogin }: { onTestLogin: (role: string) => void }) => {
  const testAccounts = [
    { role: 'colaborador', label: 'Colaborador', desc: 'Usuário básico', color: 'bg-blue-500' },
    { role: 'coordenador', label: 'Coordenador', desc: 'Avalia ações', color: 'bg-green-500' },
    { role: 'lider_divisao', label: 'Líder Divisão', desc: 'Avalia ações', color: 'bg-purple-500' },
    { role: 'gerente', label: 'Gerente', desc: 'Gestão completa', color: 'bg-orange-500' },
  ];

  return (
    <Card className="w-full border-dashed">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-accent" />
          <CardTitle className="text-center text-base">Login Rápido de Teste</CardTitle>
        </div>
        <CardDescription className="text-center text-xs">
          Crie/acesse conta de teste com role específica
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {testAccounts.map((account) => (
          <Button
            key={account.role}
            variant="outline"
            className="w-full justify-start h-auto py-2.5"
            onClick={() => onTestLogin(account.role)}
          >
            <div className={`w-2.5 h-2.5 rounded-full ${account.color} mr-2.5 flex-shrink-0`} />
            <div className="flex flex-col items-start">
              <span className="font-semibold text-sm">{account.label}</span>
              <span className="text-xs text-muted-foreground">{account.desc}</span>
            </div>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
};

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleTestLogin = async (role: string) => {
    setLoading(true);
    const testEmail = `teste.${role}@djtgo.local`;
    const testPassword = 'Teste@123456';
    const testName = `Teste ${role.charAt(0).toUpperCase() + role.slice(1).replace('_', ' ')}`;

    // Try to sign in first
    const { error: signInError } = await signIn(testEmail, testPassword);

    if (signInError) {
      // Account doesn't exist, create it
      const { data, error } = await signUp(testEmail, testPassword, testName);
      
      if (error) {
        toast({
          title: 'Erro',
          description: error.message,
          variant: 'destructive'
        });
      } else if (data.user) {
        // Assign role to the new user
        await supabase.from('user_roles').insert([{
          user_id: data.user.id,
          role: role as any
        }]);
        
        toast({
          title: 'Conta de teste criada!',
          description: `Login como ${testName}`,
        });
      }
    } else {
      // Account exists, logged in
      toast({
        title: 'Login de teste bem-sucedido!',
        description: `Logado como ${testName}`,
      });
    }
    
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: "Erro no login",
            description: error.message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Login realizado",
            description: "Bem-vindo ao DJT Go!",
          });
        }
      } else {
        if (!name || name.length < 2) {
          toast({
            title: "Nome inválido",
            description: "Por favor, insira seu nome completo",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        const { error } = await signUp(email, password, name);
        if (error) {
          toast({
            title: "Erro no cadastro",
            description: error.message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Cadastro realizado",
            description: "Bem-vindo ao DJT Go! Você já pode começar.",
          });
        }
      }
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-3">
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Shield className="h-7 w-7 text-primary" />
            <Zap className="h-7 w-7 text-secondary" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            DJT Go
          </h1>
          <p className="text-xs text-muted-foreground">CPFL Subtransmissão</p>
        </div>

        {/* Test Mode */}
        <TestQuickLogin onTestLogin={handleTestLogin} />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              ou login normal
            </span>
          </div>
        </div>

        {/* Auth Forms */}
        <Card>
          <CardContent className="pt-6">
            <Tabs value={isLogin ? "login" : "signup"} onValueChange={(v) => setIsLogin(v === "login")}>
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="login" className="text-sm">Entrar</TabsTrigger>
                <TabsTrigger value="signup" className="text-sm">Criar Conta</TabsTrigger>
              </TabsList>
              
              <TabsContent value="login">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-sm">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-sm">Senha</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="h-10"
                    />
                  </div>
                  <Button type="submit" className="w-full h-10 mt-2" disabled={loading}>
                    {loading ? "Entrando..." : "Entrar"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </form>
              </TabsContent>
              
              <TabsContent value="signup">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-sm">Nome Completo</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Seu nome"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email" className="text-sm">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password" className="text-sm">Senha</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="Mínimo 6 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="h-10"
                    />
                  </div>
                  <Button type="submit" className="w-full h-10 mt-2" disabled={loading}>
                    {loading ? "Cadastrando..." : "Cadastrar"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Conhecimento • Habilidade • Atitude • Segurança
        </p>
      </div>
    </div>
  );
}
