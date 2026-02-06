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

- Status: `PENDING`

### Gate 2

- Status: `PENDING`

### Gate 3..n

- Status: `PENDING`
