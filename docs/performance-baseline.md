# Performance baseline (DJT Quest)

Data (UTC): 2025-12-17T23:48:23Z

## Stack (visão rápida)
- Frontend: Vite + React 18 + React Router + TanStack Query + shadcn/ui (Radix) + Tailwind
- Auth: Supabase Auth + Edge Function `supabase/functions/auth-me` (enriquece `profile`, RBAC e orgScope)
- Backend: Vercel Serverless (`api/*.ts`) + Supabase (DB/Storage) + algumas Edge Functions (workflows)
- IA: chamadas server-side (Vercel) via OpenAI API (ex.: `/api/ai?handler=study-chat`, imports/curadoria)

## Módulos principais (funcionais)
- Quizzes: criação/curadoria (Studio), player (colaborador), importação de questões
- Campanhas / Desafios / Avaliações: ciclos, ações e avaliação de entregas
- Fóruns / SEPBook: posts, interações, moderação e insights
- Studio: hubs administrativos (usuários, relatórios, curadoria, compêndio)
- StudyLab: catálogo de conhecimento e chat (“Catálogo”)

## Superfícies de UI (alto nível)
Páginas (React Router, lazy-loaded): `src/pages/*`
- Login/registro/onboarding: `Auth`, `Register`, `UserSetup`
- Navegação/menus: `src/components/Navigation.tsx`, `src/components/ProfileDropdown.tsx`
- Telas principais: `Home`, `Dashboard`, `Rankings`, `Forums`, `SEPBook`, `Study`
- Studio: `Studio`, `StudioCuration`, `Evaluations`, `LeaderDashboard`

## Como medir (repetível)
### Build / bundle
```bash
npm ci
npm run build
```

### Lighthouse (local)
Recomendado rodar com o app local em modo preview:
```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
# em outro terminal:
npx lighthouse http://127.0.0.1:4173 --preset=desktop --output=json --output-path=./lighthouse-desktop.json
npx lighthouse http://127.0.0.1:4173 --preset=mobile --output=json --output-path=./lighthouse-mobile.json
```

Métricas-alvo para comparar depois:
- LCP, INP, CLS
- Tamanho do bundle inicial + cacheabilidade

### API latência p95 (local/prod)
Sugestão (depende de env vars e supabase):
```bash
# exemplo (ajuste URL e headers)
npx autocannon -c 20 -d 30 "https://<app>/api/ai?handler=health"
```

## Resultados (build atual)
### Tamanho total do build
- `dist/`: ~27 MB
- `dist/assets/`: ~24 MB

### JS (top 15 por tamanho)
- `index-*.js`: 500.4 KB (gzip 151.5 KB)
- `Studio-*.js`: 204.4 KB (gzip 53.8 KB)
- `types-*.js`: 52.0 KB (gzip 11.9 KB)
- `Profile-*.js`: 49.8 KB (gzip 14.3 KB)
- `QuizQuestionsList-*.js`: 41.2 KB (gzip 14.7 KB)
- `ChallengeDetail-*.js`: 41.0 KB (gzip 12.7 KB)
- `StudyLab-*.js`: 32.9 KB (gzip 9.6 KB)
- `SEPBook-*.js`: 32.9 KB (gzip 9.3 KB)
- `format-*.js`: 28.5 KB (gzip 8.7 KB)
- `StudioCuration-*.js`: 27.8 KB (gzip 6.7 KB)
- `ForumTopic-*.js`: 25.3 KB (gzip 7.1 KB)
- `ProfileDropdown-*.js`: 25.1 KB (gzip 7.7 KB)
- `select-*.js`: 21.8 KB (gzip 7.6 KB)
- `popover-*.js`: 19.9 KB (gzip 7.2 KB)
- `Dashboard-*.js`: 19.3 KB (gzip 6.9 KB)

Totais JS (somando chunks):
- Total JS: ~1,342.4 KB
- Total JS gzip: ~414.6 KB
- Quantidade de chunks JS: 82

### CSS
- `index-*.css`: ~106 KB

### Assets grandes (top)
Os maiores arquivos do build são imagens PNG (1.3–3.1 MB cada), por exemplo:
- `burini-*.png` (~3.1 MB)
- `BG-*.png` (~2.1 MB)
- `djt-quest-cover-*.png` (~1.6 MB)
- `Ranking-*.png` (~1.6 MB)
- `studylab-*.png` (~1.5 MB)

## Observações iniciais (para orientar otimizações)
- Já existe code-splitting por rota via `React.lazy` em `src/App.tsx`.
- O ganho mais provável no curto prazo é reduzir o peso de imagens e evitar carregar assets grandes fora de tela (lazy-load) + ajustar cache headers.
- Qualquer mudança deve ser comparada com este baseline (sem piorar >5% nas métricas combinadas).
