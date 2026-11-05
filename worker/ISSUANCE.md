# Emissão nacional: integração ainda bloqueada

A área de emissão permite preparar rascunhos e configurar os dados fiscais no aplicativo. O worker atual continua exclusivamente responsável pelos downloads. Atualizá-lo não libera emissão.

## Limite de segurança

O endpoint `issuance-workspace` mantém a confirmação fiscal bloqueada no servidor. Não remover o bloqueio por variável de ambiente ou apenas por confirmação no navegador. O envio só pode ser habilitado depois de implementar e validar o contrato oficial, assinatura, alocação durável de número DPS e reconciliação de resultado incerto.

## Evidências oficiais consultadas em 2026-11-05

- Diretório oficial de APIs: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
- Documentação vigente e XSD 1.01 (2026-02-09): https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
- API SEFIN produção: https://sefin.nfse.gov.br/SefinNacional/docs/index
- API SEFIN restrita: https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index
- Representação e alternância: https://www.gov.br/nfse/pt-br/noticias/nova-funcionalidade-possibilita-representacao-e-alternancia-de-perfis-na-nfse

Os documentos públicos confirmam a emissão síncrona via `POST /nfse`, consulta `GET /dps/{id}` e consulta `GET /nfse/{chaveAcesso}`. O acesso aos contratos Swagger nesta investigação retornou HTTP 403. O envelope JSON, os códigos de resposta e as rotas detalhadas dos parâmetros municipais não foram confirmados; não usar propriedades ou caminhos inferidos.

## Diagnóstico de certificado na VPS (sem envio)

O comando novo usa os certificados já cadastrados, sem exportá-los para disco. Verifica correspondência da chave privada, validade, uso de assinatura quando presente e uma assinatura XML local **que não é uma DPS**. Não verifica cadeia ICP-Brasil, revogação, identidade fiscal ou autorização oficial: `certificate_valid` significa apenas essas verificações locais, nunca validade fiscal completa. RSA-SHA256 usado no teste é experimental, não perfil homologado do SEFIN. Nenhum sucesso local desbloqueia emissão, aloca número ou muda rascunhos.

Após as alterações chegarem ao GitHub, execute no terminal da Hostinger:

```bash
cd /opt/notasync
git pull --ff-only
cd worker
npm install --include=dev
npm run test:issuance
npm run issuance:preflight
```

Escolha a empresa e depois Monest nova ou Monest antiga HC pelo número mostrado. Repita para cada combinação empresa/certificado. O comando utiliza o `.env` existente; não imprima esse arquivo. Resultado esperado de segurança: `production_ready: false`, `official_signature_verified: false`, `company_authorization_verified: false`. `local_signature_valid: true` comprova somente o teste criptográfico local. O serviço de downloads não precisa ser parado para o diagnóstico. Não existe acesso remoto automático à VPS neste projeto; a execução precisa ser feita pelo responsável.

## Evidência de representação atualizada

A notícia oficial correta é https://www.gov.br/nfse/pt-br/noticias/nova-funcionalidade-possibilita-representacao-e-alternancia-de-perfis-na-nfs-e . A representação passou a abranger APIs de emissão e distribuição em novembro de 2026. Isso não esclarece por si só a regra E0718 do Anexo I 1.01 (linha 649), que exige certificado do emitente da DPS. O Swagger restrito continua retornando 403 nesta investigação. Assinatura procurador permanece pendente de contrato atual e validação no ambiente restrito.

- Anexo I: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx
- Guia web 1.3, seção 11.1.1: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/guia-emissorpubliconacionalweb_snnfse-ern-v1-3.pdf
- Guia ADN 1.1 de 03/11/2026: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-municipios-apis-adn-sistema-nacional-nfs-e-v1-1-20261103.pdf

Para cada empresa, conferir no portal de serviços da Receita a autorização assinada para o CPF/CNPJ exato do procurador, serviço NFS-e e vigência. Manter evidência e data da conferência individualmente. A consulta ADN com `TipoConsulta=Procuracao` é evidência de distribuição, não autorização de assinatura fiscal. Não há endpoint independente confirmado para validar procuração de emissão. O schema XMLDSig 1.01 não fixa algoritmos; não adotar RSA-SHA1 a partir do schema 1.00 que vem no mesmo ZIP. A redação contraditória de Basic Constraints em E0716 não foi transformada em regra de aceitação.

O XSD vigente identifica `DPS/infDPS/@Id` e assinatura XML como irmã de `infDPS`. A regra publicada E0718 exige certificado do emitente; a notícia de representação não resolve sozinha a regra de assinatura com o certificado de procurador. Autorização mTLS e autorização de assinatura fiscal devem ser confirmadas separadamente. Os algoritmos encontrados no manual histórico não foram comprovados como o contrato atual.

## Trabalho restante

1. Obter o contrato OpenAPI oficial e esclarecer assinatura procurador e algoritmos atuais.
2. Consultar habilitação e parâmetros municipais; completar campos condicionais por regime, inclusive tributação total e RTC quando aplicável. Os campos atuais são preparação de rascunho, não um leiaute fiscal completo.
3. Validar XML DPS com XSD vigente e assinar com biblioteca mantida conforme requisito confirmado.
4. Alocar série/número/ID DPS atomicamente, persistir confirmação e estado antes do envio, implementar fila específica e claim atômico.
5. Em timeout, preservar estado incerto e consultar a DPS; não reenviar nem trocar certificado automaticamente.
6. Guardar resposta oficial e arquivos em armazenamento privado; implementar links temporários autenticados.
7. Validar em produção restrita, instalar suporte na VPS, comprovar procuração/habilitação e só então solicitar confirmação expressa de uma emissão real.

Não há necessidade de informar senhas de certificados ou tokens no chat. Não registrar PFX, chave privada, senha, sessão ou cabeçalhos de autenticação em logs.