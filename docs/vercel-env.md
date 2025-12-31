# Vercel env vars (OpenAI + StudyLab)

Este projeto usa Vercel Serverless Functions em `api/*.ts` (ex.: `/api/ai?handler=study-chat`) para chamadas server-side à OpenAI e para operações no Supabase.

## Variáveis obrigatórias (server-only)

Configurar no Vercel (Project → Settings → Environment Variables):

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (recomendado para rotas administrativas)

Algumas rotas aceitam fallback para chave pública, mas o comportamento pode variar conforme RLS:

- `SUPABASE_ANON_KEY`

## Variáveis públicas (frontend / Vite)

Essas ficam expostas no bundle do navegador e devem usar prefixo `VITE_`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (ou `VITE_SUPABASE_ANON_KEY`)
- `VITE_SUPABASE_PROJECT_ID` (quando usado)
- `VITE_API_BASE_URL` (opcional; útil para rodar `npm run dev` apontando para uma API já publicada)

Não coloque segredos no frontend:

- não use `VITE_OPENAI_API_KEY`

## Como validar

- Health check: `GET /api/ai?handler=health` (deve retornar `{ ok: true, ... }` quando `OPENAI_API_KEY` está configurada)
- Em dev, se estiver rodando `npm run dev` sem proxy, prefira `vercel dev` para ter `/api/*` local.

