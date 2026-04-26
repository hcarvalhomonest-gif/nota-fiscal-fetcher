#!/usr/bin/env bash
# NotaSync Worker — instalador automático para VPS Linux (Ubuntu/Debian)
# Uso na VPS (como root):
#   curl -fsSL https://raw.githubusercontent.com/hcarvalhomonest-gif/nota-fiscal-fetcher/main/worker/install.sh | bash
#
# Depois de instalar, edite /opt/notasync/worker/.env e cole o WORKER_SHARED_SECRET,
# em seguida rode:  systemctl restart notasync-worker

set -euo pipefail

REPO_URL="https://github.com/hcarvalhomonest-gif/nota-fiscal-fetcher.git"
INSTALL_DIR="/opt/notasync"
WORKER_DIR="${INSTALL_DIR}/worker"
SERVICE_NAME="notasync-worker"
SUPABASE_FUNCTIONS_URL="https://cwxsalprevqrtimkgxwo.supabase.co/functions/v1"

log()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m!! $*\033[0m"; }
die()  { echo -e "\033[1;31mXX $*\033[0m" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Rode como root (use: sudo bash install.sh)"

log "Atualizando pacotes do sistema"
apt-get update -y
apt-get install -y curl git ca-certificates

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  log "Instalando Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  log "Node.js já instalado: $(node -v)"
fi

log "Clonando/atualizando repositório em ${INSTALL_DIR}"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  git -C "${INSTALL_DIR}" fetch --all
  git -C "${INSTALL_DIR}" reset --hard origin/main
else
  rm -rf "${INSTALL_DIR}"
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

[[ -d "${WORKER_DIR}" ]] || die "Pasta worker/ não encontrada no repositório"

log "Instalando dependências do worker"
cd "${WORKER_DIR}"
npm install --no-audit --no-fund

if [[ ! -f "${WORKER_DIR}/.env" ]]; then
  log "Criando .env inicial (lembre de preencher o WORKER_SHARED_SECRET)"
  cat > "${WORKER_DIR}/.env" <<EOF
SUPABASE_FUNCTIONS_URL=${SUPABASE_FUNCTIONS_URL}
WORKER_SHARED_SECRET=COLE_AQUI_O_SEGREDO_DO_LOVABLE_CLOUD
NFSE_BASE_URL=https://adn.nfse.gov.br
POLL_INTERVAL_MS=10000
MAX_PAGES=1000
REQUEST_DELAY_MS=250
EOF
  chmod 600 "${WORKER_DIR}/.env"
else
  log ".env já existia — mantendo o atual"
fi

log "Configurando serviço systemd: ${SERVICE_NAME}"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=NotaSync Worker (NFS-e Nacional)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${WORKER_DIR}
EnvironmentFile=${WORKER_DIR}/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null

if grep -q "COLE_AQUI_O_SEGREDO" "${WORKER_DIR}/.env"; then
  warn "WORKER_SHARED_SECRET ainda não foi configurado."
  warn "Edite o arquivo:   nano ${WORKER_DIR}/.env"
  warn "Depois rode:       systemctl restart ${SERVICE_NAME}"
else
  systemctl restart "${SERVICE_NAME}"
fi

cat <<EOF

\033[1;32m✓ Instalação concluída!\033[0m

Próximos passos:
  1) Edite o segredo:        nano ${WORKER_DIR}/.env
  2) Reinicie o worker:      systemctl restart ${SERVICE_NAME}
  3) Veja o status:          systemctl status ${SERVICE_NAME}
  4) Acompanhe os logs:      journalctl -u ${SERVICE_NAME} -f

Para atualizar o worker no futuro, basta rodar este mesmo comando de novo.
EOF
