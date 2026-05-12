# Design: Reforma de UX/UI do StudyLab e do Gerador de Quizzes

**Data:** 2026-05-11
**Status:** Aprovado
**Escopo:** UX/UI overhaul do StudyLab (visual e mental model ChatGPT + NotebookLM), unificação do AiQuizGenerator (Studio) e materialização do Compêndio como "segundo cérebro" em Markdown — acessível por ferramentas externas via Storage privado e, em Phase 2, via endpoint MCP.

---

## Problema

### StudyLab
`src/components/StudyLab.tsx` tem 2.768 linhas, 81 hooks, e mistura chat, catálogo, histórico, anexos, voice e modos em um único componente. Sintomas:

- **Mental model invertido vs NotebookLM:** "Modo catálogo OFF" = falar com 1 material; "Modo catálogo ON" = falar com toda a base. Usuário não pensa assim. NotebookLM = você adiciona fontes ao notebook e o chat usa o que está dentro.
- **Catálogo overlay (Sheet):** sai do chat para consultar a fonte, quebra leitura paralela.
- **Histórico raso:** sem busca, sem agrupamento por data, sem renomear/fixar.
- **3 switches concorrentes** (catálogo / web / hashtag focus) sem explicar o efeito na resposta.
- **Sem citação inline** apesar de a infra de indexação por página (`studylab_pdf_page_indexing`) já existir no backend.
- **Composer pobre:** sem prompts sugeridos, sem indicação de o que está acontecendo durante o streaming.
- **2.768 linhas em um componente** trava qualquer mudança e gera regressões.

### Gerador de Quizzes
`AiQuizGenerator.tsx` (1.346 linhas) e `QuizCreationWizard.tsx` (2.245 linhas) coexistem no Studio sem hierarquia clara. Sintomas:

- **Dois caminhos paralelos** (`quiz` manual e `ai-quiz`) sem onboarding que explique quando usar qual.
- **Wizard linear** força volta-e-volta para trocar fonte ou tema.
- **Picker de fontes reimplementado** — duplica o catálogo do StudyLab; mantém duas verdades.
- **Sem "porquê" da pergunta:** nenhuma UI mostra qual trecho gerou cada questão. Curador não consegue auditar a IA.
- **Switches dispersos** (KB, vigentes, mostrar antigos, online) repetem a doença do StudyLab.
- **Dificuldade hardcoded** em XP_TIERS — não dá pra misturar dificuldades num mesmo conjunto.
- **Sem painel de qualidade do output** — não sinaliza ambiguidade, explicação curta, ou opções com tamanho desbalanceado.

---

## Princípios da reforma

1. **Mental model NotebookLM:** fontes são objetos persistentes do "notebook"; chat usa as fontes ativas. Não há mais "modo".
2. **Mental model ChatGPT:** thread como cidadão de primeira classe — sidebar persistente com busca, grupos por data, renomear, fixar.
3. **Layout 3 colunas (desktop):** `Sources | Chat | Studio`. Cada coluna é colapsável. Mobile vira tabs deslizantes.
4. **Citação inline obrigatória** em qualquer resposta com âncoras numeradas que abrem o trecho da fonte.
5. **Quiz se conecta ao StudyLab:** mesmo picker de fontes, mesmas categorias, mesmas vigências. Uma única verdade.
6. **Decomposição cirúrgica:** o monolito vira `StudyLabShell + StudyLabSources + StudyLabChat + StudyLabStudio + StudyLabHistory` com um provider de estado compartilhado. Mesmo princípio para o AiQuizGenerator.
7. **Segundo cérebro materializado:** todo conteúdo curado vira `.md` com frontmatter, organizado como uma biblioteca (fonte, categoria, índice geral). Sempre atualizado em background, transparente ao usuário do app, exportável por ferramentas externas (Storage privado agora, MCP em Phase 2).
8. **Quick prompts evolutivos:** começam fixos no composer (Bloco A.4) e migram para gerados por IA conforme as fontes ativas (Bloco B), com cache de 24h por conjunto.

---

## Bloco A — StudyLab: layout 3 colunas e mental model

**Arquivos novos:**
- `src/components/studylab/StudyLabShell.tsx` — orquestra layout, atalhos, mobile/desktop.
- `src/components/studylab/StudyLabProvider.tsx` — contexto com `activeSources[]`, `messages[]`, `sessionId`, `flags { web, kbFocus }`.
- `src/components/studylab/SourcesPanel.tsx` — coluna esquerda.
- `src/components/studylab/ChatPanel.tsx` — coluna central.
- `src/components/studylab/StudioPanel.tsx` — coluna direita (Compêndio, briefings, etc).
- `src/components/studylab/HistoryDrawer.tsx` — sheet mobile / popover desktop com agrupamento por data.

