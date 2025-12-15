import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface VoiceRecorderButtonProps {
  onText: (text: string) => void;
  size?: "sm" | "default";
  mode?: "organize" | "summarize";
  language?: string;
  maxSeconds?: number;
  className?: string;
  label?: string;
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

export function VoiceRecorderButton({
  onText,
  size = "sm",
  mode = "organize",
  language = "pt",
  maxSeconds = 45,
  className,
  label = "Falar",
}: VoiceRecorderButtonProps) {
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const discardOnStopRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const cleanupStream = () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
  };

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
          if (discardOnStopRef.current) return;
          setTranscribing(true);
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          if (blob.size > 12 * 1024 * 1024) {
            throw new Error("Áudio muito grande para transcrever. Grave um trecho menor.");
          }
          const ext =
            blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : blob.type.includes("webm") ? "webm" : "mp3";
          const file = new File([blob], `voz-${Date.now()}.${ext}`, { type: blob.type });
          // Convert to base64 data URL
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
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(json?.error || "Falha na transcrição");
          const text = json.text || json.transcript || "";
          if (text && typeof onText === "function") {
            onText(String(text));
          }
          toast({ title: "Áudio transcrito", description: "Texto inserido no campo." });
        } catch (e: any) {
          toast({
            title: "Falha ao transcrever áudio",
            description: e?.message || "Tente novamente",
            variant: "destructive",
          });
        } finally {
          setSeconds(0);
          setTranscribing(false);
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
        disabled={transcribing}
        className="flex items-center gap-2"
        title={
          transcribing
            ? "Transcrevendo áudio..."
            : recording
            ? "Parar gravação"
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
    </div>
  );
}
