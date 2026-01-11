import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ParsedPhone = { country: string; area: string; subscriber: string };

const parsePhone = (raw: unknown): ParsedPhone => {
  const input = String(raw ?? '').trim();
  const digits = input.replace(/\D+/g, '');

  if (!digits) {
    throw new Error('Telefone obrigatório');
  }

  // Expecting: +CC AA NNNNN-NNNN (DDI 1-3, DDD 2, subscriber 9 digits)
  // If user omitted country code, assume BR (+55) when only DDD+subscriber is provided.
  let normalizedDigits = digits;
  if (!input.startsWith('+')) {
    if (digits.length === 11) {
      normalizedDigits = `55${digits}`;
    }
  }

  const countryLen = normalizedDigits.length - 11;
  if (countryLen < 1 || countryLen > 3) {
    throw new Error('Informe DDI +XX, DDD XX e número XXXXX-XXXX');
  }

  const country = normalizedDigits.slice(0, countryLen);
  const area = normalizedDigits.slice(countryLen, countryLen + 2);
  const subscriber = normalizedDigits.slice(countryLen + 2);

  if (!/^\d{1,3}$/.test(country) || !/^\d{2}$/.test(area) || !/^\d{9}$/.test(subscriber)) {
    throw new Error('Telefone inválido. Use DDI +XX, DDD XX e número XXXXX-XXXX');
  }

  return { country, area, subscriber };
};

const formatPhone = (p: ParsedPhone) => {
  const a = p.subscriber.slice(0, 5);
  const b = p.subscriber.slice(5);
  return `+${p.country} ${p.area} ${a}-${b}`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Unauthorized');
    }

    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !data?.user) {
      throw new Error('Unauthorized');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const payload = await req.json().catch(() => ({}));
    const parsed = parsePhone(payload?.phone);
    const phone = formatPhone(parsed);

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        phone,
        phone_confirmed_at: new Date().toISOString(),
      })
      .eq('id', data.user.id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true, phone }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