**Mudanças:**

1. **Remover "Modo catálogo"** — substituir por: usuário marca fontes ativas no `SourcesPanel`. Sem fonte = chat geral; com fonte = grounded. Sem switch.
2. **Sidebar esquerda persistente** com lista de fontes ativas marcadas (checkbox), filtro por categoria/tópico, search, botão "+ Adicionar" no topo. Cards mostram tipo (PDF/URL/Texto), título, tags, último uso.
3. **Histórico vira drawer com agrupamento temporal** ("Hoje", "Ontem", "Esta semana", "Mais antigo") + search + ações por item (renomear, fixar, deletar).
4. **Composer com chips de fonte ativa** logo acima do textarea ("Falando com: 3 fontes [x] [x] [x]") e quick prompts contextuais quando vazio.
5. **Citação inline:** mensagens do assistente passam a renderizar `[1]`, `[2]` clicáveis que abrem popover com trecho + link para fonte. Backend já retorna `meta.sources` no payload do `ai-study-chat.ts`.
6. **Streaming visível:** badge "buscando na base", "lendo PDF página X", "escrevendo" — eventos já vêm do backend, só falta UI.

**Não-objetivos do Bloco A:**
- Não criar novas APIs.
- Não mudar schema de `study_sources`.
- Não tocar no RAG do backend.

---

## Bloco B — StudyLab: Studio (coluna direita) como janela do segundo cérebro

**Arquivos:**
- Modificar: `src/components/studylab/StudioPanel.tsx`
- Aproveitar: `CompendiumPicker.tsx` (já existe)

O StudioPanel é a **janela do usuário para o segundo cérebro** definido no Bloco E. O Compêndio não é mais "saída sob demanda" — é uma camada viva mantida em background; o painel apenas mostra o estado dela e permite acionar geração de saídas derivadas.

**Mudanças:**

1. **Saídas geradas vivem junto do chat:** Compêndio, briefing, mapa mental, FAQ, sumário executivo viram cards no `StudioPanel` — não em outra tela.
2. **Cada saída tem hash da seleção** para detectar staleness ("este briefing foi gerado quando você tinha 5 fontes ativas; agora tem 7"). O hash vem do Bloco E (vide `source_hash` no frontmatter).
3. **Botão "Gerar quiz a partir destas fontes"** abre o AiQuizGenerator pré-preenchido com as fontes selecionadas no StudyLab.
4. **Botão "Copiar como contexto"** por fonte/categoria — concatena os `.md` do segundo cérebro em um único bloco copiável para colar em ChatGPT/Claude/Cursor.
5. **Badge "Sincronizado / Desatualizado"** em cada saída/fonte, alimentado pelo job de regeneração do Bloco E.
6. **Quick prompts gerados por IA** a partir das fontes ativas (com cache de 24h por hash de seleção) substituem os fixos do A.4.

---

## Bloco C — Quiz Generator: unificar fluxos e usar fontes do StudyLab

**Arquivos:**
- Modificar: `src/components/AiQuizGenerator.tsx` (depois decomposto em `quiz/` similar ao StudyLab).
- Modificar: `src/components/QuizCreationWizard.tsx` (permanece para edição manual).
- Modificar: `src/pages/Studio.tsx` — hierarquia clara entre fluxos.

**Mudanças:**

1. **Um único entry point no Studio:** "Criar quiz" → pergunta IA ou manual → manual abre `QuizCreationWizard`, IA abre o novo `AiQuizFlow`.
2. **`AiQuizFlow` reaproveita `SourcesPanel`** do StudyLab — mesmo picker, mesmas vigências, mesma busca.
3. **Layout dual:** esquerda = fontes ativas + parâmetros (tipo, qtd, dificuldade); direita = preview das perguntas geradas conforme aparecem (streaming).
4. **Painel de qualidade por pergunta:** badges automáticos — "explicação curta", "opção muito longa", "correta ambígua" (verificadas no client com regras simples). Curador edita inline.
5. **"Porquê desta pergunta":** cada pergunta gerada exibe o trecho da fonte que a inspirou (já vem do backend em `ai-study-quiz.ts` via `evidence`). Clique abre a fonte na posição.
6. **Mix de dificuldades:** permitir slider por bloco em vez de tier único.
7. **Reaproveitar o wizard manual:** "Editar manualmente" no fim do AI flow joga as questões geradas no `QuizCreationWizard` para revisão final.

---

