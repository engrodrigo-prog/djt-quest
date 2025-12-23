import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemedBackground } from "@/components/ThemedBackground";
import Navigation from "@/components/Navigation";
import { useToast } from "@/hooks/use-toast";
import { Target, Hash, MessageSquare, Zap, ArrowLeft, Share2 } from "lucide-react";
import { buildAbsoluteAppUrl, openWhatsAppShare } from "@/lib/whatsappShare";
import { getActiveLocale } from "@/lib/i18n/activeLocale";

interface Campaign {
  id: string;
  title: string;
  description: string | null;
  narrative_tag: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface ChallengeRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  xp_reward: number;
  reward_mode?: string | null;
  reward_tier_steps?: number | null;
}

interface ForumTopicRow {
  id: string;
  title: string;
  description: string | null;
}

interface SepPostRow {
  id: string;
  content_md: string;
  like_count: number;
  comment_count: number;
  created_at: string;
}

export default function CampaignDetail() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [topics, setTopics] = useState<ForumTopicRow[]>([]);
  const [posts, setPosts] = useState<SepPostRow[]>([]);

  const hashTag = (() => {
    if (!campaign) return "";
    if (campaign.narrative_tag && campaign.narrative_tag.trim().length > 0) {
      const raw = campaign.narrative_tag.trim();
      return raw.startsWith("#") ? raw : `#${raw}`;
    }
    const slug = campaign.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `#camp_${slug}`;
  })();

  useEffect(() => {
    const load = async () => {
      if (!campaignId) return;
      setLoading(true);
      try {
        const [{ data: camp, error: campErr }, { data: chRows }, { data: topicRows }, { data: postRows }] =
          await Promise.all([
            supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle(),
            supabase
              .from("challenges")
              .select("id,title,description,type,xp_reward")
              .eq("campaign_id", campaignId)
              .order("created_at", { ascending: false }),
            supabase
              .from("forum_topics")
              .select("id,title,description")
              .or(
                `title.ilike.%${hashTag.replace("#", "")}%,description.ilike.%${hashTag.replace(
                  "#",
                  ""
                )}%`
              )
              .order("created_at", { ascending: false })
              .limit(20),
            supabase
              .from("sepbook_posts")
              .select("id,content_md,like_count,comment_count,created_at")
              .ilike("content_md", `%${hashTag}%`)
              .order("created_at", { ascending: false })
              .limit(20),
          ]);

        if (campErr) throw campErr;
        if (!camp) {
          toast({
            title: "Campanha não encontrada",
            description: "Verifique se o link ainda é válido.",
            variant: "destructive",
          });
          return;
        }

        setCampaign(camp as any);
        setChallenges((chRows || []) as any);
        setTopics((topicRows || []) as any);
        setPosts((postRows || []) as any);
      } catch (e: any) {
        console.error("Erro ao carregar campanha", e);
        toast({
          title: "Erro ao carregar campanha",
          description: e?.message || "Tente novamente mais tarde.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const handleOpenSepbookDraft = () => {
    if (!campaign) return;
    try {
      const content = `${hashTag} ${campaign.title}`;
      localStorage.setItem("sepbook_draft", JSON.stringify({ content }));
    } catch {}
    navigate("/sepbook");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Campanha não encontrada</CardTitle>
            <CardDescription>
              Não foi possível localizar essa campanha. Verifique se o link está correto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/dashboard")}>Voltar ao início</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background pb-40">
      <ThemedBackground theme="habilidades" />
      <div className="container relative mx-auto px-3 py-4 space-y-6">
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Target className="h-5 w-5 text-secondary" />
            Campanha
          </h1>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <Badge className="w-fit mb-1 text-[10px] bg-cyan-700/60 text-blue-50 border-cyan-500/50">
                  {campaign.narrative_tag || "Campanha DJT Quest"}
                </Badge>
                <CardTitle className="text-lg leading-tight">{campaign.title}</CardTitle>
                {campaign.description && (
                  <CardDescription className="text-sm">
                    {campaign.description}
                  </CardDescription>
                )}
                <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  <span>{hashTag}</span>
                </p>
                {campaign.start_date && campaign.end_date && (
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(campaign.start_date).toLocaleDateString(getActiveLocale(), {
                      day: "2-digit",
                      month: "short",
                    })}{" "}
                    -{" "}
                    {new Date(campaign.end_date).toLocaleDateString(getActiveLocale(), {
                      day: "2-digit",
                      month: "short",
                    })}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button size="sm" onClick={handleOpenSepbookDraft}>
                  <Zap className="h-4 w-4 mr-1" />
                  Subir no SEPBook
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => {
                    const url = buildAbsoluteAppUrl(`/campaign/${encodeURIComponent(campaign.id)}`);
                    openWhatsAppShare({
                      message: `Conheça a campanha "${campaign.title}" no DJT Quest:`,
                      url,
                    });
                  }}
                >
                  Compartilhar no WhatsApp
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Desafios & Quizzes</CardTitle>
              <CardDescription className="text-xs">
                Conteúdos formais ligados a esta campanha.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {challenges.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum desafio vinculado diretamente a esta campanha ainda.
                </p>
              )}
              {challenges.map((ch) => (
                <div
                  key={ch.id}
                  className="p-2 rounded-md border hover:bg-accent/10 cursor-pointer"
                  onClick={() => navigate(`/challenge/${ch.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{ch.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {ch.description}
                      </p>
                      <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
                        <span>{ch.type}</span>
                        <span>
                          {ch.reward_mode === 'tier_steps'
                            ? `+${ch.reward_tier_steps || 1} patamar(es)`
                            : `+${ch.xp_reward} XP`}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        const url = buildAbsoluteAppUrl(`/challenge/${encodeURIComponent(ch.id)}`)
                        openWhatsAppShare({
                          message: (ch.type || '').toLowerCase().includes('quiz')
                            ? `Participe deste quiz no DJT Quest:\n${ch.title}`
                            : `Participe deste desafio no DJT Quest:\n${ch.title}`,
                          url,
                        })
                      }}
                      title="Compartilhar no WhatsApp"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Fóruns Relacionados</CardTitle>
              <CardDescription className="text-xs">
                Tópicos onde o tema aparece, para aprofundar discussões.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topics.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Ainda não há fóruns com essa hashtag.
                </p>
              )}
              {topics.map((t) => (
                <div
                  key={t.id}
                  className="p-2 rounded-md border hover:bg-accent/10 cursor-pointer"
                  onClick={() => navigate(`/forum/${t.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {t.description}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(t.id)}`)
                        openWhatsAppShare({
                          message: `Veja este fórum no DJT Quest:\n${t.title}`,
                          url,
                        })
                      }}
                      title="Compartilhar no WhatsApp"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Movimento no SEPBook</CardTitle>
              <CardDescription className="text-xs">
                Publicações espontâneas com a hashtag da campanha.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {posts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Ainda não há posts no SEPBook com essa hashtag.
                </p>
              )}
              {posts.map((p) => (
                <div key={p.id} className="p-2 rounded-md border">
                  <p className="text-[11px] text-muted-foreground mb-1">
                    {new Date(p.created_at).toLocaleString(getActiveLocale())}
                  </p>
                  <p className="text-sm line-clamp-3 whitespace-pre-wrap">
                    {p.content_md}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                    <span>❤ {p.like_count || 0}</span>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {p.comment_count || 0}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => navigate(`/sepbook#post-${encodeURIComponent(p.id)}`)}
                      title="Abrir no SEPBook"
                    >
                      Abrir
                    </Button>
                    <button
                      type="button"
                      className="ml-auto inline-flex items-center justify-center h-7 w-7 rounded-full border border-border/50 hover:bg-accent"
                      onClick={() => {
                        const url = buildAbsoluteAppUrl(`/sepbook#post-${encodeURIComponent(p.id)}`)
                        const preview = (p.content_md || '').trim().replace(/\s+/g, ' ').slice(0, 140)
                        openWhatsAppShare({
                          message: preview
                            ? `Veja esta publicação no SEPBook (DJT Quest):\n"${preview}${preview.length >= 140 ? '…' : ''}"`
                            : "Veja esta publicação no SEPBook (DJT Quest):",
                          url,
                        })
                      }}
                      title="Compartilhar no WhatsApp"
                      aria-label="Compartilhar publicação do SEPBook no WhatsApp"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Navigation />
    </div>
  );
}
