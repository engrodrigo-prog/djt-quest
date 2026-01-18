import test from 'node:test';
import assert from 'node:assert/strict';

import { financeRequestCreateSchema } from '../server/finance/schema.js';
import { canManageFinanceRequests, isFinanceAnalyst } from '../server/finance/permissions.js';
import { parseBrlToCents } from '../server/finance/utils.js';

test('finance schema: reembolso requires amount and attachment', () => {
  const base = {
    company: 'CPFL Piratininga',
    trainingOperational: 'Não',
    requestKind: 'Reembolso',
    expenseType: 'Transporte',
    coordination: 'Planejamento',
    dateStart: '2026-01-16',
    dateEnd: null,
    description: 'Teste de reembolso com dados mínimos válidos.',
    amountBrl: '',
    attachments: [],
  };
  const r = financeRequestCreateSchema.safeParse(base);
  assert.equal(r.success, false);
  assert.ok(r.error.flatten().fieldErrors.amountBrl?.length);
  assert.ok(r.error.flatten().fieldErrors.attachments?.length);
});

test('finance schema: adiantamento forces type and allows no amount/attachments', () => {
  const base = {
    company: 'CPFL Piratininga',
    trainingOperational: 'Sim',
    requestKind: 'Adiantamento',
    expenseType: 'Adiantamento',
    coordination: 'Planejamento',
    dateStart: '2026-01-16',
    dateEnd: null,
    description: 'Teste de adiantamento.',
    amountBrl: null,
    attachments: [],
  };
  const r = financeRequestCreateSchema.safeParse(base);
  assert.equal(r.success, true);
});

test('finance schema: multi-item reembolso validates each item', () => {
  const base = {
    company: 'CPFL Piratininga',
    trainingOperational: 'Não',
    requestKind: 'Reembolso',
    expenseType: null,
    coordination: 'Planejamento',
    dateStart: '2026-01-16',
    dateEnd: null,
    description: 'Solicitação com múltiplos itens.',
    amountBrl: null,
    attachments: null,
    items: [
      { expenseType: 'Transporte', description: 'Uber', amountBrl: '', attachments: [] },
    ],
  };
  const r = financeRequestCreateSchema.safeParse(base);
  assert.equal(r.success, false);
});

test('finance schema: multi-item adiantamento forbids attachments', () => {
  const base = {
    company: 'CPFL Piratininga',
    trainingOperational: 'Sim',
    requestKind: 'Adiantamento',
    expenseType: 'Adiantamento',
    coordination: 'Planejamento',
    dateStart: '2026-01-16',
    dateEnd: null,
    description: 'Solicitação de adiantamento com múltiplos motivos.',
    amountBrl: null,
    attachments: [],
    items: [
      {
        description: 'Adiantamento para despesas de campo',
        amountBrl: '100,00',
        attachments: [{ url: 'https://example.com/a.pdf' }],
      },
    ],
  };
  const r = financeRequestCreateSchema.safeParse(base);
  assert.equal(r.success, false);
});

test('finance perms: analyst role can manage; collaborator cannot', () => {
  assert.equal(isFinanceAnalyst(['analista_financeiro'], { name: 'X' }), true);
  assert.equal(canManageFinanceRequests(['analista_financeiro'], { name: 'X' }), true);
  assert.equal(canManageFinanceRequests(['colaborador'], { name: 'X' }), false);
});

test('finance utils: parseBrlToCents accepts common formats', () => {
  assert.equal(parseBrlToCents('123,45'), 12345);
  assert.equal(parseBrlToCents('123.45'), 12345);
  assert.equal(parseBrlToCents('1.234,56'), 123456);
  assert.equal(parseBrlToCents('1,234.56'), 123456);
  assert.equal(parseBrlToCents('1.234'), 123400);
});