## Bloco E — Segundo cérebro: knowledge MDs (biblioteca em Markdown)

**Visão:** todo material curado do StudyLab é continuamente materializado como `.md` com frontmatter, organizado como uma biblioteca real, e disponibilizado para consumo por outras IAs/ferramentas. Transparente para o usuário do app: ele vê o Compêndio funcionando "naturalmente"; nos bastidores, um job mantém a biblioteca sempre atualizada.

### Arquitetura do segundo cérebro

**Armazenamento:** bucket Supabase Storage privado `knowledge-md/` (signed URLs com TTL curto quando necessário). Phase 2 adiciona endpoint MCP (`mcp://djt-quest`) por cima do mesmo storage.

**Granularidade — organização de bibliotecário:**

```
knowledge-md/
├── index.md                              # mapa geral: contagem, categorias, últimas atualizações
├── glossary.md                           # termos extraídos automaticamente, com link para fontes
├── category/
│   ├── manuais.md                        # índice da categoria + cross-references
│   ├── procedimentos.md
│   ├── apostilas.md
│   ├── relatorio-ocorrencia.md
│   ├── auditoria-interna.md
│   ├── auditoria-externa.md
│   └── outros.md
├── source/
│   ├── <source_id>.md                    # 1 arquivo por fonte (verdade canônica)
│   └── ...
└── compendium/
    ├── <compendium_id>.md                # compêndios curados continuam, viram MD
    └── ...
```

**Frontmatter padrão (YAML):**

```yaml
---
type: source | category | index | glossary | compendium
id: <uuid>
slug: <kebab-case>
title: <string>
category: MANUAIS | PROCEDIMENTOS | APOSTILAS | ...
topic: <topic_key | null>
scope: user | org
tags: [<string>, ...]
related: [<source_id>, ...]   # wiki-links internos
source_hash: <sha256>          # hash do conteúdo da fonte de origem
content_hash: <sha256>         # hash do próprio MD gerado
generated_at: <ISO datetime>
version: <int>                 # incrementa a cada regeneração que mudou content_hash
generator_model: <string>      # ex: gpt-5-2025-08-07
---
```

**Corpo do `source/<id>.md`** segue template fixo: `# Title`, `## Resumo`, `## Outline`, `## Pontos-chave`, `## Termos`, `## Trechos relevantes` (com âncoras de página quando PDF), `## Relacionados` (wiki-links).

**Corpo do `category/<cat>.md`:** índice navegável com tabela (título, tópico, escopo, last update, link) + parágrafo de visão geral gerado por IA.

**Corpo do `index.md`:** mapa do segundo cérebro inteiro com estatísticas (totais por categoria, top tópicos, fontes recém-adicionadas) e índice de wiki-links para os category MDs.

**Corpo do `glossary.md`:** termos extraídos das fontes (entidades, siglas, conceitos), cada um com link para as fontes que o mencionam.

### Sincronização

- **Fila persistente `study_regen_queue`** (decisão: caminho robusto): trigger em `study_sources` só faz `insert into study_regen_queue (...)`. A Edge Function `regenerate-knowledge-md` consome em lotes, com retry exponencial. Aguenta importação em massa sem soluçar.
- **Coalescer:** se já existe job pendente para a mesma `(type, ref_id)`, o trigger só atualiza `updated_at` em vez de inserir duplicado.
- **Sweep noturno:** cron job verifica `source_hash` vs `content_hash` e enfileira o que está fora de sincronia.
- **Botão admin "Forçar reindex"** no StudioPanel (visível para staff) para enfileirar manualmente.
- **Sobrescreve** com `version` incrementando quando `content_hash` muda. Sem arquivo histórico (decisão: sobrescrever).

### Escopo inicial (decisão: começar só `org`)

A primeira versão materializa MDs apenas para fontes com `scope = 'org'`. Cobre o segundo cérebro corporativo (foco principal). MDs para `scope = 'user'` ficam como follow-up sem data fixa — adicionados se houver demanda real, evitando multiplicar artefatos enquanto não há sinal de uso.

### Segurança

- Bucket `knowledge-md/` é privado. Acesso via signed URLs com TTL ≤ 15min, gerados sob demanda pelo backend após checar `scope` da fonte.
- MDs com `scope: user` só acessíveis ao dono; `scope: org` acessíveis aos membros da org.
- Endpoint MCP de Phase 2 exige bearer token de longa duração, gerado pelo usuário em uma página `/settings/integrations` (fora do escopo deste plano, fica como "pré-requisito da Phase 2").

### Schema novo (exceção justificada)

Tabela `study_knowledge_files`:

