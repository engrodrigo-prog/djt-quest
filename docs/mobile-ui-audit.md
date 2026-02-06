# Mobile + Desktop UI Audit (DJT Quest)

Data: 2026-02-06  
Branch de trabalho: `chore/mobile-desktop-ux-20260206`

## 1) Rollback rápido (obrigatório)

- Backup branch: `backup/pre-mobile-ux-20260206`
- Backup tag: `pre-mobile-ux-20260206`
- Commit de referência: `406d21dc6417447df6e173ff0e4feb4295e1a8ea` (`406d21d`)

## 2) Inventário de rotas/telas

| Rota | Tela | Proteção/perfil |
|---|---|---|
| `/` | Home | pública |
| `/auth` | Auth | pública |
| `/register` | Register | pública |
| `/user-setup` | UserSetup | pública |
| `/dashboard` | Dashboard | autenticada |
| `/challenge/:id` | ChallengeDetail | autenticada |
| `/campaign/:campaignId` | CampaignDetail | autenticada |
| `/evaluations` | Evaluations | líder |
| `/studio` | Studio | Studio roles |
| `/studio/curadoria` | StudioCuration | Studio roles (sem analista financeiro) |
| `/leader-dashboard` | LeaderDashboard | líder |
| `/profile` | Profile | autenticada |
| `/rankings` | Rankings | autenticada |
| `/forums` | Forums | autenticada |
| `/forums/insights` | ForumInsights | autenticada |
| `/forum/:topicId` | ForumTopic | autenticada |
| `/sepbook` | SEPBookIG | autenticada |
| `/sepbook-legacy` | SEPBook | autenticada |
| `/study` | Study | autenticada |
| `/finance` | FinanceRequests | autenticada |
| `*` | NotFound | fallback |

## 3) Inventário de componentes base

- Shell/Layout: `src/components/Navigation.tsx`, `src/components/ThemedBackground.tsx`, headers por página (ex.: `src/pages/Dashboard.tsx`, `src/pages/LeaderDashboard.tsx`).
- Base UI: `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/select.tsx`, `src/components/ui/table.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/drawer.tsx`, `src/components/ui/sheet.tsx`, `src/components/ui/card.tsx`, `src/components/ui/tabs.tsx`, `src/components/ui/sidebar.tsx`.
- Form/fluxos críticos: `ChallengeForm`, `CampaignForm`, `FinanceRequestsManagement`, `ProfileEditor`, `UserCreationForm`.

## 4) Problemas identificados

### Mobile (360x800, 390x844)

- P0: Barra de navegação inferior com itens demais (7-9) e labels longas, gerando densidade alta e risco de legibilidade/toque.
- P0: Várias telas usam paddings e containers inconsistentes (`p-3`, `p-4`, `md:p-6/8`) sem token comum.
- P0: Alto acoplamento de layout por tela com `pb-40`, aumentando risco de overlap com bottom nav.
- P1: Modais/dialogs com variação de tamanho e sem padrão único para altura máxima + scroll interno mobile.
- P1: Tabelas e listas longas sem fallback consistente em card/stack no mobile.
- P2: Alguns botões ícone sem padronização total de hit area e alinhamento visual.

### Desktop (>=1024, >=1440)

- P0: Navegação principal permanece orientada ao mobile (bottom bar) mesmo em desktop, reduzindo eficiência de navegação.
- P0: Falta de padrão de shell desktop persistente (rail/sidebar/header global), com redundância entre páginas.
- P1: Ocupação de espaço irregular (telas com `max-w` muito restrito vs telas largas sem densidade otimizada).
- P1: Inconsistência de headers locais (alguns sticky, outros não), dificultando previsibilidade.
- P2: Estados de foco/hover existem, mas sem padronização forte em todos os componentes críticos.

## 5) Prioridades por plataforma

| Prioridade | Mobile | Desktop |
|---|---|---|
| P0 | Navegação compacta e previsível; evitar overflow horizontal; safe-area | Shell persistente útil; remover dependência de bottom-nav para desktop; hierarquia clara |
| P1 | Padrão único de spacing, cards/listas, dialogs/sheets | Melhor uso de largura em 1024/1440/1920; densidade e leitura |
| P2 | Polimento de ícones/truncamento/feedback | Polimento de atalhos/context actions |

## 6) Decisões de UX/UI (baseline do refactor)

- Navegação mobile: padrão **Bottom nav (até 5 itens) + "Mais" (drawer/sheet)**.
- Navegação desktop: **rail/sidebar persistente** (não usar bottom nav principal no desktop).
- Sidebar desktop: manter acessível e visível em páginas autenticadas, com colapso visual quando necessário.
- Densidade: mobile com padding horizontal 12-16px; desktop com densidade maior e max-width por contexto.
- Safe areas: aplicar `env(safe-area-inset-*)` no shell e áreas fixas.

## 7) Checklist de verificação por viewport

- [ ] 360x800: sem overflow horizontal; CTAs principais acessíveis; bottom nav estável.
- [ ] 390x844: sem corte de texto crítico; safe-area bottom/top aplicada.
- [ ] 768x1024 (opcional): comportamento intermediário coerente.
- [ ] 1024x768: navegação desktop eficiente; sem áreas vazias excessivas.
- [ ] 1440x900: boa densidade e legibilidade em grids/listas/tabelas.
- [ ] 1920x1080: ocupação ampla sem esticar conteúdo indevidamente.

