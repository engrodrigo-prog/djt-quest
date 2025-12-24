import { useMemo } from "react";
import { Pause, Play, Square, Volume2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTts } from "@/lib/tts";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const previewText = (text: string, max = 120) => {
  const s = String(text || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
};

export function TtsPlayerBar() {
  const { enabled, ttsEnabled, isSpeaking, isPaused, currentText, togglePause, stop, rate, setRate } = useTts();

  const visible = enabled && ttsEnabled && (isSpeaking || isPaused);
  const label = useMemo(() => (currentText ? previewText(currentText) : ""), [currentText]);
  if (!visible) return null;

  return (
    <div
      className="fixed left-0 right-0 z-50"
      style={{ top: "max(env(safe-area-inset-top), 8px)" }}
      role="region"
      aria-label="Controles de áudio"
    >
      <div className="mx-auto max-w-[1100px] px-3">
        <div className="rounded-xl border border-white/10 bg-slate-950/80 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 border border-white/10">
                <Volume2 className="h-4 w-4 text-slate-100" />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold leading-tight text-slate-100">Leitura em voz</p>
                <p className="text-[11px] text-slate-200/80 truncate">{label || "—"}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn("h-9 w-9", "hover:bg-white/10")}
                onClick={togglePause}
                aria-label={isPaused ? "Retomar" : "Pausar"}
                title={isPaused ? "Retomar" : "Pausar"}
              >
                {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </Button>

              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn("h-9 w-9", "hover:bg-white/10")}
                onClick={stop}
                aria-label="Parar"
                title="Parar"
              >
                <Square className="h-4 w-4" />
              </Button>

              <div className="hidden sm:flex items-center gap-1 pl-1.5 ml-1.5 border-l border-white/10">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 hover:bg-white/10"
                  onClick={() => setRate(clamp(Number(rate) - 0.1, 0.75, 1.6))}
                  aria-label="Diminuir velocidade"
                  title="Diminuir velocidade"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="text-[11px] tabular-nums text-slate-200/90 w-[44px] text-center">
                  {Number(rate).toFixed(2)}x
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 hover:bg-white/10"
                  onClick={() => setRate(clamp(Number(rate) + 0.1, 0.75, 1.6))}
                  aria-label="Aumentar velocidade"
                  title="Aumentar velocidade"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      </div>
    </div>
  );
}