```sql
create table public.study_knowledge_files (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('source','category','index','glossary','compendium')),
  ref_id uuid null,                       -- source_id, compendium_id, ou null para index/glossary
  category text null,                     -- preenchido para type='category'
  scope text not null check (scope in ('user','org')),
  owner_user_id uuid null references auth.users(id) on delete cascade,
  org_id uuid null,
  path text not null unique,              -- ex: source/abc-123.md
  source_hash text null,
  content_hash text not null,
  version int not null default 1,
  bytes int not null,
  generator_model text null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: select por scope+owner/org; insert/update/delete só pelo service_role.
```

### Edge Function nova

`supabase/functions/regenerate-knowledge-md/index.ts`:
- Recebe `{ type, ref_id }` ou `{ sweep: true }`.
- Lê fonte(s), monta MD com template, sobe pro Storage, faz upsert em `study_knowledge_files`.
- Dispara recálculo dos agregados afetados.
- Idempotente: se `content_hash` não mudou, só atualiza `generated_at` (não incrementa version).

### UI no StudioPanel (visível para o usuário)

- Lista de saídas com badge **Sincronizado** (verde) / **Desatualizado** (âmbar).
- Botão "Baixar .md" por fonte (signed URL).
- Botão "Copiar como contexto" — concatena MDs da seleção atual em um bloco gigante com separadores `---`, pronto para colar.
- Para staff: botão "Forçar reindex desta fonte" / "Reindex completo".

### Phase 2 (não bloqueia este plano)

Endpoint MCP `mcp://djt-quest` expõe 2 tools:
- `list_sources({ category?, scope? })` → lista de `{ id, title, slug, category, updated_at }`.
- `read_source_md({ id })` → corpo do MD + frontmatter.

Auth: bearer token gerado pelo usuário em `/settings/integrations`. Isso permite Cursor/Claude Desktop/ChatGPT conectarem direto no segundo cérebro da org.

---

## Bloco D — Decomposição técnica

**Objetivo:** quebrar os 2 monolitos sem quebrar funcionalidade.

**Abordagem:**
1. Criar pasta `src/components/studylab/` e `src/components/quiz/` com os sub-componentes vazios.
2. Mover lógica em "fatias horizontais" (estado → handlers → JSX), commit por fatia.
3. Manter `StudyLab.tsx` e `AiQuizGenerator.tsx` como wrappers finos que importam dos novos arquivos, até o último commit que renomeia para `StudyLabShell` / `AiQuizFlow`.
4. Cada PR ≤ 500 linhas de diff. ADR no fim documentando a decisão.

---

## Arquitetura

- **Backend de RAG inalterado.** `study_sources`, `study_chat_sessions`, `study_chat_messages`, `studylab_vector_embeddings`, `studylab_pdf_page_indexing` permanecem.
- **Uma tabela nova justificada:** `study_knowledge_files` (vide Bloco E) para indexar a biblioteca de MDs. RLS estrita por `scope`.
- **Uma Edge Function nova:** `regenerate-knowledge-md` (vide Bloco E).
- **Um bucket Storage novo:** `knowledge-md/` privado, com path estável.
- **APIs de chat ajustadas pontualmente:** `ai-study-chat` passa a aceitar `source_ids[]` mantendo retrocompatibilidade. `ai-study-quiz` passa a retornar `evidence` por pergunta se ainda não retorna.
- **Sem dependências novas no frontend.** Tudo via shadcn/ui + Radix + Tailwind já no projeto.
- **Provider de estado**: `useContext` simples (não Zustand/Jotai) — escopo local da feature.
- **Phase 2:** endpoint MCP por cima do Storage. Adiciona dependência de um servidor MCP minimal (ex: Cloudflare Worker ou Deno deploy); fica como pré-requisito separado.

---

## Ordem de execução

1. **D.1** scaffold: pastas `studylab/` e `quiz/` + provider vazio (componente atual segue renderizando).
2. **A.1** `HistoryDrawer` com busca + agrupamento + renomear/fixar.
3. **A.2** `SourcesPanel` + eliminação do "Modo catálogo" + payload `source_ids[]` no backend.
4. **A.3** `ChatPanel` com citação inline.
5. **A.4** `Composer` com chips de fonte + quick prompts **fixos**.
6. **A.5** Shell 3 colunas (desktop) + tabs (mobile).
7. **E.1** Schema `study_knowledge_files` + bucket `knowledge-md/` + RLS.
8. **E.2** Edge Function `regenerate-knowledge-md` + trigger por mudança + sweep noturno.
9. **E.3** `index.md`, `glossary.md`, `category/*.md` (bibliotecário completo desde o início).
10. **B.1** `StudioPanel` consome a biblioteca + botões "Baixar .md" / "Copiar como contexto" + "Gerar quiz".
11. **B.2** Quick prompts gerados por IA (substitui os fixos do A.4) com cache 24h por hash de seleção.
12. **C.1** Entry point único de criação de quiz no Studio.
13. **C.2** `AiQuizFlow` reaproveita `SourcesPanel`.
14. **C.3** Preview com evidência por pergunta.
15. **C.4** Badges de qualidade automáticos.
16. **C.5** Handoff IA → wizard manual.
17. **D.2** Wrappers finos + ADR.
18. **Phase 2 (separado):** endpoint MCP + página `/settings/integrations` para tokens.

