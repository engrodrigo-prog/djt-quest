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

    const { userId, imageBase64 } = await req.json()

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
    const filename = `${userId}/${timestamp}-${hash}.png`
    const thumbnailFilename = `${userId}/${timestamp}-${hash}-thumb.png`

    // Upload original
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filename, bytes, {
        contentType: 'image/png',
        upsert: true
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      throw uploadError
    }

    console.log('Avatar uploaded successfully')

    // For thumbnail, we'll upload the same image for now
    // In production, you'd resize this server-side
    await supabase.storage
      .from('avatars')
      .upload(thumbnailFilename, bytes, {
        contentType: 'image/png',
        upsert: true
      })

    // Get public URLs
    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(filename)

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