import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Target as TargetIcon, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { challengeSchema, type ChallengeFormData } from "@/lib/validations/challenge";
import { Checkbox } from "@/components/ui/checkbox";
import { QuizQuestionForm } from "./QuizQuestionForm";
import { QuizQuestionsList } from "./QuizQuestionsList";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";
import { CompendiumPicker } from "@/components/CompendiumPicker";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { localeToOpenAiLanguageTag, localeToSpeechLanguage } from "@/lib/i18n/language";
import { ForumKbThemeSelector, type ForumKbSelection } from "@/components/ForumKbThemeSelector";
import { fetchForumKbSnippets, type ForumKbSnippet } from "@/lib/forum/fetchKbSnippets";
import { apiFetch } from "@/lib/api";

interface Campaign {
  id: string;
  title: string;
  description?: string | null;
}

interface Division {
  id: string;
  name: string;
}

interface Coordination {
  id: string;
  name: string;
  division_id: string;
}

interface Team {
  id: string;
  name: string;
  coordination_id: string;
}

export const ChallengeForm = () => {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [coordinations, setCoordinations] = useState<Coordination[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedDivisions, setSelectedDivisions] = useState<string[]>([]);
  const [selectedCoordinations, setSelectedCoordinations] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createdChallengeId, setCreatedChallengeId] = useState<string | null>(null);
  const [questionsKey, setQuestionsKey] = useState(0);
  const [knownThemes, setKnownThemes] = useState<string[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ title: '', description: '', start: '', end: '' });
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [compOpen, setCompOpen] = useState(false);
  const [kbSelection, setKbSelection] = useState<ForumKbSelection | null>(null);
  const [kbSnippets, setKbSnippets] = useState<ForumKbSnippet[]>([]);
  const [kbLoading, setKbLoading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ChallengeFormData>({
    resolver: zodResolver(challengeSchema),
    defaultValues: {
      xp_reward: 50,
      reward_mode: "fixed_xp",
      reward_tier_steps: 1 as any,
      type: "quiz",
      require_two_leader_eval: false,
      evidence_required: false,
      campaign_id: undefined as any,
      theme: "",
    },
  });

  const challengeType = watch("type");
  const rewardMode = watch("reward_mode") || "fixed_xp";
  const requireTwoLeaderEval = watch("require_two_leader_eval");
  const evidenceRequired = watch("evidence_required");
  const descriptionValue = watch("description") as any;

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const key = kbSelection?.tags?.join("|") || "";
    if (!key) {
      setKbSnippets([]);
      return;
    }
    setKbLoading(true);
    fetchForumKbSnippets({ tags: kbSelection!.tags, limit: 6 })
      .then((rows) => {
        if (!cancelled) setKbSnippets(rows);
      })
      .catch(() => {
        if (!cancelled) setKbSnippets([]);
      })
      .finally(() => {
        if (!cancelled) setKbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbSelection?.tags?.join("|")]);

  // Prefill from Forum Insights draft (desafio)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('studio_compendium_draft');
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || draft.kind !== 'desafio') return;
      // Prefer CHAS: if 'A' then atitude; if 'H' then inspecao; default atitude
      const typeFromChas = draft.chas === 'H' ? 'inspecao' : 'atitude';
      setValue('type', typeFromChas as any, { shouldValidate: true });
      if (draft.title) setValue('title', String(draft.title).replace(/^Desafio:\s*/i,'').trim());
      if (draft.summary) setValue('description', String(draft.summary));
      // Require campaign for non-quiz: user will choose; keep empty here
      // Theme hint from title
      if (draft.title) setValue('theme', String(draft.title).slice(0, 80));
      // Suggested XP level: map priority 1..5 roughly to 10..50
      const priority = Number(draft.priority || 3);
      const xpMap: Record<number, number> = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 };
      setValue('xp_reward', xpMap[priority] || 30, { shouldValidate: true });
      localStorage.removeItem('studio_compendium_draft');
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    const [campaignsRes, divisionsRes, coordinationsRes, teamsRes, themesRes] = await Promise.all([
      supabase.from("campaigns").select("id, title, description").eq("is_active", true).order("title"),
      supabase.from("divisions").select("id, name").order("name"),
      supabase.from("coordinations").select("id, name, division_id").order("name"),
      supabase.from("teams").select("id, name, coordination_id").order("name"),
      supabase.from("subject_suggestions").select("value").eq("kind", "theme").order("used_count", { ascending: false }).limit(20),
    ]);

    if (campaignsRes.data) setCampaigns(campaignsRes.data);
    if (divisionsRes.data) setDivisions(divisionsRes.data);
    if (coordinationsRes.data) setCoordinations(coordinationsRes.data);
    if (teamsRes.data) setTeams(teamsRes.data);
    if (themesRes.data) setKnownThemes((themesRes.data as any[]).map((r: any) => r.value).filter(Boolean));
  };

  const onSubmit = async (data: ChallengeFormData) => {
    setSubmitting(true);

    try {
      const isQuiz = data.type === "quiz";
      const isTierSteps = !isQuiz && data.reward_mode === "tier_steps";

      const challengeData = {
        ...data,
        target_div_ids: selectedDivisions.length > 0 ? selectedDivisions : null,
        target_coord_ids: selectedCoordinations.length > 0 ? selectedCoordinations : null,
        target_team_ids: selectedTeams.length > 0 ? selectedTeams : null,
        campaign_id: data.campaign_id || null,
        xp_reward: isQuiz ? 0 : isTierSteps ? 0 : data.xp_reward,
        reward_mode: isQuiz ? null : isTierSteps ? "tier_steps" : "fixed_xp",
        reward_tier_steps: isQuiz ? null : isTierSteps ? (data.reward_tier_steps || 1) : null,
      };

      let challenge, error;
      try {
        const { data, error: err } = await supabase
          .from("challenges")
          .insert([{ ...(challengeData as any), cover_image_url: coverUrl || null }])
          .select()
          .single();
        challenge = data; error = err;
        if (error && /cover_image_url/.test(String(error.message))) throw error;
      } catch (_) {
        const { data, error: err } = await supabase
          .from("challenges")
          .insert([{ ...(challengeData as any) }])
          .select()
          .single();
        challenge = data; error = err;
      }

      if (error) throw error;

      if (data.type === 'quiz') {
        setCreatedChallengeId(challenge.id);
        toast({
          title: "Quiz criado! 📝",
          description: "Agora adicione perguntas ao quiz",
        });
      } else {
        toast({
          title: "Desafio criado! 🎯",
          description: "O desafio foi publicado com sucesso",
        });
        // Reset form
        reset();
        setSelectedDivisions([]);
        setSelectedCoordinations([]);
        setSelectedTeams([]);
        setCreatedChallengeId(null);
        setCoverUrl(null);
      }
    } catch (error: any) {
      console.error("Error creating challenge:", error);
      toast({
        title: "Erro ao criar desafio",
        description: error.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSelection = (
    id: string,
    selected: string[],
    setSelected: (ids: string[]) => void
  ) => {
    if (selected.includes(id)) {
      setSelected(selected.filter((item) => item !== id));
    } else {
      setSelected([...selected, id]);
    }
  };

  const handleSelectAll = () => {
    const allDivIds = divisions.map(d => d.id);
    const allCoordIds = coordinations.map(c => c.id);
    const allTeamIds = teams.map(t => t.id);
    
    if (selectedDivisions.length === allDivIds.length && 
        selectedCoordinations.length === allCoordIds.length && 
        selectedTeams.length === allTeamIds.length) {
      // Desmarcar todos
      setSelectedDivisions([]);
      setSelectedCoordinations([]);
      setSelectedTeams([]);
    } else {
      // Marcar todos
      setSelectedDivisions(allDivIds);
      setSelectedCoordinations(allCoordIds);
      setSelectedTeams(allTeamIds);
    }
  };

  const handleDivisionSelect = (divisionId: string) => {
    const isSelected = selectedDivisions.includes(divisionId);
    
    if (isSelected) {
      // Desmarcar divisão e seus filhos
      setSelectedDivisions(selectedDivisions.filter(id => id !== divisionId));
      const coordsToRemove = coordinations.filter(c => c.division_id === divisionId).map(c => c.id);
      setSelectedCoordinations(selectedCoordinations.filter(id => !coordsToRemove.includes(id)));
      const teamsToRemove = teams.filter(t => coordsToRemove.includes(t.coordination_id)).map(t => t.id);
      setSelectedTeams(selectedTeams.filter(id => !teamsToRemove.includes(id)));
    } else {
      // Marcar divisão e seus filhos
      setSelectedDivisions([...selectedDivisions, divisionId]);
      const coordsToAdd = coordinations.filter(c => c.division_id === divisionId).map(c => c.id);
      setSelectedCoordinations([...new Set([...selectedCoordinations, ...coordsToAdd])]);
      const teamsToAdd = teams.filter(t => coordsToAdd.includes(t.coordination_id)).map(t => t.id);
      setSelectedTeams([...new Set([...selectedTeams, ...teamsToAdd])]);
    }
  };

  const handleCoordinationSelect = (coordId: string) => {
    const isSelected = selectedCoordinations.includes(coordId);
    
    if (isSelected) {
      // Desmarcar coordenação e suas equipes
      setSelectedCoordinations(selectedCoordinations.filter(id => id !== coordId));
      const teamsToRemove = teams.filter(t => t.coordination_id === coordId).map(t => t.id);
      setSelectedTeams(selectedTeams.filter(id => !teamsToRemove.includes(id)));
    } else {
      // Marcar coordenação e suas equipes
      setSelectedCoordinations([...selectedCoordinations, coordId]);
      const teamsToAdd = teams.filter(t => t.coordination_id === coordId).map(t => t.id);
      setSelectedTeams([...new Set([...selectedTeams, ...teamsToAdd])]);
    }
  };

  const handleCleanupDescription = async () => {
    const desc = (document.getElementById("description") as HTMLTextAreaElement | null)?.value || "";
    if (!desc.trim()) return;
    try {
      const resp = await apiFetch("/api/ai?handler=cleanup-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", description: desc, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
      });
      const json = await resp.json().catch(() => ({}));
      const usedAI = json?.meta?.usedAI !== false;
      if (!resp.ok || !json?.cleaned?.description) {
        throw new Error(json?.error || "Falha na revisão automática");
      }
      if (!usedAI) {
        toast({ title: "Erro ao revisar descrição", description: "IA indisponível no momento. Tente novamente.", variant: "destructive" });
        return;
      }
      const cleaned = String(json.cleaned.description || desc).trim();
      if (cleaned === desc.trim()) {
        toast({ title: "Nenhuma correção necessária", description: "Não encontrei ajustes de ortografia/pontuação para fazer." });
        return;
      }
      setValue("description", cleaned, { shouldValidate: true });
      toast({ title: "Descrição revisada", description: "Ortografia e pontuação ajustadas." });
    } catch (e: any) {
      toast({ title: "Erro ao revisar descrição", description: e?.message || "Tente novamente", variant: "destructive" });
    }
  };

  return (
    <>
      <CompendiumPicker
        open={compOpen}
        onOpenChange={setCompOpen}
        onPick={(item) => {
          const cat = item.final?.catalog || item.final || item.catalog || {};
          const t = String(cat.title || "Ocorrência");
          const summary = String(cat.summary || "").trim();
          const failure = String(cat.failure_mode || "").trim();
          const root = String(cat.root_cause || "").trim();
          setValue("title", `Desafio: ${t}`.slice(0, 200) as any, { shouldDirty: true, shouldValidate: true });
          const body = [summary, failure ? `Modo de falha: ${failure}` : "", root ? `Causa raiz: ${root}` : ""]
            .filter((v) => v && String(v).trim().length > 0)
            .join("\n\n");
          setValue("description", body as any, { shouldDirty: true, shouldValidate: true });
          const area = String(cat.asset_area || "").toLowerCase();
          if (area) setValue("theme", area.slice(0, 80) as any, { shouldDirty: true });
        }}
        title="Buscar ocorrência para base do desafio"
        description="Selecionar um relatório do Compêndio para pré-preencher o desafio/ação"
      />
      <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Criar Novo Desafio</CardTitle>
            <CardDescription>
              Configure um desafio com alvos específicos e requisitos
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setCompOpen(true)}>
            Buscar no Compêndio
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <Label>Capa do Desafio (opcional)</Label>
              <AttachmentUploader
                onAttachmentsChange={(urls) => setCoverUrl(urls[0] || null)}
                maxFiles={1}
                acceptMimeTypes={[ 'image/jpeg','image/png','image/webp','image/gif' ]}
                bucket="evidence"
                pathPrefix="challenges"
                capture="environment"
              />
              {coverUrl && (
                <div className="mt-2">
                  <img src={coverUrl} alt="Capa do desafio" className="h-28 w-full object-cover rounded-md" />
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="campaign">Campanha{challengeType !== 'quiz' ? ' *' : ''}</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setCampaignDialogOpen(true)}>Nova campanha</Button>
              </div>
              <Select onValueChange={(val) => {
                const id = val === 'none' ? null : val;
                setValue("campaign_id", id as any, { shouldValidate: true });
                setSelectedCampaign(id ? (campaigns.find(c => c.id === id) || null) : null);
              }}>
                <SelectTrigger id="campaign">
                  <SelectValue placeholder="Selecione uma campanha" />
                </SelectTrigger>
                <SelectContent>
                  {challengeType === 'quiz' && (
                    <SelectItem value="none">Nenhuma campanha</SelectItem>
                  )}
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.campaign_id && challengeType !== 'quiz' && (
                <p className="text-sm text-destructive mt-1">{String(errors.campaign_id.message)}</p>
              )}
              {selectedCampaign?.description && (
                <p className="text-xs text-muted-foreground mt-2">
                  {selectedCampaign.description}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="title">Título *</Label>
              <Input
                id="title"
                {...register("title")}
                placeholder="Ex: Treinamento NR10 Básico"
              />
              {errors.title && (
                <p className="text-sm text-destructive mt-1">{errors.title.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="description">Descrição</Label>
                <div className="flex items-center gap-2">
                  <VoiceRecorderButton
                    language={localeToSpeechLanguage(getActiveLocale())}
                    onText={(text) => {
                      const current = (document.getElementById("description") as HTMLTextAreaElement | null)?.value || "";
                      const combined = [current, text].filter(Boolean).join("\n\n");
                      setValue("description", combined, { shouldValidate: true });
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={handleCleanupDescription}
                    title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                  >
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Textarea
                id="description"
                {...register("description")}
                placeholder="Descreva o desafio, objetivos e critérios de conclusão..."
                rows={4}
              />
              {errors.description && (
                <p className="text-sm text-destructive mt-1">{errors.description.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="theme">Tema *</Label>
              <Input id="theme" list="themes-suggestions" placeholder="Ex.: Desligamento Zero" {...register("theme")} />
              <datalist id="themes-suggestions">
                {knownThemes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {errors.theme && (
                <p className="text-sm text-destructive mt-1">{String(errors.theme.message)}</p>
              )}
            </div>

            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Base de conhecimento (Fórum + StudyLab)</p>
                  <p className="text-[11px] text-muted-foreground">
                    Selecione um tema/subtema (até 3 níveis) para puxar trechos relevantes e usar como contexto na criação do desafio.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!kbSelection?.label}
                    onClick={() => {
                      if (!kbSelection?.label) return;
                      setValue("theme", kbSelection.label.slice(0, 120), { shouldValidate: true });
                      toast({ title: "Tema preenchido a partir da base de conhecimento" });
                    }}
                  >
                    Aplicar tema
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!kbSelection?.tags?.length}
                    onClick={() => {
                      if (!kbSelection?.tags?.length) return;
                      const current = String(descriptionValue || "").trim();
                      const hashLine = kbSelection.tags
                        .slice(0, 10)
                        .map((t) => `#${t}`)
                        .join(" ");
                      const next = [current, hashLine].filter(Boolean).join("\n\n");
                      setValue("description", next, { shouldValidate: true });
                      toast({ title: "Hashtags adicionadas à descrição" });
                    }}
                  >
                    Inserir # na descrição
                  </Button>
                </div>
              </div>

              <ForumKbThemeSelector
                maxTags={20}
                onChange={(sel) => {
                  setKbSelection(sel);
                }}
              />

              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  {kbSelection?.label ? `Foco: ${kbSelection.label}` : "Escolha um foco para ver trechos."}
                </p>

                {kbLoading ? (
                  <p className="text-xs text-muted-foreground">Carregando trechos…</p>
                ) : kbSelection?.tags?.length && kbSnippets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum trecho encontrado na base de conhecimento para essas hashtags (usa fórum curado e StudyLab).
                  </p>
                ) : (
                  kbSnippets.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold">Trechos sugeridos</p>
                      <div className="space-y-2">
                      {kbSnippets.map((s) => {
                          const flags = [
                            s.sourceType === "study" ? "StudyLab" : "",
                            s.isSolution ? "solução" : "",
                            s.isFeatured ? "destaque" : "",
                            s.likesCount ? `${s.likesCount} curtidas` : "",
                          ]
                            .filter(Boolean)
                            .join(" • ");
                          const excerpt = String(s.content || "").replace(/\s+/g, " ").trim().slice(0, 220);
                          return (
                            <div key={s.postId} className="rounded-md border border-border bg-background/60 p-3 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium truncate">{s.topicTitle}</p>
                                {flags && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {flags}
                                  </Badge>
                                )}
                              </div>
                              {excerpt && <p className="text-xs text-muted-foreground">{excerpt}{excerpt.length >= 220 ? "…" : ""}</p>}
                            </div>
                          );
                        })}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!kbSnippets.length || !kbSelection?.label}
                        onClick={() => {
                          if (!kbSelection?.label || !kbSnippets.length) return;
                          const header = [
                            "---",
                            `Contexto da Base de Conhecimento: ${kbSelection.label}`,
                            kbSelection.tags.length ? `Hashtags: ${kbSelection.tags.slice(0, 10).map((t) => `#${t}`).join(" ")}` : "",
                            "",
                          ]
                            .filter(Boolean)
                            .join("\n");
                          const lines = kbSnippets.map((s) => {
                            const ex = String(s.content || "").replace(/\s+/g, " ").trim().slice(0, 320);
                            return `- ${s.topicTitle}: ${ex}${ex.length >= 320 ? "…" : ""}`;
                          });
                          const current = String(descriptionValue || "").trim();
                          const next = [current, header, ...lines].filter(Boolean).join("\n\n");
                          setValue("description", next, { shouldValidate: true });
                          toast({ title: "Contexto da base de conhecimento inserido na descrição" });
                        }}
                      >
                        Inserir trechos na descrição
                      </Button>
                    </div>
                  )
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="type">Tipo *</Label>
                <Select
                  value={challengeType}
                  onValueChange={(val) => setValue("type", val as any)}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quiz">Quiz</SelectItem>
                    <SelectItem value="forum">Fórum</SelectItem>
                    <SelectItem value="mentoria">Mentoria</SelectItem>
                    <SelectItem value="inspecao">Inspeção</SelectItem>
                    <SelectItem value="atitude">Atitude</SelectItem>
                  </SelectContent>
                </Select>
                {errors.type && (
                  <p className="text-sm text-destructive mt-1">{errors.type.message}</p>
                )}
              </div>

              {challengeType !== 'quiz' && (
                <div>
                  <div className="space-y-2">
                    <Label>Premiação *</Label>
                    <Select
                      value={rewardMode}
                      onValueChange={(val) => setValue("reward_mode", val as any, { shouldValidate: true })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed_xp">XP fixo</SelectItem>
                        <SelectItem value="tier_steps">Avançar patamares (badge)</SelectItem>
                      </SelectContent>
                    </Select>
                    {rewardMode === "fixed_xp" ? (
                      <>
                        <Label htmlFor="xp">Nível de Dificuldade (XP) *</Label>
                        <Select
                          value={watch("xp_reward")?.toString()}
                          onValueChange={(val) => setValue("xp_reward", parseInt(val), { shouldValidate: true })}
                        >
                          <SelectTrigger id="xp">
                            <SelectValue placeholder="Selecione o nível" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="10">Básico - 10 XP</SelectItem>
                            <SelectItem value="20">Intermediário - 20 XP</SelectItem>
                            <SelectItem value="30">Avançado - 30 XP</SelectItem>
                            <SelectItem value="50">Especialista - 50 XP</SelectItem>
                          </SelectContent>
                        </Select>
                        {errors.xp_reward && (
                          <p className="text-sm text-destructive mt-1">{errors.xp_reward.message}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <Label htmlFor="reward_tier_steps">Patamares a avançar *</Label>
                        <Input
                          id="reward_tier_steps"
                          type="number"
                          min={1}
                          max={5}
                          value={(watch("reward_tier_steps") as any) || 1}
                          onChange={(e) =>
                            setValue("reward_tier_steps", Number(e.target.value) || 1, { shouldValidate: true })
                          }
                        />
                        {errors.reward_tier_steps && (
                          <p className="text-sm text-destructive mt-1">{String(errors.reward_tier_steps.message)}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          O XP é calculado automaticamente para avançar N patamares com base no tier atual do colaborador no momento da aprovação.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}
              {challengeType === 'quiz' && (
                <div className="flex items-center text-sm text-muted-foreground">
                  XP será a soma das perguntas do quiz
                </div>
              )}
            </div>
          </div>

          {/* Create Campaign Dialog */}
          <Dialog open={campaignDialogOpen} onOpenChange={setCampaignDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar nova campanha</DialogTitle>
                <DialogDescription>Defina título, datas e descrição</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="new-c-title">Título</Label>
                  <Input id="new-c-title" value={newCampaign.title} onChange={(e) => setNewCampaign({ ...newCampaign, title: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="new-c-start">Início</Label>
                  <Input id="new-c-start" type="date" value={newCampaign.start} onChange={(e) => setNewCampaign({ ...newCampaign, start: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="new-c-end">Término</Label>
                  <Input id="new-c-end" type="date" value={newCampaign.end} onChange={(e) => setNewCampaign({ ...newCampaign, end: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="new-c-desc">Descrição</Label>
                  <Textarea id="new-c-desc" rows={3} value={newCampaign.description} onChange={(e) => setNewCampaign({ ...newCampaign, description: e.target.value })} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCampaignDialogOpen(false)}>Cancelar</Button>
                  <Button type="button" onClick={async () => {
                    try {
                      if (!newCampaign.title.trim() || !newCampaign.start || !newCampaign.end) {
                        return toast({ title: 'Preencha título e datas', variant: 'destructive' })
                      }
                      const { data, error } = await supabase.from('campaigns').insert([{ 
                        title: newCampaign.title.trim(),
                        description: newCampaign.description?.trim() || null,
                        narrative_tag: null,
                        start_date: new Date(newCampaign.start).toISOString(),
                        end_date: new Date(newCampaign.end).toISOString(),
                        is_active: true,
                      }]).select('id,title,description').single()
                      if (error) throw error
                      setCampaigns([...campaigns, data as any])
                      setValue('campaign_id', (data as any).id)
                      setSelectedCampaign(data as any)
                      setCampaignDialogOpen(false)
                      setNewCampaign({ title: '', description: '', start: '', end: '' })
                      toast({ title: 'Campanha criada' })
                    } catch (e: any) {
                      toast({ title: 'Erro ao criar campanha', description: e?.message || 'Tente novamente', variant: 'destructive' })
                    }
                  }}>Criar</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Requirements */}
          <div className="space-y-4 p-4 bg-secondary/10 rounded-lg">
            <h3 className="font-semibold text-sm">Requisitos</h3>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="two-leader">Avaliação de 2 Líderes</Label>
                <p className="text-xs text-muted-foreground">
                  Requer aprovação de coordenador e líder de divisão
                </p>
              </div>
              <Switch
                id="two-leader"
                checked={requireTwoLeaderEval}
                onCheckedChange={(checked) => setValue("require_two_leader_eval", checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="evidence">Evidência Obrigatória</Label>
                <p className="text-xs text-muted-foreground">
                  Colaborador deve anexar fotos ou documentos
                </p>
              </div>
              <Switch
                id="evidence"
                checked={evidenceRequired}
                onCheckedChange={(checked) => setValue("evidence_required", checked)}
              />
            </div>
          </div>

          {/* Targeting */}
          <div className="space-y-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TargetIcon className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Alvos do Desafio</h3>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
              >
                {selectedDivisions.length === divisions.length && 
                 selectedCoordinations.length === coordinations.length && 
                 selectedTeams.length === teams.length
                  ? "Desmarcar Todas"
                  : "Selecionar Todas"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Deixe em branco para disponibilizar para todos
            </p>

            {/* Divisions */}
            <div>
              <Label className="text-xs font-semibold mb-2 block">Divisões</Label>
              <div className="flex flex-wrap gap-2">
                {divisions.map((div) => (
                  <div key={div.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`div-${div.id}`}
                      checked={selectedDivisions.includes(div.id)}
                      onCheckedChange={() => handleDivisionSelect(div.id)}
                    />
                    <label
                      htmlFor={`div-${div.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {div.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Coordinations */}
            <div>
              <Label className="text-xs font-semibold mb-2 block">Coordenações</Label>
              <div className="grid grid-cols-2 gap-2">
                {coordinations.map((coord) => (
                  <div key={coord.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`coord-${coord.id}`}
                      checked={selectedCoordinations.includes(coord.id)}
                      onCheckedChange={() => handleCoordinationSelect(coord.id)}
                    />
                    <label
                      htmlFor={`coord-${coord.id}`}
                      className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {coord.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Teams */}
            <div>
              <Label className="text-xs font-semibold mb-2 block">Equipes</Label>
              <div className="grid grid-cols-2 gap-2">
                {teams.map((team) => (
                  <div key={team.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`team-${team.id}`}
                      checked={selectedTeams.includes(team.id)}
                      onCheckedChange={() =>
                        toggleSelection(team.id, selectedTeams, setSelectedTeams)
                      }
                    />
                    <label
                      htmlFor={`team-${team.id}`}
                      className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {team.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={submitting || (challengeType === 'quiz' && !!createdChallengeId)}>
            {submitting ? (
              "Criando..."
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                {challengeType === 'quiz' && createdChallengeId ? 'Quiz Criado' : 'Criar Desafio'}
              </>
            )}
          </Button>
        </form>
      </CardContent>

      {/* Quiz Questions Section */}
      {challengeType === 'quiz' && createdChallengeId && (
        <CardContent className="space-y-6 border-t pt-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Perguntas do Quiz</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                reset();
                setSelectedDivisions([]);
                setSelectedCoordinations([]);
                setSelectedTeams([]);
                setCreatedChallengeId(null);
                toast({ title: "Novo quiz iniciado" });
              }}
            >
              Criar Outro Quiz
            </Button>
          </div>
          
          <QuizQuestionsList 
            key={questionsKey}
            challengeId={createdChallengeId} 
            onUpdate={() => setQuestionsKey(k => k + 1)}
          />
          
          <QuizQuestionForm 
            challengeId={createdChallengeId}
            onQuestionAdded={() => setQuestionsKey(k => k + 1)}
          />
        </CardContent>
      )}
    </Card>
    </>
  );
};