Cada item é um PR independente com `engineering:code-review` antes de mergear.

---

## Critérios de sucesso

### StudyLab
- [ ] Layout 3 colunas em desktop ≥1280px, com colapso individual.
- [ ] Mobile com tabs deslizantes (Sources / Chat / Studio).
- [ ] "Modo catálogo" eliminado; substituído por seleção de fontes ativas.
- [ ] Histórico com search e agrupamento por data.
- [ ] Mensagens do assistente com citações `[n]` clicáveis.
- [ ] Composer mostra chips de fontes ativas + quick prompts quando vazio.
- [ ] `src/components/StudyLab.tsx` ≤ 200 linhas (wrapper) ao final.

### Quiz Generator
- [ ] Entry point único no Studio com escolha IA × manual.
- [ ] AI flow usa o mesmo `SourcesPanel` do StudyLab.
- [ ] Cada pergunta gerada exibe trecho-fonte ("porquê").
- [ ] Painel de qualidade com badges automáticos por pergunta.
- [ ] Dificuldade pode ser mista (slider por bloco).
- [ ] `AiQuizGenerator.tsx` ≤ 200 linhas (wrapper) ao final.

### Segundo cérebro (Bloco E)
- [ ] Bucket `knowledge-md/` privado criado com RLS funcionando.
- [ ] Tabela `study_knowledge_files` criada com RLS por scope.
- [ ] Edge Function `regenerate-knowledge-md` deployada.
- [ ] Trigger automático: alterar/criar/deletar fonte gera/atualiza `source/<id>.md` em < 60s.
- [ ] Estrutura completa de bibliotecário gerada: `index.md`, `glossary.md`, `category/*.md`.
- [ ] Frontmatter padronizado em todos os MDs.
- [ ] Botão "Baixar .md" gera signed URL com TTL ≤ 15min.
- [ ] Botão "Copiar como contexto" produz bloco concatenado pronto para colar.
- [ ] Sweep noturno reconcilia hashes e reprocessa divergências.

### Técnico
- [ ] Nenhuma regressão funcional vs hoje (chat, upload, geração de quiz).
- [ ] Zero novas dependências de frontend.
- [ ] Cada PR ≤ 500 linhas de diff.
- [ ] ADR registrado em `docs/superpowers/specs/` ao final do refactor.

---

## Riscos e mitigação

- **Quebrar sessões de chat ativas durante refactor.** Mitigação: manter `study_chat_sessions` schema intacto; refactor de UI é puramente client.
- **Citação inline depende de campo `meta.sources` consistente do backend.** Mitigação: validar em uma fatia anterior ao Bloco A.3; se faltar, fatia extra no backend antes.
- **Reaproveitamento do `SourcesPanel` no quiz pode acoplar demais.** Mitigação: extrair `SourcesPanelCore` puro (sem estado de chat) que ambos os shells consomem.
- **Custo de regeneração de MDs em rajadas.** Mitigação: debounce 30s + coalescer mudanças da mesma fonte + idempotência por `content_hash`. Sweep noturno como rede de segurança.
- **Storage crescendo descontrolado.** Mitigação: política de sobrescrita (sem histórico), eviction de MDs órfãos (cuja fonte foi deletada) no sweep, métrica de bytes no painel admin.
- **Vazamento de MDs `org` para usuários sem acesso.** Mitigação: RLS estrita em `study_knowledge_files`, signed URLs com TTL curto gerados só após reverificar acesso no backend, nunca exposto via path direto público.
- **Drift entre conteúdo RAG e MDs.** Mitigação: `source_hash` no frontmatter referencia o conteúdo da fonte; `index.md` reporta divergências.
- **Phase 2 MCP introduz superfície de ataque externa.** Mitigação: tokens com escopo mínimo, rotacionáveis, rate-limiting no endpoint, logs de auditoria por acesso.
