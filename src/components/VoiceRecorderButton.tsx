import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VoiceRecorderButtonProps {
  onText: (text: string) => void;
  size?: "sm" | "default";
}

export function VoiceRecorderButton({ onText, size = "sm" }: VoiceRecorderButtonProps) {
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          const file = new File([blob], `voz-${Date.now()}.webm`, { type: blob.type });
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
            body: JSON.stringify({ audioBase64: b64, mode: "organize", language: "pt" }),
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
        }
      };
      mediaRecorderRef.current = rec;
      streamRef.current = stream;
      setRecording(true);
      setSeconds(0);
      rec.start();
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedAt) / 1000));
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
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        type="button"
        size={size}
        variant={recording ? "destructive" : "outline"}
        onClick={toggle}
        className="flex items-center gap-1"
      >
        {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      </Button>
      {recording && (
        <span className="text-[11px] text-red-500">
          ● Gravando {seconds}s
        </span>
      )}
    </div>
  );
}

