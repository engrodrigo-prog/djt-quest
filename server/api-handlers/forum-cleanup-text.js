import { loadLocalEnvIfNeeded } from '../lib/load-local-env.js';
import { normalizeChatModel } from '../lib/openai-models.js';
import { proofreadPtBrStrings, polishPtBrStrings } from '../lib/ai-proofread-ptbr.js';
loadLocalEnvIfNeeded();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_TEXT_MODEL = normalizeChatModel(process.env.OPENAI_MODEL_FAST ||
    process.env.OPENAI_TEXT_MODEL ||
    process.env.OPENAI_MODEL_OVERRIDE ||
    'gpt-5-2025-08-07', 'gpt-5-2025-08-07');
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    // Valores seguros para fallback em qualquer erro
    let safeTitle = '[sem título]';
    let safeDescription = '';
    let language = 'pt-BR';
    let mode = 'proofread';
    try {
        const input = (req.body || {});
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
            return res.status(200).json({
                cleaned: {
                    title: safeTitle.trim(),
                    description: safeDescription.trim(),
                },
                meta: { usedAI: false, reason: 'missing_api_key' },
            });
        }
        const runner = mode === 'feedback' || mode === 'polish' ? polishPtBrStrings : proofreadPtBrStrings;
        const { output, usedModel } = await runner({
            openaiKey: OPENAI_API_KEY,
            model: OPENAI_TEXT_MODEL,
            strings: [safeTitle, safeDescription],
        });
        const [nextTitle, nextDescription] = Array.isArray(output) ? output : [safeTitle, safeDescription];
        return res.status(200).json({
            cleaned: {
                title: String(nextTitle || safeTitle).trim(),
                description: String(nextDescription || safeDescription).trim(),
            },
            meta: {
                usedAI: Boolean(usedModel),
                model: usedModel || OPENAI_TEXT_MODEL,
                language,
                mode,
            },
        });
    }
    catch (err) {
        return res.status(200).json({
            cleaned: {
                title: safeTitle.trim(),
                description: safeDescription.trim(),
            },
            meta: { usedAI: false, reason: (err === null || err === void 0 ? void 0 : err.message) || 'unknown', mode },
        });
    }
}
export const config = { api: { bodyParser: true } };
