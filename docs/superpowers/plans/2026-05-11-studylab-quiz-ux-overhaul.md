# StudyLab + Quiz UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans para implementar este plano task-por-task. Steps usam checkbox (`- [ ]`) syntax para tracking.

**Goal:** Reformar UX/UI do StudyLab para mental model ChatGPT+NotebookLM, unificar o gerador de quizzes em torno das mesmas fontes, e materializar o Compêndio como segundo cérebro em Markdown. Decompor os dois monolitos sem regredir funcionalidade.

**Architecture:** Quebra cirúrgica de `src/components/StudyLab.tsx` (2.768 linhas) em `src/components/studylab/*` e de `src/components/AiQuizGenerator.tsx` (1.346 linhas) em `src/components/quiz/*`. Provider local via `useContext`. Uma tabela nova (`study_knowledge_files`), uma Edge Function nova (`regenerate-knowledge-md`), um bucket Storage privado novo (`knowledge-md/`). Sem novas dependências de frontend.

**Tech Stack:** TypeScript, React 19, Vite, shadcn/ui (Radix), Tailwind, Supabase, Vercel serverless functions, OpenAI Responses API.

**Skills usadas:** `impeccable` (auditoria visual e refino), `ui-ux-pro-max` (tokens e padrões), `frontend-design` (componentes novos), `engineering:code-review` (revisão entre fatias), `engineering:tech-debt` (priorização), `engineering:architecture` (ADR final).

---

## Files Modified / Created

### Novos
- `src/components/studylab/StudyLabShell.tsx`
- `src/components/studylab/StudyLabProvider.tsx`
- `src/components/studylab/SourcesPanel.tsx`
- `src/components/studylab/SourcesPanelCore.tsx` (reaproveitado no Quiz)
- `src/components/studylab/ChatPanel.tsx`
- `src/components/studylab/StudioPanel.tsx`
- `src/components/studylab/HistoryDrawer.tsx`
- `src/components/studylab/CitationPopover.tsx`
- `src/components/studylab/Composer.tsx`
- `src/components/quiz/AiQuizFlow.tsx`
- `src/components/quiz/QuizQualityBadges.tsx`
- `src/components/quiz/QuestionWithEvidence.tsx`

### Modificados
- `src/components/StudyLab.tsx` — vira wrapper fino que renderiza `StudyLabShell`.
- `src/components/AiQuizGenerator.tsx` — vira wrapper fino que renderiza `AiQuizFlow`.
- `src/pages/Studio.tsx` — entry point unificado para criação de quiz.
- `src/pages/Study.tsx` — passa pelo Shell.

### Apenas leitura / validação
- `server/api-handlers/ai-study-chat.ts` — checar campo `meta.sources` no payload.
- `server/api-handlers/ai-study-quiz.ts` — checar campo `evidence` por pergunta.

### Backend novo (Bloco E — segundo cérebro)
- Migration nova: `supabase/migrations/<timestamp>_study_knowledge_files.sql`
- Edge Function: `supabase/functions/regenerate-knowledge-md/index.ts`
- Bucket: `knowledge-md/` (criado via migration ou Supabase Dashboard, com policy de RLS)
- Trigger: `pg_net` ou função `notify` em `study_sources` (insert/update/delete) → Edge Function

---

## Pré-requisito: rotacionar token GH exposto

- [ ] **Etapa 0.1** Revogar `ghp_*` que está em `.claude/settings.json` local. Gerar novo com escopo mínimo. Substituir local. **Bloqueante — humano.**

---

## Bloco D — Decomposição técnica (scaffold)

### Task D.1: Criar estrutura de pastas e provider vazio

- [ ] **Step 1:** Criar `src/components/studylab/` e `src/components/quiz/`.

- [ ] **Step 2:** Criar `src/components/studylab/StudyLabProvider.tsx` com contexto contendo apenas tipos vazios. Não exporta nada que quebre o build.

