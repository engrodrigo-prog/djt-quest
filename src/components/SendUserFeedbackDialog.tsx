import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type FeedbackContext = {
  type: string;
  url?: string | null;
  label?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientId: string | null;
  recipientName?: string | null;
  context?: FeedbackContext | null;
  defaultMessage?: string;
  onSent?: () => void;
};

export function SendUserFeedbackDialog({
  open,
  onOpenChange,
  recipientId,
  recipientName,
  context,
  defaultMessage,
  onSent,
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const title = useMemo(() => {
    const name = String(recipientName || "").trim();
    return name ? `Enviar feedback para ${name}` : "Enviar feedback";
  }, [recipientName]);

  useEffect(() => {
    if (!open) return;
    setMessage(String(defaultMessage || "").trim());
  }, [defaultMessage, open]);

  const canSend = Boolean(user?.id && recipientId && message.trim().length >= 3 && !sending);

  const send = async () => {
    if (!user?.id) {
      toast({ title: "Faça login para enviar feedback.", variant: "destructive" });
      return;
    }
    if (!recipientId) {
      toast({ title: "Selecione um destinatário.", variant: "destructive" });
      return;
    }
    const text = message.trim();
    if (text.length < 3) {
      toast({ title: "Escreva uma mensagem maior.", variant: "destructive" });
      return;
    }

    try {
      setSending(true);
      const payload = {
        sender_id: user.id,
        recipient_id: recipientId,
        message: text,
        context_type: context?.type || "general",
        context_url: context?.url || null,
        context_label: context?.label || null,
        metadata: {},
      };
      const { error } = await supabase.from("user_feedback_messages").insert(payload);
      if (error) throw error;

      toast({ title: "Feedback enviado!", description: "O usuário verá a mensagem no Perfil." });
      onOpenChange(false);
      setMessage("");
      onSent?.();
    } catch (e: any) {
      toast({
        title: "Erro ao enviar feedback",
        description: e?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {context?.label ? (
              <span>
                Referência: <span className="font-medium">{context.label}</span>
              </span>
            ) : (
              "Envie uma mensagem privada (apenas o usuário verá)."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escreva seu feedback..."
            rows={6}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={!canSend} onClick={send}>
              {sending ? "Enviando..." : "Enviar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

