# Emissão de NFS-e Nacional — Monest

## Objetivo
Criar uma área de **emissão real de notas fiscais** neste aplicativo, escolhendo a empresa emitente e o certificado **Monest nova** ou **Monest antiga HC** já cadastrado. Atender MEI, Simples Nacional e lucro presumido/real, sem limitar o cadastro a uma cidade.

**Limite importante:** usar o Portal Nacional para consultar notas não garante que toda empresa possa emitir pelo Emissor Nacional. A emissão depende da habilitação do município/contribuinte e da autorização de representação. O sistema verificará essas condições e mostrará impedimentos, sem prometer emissão indiscriminada.

## Área de emissão
- Adicionar **Emitir NFS-e** ao menu, preservando o visual Monest.
- Selecionar a empresa e o certificado, identificando claramente a empresa representada e qual certificado Monest será utilizado. Manter o A1 do cliente como alternativa autorizada.
- Configurar dados fiscais do prestador que ainda não existem no cadastro: código do município, inscrição municipal quando aplicável, regime tributário e demais informações exigidas pelo leiaute vigente.
- Preencher tomador, competência, local da prestação, serviço, descrição, valores e tributação. Exibir campos obrigatórios e condicionais conforme regime e parâmetros oficiais, sem inventar alíquotas.
- Salvar e editar rascunhos por empresa. Mostrar uma revisão completa antes de **Confirmar emissão real**, com aviso de validade fiscal.
- Exibir histórico com rascunhos, processamento, notas autorizadas, rejeições e resultados ainda não confirmados. Disponibilizar XML e PDF quando retornados pela integração oficial.

## Integração oficial e proteção contra duplicidade
- Confirmar o contrato atual da API SEFIN, os esquemas XML da DPS, os requisitos de assinatura e os parâmetros municipais oficiais antes de implementar o envio.
- Gerar, validar e assinar a DPS usando o certificado autorizado; realizar a comunicação segura no programa da VPS, sem entregar senhas ou chaves privadas ao navegador.
- Manter emissões separadas dos downloads atuais, sem alterar a contagem de notas ou a detecção de cancelamentos já implementadas.
- Registrar o identificador da DPS e a tentativa de envio antes da transmissão. Bloquear confirmações repetidas e cliques duplicados.
- Em caso de demora ou perda de conexão, consultar o resultado antes de tentar novamente. Não trocar certificados nem reenviar automaticamente uma emissão cujo resultado seja incerto.
- Guardar retorno oficial, chave de acesso e arquivos; mostrar as rejeições para correção. Só marcar como emitida após confirmação oficial.

## Validação e liberação para notas reais
O destino final é produção, não uma demonstração. Antes de liberar o botão de emissão real:
1. Validar assinatura, leiaute, autorização e tratamento de rejeições no ambiente oficial de testes, sem validade fiscal.
2. Atualizar o programa da VPS com suporte à emissão, mantendo os downloads funcionando.
3. Conferir uma procuração Monest válida para serviços de NFS-e e a habilitação da empresa escolhida.
4. Com os dados reais fornecidos e confirmação expressa do usuário, emitir a primeira nota, consultar seu resultado e conferir XML/PDF pelo aplicativo.

Não será emitida uma nota real apenas para testar. Se faltarem autorização, dados fiscais ou atualização da VPS, esses requisitos aparecerão como pendências e a emissão permanecerá bloqueada.

## Detalhes técnicos
- Criar recursos próprios para configuração fiscal, rascunhos e solicitações de emissão, com permissões explícitas e isolamento por usuário/empresa no Lovable Cloud.
- Validar a sessão, o acesso à empresa e ao certificado, os dados fiscais e as transições de estado no servidor. O navegador não poderá marcar uma nota como autorizada.
- Adicionar funções autenticadas para salvar/confirmar/consultar emissões e um protocolo específico de processamento na VPS. Reutilizar o armazenamento privado e a criptografia dos certificados existentes.
- Usar biblioteca mantida para assinatura XML, validada contra os requisitos oficiais; não implementar criptografia fiscal improvisada.
- Adicionar testes para escolha de certificado, acesso à empresa, confirmação obrigatória, idempotência, rejeições e recuperação de resultado incerto.
- Verificar as telas com sessão autenticada em computador e celular, e a emissão completa com uma empresa habilitada.

## Fora desta entrega
Cancelamento e substituição de notas emitidas, emissão automática recorrente e integrações com portais municipais separados. Os livros e downloads existentes continuam disponíveis.