```typescript
import { createContext, useContext, useState, type ReactNode } from "react";

type ActiveSourceRef = { id: string };
type StudyLabState = {
  activeSources: ActiveSourceRef[];
  setActiveSources: (next: ActiveSourceRef[]) => void;
};

const StudyLabContext = createContext<StudyLabState | null>(null);

export function StudyLabProvider({ children }: { children: ReactNode }) {
  const [activeSources, setActiveSources] = useState<ActiveSourceRef[]>([]);
  return (
    <StudyLabContext.Provider value={{ activeSources, setActiveSources }}>
      {children}
    </StudyLabContext.Provider>
  );
}

export function useStudyLab() {
  const ctx = useContext(StudyLabContext);
  if (!ctx) throw new Error("useStudyLab must be inside StudyLabProvider");
  return ctx;
}
```

- [ ] **Step 3:** Rodar `npm run typecheck` — deve passar sem mudança em `StudyLab.tsx`.

- [ ] **Step 4:** Commit: `chore(studylab): scaffold de pastas e provider vazio`.

---

## Bloco A — StudyLab: layout 3 colunas e mental model

### Task A.1: Extrair HistoryDrawer

- [ ] **Step 1:** Criar `src/components/studylab/HistoryDrawer.tsx` com a UI atual de histórico, **adicionando**:
  - Input de busca por título/conteúdo.
  - Agrupamento temporal: "Hoje", "Ontem", "Esta semana", "Mais antigo".
  - Menu de ações por item: Renomear (Dialog), Fixar, Deletar.

- [ ] **Step 2:** Em `StudyLab.tsx`, importar `HistoryDrawer` e substituir o Card sticky e o Sheet mobile pela nova implementação. Manter as funções de fetch/persist no `StudyLab.tsx` ainda — só a UI move.

- [ ] **Step 3:** Testar manualmente: histórico abre/fecha, busca filtra, renomear persiste em `study_chat_sessions.title`.

- [ ] **Step 4:** `npm run typecheck && npm run lint` — devem passar.

- [ ] **Step 5:** Commit: `feat(studylab): histórico com busca, agrupamento por data e renomear/fixar`.

### Task A.2: Eliminar "Modo catálogo" — `SourcesPanel`

- [ ] **Step 1:** Criar `src/components/studylab/SourcesPanelCore.tsx` (sem estado de chat) com:
  - Lista de fontes do catálogo (mesmo fetch do `StudyLab.tsx`).
  - Checkbox por fonte (controlled via prop `activeIds[]`).
  - Filtro por categoria e tópico (mesmas constantes hoje em `STUDY_CATEGORIES`).
  - Input de busca textual.
  - Botão "+ Adicionar fonte" abre o uploader atual.

- [ ] **Step 2:** Criar `src/components/studylab/SourcesPanel.tsx` que envolve o `Core` lendo/escrevendo no `StudyLabProvider`.

- [ ] **Step 3:** Em `StudyLab.tsx`:
  - Renderizar `SourcesPanel` como coluna esquerda no desktop (`lg:flex` 320px).
  - Mobile: vira tab.
  - Remover o switch "Modo catálogo".
  - Lógica: `activeSources.length === 0` → chat geral (equivalente ao oracle/web atual quando aplicável); `activeSources.length > 0` → grounded nas fontes marcadas.

- [ ] **Step 4:** Atualizar a chamada para `apiFetch('/api/ai-study-chat', ...)` para enviar `source_ids: activeSources.map(s => s.id)` em vez de `source_id` único + `oracle: true`.

- [ ] **Step 5:** Ajustar `server/api-handlers/ai-study-chat.ts` para aceitar `source_ids[]` mantendo retrocompatibilidade com `source_id`/`oracle`. **Confirmar com humano antes** — única alteração de backend do plano.

- [ ] **Step 6:** Commit: `feat(studylab): substitui modo catálogo por seleção de fontes ativas`.

### Task A.3: Extrair `ChatPanel` com citação inline

