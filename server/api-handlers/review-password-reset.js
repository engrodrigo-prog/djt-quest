import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const allowedRoles = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).end();
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
        return res.status(500).json({ error: 'Supabase configuration missing' });
    }
    try {
        const authHeader = req.headers.authorization || '';
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.slice(7);
        const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
        if (userErr || !userData?.user)
            return res.status(401).json({ error: 'Unauthorized' });
        const reviewerId = userData.user.id;
        const { data: roles } = await supabaseUser
            .from('user_roles')
            .select('role')
            .eq('user_id', reviewerId);
        const reviewerRoles = roles?.map((r) => r.role) ?? [];
        if (!reviewerRoles.some((role) => allowedRoles.has(role))) {
            return res.status(403).json({ error: 'Sem permissão' });
        }
        const { requestId, action, notes } = req.body || {};
        if (!requestId || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Dados inválidos' });
        }
        const { data: request, error: requestError } = await supabaseAdmin
            .from('password_reset_requests')
            .select('*, user:profiles!password_reset_requests_user_id_fkey(id, division_id, coord_id)')
            .eq('id', requestId)
            .eq('status', 'pending')
            .single();
        if (requestError || !request) {
            return res.status(404).json({ error: 'Solicitação não encontrada' });
        }
        const { data: reviewerProfile } = await supabaseUser
            .from('profiles')
            .select('division_id, coord_id')
            .eq('id', reviewerId)
            .maybeSingle();
        const canReview = () => {
            if (reviewerRoles.includes('admin') || reviewerRoles.includes('gerente_djt'))
                return true;
            if (reviewerRoles.includes('gerente_divisao_djtx')) {
                return reviewerProfile?.division_id && reviewerProfile.division_id === request.user?.division_id;
            }
            if (reviewerRoles.includes('coordenador_djtx')) {
                return reviewerProfile?.coord_id && reviewerProfile.coord_id === request.user?.coord_id;
            }
            return false;
        };
        if (!canReview()) {
            return res.status(403).json({ error: 'Sem permissão para esta solicitação' });
        }
        const updates = {
            status: action === 'approve' ? 'approved' : 'rejected',
            processed_by: reviewerId,
            processed_at: new Date().toISOString(),
            reviewer_notes: notes ? String(notes).trim() : null,
        };
        if (action === 'approve') {
            const tempPassword = '123456';
            await supabaseAdmin.auth.admin.updateUserById(request.user_id, {
                password: tempPassword,
                email_confirm: true,
            });
            await supabaseAdmin
                .from('profiles')
                .update({ must_change_password: true })
                .eq('id', request.user_id);
        }
        const { error: updateError } = await supabaseAdmin
            .from('password_reset_requests')
            .update(updates)
            .eq('id', requestId);
        if (updateError)
            return res.status(400).json({ error: updateError.message });
        return res.status(200).json({ success: true });
    }
    catch (error) {
        return res.status(500).json({ error: error?.message || 'Unexpected error' });
    }
}
