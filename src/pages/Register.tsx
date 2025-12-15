import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { getOperationalBaseOptions } from "@/lib/operationalBase";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandInput } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import registerBg from "@/assets/backgrounds/BG.png";

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

const GUEST_TEAM_ID = "CONVIDADOS";
const REGISTRATION_TEAM_IDS = [
  "DJT",
  "DJT-PLAN",
  "DJTV",
  "DJTV-VOR",
  "DJTV-JUN",
  "DJTV-PJU",
  "DJTV-ITA",
  "DJTB",
  "DJTB-CUB",
  "DJTB-STO",
  GUEST_TEAM_ID,
] as const;

const REGISTRATION_TEAM_ORDER = new Map(REGISTRATION_TEAM_IDS.map((id, idx) => [id, idx]));

const normalizeTeamId = (id: unknown) => String(id ?? "").trim().toUpperCase();

const filterAndOrderRegistrationTeams = (raw: Array<{ id: string; name?: string | null }>) => {
  const byId = new Map<string, { id: string; name: string }>();
  for (const t of raw) {
    const id = normalizeTeamId(t.id);
    if (!REGISTRATION_TEAM_ORDER.has(id)) continue;
    const name = String(t.name ?? "").trim();
    byId.set(id, { id, name: name || id });
  }

  // Guarantee every allowed id exists (even if DB is missing rows)
  for (const id of REGISTRATION_TEAM_IDS) {
    if (!byId.has(id)) {
      byId.set(id, { id, name: id === GUEST_TEAM_ID ? "Convidados (externo)" : id });
    }
  }

  return REGISTRATION_TEAM_IDS.map((id) => byId.get(id)!).filter(Boolean);
};

