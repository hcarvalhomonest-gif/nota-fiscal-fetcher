import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { inspectIssuanceCertificate } from './issuance-preflight.js';

const keys = forge.pki.rsa.generateKeyPair(2048);
function fixture(expired = false, differentKey = false) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date(expired ? '2026-10-01T00:00:00Z' : '2027-01-01T00:00:00Z');
  cert.setSubject([{ name: 'commonName', value: 'SYNTHETIC TEST ONLY' }]);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([{ name: 'keyUsage', digitalSignature: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const key = differentKey ? forge.pki.rsa.generateKeyPair(2048).privateKey : keys.privateKey;
  const p12 = forge.pkcs12.toPkcs12Asn1(key, cert, 'test-password', { algorithm: '3des' });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}
const now = new Date('2026-11-05T21:14:00Z');
test('valid certificate signs locally but never authorizes issuance or procuração', () => {
  const result = inspectIssuanceCertificate(fixture(), 'test-password', now);
  assert.equal(result.certificate_valid, true);
  assert.equal(result.local_signature_valid, true);
  assert.equal(result.production_ready, false);
  assert.equal(result.official_signature_verified, false);
  assert.equal(result.company_authorization_verified, false);
});
test('expired certificate cannot pass local signature preflight', () => {
  assert.equal(inspectIssuanceCertificate(fixture(true), 'test-password', now).local_signature_valid, false);
});
test('private key must match the certificate rather than bag order', () => {
  assert.equal(inspectIssuanceCertificate(fixture(false, true), 'test-password', now).certificate_valid, false);
});
test('malformed material and wrong password produce only safe categorical diagnostics', () => {
  for (const result of [inspectIssuanceCertificate('secret-material', 'private-password', now), inspectIssuanceCertificate(fixture(), 'wrong-private-password', now)]) {
    assert.equal(result.local_signature_valid, false);
    assert.equal(result.production_ready, false);
    assert.equal(JSON.stringify(result).includes('private-password'), false);
    assert.equal(JSON.stringify(result).includes('secret-material'), false);
  }
});