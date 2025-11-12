import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

function parseDataUrl(input: string): { bytes: Uint8Array; mime: string } {
  let mime = 'image/png';
  let b64 = input;
  if (input.startsWith('data:')) {
    const [, header, data] = input.match(/^data:([^;]+);base64,(.*)$/) || [];
    if (header) mime = header;
    if (data) b64 = data;
  }
  const binary = Buffer.from(b64, 'base64');
  return { bytes: new Uint8Array(binary), mime };
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function stylizeWithOpenAI(imageBytes: Uint8Array, promptSuffix = 'game-hero', n = 1, sourceMime = 'image/png'): Promise<Uint8Array[]> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  // Create prompt
  const prompt = `ultra realistic portrait icon of a modern game hero, 3/4 headshot, clean neutral background gradient, crisp edges, cinematic lighting, professional eSports style, corporate-friendly, no text, no watermark, ${promptSuffix}`;
  // Build multipart form
  const blob = new Blob([imageBytes], { type: sourceMime });
  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('image[]', blob, 'source.png');
  form.append('n', String(Math.max(1, Math.min(n, 5))));
  form.append('size', '512x512');

  const resp = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form as any,
  });
  if (!resp.ok) {
    // Fallback: generations (sem imagem fonte)
    const genForm = new FormData();
    genForm.append('model', OPENAI_IMAGE_MODEL);
    genForm.append('prompt', prompt);
    genForm.append('n', String(Math.max(1, Math.min(n, 5))));
    genForm.append('size', '512x512');
    const gen = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: genForm as any,
    });
    if (!gen.ok) {
      const t = await gen.text();
      throw new Error(`OpenAI generation failed: ${t}`);
    }
    const gj = await gen.json();
    const arr = (gj?.data || []).map((d: any) => new Uint8Array(Buffer.from(d?.b64_json || '', 'base64')));
    if (!arr.length) throw new Error('OpenAI did not return output');
    return arr;
  }
  const json = await resp.json();
  const arr = (json?.data || []).map((d: any) => new Uint8Array(Buffer.from(d?.b64_json || '', 'base64')));
  if (!arr.length) throw new Error('OpenAI did not return output');
  return arr;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase server configuration' });
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Ensure avatars bucket exists (idempotente)
    try {
      const { data: bucketInfo } = await (supabaseAdmin.storage as any).getBucket('avatars');
      if (!bucketInfo) {
        await (supabaseAdmin.storage as any).createBucket('avatars', { public: true });
      }
    } catch {
      // ignore — some SDK versions don't throw here if exists
    }

    const authHeader = (req.headers['authorization'] as string | undefined) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    const body = req.body || {};
    const {
      userId: requestedUserId,
      imageBase64,
      useAiStyle = true,
      style = 'game-hero',
      variationCount = 3,
      mode = 'final',
      alreadyStylized = false,
    } = body;

    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

    // Identify caller user
    let callerId: string | null = null;
    if (token) {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user) callerId = data.user.id;
    }

    if (mode !== 'preview' && !requestedUserId) {
      if (!callerId) return res.status(401).json({ error: 'Unauthorized' });
    }

    // Permission check when saving for a different user
    const targetUserId = requestedUserId || callerId;
    if (!targetUserId) return res.status(400).json({ error: 'Missing target userId' });
    if (callerId && requestedUserId && requestedUserId !== callerId) {
      // Check leader roles
      const { data: roles } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', callerId);
      const allowed = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
      const hasPermission = (roles || []).some((r: any) => allowed.has(r.role));
      if (!hasPermission) return res.status(403).json({ error: 'Sem permissão para atualizar avatar de outro usuário' });
    }

    // Preview mode: return N variations
    if (mode === 'preview') {
      const { bytes: base, mime } = parseDataUrl(imageBase64);
      const total = Math.max(1, Math.min(Number(variationCount) || 3, 5));
      let outs: Uint8Array[] = [];
      try {
        outs = useAiStyle ? await stylizeWithOpenAI(base, style, total, mime) : [base];
      } catch (e) {
        outs = [base];
      }
      const previews: string[] = outs.map((buf) => `data:image/png;base64,${encodeBase64(buf)}`);
      return res.status(200).json({ success: true, previews });
    }

    // Final mode: upload final image and update profile
    const timestamp = Date.now();
    const hash = Math.random().toString(36).slice(2, 8);
    const basePath = `${targetUserId}/${timestamp}-${hash}`;

    const { bytes: initialBytes, mime } = parseDataUrl(imageBase64);
    const baseMime = mime || 'image/png';
    const originalFilename = `${basePath}-original.png`;
    const originalThumbFilename = `${basePath}-original-thumb.png`;

    // Upload original photo
    const { error: originalUpload } = await supabaseAdmin.storage
      .from('avatars')
      .upload(originalFilename, initialBytes, { contentType: baseMime, upsert: true });
    if (originalUpload) return res.status(400).json({ error: originalUpload.message });

    const { error: originalThumbUpload } = await supabaseAdmin.storage
      .from('avatars')
      .upload(originalThumbFilename, initialBytes, { contentType: baseMime, upsert: true });
    if (originalThumbUpload) return res.status(400).json({ error: originalThumbUpload.message });

    const { data: originalUrlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(originalFilename);
    const { data: originalThumbData } = supabaseAdmin.storage.from('avatars').getPublicUrl(originalThumbFilename);

    let finalBytes = initialBytes;
    let finalMime = baseMime;
    if (useAiStyle && !alreadyStylized) {
      try {
        const [one] = await stylizeWithOpenAI(finalBytes, style, 1, baseMime);
        if (one) finalBytes = one;
        finalMime = 'image/png';
      } catch (e) {
        // keep original if AI fails
      }
    }

    const stylizedFilename = `${basePath}-stylized.png`;
    const stylizedThumbFilename = `${basePath}-stylized-thumb.png`;

    // Upload stylized avatar
    const { error: avatarUpload } = await supabaseAdmin.storage
      .from('avatars')
      .upload(stylizedFilename, finalBytes, { contentType: finalMime, upsert: true });
    if (avatarUpload) return res.status(400).json({ error: avatarUpload.message });

    const { error: avatarThumbUpload } = await supabaseAdmin.storage
      .from('avatars')
      .upload(stylizedThumbFilename, finalBytes, { contentType: finalMime, upsert: true });
    if (avatarThumbUpload) return res.status(400).json({ error: avatarThumbUpload.message });

    const { data: avatarUrlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(stylizedFilename);
    const { data: avatarThumbData } = supabaseAdmin.storage.from('avatars').getPublicUrl(stylizedThumbFilename);

    const avatarUrl = avatarUrlData.publicUrl;
    const thumbnailUrl = avatarThumbData.publicUrl;
    const originalUrl = originalUrlData.publicUrl;
    const originalThumbnailUrl = originalThumbData.publicUrl;

    const avatarMeta = {
      uploaded_at: new Date().toISOString(),
      provider: useAiStyle ? 'openai' : 'manual',
      variants: {
        original: {
          filename: originalFilename,
          url: originalUrl,
          thumbnail_url: originalThumbnailUrl,
        },
        stylized: {
          filename: stylizedFilename,
          url: avatarUrl,
          thumbnail_url: thumbnailUrl,
          style,
        },
      },
    };

    const { error: upd } = await supabaseAdmin
      .from('profiles')
      .update({
        avatar_url: avatarUrl,
        avatar_thumbnail_url: thumbnailUrl,
        avatar_meta: avatarMeta,
      })
      .eq('id', targetUserId);
    if (upd) return res.status(400).json({ error: upd.message });

    return res.status(200).json({
      success: true,
      avatarUrl,
      thumbnailUrl,
      originalUrl,
      originalThumbnailUrl,
      meta: avatarMeta,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
