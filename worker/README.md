# NotaSync — Worker (VPS)

Esse worker roda **fora do Lovable** (numa VPS sua: DigitalOcean, AWS EC2, Contabo, Hetzner, etc.) porque o portal nacional NFS-e exige autenticação **mTLS com certificado A1**, o que não é possível diretamente nas Edge Functions.

## Como funciona

```
┌─────────────────────────────┐         ┌──────────────────────┐         ┌──────────────────────┐
│  NotaSync (Lovable Cloud)   │ ◄────── │  Worker (sua VPS)    │ ──────► │  Portal NFS-e Nacional│
│  - cadastro de empresas     │  jobs   │  - faz mTLS com PFX  │  HTTPS  │  (sefin.nfse.gov.br)  │
│  - upload .pfx (criptog.)   │ ──────► │  - baixa XML e PDF   │  mTLS   │                      │
│  - lista NFS-e baixadas     │ reports │  - devolve à API     │         │                      │
└─────────────────────────────┘         └──────────────────────┘         └──────────────────────┘
```

1. Você cria um job de download no painel.
2. O worker faz polling em `worker-claim-job` e pega o próximo job pendente.
3. O Lovable Cloud devolve para o worker o **certificado A1** (PFX em base64) e a **senha** descriptografada — isso só sai do Cloud sob o `WORKER_SHARED_SECRET`.
4. O worker autentica no portal NFS-e via mTLS, lista as chaves de acesso do período, baixa XML+PDF de cada nota.
5. O worker chama `worker-report` para cada nota e, no final, marca o job como `completed`.

## Setup

### 1. Configurar o secret no Lovable Cloud

No painel do Lovable, vá em **Cloud → Settings → Edge Function Secrets** e confirme que `WORKER_SHARED_SECRET` existe (foi criado durante o setup). Copie o valor.

### 2. Subir o worker numa VPS

```bash
# Numa VPS Linux (Ubuntu/Debian)
sudo apt update && sudo apt install -y nodejs npm
git clone <seu-fork-do-repo>
cd worker
npm install -g bun
bun install   # ou: npm install
cp .env.example .env
# Edite .env e cole o WORKER_SHARED_SECRET copiado do Lovable
nano .env
```

### 3. Rodar

```bash
# Teste local
bun run start

# Produção com PM2
npm install -g pm2
pm2 start "bun run start" --name notasync-worker
pm2 save
pm2 startup    # auto-iniciar no boot
```

### 4. Logs

```bash
pm2 logs notasync-worker
```

## Adaptação obrigatória

⚠️ O arquivo `src/index.ts` traz um esqueleto da integração com o portal NFS-e Nacional. **Você deve ajustar** os caminhos e o parsing dos retornos conforme a [documentação oficial das APIs (gov.br)](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao):

- `NFSE_BASE_URL` → SEFIN Nacional (consulta de NFS-e, lote, etc.)
- `NFSE_DANFSE_URL` → ADN (geração do DANFSe PDF)

A função `listAndDownloadInvoices(...)` é o ponto onde você chama os endpoints reais. As variáveis nos templates de URL e o formato do JSON de resposta podem variar.

Para **homologação/testes**, troque `NFSE_BASE_URL` para `https://sefin.producaorestrita.nfse.gov.br/SefinNacional`.

## Segurança

- A senha do certificado é criptografada no Cloud (AES-GCM, chave `CERT_PASSWORD_KEY`) e só é descriptografada no momento de entregar ao worker autenticado.
- O `WORKER_SHARED_SECRET` deve ser longo e aleatório (≥32 chars).
- Nunca exponha esse worker à internet pública: ele só faz **chamadas de saída** (polling). Não precisa abrir porta de entrada.
- Considere adicionar rotação periódica do `WORKER_SHARED_SECRET`.

## Múltiplos workers

Pode subir N instâncias em VPSs diferentes. Cada chamada a `worker-claim-job` reserva exatamente um job atomicamente.
