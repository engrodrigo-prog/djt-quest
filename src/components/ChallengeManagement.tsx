import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { isAllowlistedAdminFromProfile } from "@/lib/adminAllowlist";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuizResultsDashboard } from "@/components/QuizResultsDashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QuizQuestionsList } from "@/components/QuizQuestionsList";

type RangeKey = "30" | "60" | "180" | "365" | "all";

interface Challenge {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status?: string | null;
  xp_reward: number;
  reward_mode?: string | null;
  reward_tier_steps?: number | null;
  created_at?: string | null;
}

interface ChallengeManagementProps {
  onlyQuizzes?: boolean;
}

export const ChallengeManagement = ({ onlyQuizzes }: ChallengeManagementProps) => {
  const { isLeader, userRole, profile } = useAuth() as any;
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<RangeKey>("30");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editXp, setEditXp] = useState<string>("0");
  const [modalChallenge, setModalChallenge] = useState<Challenge | null>(null);
  const [modalTab, setModalTab] = useState<"general" | "questions" | "follow">("general");

  const isTopLeader = profile?.matricula === "601555";
  const isAllowlistedAdmin = isAllowlistedAdminFromProfile(profile);
  const canDelete =
    Boolean(isAllowlistedAdmin) ||
    (Boolean(isLeader) || (userRole && (userRole.includes("gerente") || userRole.includes("coordenador"))));
  const canDeleteThis = (c: Challenge) => {
    const isQuiz = (c.type || "").toLowerCase().includes("quiz");
    if (onlyQuizzes && isQuiz) return Boolean(isAllowlistedAdmin);
    return Boolean(canDelete);
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("challenges")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      let items: Challenge[] = (data || []) as any;
      if (onlyQuizzes) {
        items = items.filter((c) => (c.type || "").toLowerCase().includes("quiz"));
      } else {
        items = items.filter((c) => !(c.type || "").toLowerCase().includes("quiz"));
      }
      setChallenges(items);
    } catch (e) {
      console.error("Erro ao carregar desafios:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [onlyQuizzes]);

  const openModal = (c: Challenge, tab: "general" | "questions" | "follow") => {
    setModalChallenge(c);
    setModalTab(tab);
    setEditTitle(String(c.title || ""));
    setEditDescription(String(c.description || ""));
    setEditXp(String(c.xp_reward ?? 0));
  };

  const closeModal = () => {
    setModalChallenge(null);
  };

  const cutoff = (() => {
    if (range === "all") return null;
    const days = range === "30" ? 30 : range === "60" ? 60 : range === "180" ? 180 : 365;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  })();

  const filtered = challenges.filter((c) => {
    if (!cutoff) return true;
    if (!c.created_at) return true;
    const d = new Date(c.created_at);
    return d >= cutoff;
  });

  const updateStatus = async (c: Challenge, status: string) => {
    if (!c.id) return;
    const isQuiz = (c.type || "").toLowerCase().includes("quiz");
    if (isQuiz && !isAllowlistedAdmin) {
      alert("Apenas admins (Rodrigo/Cíntia) podem alterar status de quizzes no momento.");
      return;
    }
    try {
      const msg =
        status === "active"
          ? "Reabrir este desafio/quiz para um novo ciclo?"
          : "Encerrar este desafio/quiz? Ele deixará de aceitar novas ações/respostas.";
      if (!window.confirm(msg)) return;
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const resp = await fetch("/api/admin?handler=challenges-update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: c.id, status }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao atualizar status");
      await load();
    } catch (e: any) {
      alert(String(e?.message || "Erro ao atualizar desafio"));
    }
  };

  const cancelQuiz = async (c: Challenge) => {
    if (!c?.id) return;
    const isQuiz = (c.type || "").toLowerCase().includes("quiz");
    if (!isQuiz) return;
    if (!isAllowlistedAdmin) {
      alert("Apenas admins (Rodrigo/Cíntia) podem cancelar quizzes no momento.");
      return;
    }
    if (!window.confirm('Cancelar este quiz? Os usuários não poderão mais responder.')) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const resp = await fetch("/api/admin?handler=challenges-update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: c.id, status: "canceled" }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao cancelar quiz");
      await load();
    } catch (e: any) {
      alert(String(e?.message || "Erro ao cancelar quiz"));
    }
  };

  const handleDelete = async (c: Challenge) => {
    if (!c?.id) return;
    const isQuiz = (c.type || "").toLowerCase().includes("quiz");
    if (onlyQuizzes && isQuiz && !isAllowlistedAdmin) {
      alert("Apenas admins (Rodrigo/Cíntia) podem excluir quizzes no momento.");
      return;
    }
    if (!canDelete && !(onlyQuizzes && isQuiz && isAllowlistedAdmin)) return;
    const baseMsg = `Esta ação vai excluir permanentemente o desafio/quiz "${c.title}" e remover TODO o XP acumulado por quaisquer usuários ligado a ele.`;
    const approvalMsg = isTopLeader
      ? `${baseMsg}\n\nVocê é o líder máximo, esta exclusão será aplicada imediatamente. Confirmar?`
      : `${baseMsg}\n\nO pedido será registrado para ciência do seu líder imediato. Confirmar exclusão agora?`;
    if (!window.confirm(approvalMsg)) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const resp = await fetch("/api/admin?handler=challenges-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: c.id }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao excluir desafio");
      await load();
      alert("Desafio/quiz excluído e XP associado revertido para os usuários impactados.");
    } catch (e: any) {
      console.error("Erro ao excluir desafio:", e);
      alert(String(e?.message || "Erro ao excluir desafio"));
    }
  };

  const handleEdit = (c: Challenge) => {
    if (onlyQuizzes) {
      openModal(c, "general");
      return;
    }
    setEditingId(c.id);
    setEditTitle(c.title || "");
    setEditDescription(c.description || "");
    setEditXp(String(c.xp_reward ?? 0));
  };

  const handleSaveEdit = async (c: Challenge) => {
    const title = editTitle.trim();
    const description = editDescription.trim() || null;
    const xp = parseInt(editXp, 10);
    if (!title) {
      alert("Informe um título para o desafio/quiz.");
      return;
    }
    if (!Number.isFinite(xp) || xp <= 0) {
      alert("Informe um valor de XP positivo.");
      return;
    }
    try {
      const before = {
        title: c.title,
        description: c.description,
        xp_reward: c.xp_reward,
        type: c.type,
      };
      const after = {
        title,
        description,
        xp_reward: xp,
        type: c.type,
      };
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;

      const isQuiz = (c.type || "").toLowerCase().includes("quiz");
      if (isQuiz) {
        // Quizzes podem estar "travados" após submissão/publicação (trigger enforce_quiz_workflow).
        // Atualize via handler server-side (service_role) para manter a regra de versionamento.
        const resp = await apiFetch("/api/admin?handler=curation-update-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId: c.id, title, description, xp_reward: xp }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao salvar quiz");
      } else {
        const { error } = await supabase
          .from("challenges")
          .update({ title, description, xp_reward: xp })
          .eq("id", c.id);
        if (error) throw error;
      }

      if (uid) {
        await supabase.from("content_change_requests").insert({
          item_type: c.type.toLowerCase().includes("quiz") ? "quiz" : "challenge",
          item_id: c.id,
          action: "update",
          requested_by: uid,
          status: "pending",
          payload_before: before,
          payload_after: after,
        });
      }
      setEditingId(null);
      await load();
    } catch (e: any) {
      alert(String(e?.message || "Erro ao salvar alterações"));
    }
  };

  return (
    <div className="space-y-4">
      <Dialog
        open={Boolean(modalChallenge)}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
      >
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Gerenciar quiz</DialogTitle>
            <DialogDescription className="text-xs">
              {modalChallenge?.title || "—"}
            </DialogDescription>
          </DialogHeader>
          {modalChallenge?.id ? (
            <Tabs value={modalTab} onValueChange={(v) => setModalTab(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="general">Editar</TabsTrigger>
                <TabsTrigger value="questions">Perguntas</TabsTrigger>
                <TabsTrigger value="follow">Acompanhar</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-3">
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Aqui você edita o nome e a descrição. Para perguntas/alternativas use a aba “Perguntas”.
                  </div>
                  <input
                    className="w-full text-sm font-semibold bg-black/40 border border-white/10 rounded px-2 py-2 text-blue-50"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Nome do quiz"
                  />
                  <textarea
                    className="w-full text-xs bg-black/40 border border-white/10 rounded px-2 py-2 text-muted-foreground"
                    rows={4}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Descrição do quiz"
                  />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">XP:</span>
                      <input
                        className="w-[120px] text-sm bg-black/40 border border-white/10 rounded px-2 py-2 text-blue-50"
                        value={editXp}
                        onChange={(e) => setEditXp(e.target.value)}
                        inputMode="numeric"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => modalChallenge && handleSaveEdit(modalChallenge)}
                      >
                        Salvar
                      </Button>
                      <Button size="sm" variant="outline" onClick={closeModal}>
                        Fechar
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="questions" className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Edite perguntas e alternativas. Em quiz publicado, apenas curadoria/admin consegue alterar.
                </div>
                <QuizQuestionsList
                  challengeId={modalChallenge.id}
                  onUpdate={() => {
                    load();
                  }}
                />
              </TabsContent>

              <TabsContent value="follow" className="space-y-3">
                <QuizResultsDashboard challengeId={modalChallenge.id} />
              </TabsContent>
            </Tabs>
          ) : null}
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-blue-50">
            {onlyQuizzes ? "Gerenciar Quizzes" : "Gerenciar Desafios"}
          </h2>
          <p className="text-blue-100/80 text-sm">
            Filtre por período, veja histórico e reabra ou exclua itens.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {[
            { key: "30", label: "30 dias" },
            { key: "60", label: "60 dias" },
            { key: "180", label: "Semestre" },
            { key: "365", label: "Ano" },
            { key: "all", label: "Tudo" },
          ].map((opt) => (
            <Button
              key={opt.key}
              size="sm"
              variant={range === opt.key ? "secondary" : "outline"}
              onClick={() => setRange(opt.key as RangeKey)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {onlyQuizzes ? "Quizzes" : "Desafios"} ({filtered.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Período considerado a partir dos últimos{" "}
            {range === "all"
              ? "todo o período"
              : range === "30"
                ? "30 dias"
                : range === "60"
                  ? "60 dias"
                  : range === "180"
                    ? "6 meses"
                    : "12 meses"}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-xs text-muted-foreground">Carregando itens...</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum item no período selecionado.
            </p>
          )}
          {filtered.map((c) => {
            const isEditing = !onlyQuizzes && editingId === c.id;
            return (
              <div key={c.id} className="flex flex-col gap-1 border rounded-md p-3 bg-black/20">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {c.type}
                      </Badge>
                      <Badge className="text-[10px]" variant="secondary">
                        {c.status || "sem status"}
                      </Badge>
                    </div>
                    {isEditing ? (
                      <>
                        <input
                          className="mt-1 w-full text-sm font-semibold bg-black/40 border border-white/10 rounded px-2 py-1 text-blue-50"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                        <textarea
                          className="mt-1 w-full text-xs bg-black/40 border border-white/10 rounded px-2 py-1 text-muted-foreground"
                          rows={3}
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                        />
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-sm truncate text-blue-50">
                          {c.title}
                        </p>
                        {c.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {c.description}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <span className="text-xs font-semibold text-accent">
                      {c.reward_mode === 'tier_steps'
                        ? `+${c.reward_tier_steps || 1} patamar(es)`
                        : `+${c.xp_reward} XP`}
                    </span>
                    <div className="flex gap-1 mt-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => handleSaveEdit(c)}
                          >
                            Salvar
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setEditingId(null)}
                          >
                            Cancelar
                          </Button>
                        </>
	                      ) : (
	                        <>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleEdit(c)}
                          >
                            Editar
                          </Button>
                          {(c.type || "").toLowerCase().includes("quiz") && (
                            <>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => openModal(c, "questions")}
                              >
                                Perguntas
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => openModal(c, "follow")}
                              >
                                Acompanhar
                              </Button>
                            </>
                          )}
		                          {(!onlyQuizzes || isAllowlistedAdmin) && (
		                            <>
		                              <Button
		                                size="xs"
		                                variant="outline"
	                                onClick={() => updateStatus(c, "closed")}
	                              >
	                                Encerrar
	                              </Button>
	                              <Button
	                                size="xs"
	                                variant="secondary"
	                                onClick={() => updateStatus(c, "active")}
	                              >
	                                Reabrir
	                              </Button>
	                            </>
	                          )}
	                          {onlyQuizzes && isAllowlistedAdmin && (
	                            <Button
	                              size="xs"
	                              variant="destructive"
	                              onClick={() => cancelQuiz(c)}
	                            >
	                              Cancelar
	                            </Button>
	                          )}
                          {canDeleteThis(c) && (
                            <Button
                              size="xs"
                              variant="destructive"
                              onClick={() => handleDelete(c)}
                            >
                              Excluir
                            </Button>
                          )}
	                        </>
	                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};
