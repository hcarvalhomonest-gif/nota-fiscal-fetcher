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