import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import exifr from "https://esm.sh/exifr@7.1.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { storage_path, post_id } = await req.json();

    if (!storage_path) {
      return new Response(
        JSON.stringify({ error: 'storage_path é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processando metadados para: ${storage_path}`);

    // 1. Baixar arquivo do Storage
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('forum-attachments')
      .download(storage_path);

    if (downloadError) {
      console.error('Erro ao baixar arquivo:', downloadError);
      throw new Error(`Erro ao baixar arquivo: ${downloadError.message}`);
    }

    // 2. Extrair EXIF da imagem
    let exifData;
    try {
      exifData = await exifr.parse(fileBlob, {
        gps: true,
        exif: true,
        iptc: false,
        icc: false,
      });
      console.log('EXIF extraído:', exifData);
    } catch (exifError) {
      console.warn('Erro ao extrair EXIF (pode não ter EXIF):', exifError);
      exifData = null;
    }

    // 3. Obter dimensões da imagem
    const arrayBuffer = await fileBlob.arrayBuffer();
    const blob = new Blob([arrayBuffer]);
    const imageBitmap = await createImageBitmap(blob);
    const width = imageBitmap.width;
    const height = imageBitmap.height;
    imageBitmap.close();

    // 4. Preparar metadados para salvar
    const metadata: any = {
      storage_path,
      image_width: width,
      image_height: height,
      processed_at: new Date().toISOString(),
    };

    if (post_id) {
      metadata.post_id = post_id;
    }

    if (exifData) {
      if (exifData.latitude && exifData.longitude) {
        metadata.gps_latitude = exifData.latitude;
        metadata.gps_longitude = exifData.longitude;
      }
      if (exifData.DateTimeOriginal) {
        metadata.capture_date = new Date(exifData.DateTimeOriginal).toISOString();
      }
      if (exifData.Make) {
        metadata.device_make = exifData.Make;
      }
      if (exifData.Model) {
        metadata.device_model = exifData.Model;
      }
    }

    // 5. Verificar se já existe registro
    const { data: existing } = await supabase
      .from('forum_attachment_metadata')
      .select('id')
      .eq('storage_path', storage_path)
      .maybeSingle();

    let result;
    if (existing) {
      // Atualizar existente
      const { data, error } = await supabase
        .from('forum_attachment_metadata')
        .update(metadata)
        .eq('storage_path', storage_path)
        .select()
        .single();

      if (error) throw error;
      result = data;
      console.log('Metadados atualizados:', result);
    } else {
      // Criar novo (apenas se todos os campos obrigatórios existirem)
      // Nota: Normalmente seria criado pelo frontend ao fazer upload
      console.log('Registro não encontrado, metadados extraídos mas não salvos');
      result = metadata;
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        metadata: result,
        exif_available: !!exifData 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Erro ao processar metadados:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro ao processar metadados';
    const errorDetails = String(error);
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: errorDetails
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