- [ ] **Step 1:** Criar `src/components/studylab/CitationPopover.tsx` — recebe `{ index, source, snippet, page? }` e renderiza popover Radix com link "Abrir fonte".

- [ ] **Step 2:** Criar `src/components/studylab/ChatPanel.tsx` movendo a UI de chat (header, viewport, composer básico). O composer detalhado fica em `Composer.tsx` na próxima task.

- [ ] **Step 3:** No render de cada mensagem do assistente, processar o markdown e substituir tokens `[1]`, `[2]`, etc., por `<CitationPopover />` quando `message.meta.sources?.[n]` existir.

- [ ] **Step 4:** Validar que `server/api-handlers/ai-study-chat.ts` retorna `meta.sources: Array<{ index, source_id, title, snippet, page? }>`. Se não, adicionar antes (commit separado de backend).

- [ ] **Step 5:** Commit: `feat(studylab): chat com citações inline numeradas`.

### Task A.4: Composer dedicado com chips de fonte e quick prompts (fixos)

- [ ] **Step 1:** Criar `src/components/studylab/Composer.tsx`:
  - Acima do textarea: chips com fontes ativas, cada chip com `×` para remover.
  - Abaixo do textarea: badges de estado (busca / leitura / escrita) renderizados a partir de eventos do streaming.
  - Quando vazio e sem mensagens: mostrar 5 quick prompts **fixos hardcoded** (serão substituídos por gerados via IA no Bloco B.2):
    1. "Resuma este material em até 5 pontos."
    2. "Quais riscos de segurança estão neste documento?"
    3. "Gere 3 perguntas de fixação sobre este conteúdo."
    4. "Quais procedimentos preciso seguir antes de iniciar?"
    5. "Compare com a versão anterior se houver."

- [ ] **Step 2:** Plugar `Composer` dentro de `ChatPanel`. Clicar num quick prompt preenche o textarea (não envia automaticamente — usuário pode editar).

- [ ] **Step 3:** Commit: `feat(studylab): composer com chips de fonte e 5 quick prompts fixos`.

### Task A.5: Layout 3 colunas e mobile tabs

- [ ] **Step 1:** Criar `src/components/studylab/StudyLabShell.tsx` que orquestra `SourcesPanel | ChatPanel | StudioPanel` (StudioPanel placeholder vazio até o Bloco B).

- [ ] **Step 2:** Desktop ≥1280px: grid `320px minmax(0,1fr) 360px` com botões de colapso individuais nos cabeçalhos das colunas laterais.

- [ ] **Step 3:** Mobile/tablet: `<Tabs value={panel}>` com 3 triggers (Fontes / Chat / Estúdio). Estado em `localStorage` pra reabrir na última aba.

- [ ] **Step 4:** `StudyLab.tsx` vira:
```tsx
import { StudyLabProvider } from "./studylab/StudyLabProvider";
import { StudyLabShell } from "./studylab/StudyLabShell";

export const StudyLab = () => (
  <StudyLabProvider>
    <StudyLabShell />
  </StudyLabProvider>
);
```

- [ ] **Step 5:** Commit: `feat(studylab): layout 3 colunas (sources/chat/studio) com mobile tabs`.

---

## Bloco E — Segundo cérebro (executado ANTES de B)

> **Por que antes do B?** O StudioPanel (Bloco B) consome a biblioteca de MDs gerada aqui. Sem o Bloco E, o B fica sem o "Sincronizado/Desatualizado" real e sem o "Baixar .md".

> **Escopo inicial:** apenas fontes `scope = 'org'`. MDs para `scope = 'user'` ficam como follow-up.

### Task E.0: Fila persistente `study_regen_queue`

- [ ] **Step 1:** Migration adicional `<timestamp>_study_regen_queue.sql`:

