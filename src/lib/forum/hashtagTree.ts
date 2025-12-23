export type HashtagStat = {
  tag: string;
  usage_count?: number | null;
};

export type HashtagTreeNode = {
  key: string;
  label: string;
  usage: number;
  tags: string[];
  children: HashtagTreeNode[];
};

const STOPWORDS = new Set([
  // PT
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "a",
  "o",
  "as",
  "os",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "para",
  "por",
  "com",
  "sem",
  // EN (para tags híbridas)
  "and",
  "or",
  "of",
  "the",
  "to",
  "in",
  "on",
  "for",
]);

export const normalizeHashtagTag = (raw: string) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/^#+/, "").trim().toLowerCase();
};

const pickDelimiter = (tag: string) => {
  if (tag.includes("/")) return "/";
  if (tag.includes(":")) return ":";
  if (tag.includes(">")) return ">";
  if (tag.includes(".")) return ".";
  return null;
};

export const splitHashtagToPath = (rawTag: string): string[] => {
  const tag = normalizeHashtagTag(rawTag);
  if (!tag) return [];

  const delimiter = pickDelimiter(tag);
  const parts = delimiter ? tag.split(delimiter) : tag.split(/[_-]+/g);

  const filtered = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !STOPWORDS.has(p));

  if (!filtered.length) return [tag];

  if (filtered.length <= 3) return filtered;

  // Mantém no máximo 3 níveis (juntando o restante no 3º nível)
  return [filtered[0], filtered[1], filtered.slice(2).join("_")];
};

const formatSegmentLabel = (raw: string) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  const spaced = s.replace(/[_-]+/g, " ").trim();
  if (!spaced) return s;
  if (/^nr\s*\d+$/i.test(spaced)) return spaced.replace(/\s+/g, "").toUpperCase();
  if (spaced.length <= 4 && /\d/.test(spaced)) return spaced.toUpperCase();
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
};

type MutableNode = {
  key: string;
  label: string;
  usage: number;
  tags: Set<string>;
  children: Map<string, MutableNode>;
};

const toSortedNodeArray = (map: Map<string, MutableNode>): HashtagTreeNode[] => {
  const nodes: HashtagTreeNode[] = Array.from(map.values()).map((n) => ({
    key: n.key,
    label: n.label,
    usage: n.usage,
    tags: Array.from(n.tags),
    children: toSortedNodeArray(n.children),
  }));

  nodes.sort((a, b) => {
    if (b.usage !== a.usage) return b.usage - a.usage;
    return a.label.localeCompare(b.label);
  });

  for (const n of nodes) {
    n.tags.sort((a, b) => a.localeCompare(b));
  }

  return nodes;
};

export const buildHashtagTree = (items: HashtagStat[]): HashtagTreeNode[] => {
  const root = new Map<string, MutableNode>();

  for (const it of items || []) {
    const tag = normalizeHashtagTag(it?.tag);
    if (!tag) continue;
    const usage = Math.max(0, Number(it?.usage_count || 0) || 0);
    const path = splitHashtagToPath(tag);
    const segments = path.length ? path : [tag];

    let cur = root;
    for (const seg of segments) {
      const key = String(seg || "").trim();
      if (!key) continue;
      let node = cur.get(key);
      if (!node) {
        node = {
          key,
          label: formatSegmentLabel(key),
          usage: 0,
          tags: new Set(),
          children: new Map(),
        };
        cur.set(key, node);
      }
      node.tags.add(tag);
      node.usage += usage;
      cur = node.children;
    }
  }

  return toSortedNodeArray(root);
};

export const findNodeByPath = (tree: HashtagTreeNode[], path: string[]) => {
  const normalized = (path || []).map((p) => String(p || "").trim()).filter(Boolean);
  if (!normalized.length) return null;

  let curNodes = tree;
  let current: HashtagTreeNode | null = null;
  for (const seg of normalized) {
    current = curNodes.find((n) => n.key === seg) || null;
    if (!current) return null;
    curNodes = current.children;
  }
  return current;
};

