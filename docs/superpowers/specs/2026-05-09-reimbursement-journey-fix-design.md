# Design: Correção e Melhoria da Jornada de Reembolso

**Data:** 2026-05-09  
**Status:** Aprovado  
**Escopo:** Bug fix + UX improvements na jornada de reembolso/adiantamento

---

## Problema

Toda a jornada de reembolso está quebrada com erro 500. Causa raiz: 3 handlers importam de `../server/env-guard.js` e `../server/finance/*.js` — paths inválidos (`server/api-handlers/` → `../server/` = `server/server/` inexistente). Todos os outros handlers usam `../env-guard.js` corretamente.

---

## Bloco A — Fix 500 (crítico)

**Arquivos:** `server/api-handlers/finance-request.ts`, `finance-requests.ts`, `finance-requests-admin.ts`

**Mudança:** Corrigir 4 imports em cada arquivo:
- `../server/env-guard.js` → `../env-guard.js`
- `../server/finance/schema.js` → `../finance/schema.js`
- `../server/finance/permissions.js` → `../finance/permissions.js`
- `../server/finance/utils.js` → `../finance/utils.js`

**Nota:** `finance-request-extract.ts` já usa paths corretos — não tocar.

---

## Bloco C — UX do Formulário do Usuário

**Arquivo:** `src/pages/FinanceRequests.tsx`

### Melhorias:
1. **Preview de anexos** — ao fazer upload, exibir lista com nome + tamanho formatado (ex: `nota-fiscal.pdf — 142 KB`). Botão remover individual por anexo.
2. **Sucesso com protocolo em destaque** — após POST bem-sucedido, exibir banner verde com `Protocolo: FIN-XXXXXXXX` copiável. Não apenas "Enviado com sucesso".
3. **Erro de submit perto do botão** — erro atual só aparece no topo. Adicionar mensagem de erro inline abaixo do botão submit.
4. **Spinner + disable durante POST** — botão desabilitado e exibe spinner enquanto aguarda resposta.
5. **Validação BRL em tempo real** — ao sair do campo valor (onBlur), validar formato e exibir erro inline se inválido.
6. **Limpar form após sucesso** — reset do form e scroll para o topo da lista após envio com sucesso.

---

## Bloco D — UX do Painel ADM

**Arquivo:** `src/components/FinanceRequestsManagement.tsx`

### Melhorias:
1. **Linha de métricas no topo** — 5 counters: Total | Enviado | Em Análise | Aprovado/Pago | Reprovado. Calculados dos dados já carregados (sem nova chamada API).
2. **Histórico completo no modal** — timeline vertical com todos os eventos de `finance_request_status_history`: data, quem mudou, de→para, observação.
3. **Confirmação ao Reprovar** — ao selecionar status "Reprovado", exibir dialog de confirmação com campo de observação obrigatório. Impede reprovação sem justificativa.
4. **Badges de status com ícone** — adicionar ícone antes do texto do badge (✓ Aprovado, ⏳ Em Análise, ✕ Reprovado, etc).
5. **Destaque do solicitante** — no modal de detalhe, exibir nome + matrícula + email do solicitante em seção própria no topo.

---

## Arquitetura

- Sem novas rotas de API
- Sem novas tabelas
- Sem dependências novas
- Mudanças cirúrgicas em 3 arquivos de servidor + 2 de frontend

## Ordem de execução

1. **A** — fix imports (deploy imediato resolve 500)
2. **C** — UX form (FinanceRequests.tsx)
3. **D** — UX ADM (FinanceRequestsManagement.tsx)

## Critérios de sucesso

- [ ] POST /api/finance-requests retorna 200 com `{ success: true, request: { protocol } }`
- [ ] GET /api/finance-requests retorna lista do usuário
- [ ] GET/PATCH /api/finance-request funciona
- [ ] Painel ADM carrega e permite atualizar status
- [ ] Upload de anexo exibe preview com nome e tamanho
- [ ] Após envio, usuário vê protocolo gerado
- [ ] Reprovar exige observação obrigatória