```sql
create table public.study_regen_queue (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('source','category','index','glossary')),
  ref_id uuid null,
  category text null,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts int not null default 0,
  last_error text null,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null
);

create unique index study_regen_queue_dedup_idx
  on public.study_regen_queue (type, coalesce(ref_id::text, ''), coalesce(category, ''))
  where status in ('pending','running');

create index study_regen_queue_status_idx on public.study_regen_queue (status, scheduled_at);

alter table public.study_regen_queue enable row level security;
grant all on public.study_regen_queue to service_role;
```

- [ ] **Step 2:** Função `enqueue_regen(p_type, p_ref_id, p_category)` SQL com `insert ... on conflict do update set scheduled_at = now()` (coalesce de duplicados).

- [ ] **Step 3:** Commit: `feat(studylab): fila persistente study_regen_queue`.

### Task E.1: Schema, bucket e RLS

- [ ] **Step 1:** Criar migration `supabase/migrations/<timestamp>_study_knowledge_files.sql`:

```sql
create table public.study_knowledge_files (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('source','category','index','glossary','compendium')),
  ref_id uuid null,
  category text null,
  scope text not null check (scope in ('user','org')),
  owner_user_id uuid null references auth.users(id) on delete cascade,
  org_id uuid null,
  path text not null unique,
  source_hash text null,
  content_hash text not null,
  version int not null default 1,
  bytes int not null,
  generator_model text null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index study_knowledge_files_ref_id_idx on public.study_knowledge_files(ref_id);
create index study_knowledge_files_scope_owner_idx on public.study_knowledge_files(scope, owner_user_id, org_id);

alter table public.study_knowledge_files enable row level security;

create policy "kf_select_user_own"
  on public.study_knowledge_files for select
  using (scope = 'user' and owner_user_id = auth.uid());

create policy "kf_select_org_member"
  on public.study_knowledge_files for select
  using (
    scope = 'org'
    and exists (
      select 1 from public.org_members om
      where om.org_id = study_knowledge_files.org_id and om.user_id = auth.uid()
    )
  );

-- write-only via service_role (Edge Function)
grant select on public.study_knowledge_files to authenticated;
grant all on public.study_knowledge_files to service_role;
```

- [ ] **Step 2:** Criar bucket `knowledge-md` (privado) via Supabase Dashboard ou migration:

```sql
insert into storage.buckets (id, name, public) values ('knowledge-md','knowledge-md', false)
on conflict do nothing;
```

Policies de Storage (somente service_role escreve; leitura via signed URL emitida pelo backend após checar acesso):

```sql
create policy "kf_storage_service_role_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'knowledge-md')
  with check (bucket_id = 'knowledge-md');
```

- [ ] **Step 3:** Aplicar a migration em local primeiro. Validar que `npm run typecheck` continua passando.

- [ ] **Step 4:** Commit: `feat(studylab): schema study_knowledge_files + bucket knowledge-md`.

### Task E.2: Edge Function `regenerate-knowledge-md`

- [ ] **Step 1:** Criar `supabase/functions/regenerate-knowledge-md/index.ts` exportando handler que aceita:
  - `{ type: 'source', ref_id: string }` → regenera 1 source MD.
  - `{ type: 'category', category: string, scope: 'org' | 'user', owner_user_id?: string }` → regenera 1 category MD.
  - `{ type: 'index' | 'glossary' }` → regenera o índice/glossário (todas as fontes acessíveis ao scope solicitado).
  - `{ sweep: true }` → reconcilia todos com `source_hash` diferente de `content_hash`.

- [ ] **Step 2:** Função interna `buildSourceMd(source) -> { md, content_hash }`:
  - Lê `study_sources` + chunks de `studylab_vector_embeddings` (top-K mais representativos).
  - Monta corpo do MD com template: `# Title`, `## Resumo`, `## Outline`, `## Pontos-chave`, `## Termos`, `## Trechos relevantes`, `## Relacionados`.
  - Calcula `content_hash = sha256(md)`.
  - Idempotência: se `content_hash` salvo == novo, atualiza só `generated_at`; senão sobe novo arquivo + incrementa `version`.

