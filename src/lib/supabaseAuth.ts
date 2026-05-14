import { supabase } from '@/integrations/supabase/client';

type UpdatePasswordResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        status?: number;
        code?: string;
        message: string;
        raw?: unknown;
      };
    };

const getSupabaseAnonKey = () =>
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

const safeJsonParse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const coerceMessage = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '';
    }
  }
};

const looksLikeTokenIssue = (status: number, message: string) => {
  const lower = message.toLowerCase();
  return status === 401 || lower.includes('jwt') || lower.includes('token') || lower.includes('expired');
};

const looksLikeReauthRequired = (status: number, code: string, message: string) => {
  const lower = message.toLowerCase();
  const lowerCode = code.toLowerCase();
  return (
    status === 403 ||
    lowerCode.includes('reauth') ||
    lower.includes('reauth') ||
    lower.includes('recent authentication') ||
    lower.includes('recently authenticated') ||
    lower.includes('aal2') ||
    lower.includes('secure password change')
  );
};

export async function updatePassword(password: string): Promise<UpdatePasswordResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = getSupabaseAnonKey();

  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      error: { code: 'missing_supabase_env', message: 'Configuração do Supabase ausente (env)' },
    };
  }

  try {
    const getToken = async (refresh = false) => {
      if (refresh) {
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) return { token: null, error: refreshError };
        return { token: refreshed.session?.access_token || null, error: null };
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return { token: null, error: sessionError };
      return { token: sessionData.session?.access_token || null, error: null };
    };

    const putPassword = async (accessToken: string) => fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify({ password: String(password) }),
    });

    const firstToken = await getToken(false);
    if (firstToken.error) {
      return { ok: false, error: { message: firstToken.error.message, raw: firstToken.error } };
    }
    if (!firstToken.token) {
      return { ok: false, error: { code: 'not_authenticated', message: 'Não autenticado' } };
    }

    let resp = await putPassword(firstToken.token);
    let text = await resp.text().catch(() => '');
    let json = safeJsonParse(text);
    let status = resp.status;
    let code = typeof (json as any)?.code === 'string' ? String((json as any).code) : '';
    let serverMessage = coerceMessage(
      (json as any)?.msg ??
        (json as any)?.message ??
        (json as any)?.error_description ??
        (json as any)?.error ??
        (typeof text === 'string' ? text : ''),
    ).trim();

    // Retry once with refreshed session when token looks stale.
    if (!resp.ok && looksLikeTokenIssue(status, serverMessage)) {
      const refreshedToken = await getToken(true);
      if (!refreshedToken.error && refreshedToken.token) {
        resp = await putPassword(refreshedToken.token);
        text = await resp.text().catch(() => '');
        json = safeJsonParse(text);
        status = resp.status;
        code = typeof (json as any)?.code === 'string' ? String((json as any).code) : '';
        serverMessage = coerceMessage(
          (json as any)?.msg ??
            (json as any)?.message ??
            (json as any)?.error_description ??
            (json as any)?.error ??
            (typeof text === 'string' ? text : ''),
        ).trim();
      }
    }

    if (!resp.ok) {
      if (looksLikeReauthRequired(status, code, serverMessage || '')) {
        return {
          ok: false,
          error: {
            status,
            code: 'reauth_required',
            message: serverMessage || 'Reautenticação necessária para trocar a senha',
            raw: json || text,
          },
        };
      }

      return {
        ok: false,
        error: {
          status,
          code: code || undefined,
          message: serverMessage || `HTTP ${resp.status}`,
          raw: json || text,
        },
      };
    }

    // Keep client session/user in sync after auth mutation.
    try {
      await supabase.auth.refreshSession();
    } catch {
      // ignore
    }

    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof (error as any)?.message === 'string'
          ? String((error as any).message)
          : 'Falha de rede ao atualizar senha';
    return { ok: false, error: { message, raw: error } };
  }
}
