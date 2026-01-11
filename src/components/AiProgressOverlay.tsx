import React from "react";
import { useSyncExternalStore } from "react";

import { aiProgressStore } from "@/lib/aiProgress";
import { useI18n } from "@/contexts/I18nContext";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const taskSteps = (taskKey: string, t: (key: string) => string) => {
  switch (taskKey) {
    case "study-chat:ingest":
      return [
        t("aiProgress.steps.prepareMaterial"),
        t("aiProgress.steps.aiAnalyze"),
        t("aiProgress.steps.organizeCatalog"),
        t("aiProgress.steps.save"),
      ];
    case "study-quiz":
      return [
        t("aiProgress.steps.collectContext"),
        t("aiProgress.steps.aiGenerate"),
        t("aiProgress.steps.validate"),
        t("aiProgress.steps.save"),
      ];
    case "suggest-hashtags":
      return [t("aiProgress.steps.aiAnalyze"), t("aiProgress.steps.aiGenerate"), t("aiProgress.steps.save")];
    case "cleanup-text":
      return [t("aiProgress.steps.aiAnalyze"), t("aiProgress.steps.aiRewrite"), t("aiProgress.steps.save")];
    case "transcribe-audio":
      return [t("aiProgress.steps.processAudio"), t("aiProgress.steps.aiTranscribe"), t("aiProgress.steps.save")];
    case "translate-text":
      return [t("aiProgress.steps.aiAnalyze"), t("aiProgress.steps.aiTranslate"), t("aiProgress.steps.save")];
    default:
      return [t("aiProgress.steps.prepare"), t("aiProgress.steps.aiWork"), t("aiProgress.steps.save")];
  }
};

const taskTitle = (taskKey: string, t: (key: string) => string) => {
  switch (taskKey) {
    case "study-chat:ingest":
      return t("aiProgress.task.catalog");
    case "study-quiz":
      return t("aiProgress.task.quiz");
    case "suggest-hashtags":
      return t("aiProgress.task.hashtags");
    case "cleanup-text":
      return t("aiProgress.task.rewrite");
    case "transcribe-audio":
      return t("aiProgress.task.transcribe");
    case "translate-text":
      return t("aiProgress.task.translate");
    default:
      return t("aiProgress.task.generic");
  }
};

const computeProgress = (startedAt: number) => {
  const elapsedMs = Date.now() - startedAt;
  const elapsed = Math.max(0, elapsedMs / 1000);
  // Smooth, capped progress while request is pending.
  const p = 5 + Math.min(90, (elapsed / 18) * 90);
  return Math.min(95, p);
};

export function AiProgressOverlay() {
  const { t } = useI18n();
  const snap = useSyncExternalStore(aiProgressStore.subscribe, aiProgressStore.getSnapshot, aiProgressStore.getSnapshot);
  const task = snap.current;

  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (!task) {
      setProgress(0);
      return;
    }
    setProgress(8);
    const timer = setInterval(() => {
      setProgress(computeProgress(task.startedAt));
    }, 120);
    return () => clearInterval(timer);
  }, [task?.id]);

  if (!task) return null;

  const steps = taskSteps(task.taskKey, t);
  const title = taskTitle(task.taskKey, t);
  const idx = Math.min(steps.length - 1, Math.floor((progress / 100) * steps.length));
  const stageLabel =
    idx <= 0 ? t("aiProgress.stage.preparing") : idx >= steps.length - 1 ? t("aiProgress.stage.finishing") : t("aiProgress.stage.processing");

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 px-4">
      <div className="pointer-events-auto w-full rounded-xl border bg-card/95 p-4 shadow-xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">{t("aiProgress.label")}</div>
            <div className="text-base font-semibold leading-tight">{title}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {stageLabel}
              {snap.pendingCount > 1 ? ` • ${t("aiProgress.more", { count: snap.pendingCount - 1 })}` : ""}
            </div>
          </div>
          <div className="shrink-0 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
            {Math.round(progress)}%
          </div>
        </div>

        <div className="mt-3">
          <Progress value={progress} className="h-2" />
        </div>

        <div className="mt-3 grid gap-1">
          {steps.map((s, i) => (
            <div
              key={`${task.id}-${i}`}
              className={cn(
                "text-sm",
                i < idx ? "text-muted-foreground line-through opacity-70" : i === idx ? "font-medium" : "text-muted-foreground",
              )}
            >
              {i < idx ? `✓ ${s}` : i === idx ? `• ${s}` : `○ ${s}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
