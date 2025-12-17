import test from 'node:test';
import assert from 'node:assert/strict';

import { ROLE, normalizeRole, rolesToSet, canCurate, canManageUsers } from './rbac.js';

test('normalizeRole maps legacy roles', () => {
  assert.equal(normalizeRole('gerente'), 'gerente_djt');
  assert.equal(normalizeRole('lider_divisao'), 'gerente_divisao_djtx');
  assert.equal(normalizeRole('coordenador'), 'coordenador_djtx');
});

test('rolesToSet normalizes and de-dupes', () => {
  const set = rolesToSet([{ role: 'gerente' }, { role: 'gerente_djt' }, { role: '  ' }]);
  assert.ok(set.has('gerente_djt'));
  assert.equal(set.size, 1);
});

test('canCurate true for content_curator or admin', () => {
  assert.equal(canCurate(new Set([ROLE.CONTENT_CURATOR])), true);
  assert.equal(canCurate(new Set([ROLE.ADMIN])), true);
  assert.equal(canCurate(new Set([ROLE.MANAGER])), false);
});

test('canManageUsers true for management roles', () => {
  assert.equal(canManageUsers(new Set([ROLE.ADMIN])), true);
  assert.equal(canManageUsers(new Set([ROLE.MANAGER])), true);
  assert.equal(canManageUsers(new Set([ROLE.DIV_MANAGER])), true);
  assert.equal(canManageUsers(new Set([ROLE.COORD])), true);
  assert.equal(canManageUsers(new Set([ROLE.CONTENT_CURATOR])), false);
});