- [ ] **Step 3:** Trigger no Postgres em `study_sources` filtra `scope = 'org'` e chama `enqueue_regen(...)` para a fonte + propagar para category/index/glossary daquela categoria.

- [ ] **Step 4:** Cron a cada 1 min (Vercel Cron ou Supabase Scheduled Functions) chama `regenerate-knowledge-md` com `{ drain_queue: true }`: pega até N=20 jobs `pending`, marca `running`, processa, marca `done` ou `failed` com `last_error`. Retry exponencial com `attempts` (até 5).

- [ ] **Step 5:** Cron noturno às 03:00 BRT chama `{ sweep: true }` para enfileirar divergências `source_hash` ≠ `content_hash`.

- [ ] **Step 5:** Logs estruturados: cada execução grava `{ type, ref_id, content_hash, version, bytes, duration_ms }` em uma tabela `study_knowledge_logs` (criar junto, simples). Útil para auditoria.

- [ ] **Step 6:** Validar local: alterar uma fonte `org` e ver o `.md` no bucket em < 90s (cron 1min + processamento).

- [ ] **Step 7:** Teste de carga: importar 200 fontes via `scripts/import-lipowerline-studylab.mjs` e confirmar que a fila drena sem duplicatas e sem timeout, com `study_regen_queue.attempts` reportando ≤ 2 para qualquer job.

- [ ] **Step 8:** Commit: `feat(studylab): edge function regenerate-knowledge-md + consumo de fila`.

### Task E.3: Bibliotecário completo — index, glossary, category MDs

- [ ] **Step 1:** Implementar `buildCategoryMd(category, scope)`:
  - Lista fontes da categoria com tabela (título, tópico, scope, last update).
  - Parágrafo de visão geral via OpenAI Responses (modelo FAST do `.env.example`).
  - Cross-references com wiki-links: `[[source/abc-123]]`.

- [ ] **Step 2:** Implementar `buildIndexMd(scope)`:
  - Estatísticas: total por categoria, top tópicos, fontes recém-adicionadas (últimos 7 dias).
  - Mapa de wiki-links para todos os `category/*.md`.
  - Link para `glossary.md`.

- [ ] **Step 3:** Implementar `buildGlossaryMd(scope)`:
  - Extrai termos via OpenAI Responses ou heurística simples (NER + filtros).
  - Cada termo lista as fontes que o mencionam.

- [ ] **Step 4:** Trigger de propagação: regenerar 1 source dispara regeneração de category, index, glossary daquele scope (debounce 30s, coalesce).

- [ ] **Step 5:** Validar manualmente: subir 3 fontes em categorias diferentes, conferir que `index.md`, `glossary.md` e os `category/*.md` foram gerados/atualizados.

- [ ] **Step 6:** Commit: `feat(studylab): bibliotecário completo (index, glossary, category MDs)`.

---

## Bloco B — StudyLab: Studio (coluna direita) consome a biblioteca

### Task B.1: `StudioPanel` lê `study_knowledge_files`

- [ ] **Step 1:** Criar `src/components/studylab/StudioPanel.tsx` com seções:
  - "Biblioteca desta conversa" — lista os `study_knowledge_files` relacionados às fontes ativas, com badge `Sincronizado`/`Desatualizado` (compara `source_hash` salvo vs `source_hash` atual da fonte).
  - "Saídas geradas" — Compêndios + briefings da conversa.
  - Botão "Baixar .md" por item — chama endpoint que retorna signed URL com TTL 15min.
  - Botão "Copiar como contexto" — concatena os MDs selecionados em um único bloco com separadores `---`.
  - Botão "Gerar quiz a partir destas fontes" — navega para Studio > Criar quiz > IA, com `source_ids` no `location.state`.
  - Para staff: "Forçar reindex desta fonte" + "Reindex completo do scope".

- [ ] **Step 2:** Criar endpoint `api/knowledge-md.ts` que recebe `?path=source/<id>.md` e retorna signed URL após verificar acesso (RLS) — não expor path direto.

