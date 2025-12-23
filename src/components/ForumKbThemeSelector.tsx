import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildHashtagTree, findNodeByPath, normalizeHashtagTag, type HashtagTreeNode } from "@/lib/forum/hashtagTree";

export type ForumKbSelection = {
  path: string[];
  label: string;
  tags: string[];
};

export function ForumKbThemeSelector({
  maxTags = 20,
  onChange,
  className,
}: {
  maxTags?: number;
  onChange?: (selection: ForumKbSelection | null) => void;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<HashtagTreeNode[]>([]);
  const [level1, setLevel1] = useState<string>("");
  const [level2, setLevel2] = useState<string>("");
  const [level3, setLevel3] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("forum_hashtags")
          .select("tag, usage_count")
          .order("usage_count", { ascending: false })
          .limit(500);
        if (error) throw error;
        if (cancelled) return;
        const items = Array.isArray(data) ? data : [];
        setTree(buildHashtagTree(items as any));
      } catch (e) {
        if (cancelled) return;
        setTree([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const level1Node = useMemo(() => (level1 ? findNodeByPath(tree, [level1]) : null), [level1, tree]);
  const level2Node = useMemo(
    () => (level1 && level2 ? findNodeByPath(tree, [level1, level2]) : null),
    [level1, level2, tree],
  );
  const level3Node = useMemo(
    () => (level1 && level2 && level3 ? findNodeByPath(tree, [level1, level2, level3]) : null),
    [level1, level2, level3, tree],
  );

  const selectedNode = level3Node || level2Node || level1Node;
  const selectedLabel = useMemo(() => {
    const parts: string[] = [];
    if (level1Node?.label) parts.push(level1Node.label);
    if (level2Node?.label) parts.push(level2Node.label);
    if (level3Node?.label) parts.push(level3Node.label);
    return parts.join(" › ");
  }, [level1Node, level2Node, level3Node]);

  const selectedTags = useMemo(() => {
    const tags = (selectedNode?.tags || []).map(normalizeHashtagTag).filter(Boolean);
    return Array.from(new Set(tags)).slice(0, Math.max(1, maxTags));
  }, [maxTags, selectedNode]);

  useEffect(() => {
    if (!onChange) return;
    if (!selectedNode || !selectedTags.length) {
      onChange(null);
      return;
    }
    const path = [level1, level2, level3].filter(Boolean);
    onChange({ path, label: selectedLabel || path.join(" › "), tags: selectedTags });
  }, [level1, level2, level3, onChange, selectedLabel, selectedNode, selectedTags]);

  const reset = () => {
    setLevel1("");
    setLevel2("");
    setLevel3("");
  };

  const level2Options = level1Node?.children || [];
  const level3Options = level2Node?.children || [];

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-2">
          <Label>Tema</Label>
          <Select
            value={level1}
            onValueChange={(v) => {
              setLevel1(v);
              setLevel2("");
              setLevel3("");
            }}
            disabled={loading || tree.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder={loading ? "Carregando…" : tree.length ? "Selecione" : "Sem hashtags ainda"} />
            </SelectTrigger>
            <SelectContent>
              {tree.map((n) => (
                <SelectItem key={n.key} value={n.key}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {level1 && level2Options.length > 0 && (
          <div className="space-y-2">
            <Label>Subtema</Label>
            <Select
              value={level2}
              onValueChange={(v) => {
                setLevel2(v);
                setLevel3("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {level2Options.map((n) => (
                  <SelectItem key={n.key} value={n.key}>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {level1 && level2 && level3Options.length > 0 && (
          <div className="space-y-2">
            <Label>Detalhe</Label>
            <Select value={level3} onValueChange={setLevel3}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {level3Options.map((n) => (
                  <SelectItem key={n.key} value={n.key}>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedTags.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Seleção: <span className="text-foreground">{selectedLabel || "—"}</span>
              </p>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={reset}>
                Limpar
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedTags.slice(0, 10).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  #{t}
                </Badge>
              ))}
              {selectedTags.length > 10 && (
                <Badge variant="outline" className="text-[10px]">
                  +{selectedTags.length - 10}
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

