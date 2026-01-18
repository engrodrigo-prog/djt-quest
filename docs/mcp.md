# MCP (Local) — GitHub + Vercel + Supabase no VS Code (Codex)

Este projeto inclui um **MCP Server local** (rodando via Node) para o Codex no VS Code conseguir operar **GitHub**, **Vercel** e **Supabase** por ferramentas (issues/PRs/deployments/queries), sem depender de Docker.

As ferramentas de Supabase aqui são **somente leitura** (não há insert/update/delete).

## 1) Arquivos
- Config do workspace (compartilhável): `.vscode/mcp.json`
- Servidor MCP local: `scripts/mcp/djt-local-mcp.mjs`

## 2) Pré-requisitos
- Node instalado (o projeto já usa Node 22).
- Token do GitHub (Fine-grained PAT recomendado).
- Token do Vercel (Personal Token).
- Supabase URL + chave (preferencialmente ANON/PUBLISHABLE; SERVICE_ROLE é opcional).
- Para Vercel: o projeto precisa estar “linkado” (`.vercel/project.json`), criado via CLI.

## 3) Setup no VS Code
1. Abra o VS Code no workspace do projeto.
2. Abra o Chat do Codex.
3. Garanta que MCP está habilitado (`chat.mcp.gallery.enabled: true`).
4. Recarregue a janela: **Developer: Reload Window**.
5. Na primeira chamada, o VS Code vai pedir:
   - `github_token`
   - `vercel_token`
   - `supabase_url` (opcional; pode deixar vazio)
   - `supabase_service_role_key` (opcional)
   - `supabase_anon_key` (opcional)

Se você deixar os campos de Supabase vazios, o servidor tenta detectar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY/PUBLISHABLE_KEY` a partir do `.env.local` (não comitado).

## 4) Setup do Vercel (link do projeto)
O MCP tenta detectar automaticamente o `projectId`/`orgId` lendo:
- `.vercel/project.json`

Se não existir, rode no terminal (no root do repo):
- `npx vercel link`

## 5) Tokens (mínimo recomendado)
### GitHub
Fine-grained PAT:
- Repo access: selecione `engrodrigo-prog/djt-quest`
- Permissions:
  - Pull requests: Read and write (se for criar PR via ferramenta)
  - Issues: Read and write (se for criar issues via ferramenta)
  - Contents: Read-only (ou write se necessário)

### Vercel
Personal Token:
- Vercel → Account Settings → Tokens

### Supabase
Recomendado (somente leitura, sujeito a RLS):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (ou `VITE_SUPABASE_PUBLISHABLE_KEY`)

Opcional (admin/leitura ampla; cuidado):
- `SUPABASE_SERVICE_ROLE_KEY`

## 6) Ferramentas disponíveis
### Contexto
- `djt.context`
- `djt.comment_pr_with_latest_vercel_preview`

### GitHub
- `github.list_pull_requests`
- `github.create_issue`
- `github.create_pull_request`

### Vercel
- `vercel.list_deployments`
- `vercel.get_deployment`
- `vercel.get_project`

### Supabase (somente leitura)
- `supabase.context`
- `supabase.list_tables`
- `supabase.describe_table`
- `supabase.table_select`
- `supabase.table_count`
- `supabase.storage.list_buckets`
- `supabase.storage.list_objects`
- `supabase.storage.create_signed_url`

## 7) Exemplos de prompts (para o Codex)
- “Use `djt.context` e me diga qual repo/projeto Vercel você detectou.”
- “Liste os PRs abertos com `github.list_pull_requests`.”
- “Crie uma issue ‘Bug: áudio do quiz trava’ com labels `bug`.”
- “Liste os últimos 10 deployments do Vercel e me mande os links.”
- “Comente no PR #123 o preview mais recente do Vercel com `djt.comment_pr_with_latest_vercel_preview`.”
- “Liste as tabelas expostas no Supabase com `supabase.list_tables`.”
- “Descreva a tabela `profiles` com `supabase.describe_table`.”
- “Faça um select na tabela `events` com `supabase.table_select` limit 50.”
