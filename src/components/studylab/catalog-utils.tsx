import { Badge } from "@/components/ui/badge";
import { DJT_RULES_ARTICLE } from "../../../shared/djt-rules";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StudySource {
  id: string;
  user_id: string;
  title: string;
  kind: "text" | "url" | "file" | "youtube";
  url: string | null;
  storage_path: string | null;
  summary: string | null;
  ingest_status?: "pending" | "ok" | "failed" | null;
  ingested_at?: string | null;
  ingest_error?: string | null;
  topic?: string | null;
  category?: string | null;
  scope?: "user" | "org" | string | null;
  published?: boolean | null;
  metadata?: any | null;
  is_persistent: boolean;
  expires_at?: string | null;
  access_count?: number | null;
  created_at: string;
  last_used_at: string | null;
}

export const STUDY_CATEGORIES = [
  "MANUAIS",
  "PROCEDIMENTOS",
  "APOSTILAS",
  "RELATORIO_OCORRENCIA",
  "AUDITORIA_INTERNA",
  "AUDITORIA_EXTERNA",
  "OUTROS",
] as const;

export type StudyCategory = (typeof STUDY_CATEGORIES)[number];
export type StudyScope = "user" | "org";

export type IncidentForm = {
  ocorrido: string;
  causaRaizModoFalha: string;
  barreirasCuidados: string;
  acoesCorretivasPreventivas: string;
  mudancasImplementadas: string;
};

export const EMPTY_INCIDENT: IncidentForm = {
  ocorrido: "",
  causaRaizModoFalha: "",
  barreirasCuidados: "",
  acoesCorretivasPreventivas: "",
  mudancasImplementadas: "",
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<StudyCategory, string> = {
  MANUAIS: "Manuais",
  PROCEDIMENTOS: "Procedimentos",
  APOSTILAS: "Apostilas",
  RELATORIO_OCORRENCIA: "Relatório de Ocorrência",
  AUDITORIA_INTERNA: "Auditoria Interna",
  AUDITORIA_EXTERNA: "Auditoria Externa",
  OUTROS: "Outros",
};

export const CATEGORY_ORDER: StudyCategory[] = [
  "MANUAIS",
  "PROCEDIMENTOS",
  "APOSTILAS",
  "RELATORIO_OCORRENCIA",
  "AUDITORIA_INTERNA",
  "AUDITORIA_EXTERNA",
  "OUTROS",
];

export const TOPIC_LABELS: Record<string, string> = {
  LINHAS: "Linhas de Transmissão",
  SUBESTACOES: "Subestações",
  PROCEDIMENTOS: "Procedimentos",
  PROTECAO: "Proteção",
  AUTOMACAO: "Automação",
  TELECOM: "Telecom",
  SEGURANCA_DO_TRABALHO: "Segurança do Trabalho",
  OUTROS: "Outros assuntos",
};

export const PRIVATE_TTL_DAYS = 7;
export const FIXED_RULES_ID = "fixed:djt-quest-rules";

export const FIXED_SOURCES: StudySource[] = [
  {
    id: FIXED_RULES_ID,
    user_id: "system",
    title: DJT_RULES_ARTICLE.title,
    kind: "text",
    url: null,
    storage_path: null,
    summary: DJT_RULES_ARTICLE.summary,
    ingest_status: "ok",
    ingested_at: null,
    ingest_error: null,
    topic: "OUTROS",
    category: "OUTROS",
    scope: "org",
    published: true,
    metadata: {
      fixed: true,
      fixed_body: DJT_RULES_ARTICLE.body,
      ai: { outline: DJT_RULES_ARTICLE.outline },
      tags: DJT_RULES_ARTICLE.tags,
    },
    is_persistent: true,
    created_at: "2025-01-01T00:00:00Z",
    last_used_at: null,
    expires_at: null,
    access_count: 0,
  },
];

// ─── Pure utilities ───────────────────────────────────────────────────────────

export const normalizeCategory = (raw: unknown): StudyCategory => {
  const s = (raw || "").toString().trim().toUpperCase().replace(/\s+/g, "_");
  return (STUDY_CATEGORIES as readonly string[]).includes(s) ? (s as StudyCategory) : "OUTROS";
};

export const normalizeScope = (raw: unknown): StudyScope => {
  const s = (raw || "").toString().trim().toLowerCase();
  return s === "org" ? "org" : "user";
};

export const normalizeTopic = (raw: unknown) =>
  (raw || "").toString().trim().toUpperCase().replace(/\s+/g, "_");

export const getSourceMeta = (s: StudySource) =>
  s && s.metadata && typeof s.metadata === "object" ? s.metadata : null;

export const getSourceTopicKey = (s: StudySource) => {
  const meta = getSourceMeta(s);
  const raw = s.topic || meta?.ai?.topic || meta?.topic || "OUTROS";
  return normalizeTopic(raw || "OUTROS") || "OUTROS";
};

export const getSourceCategoryKey = (s: StudySource) => {
  const meta = getSourceMeta(s);
  const raw = s.category || meta?.ai?.category || meta?.category || "OUTROS";
  return normalizeCategory(raw || "OUTROS");
};

export const isFixedSource = (s: StudySource) => s.id === FIXED_RULES_ID;
export const isPublicSource = (s: StudySource) =>
  normalizeScope(s.scope) === "org" && s.published !== false;
export const isPrivateSource = (s: StudySource) =>
  normalizeScope(s.scope) === "user" || s.published === false;
export const isChatCompendiumSource = (s: StudySource) =>
  String(getSourceMeta(s)?.source || "").toLowerCase() === "study_chat";

export const displaySummary = (s: StudySource) => s.summary?.trim() || s.url || "Sem resumo";

export const getSourceTags = (s: StudySource): string[] => {
  const meta = getSourceMeta(s);
  const raw = meta?.ai?.tags || meta?.tags || [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map((t: string) => t.trim()).filter(Boolean);
  return [];
};

// ─── JSX utilities ────────────────────────────────────────────────────────────

export const renderOutline = (nodes: any[], depth = 0): JSX.Element | null => {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  return (
    <ul className={`space-y-1 ${depth > 0 ? "ml-4" : ""}`}>
      {nodes.map((node, idx) => {
        const title = String(node?.title || "").trim();
        if (!title) return null;
        return (
          <li key={`${depth}-${idx}`} className="text-xs text-muted-foreground">
            <span className="text-foreground/90">{title}</span>
            {renderOutline(node?.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
};

export const statusBadge = (s: StudySource) => {
  if (s.ingest_status === "ok") return null;
  if (s.ingest_status === "pending")
    return <Badge variant="outline" className="text-[10px]">analisando…</Badge>;
  if (s.ingest_status === "failed")
    return <Badge variant="outline" className="text-[10px] border-red-400 text-red-500">falhou</Badge>;
  return null;
};
