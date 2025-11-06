import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { userId, imageBase64, useAiStyle = true, style = 'game-hero' } = await req.json()

    if (!userId || !imageBase64) {
      return new Response(
        JSON.stringify({ error: 'userId and imageBase64 are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log(`Processing avatar for user ${userId}`)

    // Convert base64 to blob
    const base64Data = imageBase64.split(',')[1] || imageBase64
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    // Generate unique filename
    const timestamp = Date.now()
    const hash = crypto.randomUUID().split('-')[0]
    const basePath = `${userId}/${timestamp}-${hash}`
    const srcFilename = `${basePath}-src.png`
    const outFilename = `${basePath}.png`
    const thumbnailFilename = `${basePath}-thumb.png`

    // Upload source temporarily (will be removed or kept internal)
    const { error: srcUploadError } = await supabase.storage
      .from('avatars')
      .upload(srcFilename, bytes, { contentType: 'image/png', upsert: true })

    if (srcUploadError) {
      console.error('Source upload error:', srcUploadError)
      throw srcUploadError
    }

    const { data: srcUrlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(srcFilename)

    let finalBytes = bytes

    // Optional: AI stylization via Replicate
    const provider = (Deno.env.get('AVATAR_AI_PROVIDER') || '').toLowerCase()
    const replicateToken = Deno.env.get('REPLICATE_API_TOKEN') || ''
    const modelVersion = Deno.env.get('REPLICATE_MODEL_VERSION') || ''
    const openaiKey = Deno.env.get('OPENAI_API_KEY') || ''

    if (useAiStyle && provider === 'replicate' && replicateToken) {
      try {
        console.log('Stylizing avatar via Replicate...')
        const prompt = `ultra realistic portrait icon of a modern game hero, 3/4 headshot, clean background gradient, crisp edges, cinematic lighting, professional eSports style, corporate-friendly, no text, no watermark, ${style}`
        const negativePrompt = 'text, watermark, logo, blurry, lowres, distorted, extra fingers, cropped, artifacts'

        const version = modelVersion || 'a3fb3a28-5b95-4a1c-9a7c-7d5e5ba9f8aa' // default SDXL image-to-image on Replicate (placeholder)
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
              image: srcUrlData.publicUrl,
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

        if (!outputUrl) {
          console.warn('Replicate did not return output in time; falling back to original image')
        } else {
          const outResp = await fetch(outputUrl)
          const outBuf = new Uint8Array(await outResp.arrayBuffer())
          finalBytes = outBuf
        }
      } catch (e) {
        console.error('AI stylization failed:', e)
      }
    }

    // OpenAI gpt-image-1 (image-to-image edit)
    if (useAiStyle && provider === 'openai' && openaiKey) {
      try {
        console.log('Stylizing avatar via OpenAI gpt-image-1...')
        const prompt = `ultra realistic portrait icon of a modern game hero, 3/4 headshot, clean neutral background gradient, crisp edges, cinematic lighting, professional eSports style, corporate-friendly, no text, no watermark, ${style}`

        // Download source (public) to pass as file
        const srcResp = await fetch(srcUrlData.publicUrl)
        const srcBuf = await srcResp.arrayBuffer()
        const srcBlob = new Blob([srcBuf], { type: 'image/png' })

        const form = new FormData()
        form.append('model', Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1')
        form.append('prompt', prompt)
        form.append('image[]', srcBlob, 'source.png')

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
        if (b64) {
          finalBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        } else {
          console.warn('OpenAI did not return b64 output; falling back to original image')
        }
      } catch (e) {
        console.error('OpenAI stylization failed:', e)
      }
    }

    // Upload final avatar
    const { error: finalUploadError } = await supabase.storage
      .from('avatars')
      .upload(outFilename, finalBytes, {
        contentType: 'image/png',
        upsert: true
      })
    if (finalUploadError) {
      console.error('Final upload error:', finalUploadError)
      throw finalUploadError
    }

    // For thumbnail, reuse final for now
    await supabase.storage
      .from('avatars')
      .upload(thumbnailFilename, finalBytes, {
        contentType: 'image/png',
        upsert: true
      })

    // Get public URLs
    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(outFilename)

    const { data: thumbUrlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(thumbnailFilename)

    const avatarUrl = urlData.publicUrl
    const thumbnailUrl = thumbUrlData.publicUrl

    // Update profile with avatar URLs
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        avatar_url: avatarUrl,
        avatar_thumbnail_url: thumbnailUrl,
        avatar_meta: {
          uploaded_at: new Date().toISOString(),
          filename: filename
        }
      })
      .eq('id', userId)

    if (updateError) {
      console.error('Profile update error:', updateError)
      throw updateError
    }

    console.log('Profile updated with avatar URLs')

    return new Response(
      JSON.stringify({
        success: true,
        avatarUrl,
        thumbnailUrl
      }),
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
