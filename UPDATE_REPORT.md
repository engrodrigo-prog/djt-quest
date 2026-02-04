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

## Gate 1 — Pin Node LTS + scripts (pendente)
### Mudanças
- Pinagem Node LTS: `.nvmrc` e `.node-version` = `22`
- Scripts padronizados:
  - `npm run typecheck` (tsc)
  - `npm run lint:gate` (não-regressão do lint)
  - `npm run gate` (typecheck + test + build + lint gate)

### Gate 1
- `npm ci`: OK (ainda com warning `EBADENGINE` enquanto Node local estiver em 24.x)
- `npm run gate`: OK (typecheck/test/build ok; lint em modo não-regressão)

## Gate 2 — Patch/Minor deps (pendente)
## Gate 3 — Supabase/Vercel sanity checks (pendente)

## Majors candidatos (NÃO aplicados automaticamente)
- Node 24 (current) — **não** (manter LTS 22)
- (preencher após `npm outdated` e avaliação)

## Checklist (PR / Deploy)
- [ ] Rodar gates localmente: `npm ci && npm test && npm run typecheck && npm run build && npm run lint:gate`
- [ ] Validar Vercel usa Node 22.x (Project Settings → Node.js Version / ou respeitar `engines`)
- [ ] Smoke test em produção (login, dashboard, abrir quiz, sepbook mídia)