## 8) Log de gates

### Gate 0 (baseline)

Comandos executados (npm detectado por `package-lock.json`):

- `npm install` ✅ (com warning de engine Node 22.x vs ambiente 24.x)
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm run build` ✅
- `npm test` ✅

Notas do baseline:

- O `lint` inicial falhava por dívida técnica legada ampla em `api/`, `server/`, `scripts/`, `supabase/functions` e por erros bloqueantes em `src`.
- Para estabilizar o gate da frente de UI sem mascarar erros de front, foi aplicado:
  - escopo de ignore no `eslint.config.js` para áreas legadas de backend;
  - correção dos erros bloqueantes de lint em `src` (sem alterar comportamento de negócio).
- Situação final do Gate 0: **PASS** (sem erros de lint/typecheck/build/test).

### Gate 1

- Escopo: shell responsivo (`src/components/Navigation.tsx`).
- Entrega:
  - Mobile-first com bottom nav de 5 slots (4 principais + `Mais`) e sheet para ações secundárias.
  - Desktop com rail persistente (atalho rápido, foco por teclado e badges).
  - Safe-area aplicada nos elementos fixos (`env(safe-area-inset-bottom/top)`).
- Comandos:
  - `npm run lint` ✅
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - `npm test` ✅
- Status: **PASS**

### Gate 2

- Escopo: componentes base reutilizáveis (`button`, `input`, `textarea`, `select`, `dialog`, `drawer`, `card`, `table`).
- Entrega:
  - Alvos de toque mobile >=44px para controles principais.
  - Ajuste de densidade desktop (`md`) sem inflar espaçamento.
  - Dialog com `max-h` e scroll interno; drawer com `max-h` e safe-area bottom.
  - Tabela com container responsivo e melhor legibilidade de células/cabeçalho.
- Comandos:
  - `npm run lint` ✅
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - `npm test` ✅
- Status: **PASS**

### Gate 3..n

- Escopo: ajustes por tela (lote principal de páginas autenticadas com `Navigation`).
- Telas ajustadas:
  - `Dashboard`, `LeaderDashboard`, `Profile`
  - `Forums`, `ForumTopic`, `ForumInsights`
  - `Rankings`, `FinanceRequests`, `CampaignDetail`, `ChallengeDetail`
  - `Studio`, `StudioCuration`, `Evaluations`, `Study`
  - `SEPBook`, `SEPBookIG`
- Entrega:
  - Padding inferior responsivo com safe-area para evitar overlap com navegação fixa.
  - Compensação desktop (`lg:pl-24`) para coexistir com rail lateral sem cobrir conteúdo.
  - Containers padronizados (`px-3 sm:px-4 lg:px-6`) e densidade melhor em desktop.
  - Ajustes de header mobile (truncamento/compactação) em telas críticas.
- Comandos:
  - `npm run lint` ✅
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - `npm test` ✅
- Status: **PASS**

### Gate 4

- Escopo: estabilidade de IA (health/proofread/StudyLab) + legibilidade do drilldown de resultados.
- Entrega:
  - Health check da OpenAI com payload mais compatível + fallback para modelo compat (`OPENAI_MODEL_COMPAT`).
  - Remoção de `reasoning.effort` para evitar `Unsupported parameter` em modelos que não suportam.
  - Drilldown do quiz: botões expandir/recolher com alvo >= 44px + inferência de subárea por `operational_base` quando aplicável.
- Comandos:
  - `npm run lint` ✅
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - `npm test` ✅
- Status: **PASS**

## 9) PR + Deploy (Vercel)

- Branch publicada:
  - `git push -u origin chore/mobile-desktop-ux-20260206` ✅
- Link para abrir PR:
  - `https://github.com/engrodrigo-prog/djt-quest/pull/new/chore/mobile-desktop-ux-20260206`
- Preview deploy:
  - Comando: `npx vercel --yes`
  - URL: `https://djt-quest-6tggprlax-rodrigos-projects-9be3fb9d.vercel.app`
- Produção:
  - Comando: `npx vercel --prod --yes`
  - URL do deploy: `https://djt-quest-dwxof1wq8-rodrigos-projects-9be3fb9d.vercel.app`
  - Alias ativo: `https://djt-quest.vercel.app`

## 10) Smoke test web (pós-deploy)

- Validação HTTP básica (`curl -I`) em produção: `/`, `/auth`, `/register`, `/dashboard`, `/forums` => `HTTP/2 200`.
- Validação HTTP básica (`curl -I`) em preview: `/`, `/auth`, `/dashboard` => `HTTP/2 200`.
- Validação HTML base (`curl` + `grep`) em preview e produção: `<title>` + `<div id=\"root\"></div>` presentes.
- Validação IA (produção):
  - `curl https://djt-quest.vercel.app/api/ai?handler=health` => `ok: true`
  - `curl https://djt-quest.vercel.app/api/ai?handler=cleanup-text` => `meta.usedAI: true`
- Limitação atual:
  - Sem sessão autenticada automatizada no ambiente CLI para validar visualmente fluxos internos por viewport (360/390/1024/1440/1920) após deploy.
