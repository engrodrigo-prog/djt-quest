# UPDATE_REPORT — LTS / Stable Audit

Branch: `chore/update-lts-20260204`  
Date: 2026-02-04

## Gate 0 — Baseline

**Package manager:** npm (`package-lock.json` presente).  
**Extra lockfile:** `bun.lockb` presente (não utilizado nos gates).

### Environment
- `package.json#engines.node`: `22.x`
- Node local detectado: `v24.9.0` (fora do engines/LTS) → `npm ci` emite `EBADENGINE` (apenas warning).

### Commands
- `npm ci`: OK (com warning de engine) — **23 vulnerabilities** reportadas (1 low / 8 moderate / 13 high / 1 critical). Não aplicado `npm audit fix` (evitar mudanças não-auditadas).
- `npm test`: OK
- `npx tsc --noEmit`: OK
- `npm run build`: OK
- `npm run lint`: **FAIL** (dívida técnica histórica)
  - 329 problemas: 204 errors / 125 warnings
  - Principais fontes:
    - `api/*.ts` com `@ts-nocheck` (regra `@typescript-eslint/ban-ts-comment`)
    - `no-empty` em vários pontos

**Decisão de estabilidade:** lint entra em modo **não-regressão** (gate via `lint:gate`) até zerarmos o backlog.

## Gate 1 — Pin Node LTS + scripts (OK)
### Mudanças
- Pinagem Node LTS: `.nvmrc` e `.node-version` = `22`
- Scripts padronizados:
  - `npm run typecheck` (tsc)
  - `npm run lint:gate` (não-regressão do lint)
  - `npm run gate` (typecheck + test + build + lint gate)

### Gate 1
- `npm ci`: OK (ainda com warning `EBADENGINE` enquanto Node local estiver em 24.x)
- `npm run gate`: OK (typecheck/test/build ok; lint em modo não-regressão)

## Gate 2 — Patch/Minor deps (OK)

### Mudanças (patch/minor + estabilidade)
- Atualizações patch/minor (sem majors) em deps e tooling:
  - `@supabase/supabase-js` `^2.90.1` → `^2.94.0`
  - `@tanstack/react-query` `^5.90.16` → `^5.90.20`
  - `react`/`react-dom` `^19.2.3` → `^19.2.4`
  - `react-hook-form` `^7.71.0` → `^7.71.1`
  - `react-resizable-panels` `^4.3.3` → `^4.5.9`
  - `recharts` `^3.6.0` → `^3.7.0`
  - `tailwind-merge` `^2.6.0` → `^2.6.1`
  - `jsonrepair` `^3.13.1` → `^3.13.2`
  - `@types/node` `^22.19.5` → `^22.19.8`
  - `@types/react` `^19.2.8` → `^19.2.11`
  - `autoprefixer` `^10.4.23` → `^10.4.24`
  - `globals` `^17.0.0` → `^17.3.0`
  - `typescript-eslint` `^8.52.0` → `^8.54.0`
- Removido `vercel` do `dependencies` (evitar transitivos canary/beta no lockfile). Scripts `dev:vercel:*` passam a usar `npx vercel@50.10.0`.
- Adicionado `@vercel/node` em `devDependencies` (tipos para `api/*.ts`).
- `overrides`: força `web-streams-polyfill@4.2.0` (remove beta transitive do OpenAI SDK).

### Gate 2
- `npm install`: OK
- `npm run gate`: OK

### Segurança (audit)
- `npm audit --omit=dev`: **1 high** (somente `xlsx`, sem fix disponível).

### Nota sobre prerelease transitivo
- Após limpeza, restam apenas:
  - `gensync@1.0.0-beta.2` (transitivo do Babel; não há release stable)
  - `@rolldown/pluginutils@1.0.0-rc.2` (transitivo do tooling Vite/plugin)

## Gate 3 — Supabase/Vercel sanity checks (pendente)
- Supabase: revisar `supabase/config.toml` + ordem/nomes em `supabase/migrations/` (sem aplicar migrations).
- Vercel: validar Node 22.x em produção e smoke test pós-deploy.

## Majors candidatos (NÃO aplicados automaticamente)
- Node 24 (current) — **não** (manter LTS 22)
- `@hookform/resolvers` 3.x → 5.x
- `date-fns` 3.x → 4.x
- `react-router-dom` 6.x → 7.x
- `tailwind-merge` 2.x → 3.x
- `tailwindcss` 3.x → 4.x
- `zod` 3.x → 4.x
- `openai` 4.x → 6.x
- `@types/node` 22.x → 25.x

## Checklist (PR / Deploy)
- [ ] Rodar gates localmente: `npm ci && npm run gate`
- [ ] Validar Vercel usa Node 22.x (Project Settings → Node.js Version / ou respeitar `engines`)
- [ ] Smoke test em produção (login, dashboard, abrir quiz, sepbook mídia)
