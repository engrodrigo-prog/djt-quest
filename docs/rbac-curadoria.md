# RBAC + Curadoria de Conteúdo (Quizzes)

Este documento descreve papéis, permissões, fluxo de estados e operação da curadoria de quizzes (inclui importação por arquivos e versionamento).

## Papéis (roles)

Roles (armazenadas em `user_roles.role`, **lowercase**):

- `admin` (ADMIN): acesso total.
- `lider_equipe` + papéis gerenciais (`coordenador_djtx`, `gerente_divisao_djtx`, `gerente_djt`): LEADER.
- `invited` (GUEST/INVITED): acesso mínimo ao app, apenas consumo de quizzes publicados.
- `content_curator` (CONTENT_CURATOR): curadoria/imports/edição de quizzes submetidos; no Studio só acessa Hub de Curadoria.

Compatibilidade: aliases legados são normalizados em `shared/rbac.js` (`gerente`, `coordenador`, `lider_divisao`).

## Matriz de permissões (resumo)

| Ação | INVITED | LEADER | CONTENT_CURATOR | ADMIN |
|---|---:|---:|---:|---:|
| Consumir quizzes publicados (sem gabarito) | ✅ | ✅ | ✅ | ✅ |
| Ver gabarito completo | ❌ | ✅ (somente próprios) | ✅ (todos) | ✅ |
| Criar quiz (DRAFT) | ❌ | ✅ | ✅ | ✅ |
| Editar quiz DRAFT próprio | ❌ | ✅ | ✅ | ✅ |
| Submeter quiz (DRAFT → SUBMITTED) | ❌ | ✅ (somente próprios) | ✅ (se for autor) | ✅ |
| Aprovar/Reprovar (SUBMITTED → APPROVED/REJECTED) | ❌ | ❌ | ✅ | ✅ |
| Publicar (APPROVED → PUBLISHED) | ❌ | ❌ | ✅ | ✅ |
| Importar questões por arquivo | ❌ | ❌ | ✅ | ✅ |
| Atribuir/demitir roles | ❌ | ✅ | ❌ | ✅ |
| Acesso ao Studio (hubs) | ❌ | ✅ | ✅ (somente Curadoria) | ✅ |

## Fluxo de estados (workflow)

Estados suportados (coluna `challenges.quiz_workflow_status`):

- `DRAFT`
- `SUBMITTED`
- `APPROVED`
- `REJECTED`
- `PUBLISHED`

Regras principais:

- LEADER/autor: `DRAFT → SUBMITTED`
- CONTENT_CURATOR/ADMIN: `SUBMITTED → APPROVED` ou `SUBMITTED → REJECTED`
- CONTENT_CURATOR/ADMIN: `APPROVED → PUBLISHED`
- Qualquer edição após `SUBMITTED` gera snapshot em `quiz_versions` e preserva histórico.
- Ao editar um `REJECTED`, o autor retorna para `DRAFT` (nova iteração), mantendo histórico.

## Segurança do gabarito (least privilege)

- **Banco (RLS/privileges)**: `quiz_options.is_correct` não é legível por `anon`/`authenticated` (somente `service_role`).
- **Backend** é a fonte da verdade para curadoria e para qualquer retorno de gabarito.
- **Gameplay** (`supabase/functions/submit-quiz-answer`) só devolve `correctOptionId`/`explanation` se:
  - `admin` ou `content_curator`, ou
  - o usuário é **dono do quiz** (`owner_id`/`created_by`).

## Jornada de convidados (GUEST/INVITED) e promoção

Premissa: o usuário nunca se auto-atribui roles.

### Aprovação de convidado

No fluxo de aprovação existente:

- aprovar usuário como convidado → atribui `invited`
- opcionalmente (somente LEADER/ADMIN) marcar para curador → atribui `content_curator`

Auditoria é registrada em `audit_log` quando disponível.

### Editar perfil / promover / demover

Somente LEADER/ADMIN podem alterar roles (inclui `content_curator`), e nunca para si próprios.

Implementações:

- API: `server/api-handlers/studio-update-user.js`
- Edge function: `supabase/functions/studio-update-user/index.ts`

## Studio / Hub de Curadoria

- Rota: `/studio/curadoria`
- Curador ao entrar no Studio é redirecionado para `/studio/curadoria` e não vê outros módulos.
- Líder acessa `/studio/curadoria` apenas para submeter e acompanhar quizzes próprios.

## Importação por arquivos (CSV/XLSX/PDF)

Fluxo no Hub de Curadoria:

1) Upload → storage bucket `quiz-imports` (privado)
2) Criar registro em `content_imports` (status `UPLOADED`)
3) Extração server-side:
   - CSV/XLSX: colunas `[pergunta, alt_a..alt_e, correta, explicacao?]`
   - PDF: extrai texto bruto e salva em `raw_extract`
4) Pré-visualizar e “Estruturar com IA (GPT-5.2)”:
   - se CSV/XLSX, usa modo `passthrough` (sem IA)
   - se PDF, usa provider `server/lib/ai-curation-provider.js` (stub via env)
5) Finalizar (`FINAL_APPROVED`) e aplicar ao quiz em `DRAFT`

## Seed: promover Daniel Burini a curador (idempotente)

Premissa fixa: Daniel Burini **já existe no banco**. O seed não cria usuário.

Comando:

```bash
npm run seed:daniel-curator -- --email="EMAIL_DO_DANIEL"
```

Ou via env:

```bash
export DANIEL_BURINI_EMAIL="EMAIL_DO_DANIEL"
npm run seed:daniel-curator
```

O script garante a role `content_curator` sem duplicar e registra auditoria (best-effort).

