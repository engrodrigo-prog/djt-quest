import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Zap, ArrowRight, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { BootstrapManager } from '@/components/BootstrapManager';

const TestQuickLogin = ({ onTestLogin }: { onTestLogin: (role: string) => void }) => {
  const testAccounts = [
    { role: 'colaborador', label: 'Colaborador', desc: 'Usuário básico', color: 'bg-blue-500' },
    { role: 'coordenador', label: 'Coordenador (DJTX-ABC)', desc: 'Avalia ações', color: 'bg-green-500' },
    { role: 'lider_divisao', label: 'Líder de Divisão (DJTX)', desc: 'Avalia ações', color: 'bg-purple-500' },
    { role: 'gerente', label: 'Gerente (DJT)', desc: 'Gestão completa', color: 'bg-orange-500' },
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, user } = useAuth();
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

    // Try to sign in
    const { error: signInError } = await signIn(testEmail, testPassword);

    if (signInError) {
      toast({
        title: 'Erro',
        description: 'Conta não existe. Solicite ao líder que crie sua conta no Studio.',
        variant: 'destructive'
      });
    } else {
      toast({
        title: 'Login de teste bem-sucedido!',
        description: 'Logado com sucesso',
      });
    }
    
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
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

        {/* Bootstrap Manager */}
        {user && <BootstrapManager />}

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
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Apenas líderes podem criar novas contas através do Studio
        </p>

        <p className="text-center text-xs text-muted-foreground">
          Conhecimento • Habilidade • Atitude • Segurança
        </p>
      </div>
    </div>
  );
}
