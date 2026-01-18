# MCP (Local) — GitHub + Vercel no VS Code (Codex)

Este projeto inclui um **MCP Server local** (rodando via Node) para o Codex no VS Code conseguir operar **GitHub** e **Vercel** por ferramentas (issues/PRs/deployments), sem depender de Docker.

## 1) Arquivos
- Config do workspace (compartilhável): `.vscode/mcp.json`
- Servidor MCP local: `scripts/mcp/djt-local-mcp.mjs`

## 2) Pré-requisitos
- Node instalado (o projeto já usa Node 22).
- Token do GitHub (Fine-grained PAT recomendado).
- Token do Vercel (Personal Token).
- Para Vercel: o projeto precisa estar “linkado” (`.vercel/project.json`), criado via CLI.

## 3) Setup no VS Code
1. Abra o VS Code no workspace do projeto.
2. Abra o Chat do Codex.
3. Garanta que MCP está habilitado (`chat.mcp.gallery.enabled: true`).
4. Recarregue a janela: **Developer: Reload Window**.
5. Na primeira chamada, o VS Code vai pedir:
   - `github_token`
   - `vercel_token`

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

## 6) Ferramentas disponíveis
### Contexto
- `djt.context`

### GitHub
- `github.list_pull_requests`
- `github.create_issue`
- `github.create_pull_request`

### Vercel
- `vercel.list_deployments`
- `vercel.get_deployment`
- `vercel.get_project`

## 7) Exemplos de prompts (para o Codex)
- “Use `djt.context` e me diga qual repo/projeto Vercel você detectou.”
- “Liste os PRs abertos com `github.list_pull_requests`.”
- “Crie uma issue ‘Bug: áudio do quiz trava’ com labels `bug`.”
- “Liste os últimos 10 deployments do Vercel e me mande os links.”

