import { supabase } from "@/integrations/supabase/client";

export type ForumKbSnippet = {
  topicTitle: string;
  postId: string;
  content: string;
  hashtags: string[];
  likesCount: number;
  isSolution: boolean;
  isFeatured: boolean;
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

  const { data, error } = await supabase
    .from("forum_knowledge_base")
    .select("title, post_id, content, content_html, hashtags, likes_count, is_solution, is_featured")
    .overlaps("hashtags", tags as any)
    .order("is_solution", { ascending: false })
    .order("likes_count", { ascending: false })
    .limit(limit);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];

  return rows
    .map((row: any) => {
      const topicTitle = String(row?.title || "").trim() || "Tópico do Fórum";
      const postId = String(row?.post_id || "").trim();
      const raw = String(row?.content || "").trim();
      const html = String(row?.content_html || "").trim();
      const content = raw || (html ? stripHtml(html) : "");
      const hashtags = Array.isArray(row?.hashtags) ? row.hashtags.map((h: any) => String(h || "").trim()).filter(Boolean) : [];
      const likesCount = Number(row?.likes_count || 0) || 0;
      const isSolution = Boolean(row?.is_solution);
      const isFeatured = Boolean(row?.is_featured);
      if (!postId || !content.trim()) return null;
      return { topicTitle, postId, content, hashtags, likesCount, isSolution, isFeatured } as ForumKbSnippet;
    })
    .filter(Boolean) as ForumKbSnippet[];
}

