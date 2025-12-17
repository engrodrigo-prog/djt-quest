import test from 'node:test';
import assert from 'node:assert/strict';

import { ROLE, rolesToSet, canAssignRoles, canSeeAnswerKey, studioLandingPath } from './rbac.js';

test('canAssignRoles allows leader/admin only', () => {
  assert.equal(canAssignRoles({ roleSet: new Set([ROLE.ADMIN]), profile: {} }), true);
  assert.equal(canAssignRoles({ roleSet: new Set([ROLE.TEAM_LEADER]), profile: {} }), true);
  assert.equal(canAssignRoles({ roleSet: new Set(), profile: { is_leader: true } }), true);
  assert.equal(canAssignRoles({ roleSet: new Set([ROLE.CONTENT_CURATOR]), profile: {} }), false);
  assert.equal(canAssignRoles({ roleSet: new Set([ROLE.INVITED]), profile: {} }), false);
});

test('canSeeAnswerKey allows admin/curator/owner only', () => {
  assert.equal(canSeeAnswerKey({ roleSet: new Set([ROLE.ADMIN]), isOwner: false }), true);
  assert.equal(canSeeAnswerKey({ roleSet: new Set([ROLE.CONTENT_CURATOR]), isOwner: false }), true);
  assert.equal(canSeeAnswerKey({ roleSet: new Set([ROLE.TEAM_LEADER]), isOwner: false }), false);
  assert.equal(canSeeAnswerKey({ roleSet: new Set(), isOwner: true }), true);
});

test('studioLandingPath for content curator', () => {
  assert.equal(studioLandingPath({ roleSet: new Set([ROLE.CONTENT_CURATOR]) }), '/studio/curadoria');
});

test('rolesToSet accepts role rows or strings', () => {
  const setFromRows = rolesToSet([{ role: ROLE.ADMIN }, { role: '  ' }]);
  const setFromStrings = rolesToSet([ROLE.ADMIN, ROLE.ADMIN]);
  assert.equal(setFromRows.has(ROLE.ADMIN), true);
  assert.equal(setFromStrings.size, 1);
});