- [ ] **Step 3:** Commit: `feat(studylab): studio panel consome biblioteca de MDs com sync status`.

### Task B.2: Quick prompts gerados por IA (substitui fixos do A.4)

- [ ] **Step 1:** Endpoint `api/study-quick-prompts.ts` que recebe `source_ids[]` e retorna 5 prompts contextuais. Cache em tabela leve `study_quick_prompts_cache(hash, prompts_json, generated_at)` com TTL de 24h por `hash = sha256(sorted source_ids)`.

- [ ] **Step 2:** No `Composer.tsx`, quando `activeSources.length > 0` e `messages.length === 0`, buscar do endpoint; fallback para os 5 fixos do A.4 se a chamada falhar ou demorar > 800ms.

- [ ] **Step 3:** Commit: `feat(studylab): quick prompts gerados por IA com cache 24h`.

---

## Bloco C — Quiz Generator: unificar fluxos

### Task C.1: Entry point único no Studio

- [ ] **Step 1:** Em `src/pages/Studio.tsx`, criar a entrada "Criar quiz" que abre Dialog com 2 botões grandes:
  - "Gerar com IA a partir de fontes" → `AiQuizFlow`.
  - "Criar manualmente" → `QuizCreationWizard`.

- [ ] **Step 2:** Manter as rotas atuais `quiz` e `ai-quiz` funcionando, mas o card "AI Quiz" do StudioDashboard sai e fica só "Criar quiz".

- [ ] **Step 3:** Commit: `feat(studio): entry point único de criação de quiz (IA × manual)`.

### Task C.2: `AiQuizFlow` reaproveita `SourcesPanel`

- [ ] **Step 1:** Criar `src/components/quiz/AiQuizFlow.tsx` com layout 2 colunas:
  - Esquerda 380px: `SourcesPanelCore` (reaproveitado do StudyLab) + parâmetros (tipo, qtd, dificuldade).
  - Direita 1fr: preview das perguntas conforme aparecem por streaming.

- [ ] **Step 2:** Estado próprio: `useState` local + leitura de `source_ids` do `location.state` se vier do StudyLab.

- [ ] **Step 3:** Substituir as 3 Tabs (Catálogo / Compêndio / Online) por:
  - Toggle "Adicionar Compêndio" e "Adicionar URLs" como expansões dentro do mesmo painel.
  - Tabs viram acordeão único para reduzir clique.

- [ ] **Step 4:** Manter `XP_TIERS` mas adicionar slider "Mix de dificuldades" que distribui `% Básico / Intermediário / Avançado / Especialista`.

- [ ] **Step 5:** Commit: `feat(quiz): fluxo de IA com fontes do StudyLab e mix de dificuldades`.

### Task C.3: Preview com evidência por pergunta

- [ ] **Step 1:** Criar `src/components/quiz/QuestionWithEvidence.tsx`:
  - Card por pergunta com question_text, options, correct_letter, explanation.
  - Botão "Por que esta pergunta?" abre popover com `evidence.snippet` + link para fonte (`evidence.source_id`, `evidence.page?`).

- [ ] **Step 2:** Validar que `server/api-handlers/ai-study-quiz.ts` retorna `evidence` por pergunta. Se não, adicionar campo no payload (commit separado de backend).

- [ ] **Step 3:** Commit: `feat(quiz): preview com 'porquê' e evidência da fonte por pergunta`.

### Task C.4: Painel de qualidade automático

- [ ] **Step 1:** Criar `src/components/quiz/QuizQualityBadges.tsx` com regras client-side:
  - `explicação curta`: `explanation.length < 80`.
  - `opção muito longa`: `Math.max(...options.map(o => o.length)) > 160`.
  - `opções desbalanceadas`: diferença entre min e max length > 80.
  - `correta ambígua`: heurística — 2 opções com similaridade alta (Jaccard simples sobre palavras).
  - `pergunta sem evidência`: `!evidence`.

