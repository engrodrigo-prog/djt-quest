// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { translateForumTexts, localesForAllTargets, mergeTranslations } from '../lib/forum-translations.js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string

const EDIT_ROLES = new Set(['admin','gerente_djt','gerente_divisao_djtx','coordenador_djtx'])
const EDIT_ANY_POST_ROLES = new Set(['admin','gerente_djt','gerente_divisao_djtx'])
const DELETE_TOPIC_ROLES = new Set(['admin','gerente_djt','gerente_divisao_djtx'])

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
      const or = handles.map((h) => `email.ilike.${h}@%`).join(',')
      const { data } = await admin.from('profiles').select('id, email').or(or)
      for (const u of data || []) if (u?.id) out.add(String(u.id))
    } catch {}
  }

  if (excludeUserId) out.delete(excludeUserId)
  return Array.from(out)
}

async function replacePostHashtags(admin: any, postId: string, rawTags: string[]) {
  const tags = Array.from(
    new Set((rawTags || []).map((t) => String(t || '').trim().replace(/^#+/, '').toLowerCase()).filter(Boolean)),
  )
    .filter((t) => t.length >= 3 && t.length <= 50)
    .slice(0, 24)
  if (!postId) return

  try {
    await admin.from('forum_post_hashtags').delete().eq('post_id', postId)
  } catch {}

  if (!tags.length) return

  try {
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

    await admin
      .from('forum_post_hashtags')
      .upsert(
        ids.map((hashtag_id: string) => ({ post_id: postId, hashtag_id })),
        { onConflict: 'post_id,hashtag_id' },
      )
  } catch {
    // ignore
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' })
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
    const token = authHeader.slice(7)
    const { data: userData } = await admin.auth.getUser(token)
    const uid = userData?.user?.id
    if (!uid) return res.status(401).json({ error: 'Unauthorized' })

    // Check leader permission
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid)
    const roleNames = (roles || []).map((r: any) => r.role as string)
    const canEdit = roleNames.some((r) => EDIT_ROLES.has(r))
    const canEditAnyPost = roleNames.some((r) => EDIT_ANY_POST_ROLES.has(r))
    const canDeleteTopic = roleNames.some((r) => DELETE_TOPIC_ROLES.has(r))

    const { action, topic_id, post_id, update, content_md } = req.body || {}
    const targetLocales = localesForAllTargets((req.body as any)?.locales)
    if (!action) return res.status(400).json({ error: 'action required' })

    if (action === 'delete_post') {
      if (!post_id) return res.status(400).json({ error: 'post_id required' })
      const { data: post, error: postErr } = await admin
        .from('forum_posts')
        .select('id, user_id, is_solution')
        .eq('id', post_id)
        .maybeSingle()
      if (postErr) return res.status(400).json({ error: postErr.message })
      if (!post) return res.status(404).json({ error: 'Post não encontrado' })
      if (!canEdit && post.user_id !== uid) {
        return res.status(403).json({ error: 'Sem permissão para excluir este post' })
      }

      // Se este post era a solução oficial, reverter o XP bônus (+20 XP)
      if (post.is_solution) {
        const targetUserId = post.user_id
        if (targetUserId) {
          try {
            await admin.rpc('increment_user_xp', { _user_id: targetUserId, _xp_to_add: -20 })
          } catch {
            try {
              const { data: prof } = await admin.from('profiles').select('xp').eq('id', targetUserId).maybeSingle()
              const cur = Number(prof?.xp || 0)
              const next = Math.max(0, cur - 20)
              await admin.from('profiles').update({ xp: next }).eq('id', targetUserId)
            } catch {}
          }
        }
      }

      const { error } = await admin.from('forum_posts').delete().eq('id', post_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'delete_topic') {
      if (!canDeleteTopic) return res.status(403).json({ error: 'Sem permissão para excluir tópicos' })
      if (!topic_id) return res.status(400).json({ error: 'topic_id required' })
      // Antes de excluir o tópico, reverter XP de respostas marcadas como solução (+20 XP cada)
      try {
        const { data: solutionPosts } = await admin
          .from('forum_posts')
          .select('user_id, is_solution')
          .eq('topic_id', topic_id)
          .eq('is_solution', true)

        for (const row of (solutionPosts || [])) {
          const uidSolution = row?.user_id
          if (!uidSolution) continue
          try {
            await admin.rpc('increment_user_xp', { _user_id: uidSolution, _xp_to_add: -20 })
          } catch {
            try {
              const { data: prof } = await admin.from('profiles').select('xp').eq('id', uidSolution).maybeSingle()
              const cur = Number(prof?.xp || 0)
              const next = Math.max(0, cur - 20)
              await admin.from('profiles').update({ xp: next }).eq('id', uidSolution)
            } catch {}
          }
        }
      } catch {
        // se falhar, ainda assim seguimos com a exclusão do tópico
      }

      // cascade via FK removerá posts e reações
      const { error } = await admin.from('forum_topics').delete().eq('id', topic_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'clear_topic') {
      if (!canEdit) return res.status(403).json({ error: 'Sem permissão para limpar tópicos' })
      if (!topic_id) return res.status(400).json({ error: 'topic_id required' })

      // Antes de limpar, reverter XP de respostas marcadas como solução neste tópico
      try {
        const { data: solutionPosts } = await admin
          .from('forum_posts')
          .select('user_id, is_solution')
          .eq('topic_id', topic_id)
          .eq('is_solution', true)

        for (const row of (solutionPosts || [])) {
          const uidSolution = (row as any)?.user_id
          if (!uidSolution) continue
          try {
            await admin.rpc('increment_user_xp', { _user_id: uidSolution, _xp_to_add: -20 })
          } catch {
            try {
              const { data: prof } = await admin.from('profiles').select('xp').eq('id', uidSolution).maybeSingle()
              const cur = Number(prof?.xp || 0)
              const next = Math.max(0, cur - 20)
              await admin.from('profiles').update({ xp: next }).eq('id', uidSolution)
            } catch {}
          }
        }
      } catch {
        // se falhar, ainda assim seguimos com a limpeza dos posts
      }

      const { error } = await admin.from('forum_posts').delete().eq('topic_id', topic_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'update_post') {
      if (!post_id) return res.status(400).json({ error: 'post_id required' })
      const text = typeof content_md === 'string' ? content_md.trim() : ''
      if (text.length < 1) return res.status(400).json({ error: 'content_md obrigatório' })

      const { data: post, error: postErr } = await admin
        .from('forum_posts')
        .select('id, user_id, author_id, topic_id, translations')
        .eq('id', post_id)
        .maybeSingle()
      if (postErr) return res.status(400).json({ error: postErr.message })
      if (!post) return res.status(404).json({ error: 'Post não encontrado' })

      const ownerId = post.user_id || (post as any).author_id
      if (ownerId !== uid) {
        return res.status(403).json({ error: 'Sem permissão para editar este post' })
      }

      const { mentions, hashtags } = extractMentionsAndTags(text)

      let translations: any = mergeTranslations((post as any)?.translations, { 'pt-BR': text })
      try {
        const [map] = await translateForumTexts({ texts: [text], targetLocales })
        translations = mergeTranslations(translations, map as any)
      } catch {
        // keep merged fallback
      }

      let updateError
      try {
        const { error } = await admin
          .from('forum_posts')
          .update({
            content_md: text,
            content: text,
            tags: hashtags,
            translations,
          } as any)
          .eq('id', post_id)
        updateError = error
        if (updateError && /column .*translations.* does not exist/i.test(updateError.message)) throw updateError
      } catch (_) {
        const { error } = await admin
          .from('forum_posts')
          .update({
            content_md: text,
            content: text,
            tags: hashtags,
          } as any)
          .eq('id', post_id)
        updateError = error
      }
      if (updateError) return res.status(400).json({ error: updateError.message })

      // Sync hashtags into knowledge base join table (best-effort)
      try {
        await replacePostHashtags(admin, post_id, hashtags)
      } catch {}

      // Atualizar mentions best-effort: limpa antigas e recria
      try {
        await admin.from('forum_mentions').delete().eq('post_id', post_id)
        if (mentions.length) {
          const ids = await resolveMentionedUserIds(admin, mentions, { excludeUserId: uid })
          if (ids.length) {
            const rows = ids.map((id: string) => ({
              mentioned_user_id: id,
              mentioned_by: uid,
              post_id,
              is_read: false,
            }))
            await admin.from('forum_mentions').upsert(rows as any, { onConflict: 'post_id,mentioned_user_id' } as any)

            try {
              const { data: authorProfile } = await admin
                .from('profiles')
                .select('name')
                .eq('id', uid)
                .maybeSingle()
              const authorName = String(authorProfile?.name || 'Alguém')
              await Promise.all(
                ids.map((id: string) =>
                  admin.rpc('create_notification', {
                    _user_id: id,
                    _type: 'forum_mention',
                    _title: 'Você foi mencionado',
                    _message: `${authorName} mencionou você em um fórum`,
                    _metadata: { post_id, topic_id: post.topic_id },
                  }),
                ),
              )
            } catch {}
          }
        }
      } catch {}

      return res.status(200).json({ success: true })
    }

    if (action === 'update_topic') {
      if (!canEdit) return res.status(403).json({ error: 'Sem permissão para editar tópicos' })
      if (!topic_id || typeof update !== 'object') return res.status(400).json({ error: 'topic_id and update required' })
      const safe: any = {}
      if (typeof update.title === 'string' && update.title.trim()) safe.title = update.title.trim()
      if (typeof update.description === 'string') safe.description = update.description
      if (typeof update.status === 'string') safe.status = update.status
      if (Array.isArray(update.tags)) safe.tags = update.tags
      if (Array.isArray(update.quiz_specialties)) safe.quiz_specialties = update.quiz_specialties
      if (typeof update.chas_dimension === 'string') safe.chas_dimension = update.chas_dimension
      let topicTranslations: any = null
      let descTranslations: any = null
      if (safe.title || safe.description) {
        const { data: existing } = await admin
          .from('forum_topics')
          .select('title, description, title_translations, description_translations')
          .eq('id', topic_id)
          .maybeSingle()
        if (safe.title) {
          topicTranslations = mergeTranslations((existing as any)?.title_translations, { 'pt-BR': safe.title })
          try {
            const [map] = await translateForumTexts({ texts: [safe.title], targetLocales })
            topicTranslations = mergeTranslations(topicTranslations, map as any)
          } catch {}
          safe.title_translations = topicTranslations
        }
        if (safe.description !== undefined) {
          const baseDesc = safe.description ?? (existing as any)?.description ?? ''
          descTranslations = mergeTranslations((existing as any)?.description_translations, { 'pt-BR': baseDesc })
          if (typeof baseDesc === 'string' && baseDesc.trim()) {
            try {
              const [map] = await translateForumTexts({ texts: [baseDesc], targetLocales })
              descTranslations = mergeTranslations(descTranslations, map as any)
            } catch {}
          }
          safe.description_translations = descTranslations
        }
      }
      const { error } = await admin.from('forum_topics').update(safe).eq('id', topic_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'unknown action' })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
