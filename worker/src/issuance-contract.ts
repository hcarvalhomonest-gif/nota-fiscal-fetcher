import { createHash } from 'node:crypto';

export const RESTRICTED_ORIGIN = 'https://sefin.producaorestrita.nfse.gov.br';
export const RESTRICTED_DOCS = `${RESTRICTED_ORIGIN}/API/SefinNacional/docs/index`;
export type ReadReply = { status: number; body: string };
export type ContractRead = (url: string) => Promise<ReadReply>;

// Only documentation resources on the restricted official host; no fiscal routes or query strings.
export function documentationUrl(candidate: string, base = RESTRICTED_DOCS): string | null {
  try {
    const url = new URL(candidate, base);
    if (url.origin !== RESTRICTED_ORIGIN || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/API\/SefinNacional\/(?:docs|swagger)\/[a-zA-Z0-9_./-]+$/.test(url.pathname)) return null;
    if (!/\.(?:json|js)$/.test(url.pathname) && !/\/swagger-config$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export function contractCandidates(text: string, base: string): string[] {
  const candidates = [...text.matchAll(/(?:\b(?:url|configUrl|swaggerUrl)\s*[:=]|\bsrc\s*=)\s*["']([^"']+)["']/g)]
    .map(match => documentationUrl(match[1] ?? '', base)).filter((value): value is string => value !== null);
  try {
    const config = JSON.parse(text);
    for (const item of [config.url, config.configUrl, config.swaggerUrl, ...(Array.isArray(config.urls) ? config.urls.map((entry: { url?: unknown }) => entry.url) : [])]) {
      if (typeof item === 'string') {
        const url = documentationUrl(item, base);
        if (url) candidates.push(url);
      }
    }
  } catch { /* HTML/bootstrap script, not configuration JSON */ }
  return [...new Set(candidates)];
}

export async function obtainRestrictedContract(read: ContractRead) {
  const visited = new Set<string>();
  const queue = [RESTRICTED_DOCS];
  const attempts: { resource: string; status: number }[] = [];
  while (queue.length && visited.size < 8) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const reply = await read(url);
    attempts.push({ resource: new URL(url).pathname, status: reply.status });
    if (reply.status !== 200) continue;
    try {
      const doc = JSON.parse(reply.body);
      if ((typeof doc.openapi === 'string' || typeof doc.swagger === 'string') && doc.paths && typeof doc.paths === 'object' && !Array.isArray(doc.paths)) {
        const paths = Object.keys(doc.paths).filter(path => /^\/[a-zA-Z0-9_/{}/.-]+$/.test(path));
        return {
          report: { production_ready: false, official_signature_verified: false, company_authorization_verified: false,
            contract_obtained: true, contract_sha256: createHash('sha256').update(reply.body).digest('hex'),
            documented_paths: paths, attempts },
          contract: reply.body,
        };
      }
    } catch { /* Bootstrap may be HTML or JS. Never execute it. */ }
    queue.push(...contractCandidates(reply.body, url).filter(candidate => !visited.has(candidate)));
  }
  return { report: { production_ready: false, official_signature_verified: false, company_authorization_verified: false,
    contract_obtained: false, attempts }, contract: null };
}