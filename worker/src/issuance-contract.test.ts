import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentationUrl, obtainRestrictedContract, RESTRICTED_DOCS, RESTRICTED_ORIGIN } from './issuance-contract.js';

test('reject production, fiscal operations and credential forwarding destinations', () => {
  for (const url of ['https://sefin.nfse.gov.br/SefinNacional/docs/swagger.json', `${RESTRICTED_ORIGIN}/API/SefinNacional/nfse`, 'https://example.com/swagger.json', '../nfse', '/API/SefinNacional/docs/x.json?token=secret', 'https://user:password@sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/x.json']) {
    assert.equal(documentationUrl(url), null);
  }
});
test('retrieve advertised contract without invoking documented fiscal routes', async () => {
  const called: string[] = [];
  const result = await obtainRestrictedContract(async url => {
    called.push(url);
    return { status: 200, body: url === RESTRICTED_DOCS ? 'url: "../swagger/v1/swagger.json"' : JSON.stringify({ openapi: '3.0.0', paths: { '/nfse': { post: {} }, '/dps/{id}': { get: {} } } }) };
  });
  assert.equal(called.length, 2);
  assert.equal(result.report.contract_obtained, true);
  assert.equal(result.report.production_ready, false);
  assert.equal(result.report.official_signature_verified, false);
  assert.equal(result.report.company_authorization_verified, false);
  assert.equal(called.some(url => url.endsWith('/nfse')), false);
});
test('HTTP 403 does not become authorization evidence', async () => {
  const result = await obtainRestrictedContract(async () => ({ status: 403, body: 'forbidden' }));
  assert.equal(result.contract, null);
  assert.equal(result.report.contract_obtained, false);
  assert.equal(result.report.company_authorization_verified, false);
});
test('ignore external or fiscal URLs advertised in untrusted documentation', async () => {
  let calls = 0;
  await obtainRestrictedContract(async () => {
    calls++;
    return { status: 200, body: 'url: "https://example.com/collect.json"; url: "../nfse"' };
  });
  assert.equal(calls, 1);
});
test('read Swashbuckle embedded JSON configuration and extensionless docs contract', async () => {
  const called: string[] = [];
  const result = await obtainRestrictedContract(async url => {
    called.push(url);
    return { status: 200, body: url === RESTRICTED_DOCS
      ? `var configObject = JSON.parse('{"urls":[{"url":"v1","name":"SEFIN"}]}');`
      : JSON.stringify({ swagger: '2.0', paths: { '/nfse': { post: {} } } }) };
  });
  assert.equal(called[1], `${RESTRICTED_ORIGIN}/API/SefinNacional/docs/v1`);
  assert.equal(result.report.contract_obtained, true);
  assert.equal(result.report.production_ready, false);
});
test('read quoted url property from initialization script', async () => {
  const called: string[] = [];
  const result = await obtainRestrictedContract(async url => {
    called.push(url);
    return { status: 200, body: url === RESTRICTED_DOCS ? `<script src="swagger-ui-init.js"></script>`
      : url.endsWith('.js') ? `const config = {"url": "../swagger/v1/swagger.json"};`
      : JSON.stringify({ openapi: '3.0.0', paths: {} }) };
  });
  assert.equal(called.length, 3);
  assert.equal(result.report.contract_obtained, true);
});
test('encoded configuration cannot bypass restricted documentation host', async () => {
  let calls = 0;
  const result = await obtainRestrictedContract(async () => {
    calls++;
    return { status: 200, body: `JSON.parse('{"urls":[{"url":"https://example.com/collect"},{"url":"../nfse"}]}')` };
  });
  assert.equal(calls, 1);
  assert.equal(result.report.contract_obtained, false);
});