export default function Register() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>(() => filterAndOrderRegistrationTeams([]));
  const [bases, setBases] = useState<string[]>([]);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [basesOpen, setBasesOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const [baseQuery, setBaseQuery] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    telefone: "",
    matricula: "",
    operational_base: "",
    sigla_area: "",
  });
  const sigla = String(formData.sigla_area || "").toUpperCase().trim();
  const isGuest = sigla === GUEST_TEAM_ID || sigla === "EXTERNO";

  // Carregar equipes (bases operacionais) para as listas suspensas
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const resp = await fetch("/api/registration-options", { cache: "no-store" });
        const json = await resp.json().catch(() => ({}));
        const list = Array.isArray(json?.teams) ? json.teams : [];
        const mapped = list
          .map((t: any) => ({ id: String(t?.id || "").trim(), name: String(t?.name || "").trim() }))
          .filter((t: any) => t.id)
          .map((t: any) => ({ id: t.id, name: t.name || t.id }));
        if (active) setTeams(filterAndOrderRegistrationTeams(mapped));
      } catch {
        const { data } = await supabase.from("teams").select("id, name").order("name");
        if (active && data) setTeams(filterAndOrderRegistrationTeams(data as any));
      }
    })();
    return () => { active = false };
  }, []);

  // Carregar bases por equipe/sigla escolhida (a partir de casos já cadastrados)
  useEffect(() => {
    let active = true;
    (async () => {
      if (!sigla || isGuest) {
        if (active) setBases([]);
        return;
      }
      try {
        const resp = await fetch(`/api/registration-options?team=${encodeURIComponent(sigla)}`, { cache: "no-store" });
        const json = await resp.json().catch(() => ({}));
        const fromApi = Array.isArray(json?.bases) ? json.bases.map((x: any) => String(x || "").trim()).filter(Boolean) : [];
        const fromStatic = getOperationalBaseOptions(sigla) || [];
        const merged = Array.from(new Set([...fromApi, ...fromStatic])).sort((a, b) => a.localeCompare(b, "pt-BR"));
        if (active) setBases(merged);
        if (active && merged.length && (!formData.operational_base || !merged.includes(formData.operational_base))) {
          // não forçar seleção se o usuário já digitou algo; só sugere quando vazio
          if (!formData.operational_base) setFormData((prev) => ({ ...prev, operational_base: merged[0] }));
        }
      } catch {
        const fallback = (getOperationalBaseOptions(sigla) || []).slice();
        if (active) setBases(fallback);
      }
    })();
    return () => { active = false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigla]);

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const teamOptions = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    const list = filterAndOrderRegistrationTeams(teams).slice();
    if (!q) return list;
    return list.filter((t) => `${t.id} ${t.name}`.toLowerCase().includes(q));
  }, [teams, teamQuery]);

  const baseOptions = useMemo(() => {
    const q = baseQuery.trim().toLowerCase();
    const list = bases.slice();
    if (!q) return list;
    return list.filter((b) => String(b).toLowerCase().includes(q));
  }, [bases, baseQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // normalizar convidado (sem mutar o state diretamente)
      const payload = {
        ...formData,
        sigla_area: isGuest ? GUEST_TEAM_ID : formData.sigla_area,
        operational_base: isGuest ? GUEST_TEAM_ID : formData.operational_base,
      };
      // Validar dados com zod
      const validatedData = registerSchema.parse(payload);

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
        style={{ backgroundImage: `url(${registerBg})` }}
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
              <Label htmlFor="sigla_area">Equipe/Sigla *</Label>
              <Popover open={teamsOpen} onOpenChange={setTeamsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={teamsOpen}
                    className="w-full justify-between"
                  >
                    <span className="truncate">
                      {sigla
                        ? (() => {
                            const t = teams.find((x) => String(x.id).toUpperCase() === sigla);
                            const label = t?.name && t.name !== t.id ? `${t.id} — ${t.name}` : sigla;
                            return label;
                          })()
                        : "Selecione sua equipe (sigla – nome)"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0 z-50 bg-popover border shadow-lg"
                  align="start"
                  sideOffset={4}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Buscar equipe..." value={teamQuery} onValueChange={setTeamQuery} />
                    <CommandList>
                      <CommandEmpty>Nenhuma equipe encontrada.</CommandEmpty>
                      <CommandGroup heading={teamOptions.length ? `${teamOptions.length} opção(ões)` : undefined}>
                        {teamOptions.map((t) => {
                          const id = String(t.id).toUpperCase();
                          const selected = id === sigla;
                          const display = t.name && t.name !== t.id ? `${t.id} — ${t.name}` : t.id;
                          return (
                            <CommandItem
                              key={t.id}
                              value={t.id}
                              onMouseDown={(e) => e.preventDefault()}
                              onSelect={() => {
                                const nextSigla = String(t.id || "").toUpperCase().trim();
                                handleChange("sigla_area", nextSigla);
                                if (nextSigla === GUEST_TEAM_ID || nextSigla === "EXTERNO") {
                                  handleChange("operational_base", GUEST_TEAM_ID);
                                } else {
                                  handleChange("operational_base", "");
                                }
                                setTeamsOpen(false);
                                setTeamQuery("");
                              }}
                              className={cn(selected && "bg-accent")}
                            >
                              <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                              {display}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Se você for externo, selecione <span className="font-semibold">{GUEST_TEAM_ID}</span> para entrar sem vínculo com base/equipe.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="operational_base">Base Operacional (Cidade) {isGuest ? "" : "*"}</Label>
              {isGuest ? (
                <Input id="operational_base" value={GUEST_TEAM_ID} disabled className="opacity-90" />
              ) : (
                <Popover open={basesOpen} onOpenChange={setBasesOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={basesOpen}
                      className="w-full justify-between"
                      disabled={!sigla || loading}
                    >
                      <span className="truncate">
                        {formData.operational_base || (sigla ? "Selecione sua base operacional" : "Selecione a equipe primeiro")}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0 z-50 bg-popover border shadow-lg"
                    align="start"
                    sideOffset={4}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Buscar base..." value={baseQuery} onValueChange={setBaseQuery} />
                      <CommandList>
                        <CommandEmpty>Nenhuma base encontrada.</CommandEmpty>
                        <CommandGroup heading={baseOptions.length ? `${baseOptions.length} opção(ões)` : undefined}>
                          {baseOptions.map((b) => {
                            const selected = String(formData.operational_base || "") === String(b);
                            return (
                              <CommandItem
                                key={b}
                                value={b}
                                onMouseDown={(e) => e.preventDefault()}
                                onSelect={() => {
                                  handleChange("operational_base", b);
                                  setBasesOpen(false);
                                  setBaseQuery("");
                                }}
                                className={cn(selected && "bg-accent")}
                              >
                                <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                                {b}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              <p className="text-xs text-muted-foreground">
                {isGuest
                  ? "Convidados entram como colaboradores e não ficam vinculados a uma base operacional."
                  : "A base é sugerida a partir das opções já cadastradas (e também da lista padrão por equipe)."}
              </p>
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
