import { supabase } from "@/integrations/supabase/client";

export type ForumKbSnippet = {
  topicTitle: string;
  postId: string;
  content: string;
  hashtags: string[];
  likesCount: number;
  isSolution: boolean;
  isFeatured: boolean;
  sourceType?: "forum" | "study";
  sourceKind?: string;
  sourceUrl?: string | null;
};

const stripHtml = (html: string) =>
  String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function fetchForumKbSnippets(params: { tags: string[]; limit?: number }): Promise<ForumKbSnippet[]> {
  const limit = Math.max(1, Math.min(12, Number(params.limit || 6)));
  const tags = Array.from(
    new Set((params.tags || []).map((t) => String(t || "").trim().replace(/^#+/, "").toLowerCase()).filter(Boolean)),
  ).slice(0, 24);
  if (!tags.length) return [];

  const selectFields =
    "source_type, title, post_id, source_id, content, content_html, hashtags, likes_count, is_solution, is_featured, kind, url";
  let rows: any[] = [];
  try {
    const { data, error } = await supabase
      .from("knowledge_base")
      .select(selectFields)
      .overlaps("hashtags", tags as any)
      .order("is_solution", { ascending: false })
      .order("likes_count", { ascending: false })
      .limit(limit);
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  } catch {
    const { data, error } = await supabase
      .from("forum_knowledge_base")
      .select("title, post_id, content, content_html, hashtags, likes_count, is_solution, is_featured")
      .overlaps("hashtags", tags as any)
      .order("is_solution", { ascending: false })
      .order("likes_count", { ascending: false })
      .limit(limit);
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  }

  return rows
    .map((row: any) => {
      const sourceType = String(row?.source_type || "forum").toLowerCase() === "study" ? "study" : "forum";
      const topicTitle = String(row?.title || "").trim() || (sourceType === "study" ? "Material StudyLab" : "Tópico do Fórum");
      const postId = String(row?.post_id || row?.source_id || "").trim();
      const raw = String(row?.content || "").trim();
      const html = String(row?.content_html || "").trim();
      const content = raw || (html ? stripHtml(html) : "");
      const hashtags = Array.isArray(row?.hashtags) ? row.hashtags.map((h: any) => String(h || "").trim()).filter(Boolean) : [];
      const likesCount = Number(row?.likes_count || 0) || 0;
      const isSolution = Boolean(row?.is_solution);
      const isFeatured = Boolean(row?.is_featured);
      const sourceKind = row?.kind ? String(row.kind).toLowerCase() : undefined;
      const sourceUrl = row?.url ? String(row.url) : null;
      if (!postId || !content.trim()) return null;
      return { topicTitle, postId, content, hashtags, likesCount, isSolution, isFeatured, sourceType, sourceKind, sourceUrl } as ForumKbSnippet;
    })
    .filter(Boolean) as ForumKbSnippet[];
}
