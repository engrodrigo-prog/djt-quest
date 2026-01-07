// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { translateForumTexts, localesForAllTargets } from '../lib/forum-translations.js'
import { loadLocalEnvIfNeeded } from '../lib/load-local-env.js'
import { getSupabaseUrlFromEnv } from '../lib/supabase-url.js'
import { DJT_QUEST_SUPABASE_HOST } from '../env-guard.js'

loadLocalEnvIfNeeded()

const SUPABASE_URL = getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true }) as string
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) as string
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string

function extractMentionsAndTags(md: string) {
  const mentions = Array.from(
    md.matchAll(/@([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/g)
  ).map(m => m[1])
  const hashtags = Array.from(md.matchAll(/#([A-Za-z0-9_.-]+)/g)).map(m => m[1].toLowerCase())
  return { mentions, hashtags }
}

const normalizeMentionToken = (raw: string) =>
  String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();

async function resolveMentionedUserIds(admin: any, rawMentions: string[], opts?: { excludeUserId?: string }) {
  const excludeUserId = opts?.excludeUserId ? String(opts.excludeUserId) : null
  const list = Array.from(
    new Set((rawMentions || []).map((m) => normalizeMentionToken(String(m || ''))).filter(Boolean)),
  ).slice(0, 40)
  if (!list.length) return []

  const emails = list.filter((m) => m.includes('@'))
  const handles = list.filter((m) => !m.includes('@'))

  const out = new Set<string>()
  try {
    if (emails.length) {
      const { data } = await admin.from('profiles').select('id, email').in('email', emails)
      for (const u of data || []) if (u?.id) out.add(String(u.id))
    }
  } catch {}

  if (handles.length) {
    try {
      const { data } = await admin.from('profiles').select('id, mention_handle').in('mention_handle', handles)
      for (const u of data || []) if (u?.id) out.add(String(u.id))
    } catch {}

    try {
      // Resolve "@paulo.camara" -> "paulo.camara@dominio"
      const or = handles.map((h) => `email.ilike.${h}@%`).join(',')
      const { data } = await admin.from('profiles').select('id, email').or(or)
      for (const u of data || []) if (u?.id) out.add(String(u.id))
    } catch {}
  }

  if (excludeUserId) out.delete(excludeUserId)
  return Array.from(out)
}

async function syncPostHashtags(admin: any, postId: string, rawTags: string[]) {
  const tags = Array.from(
    new Set((rawTags || []).map((t) => String(t || '').trim().replace(/^#+/, '').toLowerCase()).filter(Boolean)),
  )
    .filter((t) => t.length >= 3 && t.length <= 50)
    .slice(0, 24)
  if (!postId || !tags.length) return

  try {
    // Upsert hashtags (ensure ids)
    let rows: any[] = []
    try {
      const up = await admin
        .from('forum_hashtags')
        .upsert(tags.map((tag) => ({ tag })), { onConflict: 'tag' })
        .select('id, tag')
      if (up.error) throw up.error
      rows = Array.isArray(up.data) ? up.data : []
    } catch {
      const sel = await admin.from('forum_hashtags').select('id, tag').in('tag', tags)
      rows = Array.isArray(sel.data) ? sel.data : []
    }

    const ids = rows.map((r: any) => r?.id).filter(Boolean)
    if (!ids.length) return

    // Link post -> hashtags (best-effort)
    await admin
      .from('forum_post_hashtags')
      .upsert(
        ids.map((hashtag_id: string) => ({ post_id: postId, hashtag_id })),
        { onConflict: 'post_id,hashtag_id' },
      )
  } catch {
    // ignore on failure (legacy schemas / missing tables)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' })
    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
    const token = authHeader.slice(7)
    const authed = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: userData, error: authErr } = await authed.auth.getUser()
    if (authErr) return res.status(401).json({ error: 'Unauthorized' })
    const uid = userData?.user?.id
    if (!uid) return res.status(401).json({ error: 'Unauthorized' })

    const {
      topic_id,
      content_md,
      payload = {},
      parent_post_id = null,
      reply_to_user_id = null,
      attachment_urls = [],
    } = req.body || {}
    if (!topic_id || typeof content_md !== 'string' || content_md.trim().length < 1) return res.status(400).json({ error: 'Invalid payload' })

    try {
      const { data: topic } = await authed.from('forum_topics').select('is_active,is_locked').eq('id', topic_id).maybeSingle()
      if (!topic) return res.status(404).json({ error: 'Topic not found' })
      if (topic.is_active === false || topic.is_locked === true) {
        return res.status(400).json({ error: 'Topic is closed or locked' })
      }
    } catch {}

    const { mentions, hashtags } = extractMentionsAndTags(content_md)
    const targetLocales = localesForAllTargets((req.body as any)?.locales)
    let translations: any = { 'pt-BR': content_md.trim() }
    try {
      const [map] = await translateForumTexts({ texts: [content_md.trim()], targetLocales })
      if (map && typeof map === 'object') translations = map
    } catch {
      // fallback keeps base locale only
    }

    // Insert supporting both legacy (author_id, content) and new (user_id, content_md) schemas
    const insertPayload: any = {
      topic_id,
      user_id: uid,
      author_id: uid, // legacy column
      content_md: content_md.trim(),
      content: content_md.trim(), // legacy column with CHECK(LENGTH(content) >= 10)
      payload: { ...(payload || {}), images: Array.isArray(attachment_urls) ? attachment_urls : [] },
      parent_post_id,
      reply_to_user_id,
      tags: hashtags,
      translations,
    };

    // Try insert including legacy attachment_urls column; if it fails due to column missing, retry without it
    let post, error;
    try {
      const { data, error: err } = await authed
        .from('forum_posts')
        .insert({ ...insertPayload, attachment_urls: Array.isArray(attachment_urls) ? attachment_urls : null })
        .select()
        .single();
      post = data; error = err;
      if (error && /column .*attachment_urls.* does not exist/i.test(error.message)) throw error;
      if (error && /column .*translations.* does not exist/i.test(error.message)) throw error;
    } catch (_) {
      const { data, error: err } = await authed
        .from('forum_posts')
        .insert(insertPayload)
        .select()
        .single();
      post = data; error = err;
      if (error && /column .*translations.* does not exist/i.test(error.message)) {
        const { translations: _omit, ...rest } = insertPayload
        const { data: d2, error: err2 } = await authed.from('forum_posts').insert(rest as any).select().single()
        post = d2; error = err2;
      }
    }
    if (error) return res.status(400).json({ error: error.message })

    // Sync hashtags into knowledge base join table (best-effort)
    try {
      if (post?.id && hashtags.length) {
        if (SERVICE_ROLE_KEY) {
          const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
          await syncPostHashtags(admin, post.id, hashtags)
        }
      }
    } catch {}

    // Regras de XP por participação no fórum:
    // • Cada interação "contundente" (>= 50 caracteres) rende 100 XP.
    // • Limite de 5 interações por tópico por colaborador (máximo 500 XP por fórum).
    try {
      const trimmed = String(content_md || '').trim()
      if (trimmed.length >= 50) {
        // Contar quantos posts contundentes o usuário já tem neste tópico
        const { data: strongPosts, error: countErr } = await authed
          .from('forum_posts')
          .select('id, content_md')
          .eq('topic_id', topic_id)
          .eq('user_id', uid)

        if (!countErr && Array.isArray(strongPosts)) {
          const qualifying = strongPosts.filter((p: any) => String(p.content_md || '').trim().length >= 50)
          const count = qualifying.length
          if (count <= 5) {
            // Esta interação ainda está dentro do limite de 5 por tópico → +100 XP
            try {
              await authed.rpc('increment_user_xp', { _user_id: uid, _xp_to_add: 100 })
            } catch (xpErr) {
              console.error('Erro ao aplicar XP por participação em fórum:', xpErr)
            }
          }
        }
      }
    } catch (xpWrapErr) {
      console.error('Erro ao processar XP de fórum:', xpWrapErr)
    }

    // Register mentions best-effort
    if (mentions.length) {
      try {
        const writer = SERVICE_ROLE_KEY
          ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
          : authed
        const ids = await resolveMentionedUserIds(writer, mentions, { excludeUserId: uid })
        if (ids.length) {
          const rows = ids.map((id: string) => ({
            mentioned_user_id: id,
            mentioned_by: uid,
            post_id: post.id,
            is_read: false,
          }))
          await writer.from('forum_mentions').upsert(rows as any, { onConflict: 'post_id,mentioned_user_id' } as any)

          const { data: authorProfile } = await writer
            .from('profiles')
            .select('name')
            .eq('id', uid)
            .maybeSingle()
          const authorName = String(authorProfile?.name || 'Alguém')
          await Promise.all(
            ids.map((id: string) =>
              writer.rpc('create_notification', {
                _user_id: id,
                _type: 'forum_mention',
                _title: 'Você foi mencionado',
                _message: `${authorName} mencionou você em um fórum`,
                _metadata: { post_id: post.id, topic_id },
              }),
            ),
          )
        }
      } catch {}
    }

    // Attachment metadata best-effort
    if (Array.isArray(attachment_urls) && attachment_urls.length) {
      for (const url of attachment_urls) {
        try {
          const path = (url.split('/forum-attachments/')[1] || '').trim();
          if (!path) continue;
          const folder = path.split('/')[0];
          const filename = path.split('/').pop() || 'unknown';
          const ext = filename.split('.').pop()?.toLowerCase() || '';
          let fileType = 'document';
          let mimeType = 'application/octet-stream';
          if (['jpg','jpeg','png','gif','webp'].includes(ext)) { fileType = 'image'; mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`; }
          else if (['mp3','wav','ogg','webm','m4a'].includes(ext)) { fileType = 'audio'; mimeType = `audio/${ext}`; }
          else if (['mp4','webm','mov'].includes(ext)) { fileType = 'video'; mimeType = ext === 'mov' ? 'video/quicktime' : `video/${ext}`; }
          else if (ext === 'pdf') { mimeType = 'application/pdf'; }

          // Try to fetch file info to capture size
          let fileSize = 0;
          try {
            const listFolder = folder;
            const searchName = filename;
            const { data: files } = await (authed as any).storage.from('forum-attachments').list(listFolder, { search: searchName });
            const found = (files || []).find((f: any) => f.name === filename);
            fileSize = found?.metadata?.size || found?.size || 0;
          } catch {}

          try {
            await authed.from('forum_attachment_metadata').insert({
              post_id: post.id,
              storage_path: path,
              file_type: fileType,
              mime_type: mimeType,
              file_size: fileSize,
              original_filename: filename,
            } as any);
          } catch {}

          // Attempt to invoke image metadata extraction function in background
          if (fileType === 'image') {
            try {
              await (authed as any).functions.invoke('extract-image-metadata', { body: { storage_path: path, post_id: post.id } });
            } catch {}
          }
        } catch {}
      }
    }

    return res.status(200).json({ success: true, post })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
