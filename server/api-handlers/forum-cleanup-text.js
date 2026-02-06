import { loadLocalEnvIfNeeded } from '../lib/load-local-env.js';
import { normalizeChatModel } from '../lib/openai-models.js';
import { proofreadPtBrStrings, polishPtBrStrings } from '../lib/ai-proofread-ptbr.js';

loadLocalEnvIfNeeded();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_TEXT_MODEL = normalizeChatModel(
    process.env.OPENAI_MODEL_FAST ||
        process.env.OPENAI_TEXT_MODEL ||
        process.env.OPENAI_MODEL_OVERRIDE ||
        'gpt-5-2025-08-07',
    'gpt-5-2025-08-07',
);

const classifyCleanupFailure = (rawReason) => {
    const reason = String(rawReason || '').trim();
    const lower = reason.toLowerCase();
    if (!reason || lower.includes('no_model_succeeded') || lower.includes('nenhum modelo')) {
        return {
            status: 503,
            code: 'model_unavailable',
            message: 'IA indisponível no momento. Tente novamente em alguns minutos.',
        };
    }
    if (lower.includes('openai_api_key ausente') || lower.includes('missing_api_key')) {
        return {
            status: 503,
            code: 'missing_api_key',
            message: 'IA não configurada no servidor (OPENAI_API_KEY ausente).',
        };
    }
    if (lower.includes('exceeded your current quota') || lower.includes('insufficient_quota') || lower.includes('quota')) {
        return {
            status: 429,
            code: 'quota_exceeded',
            message: 'Limite da IA atingido no provedor. Tente novamente mais tarde.',
        };
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
        return {
            status: 429,
            code: 'rate_limited',
            message: 'Muitas requisições para a IA no momento. Tente novamente em instantes.',
        };
    }
    if (lower.includes('invalid api key') || lower.includes('api key') || lower.includes('unauthorized')) {
        return {
            status: 503,
            code: 'invalid_api_key',
            message: 'Chave da IA inválida ou revogada no servidor.',
        };
    }
    return {
        status: 503,
        code: 'ai_unavailable',
        message: 'IA indisponível no momento. Tente novamente mais tarde.',
    };
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    let safeTitle = '[sem título]';
    let safeDescription = '';
    let language = 'pt-BR';
    let mode = 'proofread';
    try {
        const input = req.body || {};
        const rawTitle = input.title;
        const rawDescription = input.description;
        mode =
            typeof input.mode === 'string' && input.mode.trim()
                ? input.mode.trim().toLowerCase()
                : 'proofread';
        language =
            typeof input.language === 'string' && input.language.trim()
                ? input.language
                : 'pt-BR';
        safeTitle =
            typeof rawTitle === 'string' && rawTitle.trim()
                ? rawTitle
                : '[sem título]';
        if (!rawDescription || typeof rawDescription !== 'string') {
            return res.status(400).json({ error: 'description obrigatório' });
        }
        safeDescription = rawDescription;
        if (!OPENAI_API_KEY) {
            const failure = classifyCleanupFailure('OPENAI_API_KEY ausente');
            return res.status(failure.status).json({
                error: failure.message,
                cleaned: {
                    title: safeTitle.trim(),
                    description: safeDescription.trim(),
                },
                meta: { usedAI: false, reason: 'missing_api_key', reason_code: failure.code },
            });
        }
        const runner = mode === 'feedback' || mode === 'polish' ? polishPtBrStrings : proofreadPtBrStrings;
        const result = await runner({
            openaiKey: OPENAI_API_KEY,
            model: OPENAI_TEXT_MODEL,
            strings: [safeTitle, safeDescription],
        });
        const { output, usedModel, error, attemptedModels } = result || {};
        const [nextTitle, nextDescription] = Array.isArray(output) ? output : [safeTitle, safeDescription];
        const usedAI = Boolean(usedModel);
        if (!usedAI) {
            const reason = String(error || 'no_model_succeeded');
            const failure = classifyCleanupFailure(reason);
            return res.status(failure.status).json({
                error: failure.message,
                cleaned: {
                    title: String(nextTitle || safeTitle).trim(),
                    description: String(nextDescription || safeDescription).trim(),
                },
                meta: {
                    usedAI: false,
                    model: null,
                    language,
                    mode,
                    reason,
                    reason_code: failure.code,
                    attempted_models: Array.isArray(attemptedModels)
                        ? attemptedModels.slice(0, 8)
                        : [],
                },
            });
        }
        return res.status(200).json({
            cleaned: {
                title: String(nextTitle || safeTitle).trim(),
                description: String(nextDescription || safeDescription).trim(),
            },
            meta: {
                usedAI: true,
                model: usedModel || null,
                language,
                mode,
                reason: null,
                attempted_models: [],
            },
        });
    }
    catch (err) {
        const reason = err?.message || 'unknown';
        const failure = classifyCleanupFailure(reason);
        return res.status(failure.status).json({
            error: failure.message,
            cleaned: {
                title: safeTitle.trim(),
                description: safeDescription.trim(),
            },
            meta: { usedAI: false, reason, reason_code: failure.code, mode },
        });
    }
}
export const config = { api: { bodyParser: true } };
