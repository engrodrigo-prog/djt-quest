# Deploy em produção (padrão)

Objetivo: sempre aplicar as migrations do Supabase e fazer deploy em produção na Vercel.

## Fluxo manual (recomendado)

Pré-requisitos (máquina local):

- Supabase CLI autenticado (`supabase login`)
- Vercel CLI autenticado (`vercel login`) **ou** `VERCEL_TOKEN` definido

Comandos:

```sh
npm run release:prod
```

Opções:

- Pular a gate (typecheck + tests + build + lint): `npm run release:prod -- --skip-gate`

## Fluxo automático (CI)

Se você quiser automatizar em push na `main`, crie secrets no GitHub:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD` (senha do Postgres do projeto Supabase)
- `VERCEL_TOKEN`

E então use o workflow em `.github/workflows/prod-deploy.yml`.

