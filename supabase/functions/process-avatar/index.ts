import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const decodeBase64 = (input: string): Uint8Array => {
  const base64 = input.includes(',') ? input.split(',')[1] : input
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

const encodeBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const {
      userId,
      imageBase64,
      useAiStyle = true,
      style = 'game-hero',
      variationCount = 3,
      mode = 'final',
      alreadyStylized = false,
    } = body

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'imageBase64 is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (mode !== 'preview' && !userId) {
      return new Response(
        JSON.stringify({ error: 'userId is required for final mode' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const bytes = decodeBase64(imageBase64)

    const provider = (Deno.env.get('AVATAR_AI_PROVIDER') || '').toLowerCase()
    const replicateToken = Deno.env.get('REPLICATE_API_TOKEN') || ''
    const modelVersion = Deno.env.get('REPLICATE_MODEL_VERSION') || ''
    const openaiKey = Deno.env.get('OPENAI_API_KEY') || ''
    const openaiModel = Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1'

    const timestamp = Date.now()
    const hash = crypto.randomUUID().split('-')[0]
    const basePath = userId ? `${userId}/${timestamp}-${hash}` : `${timestamp}-${hash}`
    const srcFilename = `${basePath}-src.png`

    // upload source when needed (Replicate requires URL)
    const ensureSourceUpload = async () => {
      const { error } = await supabase.storage
        .from('avatars')
        .upload(srcFilename, bytes, { contentType: 'image/png', upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('avatars').getPublicUrl(srcFilename)
      return data.publicUrl
    }

    const stylizeWithReplicate = async () => {
      const srcUrl = await ensureSourceUpload()
      const prompt = `ultra realistic portrait icon of a modern game hero, 3/4 headshot, clean background gradient, crisp edges, cinematic lighting, professional eSports style, corporate-friendly, no text, no watermark, ${style}`
      const negativePrompt = 'text, watermark, logo, blurry, lowres, distorted, extra fingers, cropped, artifacts'
      const version = modelVersion || 'a3fb3a28-5b95-4a1c-9a7c-7d5e5ba9f8aa'
      const createResp = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${replicateToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          version,
          input: {
            prompt,
            negative_prompt: negativePrompt,
            image: srcUrl,
            strength: 0.6,
            scheduler: 'K_EULER',
            num_outputs: 1,
            guidance_scale: 7
          }
        })
      })
      if (!createResp.ok) {
        const errText = await createResp.text()
        throw new Error(`Replicate create failed: ${errText}`)
      }
      const created = await createResp.json()
      const pollUrl = created.urls?.get
      let status = created.status
      let outputUrl = ''
      const startedAt = Date.now()
      while (status !== 'succeeded' && status !== 'failed' && Date.now() - startedAt < 60000) {
        await new Promise((r) => setTimeout(r, 1500))
        const poll = await fetch(pollUrl, { headers: { 'Authorization': `Token ${replicateToken}` } })
        const pred = await poll.json()
        status = pred.status
        if (status === 'succeeded') {
          const out = pred.output
          if (Array.isArray(out) && out.length > 0) outputUrl = out[0]
          else if (typeof out === 'string') outputUrl = out
        }
      }
      if (!outputUrl) throw new Error('Replicate did not return output in time')
      const outResp = await fetch(outputUrl)
      return new Uint8Array(await outResp.arrayBuffer())
    }

    const stylizeWithOpenAI = async () => {
      const blob = new Blob([bytes], { type: 'image/png' })
      const form = new FormData()
      form.append('model', openaiModel)
      form.append('prompt', `ultra realistic portrait icon of a modern game hero, 3/4 headshot, clean neutral background gradient, crisp edges, cinematic lighting, professional eSports style, corporate-friendly, no text, no watermark, ${style}`)
      form.append('image[]', blob, 'source.png')
      form.append('n', '1')
      const aiResp = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: form
      })
      if (!aiResp.ok) {
        const errText = await aiResp.text()
        throw new Error(`OpenAI edit failed: ${errText}`)
      }
      const aiJson = await aiResp.json()
      const b64 = aiJson?.data?.[0]?.b64_json
      if (!b64) throw new Error('OpenAI did not return output')
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    }

    const stylize = async () => {
      if (!useAiStyle) return bytes
      if (provider === 'replicate' && replicateToken) {
        return stylizeWithReplicate()
      }
      if (provider === 'openai' && openaiKey) {
        return stylizeWithOpenAI()
      }
      return bytes
    }

    if (mode === 'preview') {
      const previews: string[] = []
      const total = Math.max(1, Math.min(variationCount, 5))
      for (let i = 0; i < total; i++) {
        try {
          const styled = await stylize()
          previews.push(`data:image/png;base64,${encodeBase64(styled)}`)
        } catch (err) {
          console.error('Preview generation error:', err)
          previews.push(`data:image/png;base64,${encodeBase64(bytes)}`)
        }
      }
      return new Response(
        JSON.stringify({ success: true, previews }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let finalBytes = bytes
    if (useAiStyle && !alreadyStylized) {
      try {
        finalBytes = await stylize()
      } catch (error) {
        console.error('Stylization failed, using original image', error)
      }
    }

    const outFilename = `${basePath}.png`
    const thumbnailFilename = `${basePath}-thumb.png`

    const { error: finalUploadError } = await supabase.storage
      .from('avatars')
      .upload(outFilename, finalBytes, {
        contentType: 'image/png',
        upsert: true
      })
    if (finalUploadError) throw finalUploadError

    await supabase.storage
      .from('avatars')
      .upload(thumbnailFilename, finalBytes, {
        contentType: 'image/png',
        upsert: true
      })

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(outFilename)
    const { data: thumbUrlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(thumbnailFilename)

    const avatarUrl = urlData.publicUrl
    const thumbnailUrl = thumbUrlData.publicUrl

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        avatar_url: avatarUrl,
        avatar_thumbnail_url: thumbnailUrl,
        avatar_meta: {
          uploaded_at: new Date().toISOString(),
          filename: outFilename,
          provider,
        }
      })
      .eq('id', userId)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ success: true, avatarUrl, thumbnailUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in process-avatar:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
