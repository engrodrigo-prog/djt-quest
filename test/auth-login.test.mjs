import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLoginQueryState,
  resolveLoginCandidate,
} from '../src/lib/auth-login.ts';

test('getLoginQueryState classifies employee ID searches without forcing selection', () => {
  const state = getLoginQueryState('202559');

  assert.equal(state.kind, 'matricula');
  assert.equal(state.allowSuggestions, true);
  assert.equal(state.inputMode, 'numeric');
});

test('getLoginQueryState keeps text keyboard for names and email keyboard for emails', () => {
  const nameState = getLoginQueryState('Rodrigo Henrique');
  const emailState = getLoginQueryState('rodrigo@cpfl.com.br');

  assert.equal(nameState.kind, 'name');
  assert.equal(nameState.inputMode, 'text');
  assert.equal(emailState.kind, 'email');
  assert.equal(emailState.inputMode, 'email');
});

test('resolveLoginCandidate matches only exact employee ID lookups', () => {
  const state = getLoginQueryState('202559');
  const exact = [{ id: '1', matricula: '202559', name: 'Rodrigo', email: 'r@cpfl.com.br' }];

  assert.deepEqual(resolveLoginCandidate(state, { exactMatricula: exact }), {
    kind: 'matched',
    user: exact[0],
  });
});

test('resolveLoginCandidate requires selection when only partial employee ID matches exist', () => {
  const state = getLoginQueryState('202559');
  const partial = [{ id: '2', matricula: '2025593', name: 'Rodrigo', email: 'r@cpfl.com.br' }];

  assert.deepEqual(resolveLoginCandidate(state, { partialMatricula: partial }), {
    kind: 'needs_selection',
    suggestions: partial,
  });
});

test('resolveLoginCandidate prefers exact email among broader email matches', () => {
  const state = getLoginQueryState('rodrigo@cpfl.com.br');
  const emailMatches = [
    { id: '1', name: 'Outro Rodrigo', email: 'rodrigo@cpfl.com.br.br' },
    { id: '2', name: 'Rodrigo Henrique', email: 'rodrigo@cpfl.com.br' },
  ];

  assert.deepEqual(resolveLoginCandidate(state, { email: emailMatches }), {
    kind: 'matched',
    user: emailMatches[1],
  });
});

test('resolveLoginCandidate keeps ambiguous name searches in selection mode', () => {
  const state = getLoginQueryState('rodrigo henrique');
  const nameMatches = [
    { id: '1', name: 'Rodrigo Henrique', email: 'r1@cpfl.com.br' },
    { id: '2', name: 'Rodrigo Henrique', email: 'r2@cpfl.com.br' },
  ];

  assert.deepEqual(resolveLoginCandidate(state, { name: nameMatches }), {
    kind: 'needs_selection',
    suggestions: nameMatches,
  });
});