- [ ] **Step 2:** Renderizar badges no `QuestionWithEvidence` quando houver problema. Curador pode dispensar manualmente.

- [ ] **Step 3:** Commit: `feat(quiz): badges automáticos de qualidade por pergunta`.

### Task C.5: "Editar manualmente" passa as questões para o wizard

- [ ] **Step 1:** No fim do `AiQuizFlow`, botão "Editar manualmente" leva ao `QuizCreationWizard` com as questões pré-carregadas via `location.state`.

- [ ] **Step 2:** Em `QuizCreationWizard.tsx`, aceitar `location.state.draftQuestions` e popular o form.

- [ ] **Step 3:** Commit: `feat(quiz): handoff do AI flow para wizard manual com questões prontas`.

---

## Bloco D continuação — Encerramento do refactor

### Task D.2: Wrappers finos e ADR

- [ ] **Step 1:** Reduzir `src/components/StudyLab.tsx` para ≤ 30 linhas (apenas Provider + Shell).

- [ ] **Step 2:** Reduzir `src/components/AiQuizGenerator.tsx` para ≤ 30 linhas (apenas `AiQuizFlow`).

- [ ] **Step 3:** Criar `docs/superpowers/specs/2026-05-XX-studylab-quiz-decomposition-adr.md` documentando a decisão (skill: `engineering:architecture`).

- [ ] **Step 4:** Commit: `refactor(studylab,quiz): finaliza decomposição e registra ADR`.

---

## Validação por bloco

Após cada bloco, executar:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

E manualmente:

- StudyLab abre em desktop e mobile sem erros no console.
- Enviar mensagem com 0 fontes ativas → resposta geral.
- Enviar mensagem com 2 fontes ativas → resposta cita `[1]` e `[2]` que abrem o trecho.
- Renomear sessão no histórico persiste.
- Gerar quiz a partir do StudyLab leva fontes selecionadas para o `AiQuizFlow`.
- Quiz gerado mostra evidência por pergunta + badges de qualidade quando aplicável.

---

## Phase 2 (não bloqueia este plano — backlog explícito)

> Executar somente após este plano concluído, validado em produção, e aprovação adicional.

### Phase 2.1: Página `/settings/integrations` para tokens MCP

- [ ] Criar tabela `user_integration_tokens(id, user_id, name, token_hash, scopes[], created_at, last_used_at, expires_at)`.
- [ ] UI em Settings com criar/listar/revogar.

### Phase 2.2: Endpoint MCP `mcp://djt-quest`

- [ ] Servidor MCP minimal (Cloudflare Worker ou Deno deploy) com 2 tools:
  - `list_sources({ category?, scope? })`.
  - `read_source_md({ id })`.
- [ ] Auth bearer + rate-limit (60 req/min/token).
- [ ] Logs de auditoria por acesso em `mcp_access_log`.

### Phase 2.3: Documentação de uso

- [ ] Guia em `docs/mcp-second-brain.md` ensinando como conectar Cursor / Claude Desktop / ChatGPT ao segundo cérebro da org.

---

## Critérios globais de pronto

- [ ] Zero regressões funcionais comparadas ao estado atual em produção.
- [ ] `StudyLab.tsx` e `AiQuizGenerator.tsx` viraram wrappers ≤ 30 linhas.
- [ ] Nenhuma dependência nova no `package.json` do frontend.
- [ ] Cada commit do refactor passa em `npm run gate`.
- [ ] PRs ≤ 500 linhas de diff.
- [ ] Tabela `study_knowledge_files` com RLS validada por testes mínimos.
- [ ] Bucket `knowledge-md/` nunca acessível por path direto (só via endpoint que verifica acesso).
- [ ] Edge Function `regenerate-knowledge-md` é idempotente e tolera falhas parciais (1 source falha não trava o batch).
- [ ] Bibliotecário completo: `index.md`, `glossary.md`, `category/*.md`, `source/*.md` gerados para o escopo `org` e por usuário para `user`.
- [ ] ADR registrado.
