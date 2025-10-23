import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { AvatarCapture } from "@/components/AvatarCapture";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { useToast } from "@/hooks/use-toast";
import { Shield, Zap, User, Check } from "lucide-react";

interface Team {
  id: string;
  name: string;
  coordination: {
    division: {
      id: string;
      name: string;
    };
  };
}

export default function Register() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Basic data
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2: Role and hierarchy
  const [role, setRole] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [teams, setTeams] = useState<Team[]>([]);

  // Step 3: Avatar
  const [avatarBase64, setAvatarBase64] = useState<string>("");

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async () => {
    const { data } = await supabase
      .from("teams")
      .select(`
        id,
        name,
        coordinations!inner(
          divisions!inner(
            id,
            name
          )
        )
      `)
      .order("name");

    if (data) {
      // Transform nested data
      const transformedTeams = data.map((t: any) => ({
        id: t.id,
        name: t.name,
        coordination: {
          division: {
            id: t.coordinations.divisions.id,
            name: t.coordinations.divisions.name,
          },
        },
      }));
      setTeams(transformedTeams);
    }
  };

  const selectedTeam = teams.find((t) => t.id === teamId);
  const divisionName = selectedTeam?.coordination.division.name;

  const handleNext = () => {
    if (step === 1) {
      if (!name || !email || !password) {
        toast({
          title: "Erro",
          description: "Preencha todos os campos",
          variant: "destructive",
        });
        return;
      }
      if (password.length < 6) {
        toast({
          title: "Erro",
          description: "A senha deve ter no mínimo 6 caracteres",
          variant: "destructive",
        });
        return;
      }
    }

    if (step === 2) {
      if (!role) {
        toast({
          title: "Erro",
          description: "Selecione um perfil",
          variant: "destructive",
        });
        return;
      }
      if (role === "colaborador" && !teamId) {
        toast({
          title: "Erro",
          description: "Colaboradores devem selecionar uma equipe",
          variant: "destructive",
        });
        return;
      }
    }

    setStep(step + 1);
  };

  const handleRegister = async () => {
    setLoading(true);

    try {
      // Sign up user
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
          },
        },
      });

      if (signUpError) throw signUpError;
      if (!authData.user) throw new Error("Falha no cadastro");

      const userId = authData.user.id;

      // Update profile with team if colaborador
      if (role === "colaborador" && teamId) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ team_id: teamId })
          .eq("id", userId);

        if (profileError) throw profileError;
      }

      // Assign role
      const { error: roleError } = await supabase
        .from("user_roles")
        .insert({
          user_id: userId,
          role: role as any,
        });

      if (roleError) throw roleError;

      // Process avatar if captured
      if (avatarBase64) {
        const { error: avatarError } = await supabase.functions.invoke(
          "process-avatar",
          {
            body: { userId, imageBase64: avatarBase64 },
          }
        );

        if (avatarError) {
          console.error("Avatar processing error:", avatarError);
          // Don't throw, avatar is optional
        }
      }

      toast({
        title: "Bem-vindo ao DJT Go! 🎮",
        description: "Cadastro realizado com sucesso",
      });

      // Auto sign in
      await supabase.auth.signInWithPassword({ email, password });
      navigate("/");
    } catch (error: any) {
      console.error("Registration error:", error);
      toast({
        title: "Erro no cadastro",
        description: error.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const progress = (step / 4) * 100;

  const roleLabels: Record<string, string> = {
    colaborador: "Colaborador",
    coordenador: "Coordenador (DJTX-ABC)",
    lider_divisao: "Líder de Divisão (DJTX)",
    gerente: "Gerente (DJT)",
  };

  const hasStudioAccess = ["coordenador", "lider_divisao", "gerente"].includes(role);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Shield className="h-8 w-8 text-primary" />
            <Zap className="h-8 w-8 text-secondary" />
          </div>
          <h1 className="text-3xl font-bold">Cadastro DJT Go</h1>
          <p className="text-muted-foreground">
            Complete seu cadastro e comece a jornada
          </p>
        </div>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Etapa {step} de 4</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step 1: Basic Data */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Dados Básicos</CardTitle>
              <CardDescription>Informações pessoais para seu perfil</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">Nome Completo *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome completo"
                />
              </div>
              <div>
                <Label htmlFor="email">E-mail *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.email@cpfl.com.br"
                />
              </div>
              <div>
                <Label htmlFor="password">Senha *</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <Button onClick={handleNext} className="w-full">
                Próximo
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Role & Hierarchy */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Perfil e Hierarquia</CardTitle>
              <CardDescription>Selecione seu papel na organização</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="role">Perfil *</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="role">
                    <SelectValue placeholder="Escolha seu perfil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="colaborador">Colaborador</SelectItem>
                    <SelectItem value="coordenador">Coordenador (DJTX-ABC)</SelectItem>
                    <SelectItem value="lider_divisao">Líder de Divisão (DJTX)</SelectItem>
                    <SelectItem value="gerente">Gerente (DJT)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {role === "colaborador" && (
                <div>
                  <Label htmlFor="team">Equipe *</Label>
                  <Select value={teamId} onValueChange={setTeamId}>
                    <SelectTrigger id="team">
                      <SelectValue placeholder="Escolha sua equipe" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTeam && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Divisão: {divisionName}
                    </p>
                  )}
                </div>
              )}

              {hasStudioAccess && (
                <div className="p-4 bg-primary/10 rounded-lg border border-primary/20">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Acesso ao Studio Liberado
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Você poderá criar desafios, avaliar ações e gerenciar usuários
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={() => setStep(1)} variant="outline" className="w-full">
                  Voltar
                </Button>
                <Button onClick={handleNext} className="w-full">
                  Próximo
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Avatar */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Foto do Perfil</CardTitle>
              <CardDescription>
                Capture ou selecione uma foto para personalizar seu avatar
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AvatarCapture
                onCapture={(image) => {
                  setAvatarBase64(image);
                  setStep(4);
                }}
                onSkip={() => setStep(4)}
              />
            </CardContent>
          </Card>
        )}

        {/* Step 4: Confirmation */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle>Confirmação</CardTitle>
              <CardDescription>Revise seus dados antes de finalizar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                {avatarBase64 ? (
                  <div className="relative w-20 h-20 rounded-full overflow-hidden border-4 border-primary/20">
                    <img src={avatarBase64} alt="Avatar" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-secondary/20 flex items-center justify-center">
                    <User className="w-10 h-10 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="font-semibold text-lg">{name}</p>
                  <p className="text-sm text-muted-foreground">{email}</p>
                </div>
              </div>

              <div className="space-y-2 p-4 bg-secondary/10 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Perfil:</span>
                  <span className="font-semibold">{roleLabels[role]}</span>
                </div>
                {role === "colaborador" && selectedTeam && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Equipe:</span>
                      <span className="font-semibold">{selectedTeam.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Divisão:</span>
                      <span className="font-semibold">{divisionName}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-3">
                <Button onClick={() => setStep(3)} variant="outline" className="w-full">
                  Voltar
                </Button>
                <Button
                  onClick={handleRegister}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? (
                    "Cadastrando..."
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Salvar e Entrar no Jogo
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}