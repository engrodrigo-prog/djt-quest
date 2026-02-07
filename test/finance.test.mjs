import test from 'node:test';
import assert from 'node:assert/strict';

import { financeRequestCreateSchema } from '../server/finance/schema.js';
import { canManageFinanceRequests, canOwnerDeleteFinanceRequest, isFinanceAnalyst } from '../server/finance/permissions.js';
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

test('finance delete: owner can delete only initial unseen request', () => {
  const ownerId = '00000000-0000-0000-0000-000000000123';
  const request = { status: 'Enviado', analyst_viewed_at: null };
  const initialHistory = [{ from_status: null, to_status: 'Enviado', changed_by: ownerId }];
  assert.equal(canOwnerDeleteFinanceRequest(request, initialHistory, ownerId), true);

  const seenByAnalyst = { status: 'Enviado', analyst_viewed_at: '2026-02-06T10:00:00.000Z' };
  assert.equal(canOwnerDeleteFinanceRequest(seenByAnalyst, initialHistory, ownerId), false);

  const processedHistory = [
    { from_status: null, to_status: 'Enviado', changed_by: ownerId },
    { from_status: 'Enviado', to_status: 'Em Análise', changed_by: '00000000-0000-0000-0000-000000000999' },
  ];
  assert.equal(canOwnerDeleteFinanceRequest(request, processedHistory, ownerId), false);
});
