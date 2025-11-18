import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { getOperationalBaseOptions } from "@/lib/operationalBase";

const registerSchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Nome é obrigatório")
    .max(100, "Nome deve ter no máximo 100 caracteres"),
  email: z.string()
    .trim()
    .email("Email inválido")
    .max(255, "Email deve ter no máximo 255 caracteres"),
  telefone: z.string()
    .trim()
    .max(20, "Telefone deve ter no máximo 20 caracteres")
    .optional(),
  matricula: z.string()
    .trim()
    .max(50, "Matrícula deve ter no máximo 50 caracteres")
    .optional(),
  operational_base: z.string()
    .trim()
    .min(1, "Base operacional é obrigatória")
    .max(100, "Base operacional deve ter no máximo 100 caracteres"),
  sigla_area: z.string()
    .trim()
    .min(1, "Sigla da área é obrigatória")
    .max(10, "Sigla deve ter no máximo 10 caracteres")
    .regex(/^[A-Z0-9-]+$/, "Sigla deve conter apenas letras maiúsculas, números e hífen"),
});

export default function Register() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    telefone: "",
    matricula: "",
    operational_base: "",
    sigla_area: "",
  });

  // Carregar equipes (bases operacionais) para as listas suspensas
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('teams')
        .select('id, name')
        .order('name');
      if (active && data) setTeams(data as any);
    })();
    return () => { active = false };
  }, []);

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validar dados com zod
      const validatedData = registerSchema.parse(formData);

      // Inserir na tabela pending_registrations
      const { error: insertError } = await supabase
        .from("pending_registrations")
        .insert({
          name: validatedData.name,
          email: validatedData.email,
          telefone: validatedData.telefone || null,
          matricula: validatedData.matricula || null,
          operational_base: validatedData.operational_base,
          sigla_area: validatedData.sigla_area.toUpperCase(),
          status: "pending",
        });

      if (insertError) {
        console.error("Erro ao criar solicitação:", insertError);
        
        // Verificar se é erro de email duplicado
        if (insertError.code === "23505") {
          toast.error("Este email já possui uma solicitação pendente.");
          return;
        }
        
        throw insertError;
      }

      toast.success("Solicitação enviada com sucesso!", {
        description: "Aguarde a aprovação do coordenador para acessar o sistema.",
      });

      // Redirecionar para login após 2 segundos
      setTimeout(() => {
        navigate("/auth");
      }, 2000);

    } catch (error) {
      if (error instanceof z.ZodError) {
        // Mostrar primeiro erro de validação
        const firstError = error.issues[0];
        toast.error(firstError.message);
      } else {
        console.error("Erro ao enviar solicitação:", error);
        toast.error("Erro ao enviar solicitação. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      {/* Background */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/src/assets/backgrounds/splash-bg.png')" }}
      >
        <div className="absolute inset-0 bg-background/80" />
      </div>

      {/* Form */}
      <Card className="w-full max-w-md relative z-10 bg-background">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Solicitar Cadastro</CardTitle>
          <CardDescription className="text-center">
            Preencha seus dados para solicitar acesso ao DJT Quest
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome Completo *</Label>
              <Input
                id="name"
                type="text"
                placeholder="Digite seu nome completo"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                required
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu.email@exemplo.com"
                value={formData.email}
                onChange={(e) => handleChange("email", e.target.value)}
                required
                maxLength={255}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input
                id="telefone"
                type="tel"
                placeholder="(00) 00000-0000"
                value={formData.telefone}
                onChange={(e) => handleChange("telefone", e.target.value)}
                maxLength={20}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="matricula">Matrícula</Label>
              <Input
                id="matricula"
                type="text"
                placeholder="Sua matrícula"
                value={formData.matricula}
                onChange={(e) => handleChange("matricula", e.target.value)}
                maxLength={50}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="operational_base">Base Operacional (Equipe) *</Label>
              {(() => {
                const options = getOperationalBaseOptions(formData.sigla_area);
                if (options.length === 0) {
                  return (
                    <Input
                      id="operational_base"
                      placeholder="Ex.: Cubatão, Santos, Votorantim..."
                      value={formData.operational_base}
                      onChange={(e) => handleChange("operational_base", e.target.value)}
                    />
                  );
                }
                return (
                  <Select
                    onValueChange={(val) => handleChange("operational_base", val)}
                    value={formData.operational_base}
                  >
                    <SelectTrigger id="operational_base">
                      <SelectValue placeholder="Selecione sua base operacional" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                Sua base deve respeitar a lista de cidades associadas à equipe. Líderes revisarão e aprovarão esse vínculo.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sigla_area">Equipe/Sigla *</Label>
              <Select
                onValueChange={(val) => {
                  handleChange('sigla_area', val.toUpperCase());
                  const baseOptions = getOperationalBaseOptions(val);
                  if (baseOptions.length && !baseOptions.includes(formData.operational_base)) {
                    handleChange('operational_base', baseOptions[0]);
                  }
                }}
                value={formData.sigla_area || undefined}
              >
                <SelectTrigger id="sigla_area">
                  <SelectValue placeholder="Selecione sua equipe (sigla – nome)" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="font-mono font-semibold">{t.id}</span>
                      {t.name && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          — {t.name}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Enviando..." : "Solicitar Cadastro"}
            </Button>

            <Button 
              type="button" 
              variant="outline" 
              className="w-full"
              onClick={() => navigate("/auth")}
              disabled={loading}
            >
              Voltar para Login
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
