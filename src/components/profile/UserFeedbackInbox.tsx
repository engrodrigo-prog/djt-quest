import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserProfilePopover } from "@/components/UserProfilePopover";

type FeedbackRow = {
  id: string;
  created_at: string;
  sender_id: string;
  recipient_id: string;
  message: string;
  context_type: string;
  context_url: string | null;
  context_label: string | null;
  metadata: any;
  read_at: string | null;
  sender?: { name: string | null; avatar_thumbnail_url?: string | null } | null;
  recipient?: { name: string | null; avatar_thumbnail_url?: string | null } | null;
};

function formatWhen(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function UserFeedbackInbox({ showSent }: { showSent: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<string>(showSent ? "received" : "received");
  const [received, setReceived] = useState<FeedbackRow[]>([]);
  const [sent, setSent] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = useMemo(() => received.filter((m) => !m.read_at).length, [received]);

  useEffect(() => {
    if (!showSent) setTab("received");
  }, [showSent]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const [{ data: recvData, error: recvErr }, { data: sentData, error: sentErr }] = await Promise.all([
          supabase
            .from("user_feedback_messages")
            .select(
              "id,created_at,sender_id,recipient_id,message,context_type,context_url,context_label,metadata,read_at,sender:profiles!user_feedback_messages_sender_id_fkey(name,avatar_thumbnail_url)",
            )
            .eq("recipient_id", user.id)
            .order("created_at", { ascending: false })
            .limit(100),
          showSent
            ? supabase
                .from("user_feedback_messages")
                .select(
                  "id,created_at,sender_id,recipient_id,message,context_type,context_url,context_label,metadata,read_at,recipient:profiles!user_feedback_messages_recipient_id_fkey(name,avatar_thumbnail_url)",
                )
                .eq("sender_id", user.id)
                .order("created_at", { ascending: false })
                .limit(100)
            : Promise.resolve({ data: [], error: null } as any),
        ]);

        if (recvErr) throw recvErr;
        if (sentErr) throw sentErr;

        if (!cancelled) {
          setReceived((recvData || []) as any);
          setSent((sentData || []) as any);
        }

        // Mark all received as read when opening inbox (simple UX)
        const hasUnread = (recvData || []).some((m: any) => !m.read_at);
        if (hasUnread) {
          const now = new Date().toISOString();
          await supabase.from("user_feedback_messages").update({ read_at: now }).eq("recipient_id", user.id).is("read_at", null);
          if (!cancelled) {
            setReceived((prev) => prev.map((m) => (m.read_at ? m : { ...m, read_at: now })));
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          toast({
            title: "Não foi possível carregar feedbacks",
            description: e?.message || "Tente novamente.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [showSent, toast, user?.id]);

  const renderList = (list: FeedbackRow[], kind: "received" | "sent") => {
    if (loading) {
      return (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Carregando…</CardContent>
        </Card>
      );
    }
    if (!list.length) {
      return (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {kind === "received" ? "Nenhum feedback recebido ainda." : "Nenhum feedback enviado ainda."}
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="space-y-3">
        {list.map((m) => {
          const person = kind === "received" ? m.sender : m.recipient;
          const personId = kind === "received" ? m.sender_id : m.recipient_id;
          const personName = person?.name || null;
          return (
            <Card key={m.id} className="bg-black/20 border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
                  <UserProfilePopover userId={personId} name={personName} avatarUrl={person?.avatar_thumbnail_url || null}>
                    <button type="button" className="text-primary font-semibold text-sm">
                      {personName || "Usuário"}
                    </button>
                  </UserProfilePopover>
                  <span className="text-xs text-muted-foreground">{formatWhen(m.created_at)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {m.context_label && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Referência:</span> {m.context_label}
                  </div>
                )}
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.message}</div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    {kind === "received" && !m.read_at && <Badge variant="secondary">Novo</Badge>}
                    {m.context_type && m.context_type !== "general" && (
                      <Badge variant="outline" className="border-white/20">
                        {m.context_type}
                      </Badge>
                    )}
                  </div>
                  {m.context_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const url = String(m.context_url || "").trim();
                        if (!url) return;
                        if (url.startsWith("http")) window.location.href = url;
                        else navigate(url);
                      }}
                    >
                      Abrir item
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className={`grid w-full max-w-2xl ${showSent ? "grid-cols-2" : "grid-cols-1"}`}>
        <TabsTrigger value="received">Recebidos {unreadCount ? `(${unreadCount})` : ""}</TabsTrigger>
        {showSent && <TabsTrigger value="sent">Enviados</TabsTrigger>}
      </TabsList>
      <TabsContent value="received" className="space-y-3">
        {renderList(received, "received")}
      </TabsContent>
      {showSent && (
        <TabsContent value="sent" className="space-y-3">
          {renderList(sent, "sent")}
        </TabsContent>
      )}
    </Tabs>
  );
}

