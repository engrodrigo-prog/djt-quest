# DJT Quest

Aplicação web (Vite + React) com backend Supabase (SQL migrations + Edge Functions) e rotas serverless em `api/*.ts` (Vercel).

## Tecnologias (versões do `package.json`)

- Node.js: `22.x`
- Vite: `7.3.1`
- React / React DOM: `19.2.3`
- TypeScript: `5.9.3`
- Tailwind CSS: `3.4.19`
- shadcn/ui (Radix UI) + lucide-react
- Supabase JS: `2.90.1`
- TanStack React Query: `5.90.16`
- Leaflet / React-Leaflet (mapas): `1.9.4` / `5.0.0`
- Vercel CLI (dev/debug): `50.1.6`

## Rodar localmente

```sh
npm i
npm run dev
```

## Backend (Supabase)

Estrutura:

- Migrações SQL: `supabase/migrations/`
- Edge Functions: `supabase/functions/`

Fluxo local (opcional):

1) Instale o Supabase CLI: `npm i -g supabase`
2) Suba o stack local: `supabase start`
3) Aplique schema/migrações: `supabase db reset` (ou `supabase db push`)

## Rotas serverless (Vercel)

- Endpoints: `api/*.ts`
- Para variáveis de ambiente (Supabase + OpenAI / StudyLab), veja `docs/vercel-env.md`.

## Scripts úteis

- `npm run build` (build produção)
- `npm run preview` (preview)
- Scripts utilitários em `scripts/`
