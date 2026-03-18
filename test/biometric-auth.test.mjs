import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearStoredBiometricFactorId,
  getBiometricStorageKey,
  getPreferredBiometricFactor,
  listVerifiedWebAuthnFactors,
  setStoredBiometricFactorId,
  syncPreferredBiometricFactor,
} from '../src/lib/biometricAuth.ts';

const makeWindow = () => {
  const store = new Map();
  return {
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
    __store: store,
  };
};

test('listVerifiedWebAuthnFactors keeps only verified webauthn entries', () => {
  const factors = [
    { id: '1', factor_type: 'webauthn', status: 'verified' },
    { id: '2', factor_type: 'webauthn', status: 'unverified' },
    { id: '3', factor_type: 'totp', status: 'verified' },
  ];

  assert.deepEqual(listVerifiedWebAuthnFactors(factors), [factors[0]]);
});

test('getBiometricStorageKey namespaces factor ids by user', () => {
  assert.equal(getBiometricStorageKey('user-123'), 'djt_biometric_factor_id:user-123');
});

test('preferred biometric factor follows local device preference and clears stale ids', () => {
  const previousWindow = globalThis.window;
  const fakeWindow = makeWindow();
  globalThis.window = fakeWindow;

  try {
    setStoredBiometricFactorId('user-1', 'factor-a');

    const factors = [
      { id: 'factor-a', factor_type: 'webauthn', status: 'verified' },
      { id: 'factor-b', factor_type: 'webauthn', status: 'verified' },
    ];

    assert.equal(getPreferredBiometricFactor('user-1', factors)?.id, 'factor-a');

    assert.equal(syncPreferredBiometricFactor('user-1', [factors[1]]), null);
    assert.equal(fakeWindow.localStorage.getItem(getBiometricStorageKey('user-1')), null);

    clearStoredBiometricFactorId('user-1');
  } finally {
    globalThis.window = previousWindow;
  }
});
