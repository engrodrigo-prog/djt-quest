// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Invalid server environment" });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      // Sem config de backend: devolve feed vazio para não quebrar o cliente
      return res.status(200).json({ items: [], meta: { warning: "Supabase não configurado no servidor (SUPABASE_URL/SUPABASE_*_KEY)." } });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const authed =
      token && ANON_KEY
        ? createClient(SUPABASE_URL, ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
        : null;
    let currentUserId: string | null = null;
    if (authed) {
      try {
        const { data, error } = await authed.auth.getUser();
        if (!error) currentUserId = data?.user?.id || null;
      } catch {}
    } else if (token) {
      try {
        const { data } = await admin.auth.getUser(token);
        currentUserId = data?.user?.id || null;
      } catch {}
    }

    if (!SERVICE_ROLE_KEY && !authed) {
      return res.status(200).json({
        items: [],
        meta: { warning: "Autenticação ausente para carregar o SEPBook (env sem SUPABASE_SERVICE_ROLE_KEY)." },
      });
    }

    const reader = SERVICE_ROLE_KEY ? admin : (authed || admin);

    let posts: any[] = [];
    try {
      const baseSelect = `
          id, user_id, content_md, attachments, like_count, comment_count, created_at, location_label, campaign_id, challenge_id, group_label,
          participants:sepbook_post_participants(user_id, profiles(id, name, sigla_area))
        `;

      // Try to include repost data (newer schema); fall back if column/relationship doesn't exist yet.
      const selectWithRepost = `
          ${baseSelect},
          repost_of,
          repost:sepbook_posts!sepbook_posts_repost_of_fkey(
            id, user_id, content_md, attachments, like_count, comment_count, created_at, location_label, campaign_id, challenge_id, group_label
          )
        `;

      const minimalSelect = `
          id, user_id, content_md, attachments, like_count, comment_count, created_at, location_label, campaign_id, challenge_id, group_label, repost_of
        `;

      let data: any[] | null = null;
      let error: any = null;
      const attempt = await reader
        .from("sepbook_posts")
        .select(selectWithRepost)
        .order("created_at", { ascending: false })
        .limit(50);
      data = attempt.data as any;
      error = attempt.error as any;
      if (error && /repost_of|sepbook_posts_repost_of_fkey/i.test(String(error.message || ""))) {
        const fallback = await reader
          .from("sepbook_posts")
          .select(baseSelect)
          .order("created_at", { ascending: false })
          .limit(50);
        data = fallback.data as any;
        error = fallback.error as any;
      }
      if (
        error &&
        /(sepbook_post_participants|permission denied|row level security|rls)/i.test(String(error.message || ""))
      ) {
        const fallback2 = await reader
          .from("sepbook_posts")
          .select(minimalSelect)
          .order("created_at", { ascending: false })
          .limit(50);
        data = fallback2.data as any;
        error = fallback2.error as any;
      }
      if (error) {
        // Se a tabela ainda não existir (migração não aplicada), devolve lista vazia com aviso opcional
        if (/sepbook_posts/i.test(error.message) && /relation|table.*does not exist/i.test(error.message)) {
          return res
            .status(200)
            .json({ items: [], meta: { warning: "Tabela sepbook_posts ausente. Aplique a migração supabase/migrations/20251115153000_sepbook.sql." } });
        }
        if (/(row level security|rls|permission denied|not authorized)/i.test(String(error.message || ""))) {
          return res.status(200).json({
            items: [],
            meta: {
              warning:
                "Permissão insuficiente para ler o SEPBook (RLS). Configure políticas de leitura no Supabase ou defina SUPABASE_SERVICE_ROLE_KEY no Vercel.",
            },
          });
        }
        // Outro erro de banco: devolve feed vazio para não quebrar a UI
        return res.status(200).json({ items: [], meta: { warning: "Falha ao carregar SEPBook. Tente novamente mais tarde." } });
      }
      posts = data || [];
    } catch {
      // Falha de rede/fetch para o Supabase: devolve feed vazio
      return res.status(200).json({ items: [], meta: { warning: "SEPBook temporariamente indisponível." } });
    }

    const userIds = Array.from(
      new Set(
        posts
          .flatMap((p) => [p.user_id, p?.repost?.user_id].filter(Boolean))
      ),
    );
    let profiles: any[] = [];
    try {
      const resp = await reader
        .from("profiles")
        .select("id, name, sigla_area, avatar_url, operational_base")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
      profiles = (resp.data as any[]) || [];
    } catch {
      profiles = [];
    }

    let myLikes: any[] = [];
    if (currentUserId) {
      const postIds = (posts || []).map((p) => p.id);
      try {
        const likeReader = SERVICE_ROLE_KEY ? admin : authed;
        if (likeReader) {
          const { data: likes } = await likeReader
            .from("sepbook_likes")
            .select("post_id")
            .eq("user_id", currentUserId)
            .in("post_id", postIds.length ? postIds : ["00000000-0000-0000-0000-000000000000"]);
          myLikes = likes || [];
        }
      } catch {
        myLikes = [];
      }
    }

    const likedSet = new Set<string>(myLikes.map((l) => l.post_id));
    const profileMap = new Map<string, { name: string; sigla_area: string | null; avatar_url: string | null; operational_base: string | null }>();
    (profiles || []).forEach((p) => {
      profileMap.set(p.id, { name: p.name, sigla_area: p.sigla_area, avatar_url: p.avatar_url, operational_base: (p as any).operational_base || null });
    });

    const items = (posts || []).map((p) => {
      const prof = profileMap.get(p.user_id) || { name: "Colaborador", sigla_area: null, avatar_url: null, operational_base: null };
      const repostRow = p?.repost || null;
      const repostAuthor =
        repostRow && repostRow.user_id ? profileMap.get(repostRow.user_id) || { name: "Colaborador", sigla_area: null, avatar_url: null, operational_base: null } : null;
      const participants =
        Array.isArray(p.participants) && p.participants.length > 0
          ? (p.participants as any[]).map((row) => ({
              id: row.user_id,
              name: row.profiles?.name || "Participante",
              sigla_area: row.profiles?.sigla_area || null,
            }))
          : [];
      return {
        id: p.id,
        user_id: p.user_id,
        author_name: prof.name,
        author_team: prof.sigla_area,
        author_avatar: prof.avatar_url,
        author_base: prof.operational_base,
        content_md: p.content_md,
        attachments: Array.isArray(p.attachments) ? p.attachments : [],
        like_count: p.like_count || 0,
        comment_count: p.comment_count || 0,
        created_at: p.created_at,
        location_label: p.location_label,
        campaign_id: p.campaign_id || null,
        challenge_id: p.challenge_id || null,
        group_label: p.group_label || null,
        participants,
        has_liked: likedSet.has(p.id),
        repost_of: p.repost_of || null,
        repost: repostRow
          ? {
              id: repostRow.id,
              user_id: repostRow.user_id,
              author_name: repostAuthor?.name || "Colaborador",
              author_team: repostAuthor?.sigla_area || null,
              author_avatar: repostAuthor?.avatar_url || null,
              author_base: repostAuthor?.operational_base || null,
              content_md: repostRow.content_md,
              attachments: Array.isArray(repostRow.attachments) ? repostRow.attachments : [],
              like_count: repostRow.like_count || 0,
              comment_count: repostRow.comment_count || 0,
              created_at: repostRow.created_at,
              location_label: repostRow.location_label,
              campaign_id: repostRow.campaign_id || null,
              challenge_id: repostRow.challenge_id || null,
              group_label: repostRow.group_label || null,
            }
          : null,
      };
    });

    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
