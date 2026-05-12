/**
 * StudyLabProvider — provider de estado compartilhado para a reforma do StudyLab.
 *
 * Status: scaffold inicial (Task D.1 do plan 2026-05-11-studylab-quiz-ux-overhaul).
 * Ainda não está plugado em nenhum lugar — o componente atual
 * `src/components/StudyLab.tsx` continua sendo o que renderiza.
 *
 * Próximas fatias vão mover o estado do monolito atual para cá:
 *   - A.1: `historyOpen`, `pinnedSessionIds`, search do histórico.
 *   - A.2: `activeSources[]` (substitui `oracleMode` + `selectedSourceId`).
 *   - A.3: `chatMessages[]`, `chatLoading`, `streamingMeta`.
 *   - B.1: `knowledgeFiles[]` (consumo de `study_knowledge_files`).
 *
 * Referência: docs/superpowers/specs/2026-05-11-studylab-quiz-ux-overhaul-design.md
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type ActiveSourceRef = { id: string };

export type StudyLabState = {
  /** Fontes marcadas como ativas no SourcesPanel. */
  activeSources: ActiveSourceRef[];
  setActiveSources: (next: ActiveSourceRef[]) => void;
  addActiveSource: (id: string) => void;
  removeActiveSource: (id: string) => void;
  clearActiveSources: () => void;
};

const StudyLabContext = createContext<StudyLabState | null>(null);

export function StudyLabProvider({ children }: { children: ReactNode }) {
  const [activeSources, setActiveSources] = useState<ActiveSourceRef[]>([]);

  const value = useMemo<StudyLabState>(
    () => ({
      activeSources,
      setActiveSources,
      addActiveSource: (id: string) =>
        setActiveSources((prev) => (prev.some((s) => s.id === id) ? prev : [...prev, { id }])),
      removeActiveSource: (id: string) =>
        setActiveSources((prev) => prev.filter((s) => s.id !== id)),
      clearActiveSources: () => setActiveSources([]),
    }),
    [activeSources],
  );

  return <StudyLabContext.Provider value={value}>{children}</StudyLabContext.Provider>;
}

export function useStudyLab(): StudyLabState {
  const ctx = useContext(StudyLabContext);
  if (!ctx) {
    throw new Error("useStudyLab must be used inside <StudyLabProvider>.");
  }
  return ctx;
}
