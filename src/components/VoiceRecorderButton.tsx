import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

interface VoiceRecorderButtonProps {
  onText: (text: string) => void;
  size?: "sm" | "default";
  mode?: "organize" | "summarize";
  language?: string;
  maxSeconds?: number;
  className?: string;
  label?: string;
  confirmBeforeInsert?: boolean;
}

const pickSupportedMime = () => {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  // @ts-ignore
  if (typeof MediaRecorder.isTypeSupported !== "function") return null;
  // @ts-ignore
  for (const mt of candidates) if (MediaRecorder.isTypeSupported(mt)) return mt;
  return null;
};

const formatTime = (s: number) => {
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

const readApiError = async (resp: Response) => {
  try {
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const json = await resp.json().catch(() => ({} as any));
      const msg = (json as any)?.error;
      if (msg) return String(msg);
    }
  } catch {
    // ignore
  }
  try {
    const text = await resp.text();
    const trimmed = String(text || "").trim();
    return trimmed ? trimmed.slice(0, 280) : "";
  } catch {
    return "";
  }
};

export function VoiceRecorderButton({
  onText,
  size = "sm",
  mode = "organize",
  language = "pt",
  maxSeconds = 45,
  className,
  label = "Falar",
  confirmBeforeInsert = true,
}: VoiceRecorderButtonProps) {
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewAudioUrl, setReviewAudioUrl] = useState<string | null>(null);
  const [reviewAudioFile, setReviewAudioFile] = useState<File | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [suggestingTags, setSuggestingTags] = useState(false);
  const transcribeRunIdRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const discardOnStopRef = useRef(false);

  const canStartNewRecording = useMemo(() => !recording && !transcribing && !reviewOpen, [recording, transcribing, reviewOpen]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      try {
        if (reviewAudioUrl) URL.revokeObjectURL(reviewAudioUrl);
      } catch {
        // ignore
      }
    };
  }, [reviewAudioUrl]);

  const cleanupStream = () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
  };

  const resetReview = useCallback(() => {
    transcribeRunIdRef.current += 1;
    setReviewOpen(false);
    setReviewText("");
    setReviewError(null);
    setSuggestingTags(false);
    setReviewAudioFile(null);
    setSeconds(0);
    setTranscribing(false);
    try {
      if (reviewAudioUrl) URL.revokeObjectURL(reviewAudioUrl);
    } catch {
      // ignore
    }
    setReviewAudioUrl(null);
  }, [reviewAudioUrl]);

  const transcribeFile = useCallback(
    async (file: File) => {
      const runId = (transcribeRunIdRef.current += 1);
      try {
        setReviewError(null);
        setTranscribing(true);
        if (file.size > 12 * 1024 * 1024) {
          throw new Error("Áudio muito grande para transcrever. Grave um trecho menor.");
        }
        let text = "";
        try {
          const { data: userData } = await supabase.auth.getUser();
          const userId = userData.user?.id;
          if (!userId) throw new Error("Não autenticado");

          const name = String(file.name || "").trim();
          const ext = (() => {
            const m = String(file.type || "").split(";")[0].trim().toLowerCase();
            if (name.includes(".")) return name.split(".").pop() || "webm";
            if (m === "audio/mp4" || m === "audio/x-m4a") return "m4a";
            if (m === "audio/mpeg") return "mp3";
            if (m === "audio/wav") return "wav";
            if (m === "audio/ogg") return "ogg";
            if (m === "audio/webm") return "webm";
            return "webm";
          })();

          const bucket = "forum-attachments";
          const filePath = `voice-transcribe/${userId}/voice-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          let uploadedPath: string | null = null;

          try {
            const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file, {
              upsert: false,
              cacheControl: "60",
              contentType: file.type || undefined,
            } as any);
            if (uploadError) throw uploadError;
            uploadedPath = filePath;

            const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(filePath);
            const publicUrl = publicData?.publicUrl;
            if (!publicUrl) throw new Error("Falha ao obter URL do áudio");

            const resp = await fetch("/api/ai?handler=transcribe-audio", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fileUrl: publicUrl, mode, language }),
            });
            if (!resp.ok) {
              const msg = await readApiError(resp);
              throw new Error(msg || "Falha na transcrição");
            }
            const json = await resp.json().catch(() => ({} as any));
            if (runId !== transcribeRunIdRef.current) return;
            text = String((json as any)?.text || (json as any)?.transcript || "").trim();
          } finally {
            // best-effort cleanup do arquivo temporário (sempre tenta apagar)
            try {
              if (uploadedPath) await supabase.storage.from(bucket).remove([uploadedPath]);
            } catch {
              // ignore
            }
          }
        } catch (primaryErr: any) {
          // Fallback: base64 (caso upload falhe / sem sessão / sem permissão)
          const toBase64 = (f: File) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(f);
            });
          const b64 = await toBase64(file);
          const resp = await fetch("/api/ai?handler=transcribe-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: b64, mode, language }),
          });
          if (!resp.ok) {
            const msg = await readApiError(resp);
            throw new Error(msg || primaryErr?.message || "Falha na transcrição");
          }
          const json = await resp.json().catch(() => ({} as any));
          if (runId !== transcribeRunIdRef.current) return;
          text = String((json as any)?.text || (json as any)?.transcript || "").trim();
        }

        setReviewText(text);
        if (!confirmBeforeInsert && text && typeof onText === "function") {
          onText(text);
          toast({ title: "Áudio transcrito", description: "Texto inserido no campo." });
          resetReview();
        }
      } catch (e: any) {
        setReviewError(e?.message || "Falha na transcrição");
        toast({
          title: "Falha ao transcrever áudio",
          description: e?.message || "Tente novamente",
          variant: "destructive",
        });
      } finally {
        if (runId !== transcribeRunIdRef.current) return;
        setTranscribing(false);
      }
    },
    [confirmBeforeInsert, language, mode, onText, resetReview, toast],
  );

  const stopRecording = (opts?: { discard?: boolean }) => {
    discardOnStopRef.current = Boolean(opts?.discard);
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      // ignore
    }
    cleanupStream();
    setRecording(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
  };

  const startRecording = async () => {
    try {
      if (!canStartNewRecording) return;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        toast({
          title: "Áudio não suportado neste navegador",
          description: "Tente atualizar o navegador ou use um computador com Chrome/Edge.",
          variant: "destructive",
        });
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        toast({
          title: "Gravação não suportada neste navegador",
          description: "Use um navegador compatível (Chrome/Edge) ou anexe um arquivo de áudio.",
          variant: "destructive",
        });
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as any,
      });

      const mimeType = pickSupportedMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType } as any) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        try {
          if (discardOnStopRef.current) {
            discardOnStopRef.current = false;
            setSeconds(0);
            return;
          }
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          if (blob.size > 12 * 1024 * 1024) {
            throw new Error("Áudio muito grande para transcrever. Grave um trecho menor.");
          }
          const ext =
            blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : blob.type.includes("webm") ? "webm" : "mp3";
          const file = new File([blob], `voz-${Date.now()}.${ext}`, { type: blob.type });
          setReviewAudioFile(file);
          setReviewError(null);
          setReviewText("");
          try {
            const url = URL.createObjectURL(file);
            setReviewAudioUrl(url);
          } catch {
            setReviewAudioUrl(null);
          }
          setReviewOpen(true);
          await transcribeFile(file);
        } catch (e: any) {
          toast({
            title: "Falha ao processar áudio",
            description: e?.message || "Tente novamente",
            variant: "destructive",
          });
        } finally {
          setSeconds(0);
          discardOnStopRef.current = false;
        }
      };
      mediaRecorderRef.current = rec;
      streamRef.current = stream;
      setRecording(true);
      setSeconds(0);
      rec.start();
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(s);
        if (maxSeconds > 0 && s >= maxSeconds) {
          toast({ title: "Tempo máximo atingido", description: "Parando gravação e transcrevendo..." });
          stopRecording();
        }
      }, 1000);
    } catch {
      toast({
        title: "Permissão de microfone necessária",
        description: "Habilite o microfone para gravar áudio.",
        variant: "destructive",
      });
    }
  };

  const toggle = () => {
    if (transcribing) return;
    if (recording) return stopRecording();
    return startRecording();
  };

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <Button
        type="button"
        size={size}
        variant={recording ? "destructive" : "outline"}
        onClick={toggle}
        disabled={transcribing || reviewOpen}
        className="flex items-center gap-2"
        title={
          transcribing
            ? "Transcrevendo áudio..."
            : recording
            ? "Parar gravação"
            : confirmBeforeInsert
              ? "Gravar áudio, transcrever e revisar antes de inserir"
              : "Gravar áudio e transcrever"
        }
      >
        {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        <span>{transcribing ? "Transcrevendo..." : recording ? `Parar (${formatTime(seconds)})` : label}</span>
      </Button>
      {recording && !transcribing && (
        <Button
          type="button"
          size={size}
          variant="ghost"
          onClick={() => stopRecording({ discard: true })}
          className="gap-2"
          title="Cancelar gravação (não transcrever)"
        >
          <X className="h-4 w-4" />
          Cancelar
        </Button>
      )}

      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!open) resetReview();
          else setReviewOpen(true);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Revisar transcrição</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {reviewAudioUrl && (
              <div className="rounded-md border p-2 bg-muted">
                <audio controls className="w-full">
                  <source src={reviewAudioUrl} />
                  Seu navegador não suporta áudio.
                </audio>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {transcribing
                  ? "Transcrevendo… você pode aguardar ou regravar."
                  : reviewError
                    ? "Não foi possível transcrever agora. Você pode tentar novamente ou regravar."
                    : "Confirme e ajuste o texto antes de inserir."}
              </p>
              <Textarea
                rows={6}
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                placeholder={transcribing ? "Aguardando transcrição…" : "Texto transcrito aparecerá aqui…"}
                disabled={transcribing}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={transcribing || suggestingTags || (reviewText || "").trim().length < 10}
                onClick={async () => {
                  const base = (reviewText || "").trim();
                  if (base.length < 10) return;
                  try {
                    setSuggestingTags(true);
                    const resp = await fetch("/api/ai?handler=suggest-hashtags", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ text: base }),
                    });
                    const json = await resp.json().catch(() => ({}));
                    if (!resp.ok) throw new Error(json?.error || "Falha ao sugerir hashtags");
                    const tags = Array.isArray(json.hashtags) ? json.hashtags : [];
                    const cleanTags = tags
                      .map((t: any) => String(t || "").trim())
                      .filter((t: string) => t.startsWith("#") && t.length >= 2)
                      .slice(0, 5);
                    if (cleanTags.length === 0) return;
                    setReviewText((prev) => {
                      const cur = prev || "";
                      const toAdd = cleanTags.filter((t: string) => !cur.includes(t));
                      if (toAdd.length === 0) return cur;
                      return [cur.trim(), toAdd.join(" ")].filter(Boolean).join("\n");
                    });
                  } catch (e: any) {
                    toast({
                      title: "Não foi possível sugerir temas agora",
                      description: e?.message || "Tente novamente",
                      variant: "destructive",
                    });
                  } finally {
                    setSuggestingTags(false);
                  }
                }}
              >
                {suggestingTags ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Sugerir #tags
              </Button>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const file = reviewAudioFile;
                  if (!file) return;
                  await transcribeFile(file);
                }}
                disabled={transcribing || !reviewAudioFile}
              >
                Tentar novamente
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetReview();
                  setTimeout(() => startRecording(), 80);
                }}
                disabled={transcribing || recording}
              >
                Regravar
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={resetReview}>
                Descartar
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const text = (reviewText || "").trim();
                  if (!text) return;
                  if (typeof onText === "function") onText(text);
                  toast({ title: "Texto inserido", description: "Você pode ajustar antes de publicar." });
                  resetReview();
                }}
                disabled={transcribing || (reviewText || "").trim().length === 0}
              >
                Inserir texto
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
