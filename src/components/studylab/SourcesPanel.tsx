import { useStudyLab } from "./StudyLabProvider";
import { SourcesPanelCore } from "./SourcesPanelCore";
import type { StudySourceMini, SourcesPanelCoreProps } from "./SourcesPanelCore";

export type { StudySourceMini };

type SourcesPanelProps = Omit<SourcesPanelCoreProps, "activeIds" | "onToggle" | "onClearAll">;

export function SourcesPanel(props: SourcesPanelProps) {
  const { activeSources, addActiveSource, removeActiveSource, clearActiveSources } = useStudyLab();
  const activeIds = activeSources.map((s) => s.id);

  return (
    <SourcesPanelCore
      {...props}
      activeIds={activeIds}
      onToggle={(id) => {
        if (activeIds.includes(id)) removeActiveSource(id);
        else addActiveSource(id);
      }}
      onClearAll={clearActiveSources}
    />
  );
}
