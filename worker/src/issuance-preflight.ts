import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

export type PreflightResult = {
  production_ready: false;
  certificate_valid: boolean;
  local_signature_valid: boolean;
  official_signature_verified: false;
  company_authorization_verified: false;
  blockers: string[];
};

/** Offline cryptographic probe only. This is NOT a DPS and cannot issue an invoice. */
export function inspectIssuanceCertificate(pfxBase64: string, password: string, now = new Date()): PreflightResult {
  const result: PreflightResult = {
    production_ready: false, certificate_valid: false, local_signature_valid: false,
    official_signature_verified: false, company_authorization_verified: false,
    blockers: [
      'Contrato e assinatura fiscal oficiais ainda não validados.',
      'Procuração e habilitação para emissão desta empresa ainda não comprovadas.',
      'Envio real bloqueado; confirmação expressa continua obrigatória.',
    ],
  };
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(pfxBase64)), false, password);
    const keys = [
      ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
      ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
    ].flatMap(bag => bag.key ? [bag.key] : []);
    if (keys.length !== 1) throw new Error('ambiguous key');
    const key = keys[0];
    if (!key) throw new Error('missing key');
    const certificates = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
      .flatMap(bag => bag.cert ? [bag.cert] : [])
      .filter(cert => {
        const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
        return publicKey.n?.equals(key.n) && publicKey.e?.equals(key.e);
      });
    if (certificates.length !== 1) throw new Error('certificate mismatch');
    const cert = certificates[0];
    if (!cert || cert.validity.notBefore > now || cert.validity.notAfter <= now) throw new Error('invalid validity');
    const usage = cert.getExtension('keyUsage') as { digitalSignature?: boolean } | null;
    if (usage && !usage.digitalSignature) throw new Error('signing not allowed');
    result.certificate_valid = true;
    const certPem = forge.pki.certificateToPem(cert);
    const signer = new SignedXml({
      privateKey: forge.pki.privateKeyToPem(key), publicCert: certPem,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    signer.addReference({ xpath: "//*[local-name()='Probe']", transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'], digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
    signer.computeSignature('<Probe Id="local-preflight">MONEST-OFFLINE-NOT-A-DPS</Probe>');
    const verifier = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
    verifier.loadSignature(signer.getSignatureXml());
    result.local_signature_valid = verifier.checkSignature(signer.getSignedXml());
    if (!result.local_signature_valid) throw new Error('signature mismatch');
  } catch {
    // Never forward crypto exceptions: some libraries include private input in errors.
    result.blockers.unshift('Falha na verificação local: confira validade, senha e integridade do certificado A1.');
  }
  return result;
}