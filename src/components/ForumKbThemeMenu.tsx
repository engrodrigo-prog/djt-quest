import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildHashtagTree, type HashtagTreeNode } from "@/lib/forum/hashtagTree";
import type { ForumKbSelection } from "@/components/ForumKbThemeSelector";

const filterTree = (nodes: HashtagTreeNode[], q: string): HashtagTreeNode[] => {
  const query = q.trim().toLowerCase();
  if (!query) return nodes;

  const keep = (n: HashtagTreeNode): HashtagTreeNode | null => {
    const labelHit = n.label.toLowerCase().includes(query);
    const tagHit = (n.tags || []).some((t) => t.toLowerCase().includes(query));
    const children = (n.children || []).map(keep).filter(Boolean) as HashtagTreeNode[];
    if (labelHit || tagHit || children.length) {
      return { ...n, children };
    }
    return null;
  };

  return nodes.map(keep).filter(Boolean) as HashtagTreeNode[];
};

const pathEquals = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export function ForumKbThemeMenu({
  selected,
  onSelect,
  maxTags = 20,
}: {
  selected: ForumKbSelection | null;
  onSelect: (next: ForumKbSelection | null) => void;
  maxTags?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<HashtagTreeNode[]>([]);
  const [search, setSearch] = useState("");
  const [openLevel1, setOpenLevel1] = useState<string | null>(null);
  const [openLevel2, setOpenLevel2] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("forum_hashtags")
          .select("tag, usage_count")
          .order("usage_count", { ascending: false })
          .limit(700);
        if (error) throw error;
        if (cancelled) return;
        const items = Array.isArray(data) ? data : [];
        setTree(buildHashtagTree(items as any));
      } catch {
        if (!cancelled) setTree([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => filterTree(tree, search), [search, tree]);

  const pick = (path: string[], label: string, tags: string[]) => {
    const unique = Array.from(new Set(tags)).slice(0, Math.max(1, maxTags));
    if (!unique.length) {
      onSelect(null);
      return;
    }
    onSelect({ path, label, tags: unique });
  };

  const isSelected = (path: string[]) => Boolean(selected?.path && pathEquals(selected.path, path));

  return (
    <div className="space-y-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={loading ? "Carregando hashtags…" : "Buscar tema/hashtag…"}
      />

      {!loading && filtered.length === 0 && (
        <p className="text-[11px] text-white/70">
          Nenhuma hashtag encontrada. Use # nos fóruns e no StudyLab para alimentar esta base.
        </p>
      )}

      <div className="max-h-72 overflow-y-auto rounded-md border border-white/15 bg-black/10 p-2 space-y-1">
        {filtered.map((lvl1) => {
          const open1 = openLevel1 === lvl1.key;
          const path1 = [lvl1.key];
          return (
            <div key={lvl1.key} className="space-y-1">
              <div className={`flex items-center gap-2 rounded-md px-2 py-1 ${isSelected(path1) ? "bg-primary/25" : "hover:bg-white/5"}`}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-white/90"
                  onClick={() => {
                    setOpenLevel1((prev) => (prev === lvl1.key ? null : lvl1.key));
                    setOpenLevel2(null);
                  }}
                >
                  {open1 ? "▾" : "▸"}
                </Button>
                <button
                  type="button"
                  className="flex-1 text-left text-xs text-white hover:underline"
                  onClick={() => pick(path1, lvl1.label, lvl1.tags)}
                >
                  {lvl1.label}
                </button>
                <Badge variant="outline" className="text-[10px] border-white/30 text-white/80">
                  {Math.min(lvl1.tags.length, maxTags)}#
                </Badge>
              </div>

              {open1 && lvl1.children.length > 0 && (
                <div className="pl-6 space-y-1">
                  {lvl1.children.map((lvl2) => {
                    const open2 = openLevel2 === lvl2.key;
                    const path2 = [lvl1.key, lvl2.key];
                    return (
                      <div key={`${lvl1.key}/${lvl2.key}`} className="space-y-1">
                        <div className={`flex items-center gap-2 rounded-md px-2 py-1 ${isSelected(path2) ? "bg-primary/20" : "hover:bg-white/5"}`}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-white/90"
                            onClick={() => setOpenLevel2((prev) => (prev === lvl2.key ? null : lvl2.key))}
                          >
                            {lvl2.children.length ? (open2 ? "▾" : "▸") : "•"}
                          </Button>
                          <button
                            type="button"
                            className="flex-1 text-left text-xs text-white hover:underline"
                            onClick={() => pick(path2, `${lvl1.label} › ${lvl2.label}`, lvl2.tags)}
                          >
                            {lvl2.label}
                          </button>
                          <Badge variant="outline" className="text-[10px] border-white/30 text-white/80">
                            {Math.min(lvl2.tags.length, maxTags)}#
                          </Badge>
                        </div>

                        {open2 && lvl2.children.length > 0 && (
                          <div className="pl-6 space-y-1">
                            {lvl2.children.map((lvl3) => {
                              const path3 = [lvl1.key, lvl2.key, lvl3.key];
                              return (
                                <div key={`${lvl1.key}/${lvl2.key}/${lvl3.key}`} className={`flex items-center gap-2 rounded-md px-2 py-1 ${isSelected(path3) ? "bg-primary/15" : "hover:bg-white/5"}`}>
                                  <span className="text-xs text-white/60">•</span>
                                  <button
                                    type="button"
                                    className="flex-1 text-left text-xs text-white hover:underline"
                                    onClick={() => pick(path3, `${lvl1.label} › ${lvl2.label} › ${lvl3.label}`, lvl3.tags)}
                                  >
                                    {lvl3.label}
                                  </button>
                                  <Badge variant="outline" className="text-[10px] border-white/30 text-white/80">
                                    {Math.min(lvl3.tags.length, maxTags)}#
                                  </Badge>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected?.tags?.length ? (
        <p className="text-[11px] text-white/70">
          Foco: <span className="text-white/90">{selected.label}</span> ({selected.tags.length} hashtag(s))
        </p>
      ) : (
        <p className="text-[11px] text-white/70">Selecione um tema para focar o Catálogo.</p>
      )}
    </div>
  );
}
