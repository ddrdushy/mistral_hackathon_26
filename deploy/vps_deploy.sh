#!/usr/bin/env bash
# HireOps AI — VPS update script.
#
# Run as root on the VPS to pull latest, rebuild, and restart ONLY the
# hireops systemd services. Designed to leave everything else (nginx,
# postgres, postfix, other apps) untouched.
#
# Usage:
#   ssh root@<vps>
#   cd /opt/hireops
#   bash deploy/vps_deploy.sh
#
# The two Next.js standalone gotchas this handles:
#   1. After `next build`, `.next/standalone/` does NOT include public/
#      or .next/static/ — they must be copied manually. We do this here
#      so /_next/static/css/* and /landing/* work.
#   2. sharp's native binaries sometimes don't make it into the
#      standalone build via npm ci. We ensure sharp is installed in
#      .next/standalone/ explicitly.

set -e

APP_DIR="${APP_DIR:-/opt/hireops}"
BACKEND_SERVICE="hireops-backend.service"
FRONTEND_SERVICE="hireops-frontend.service"

export PAGER=cat GIT_PAGER=cat

cd "${APP_DIR}"

echo "=== 1/7  git pull ==="
git stash push -u -m "predeploy-$(date +%s)" 2>/dev/null || true
git pull --ff-only origin main

echo "=== 2/7  backend deps ==="
cd "${APP_DIR}/backend"
if [ -d .venv ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -q -r requirements.txt
  deactivate
else
  echo "WARN: backend/.venv missing — skipping pip install"
fi

echo "=== 3/7  frontend deps ==="
cd "${APP_DIR}/frontend"
npm ci --silent

echo "=== 4/7  frontend build ==="
npm run build

echo "=== 5/7  copy public + static into standalone (Next gotcha) ==="
STANDALONE="${APP_DIR}/frontend/.next/standalone"
if [ ! -d "${STANDALONE}" ]; then
  echo "ERROR: ${STANDALONE} not found. Is output:'standalone' set in next.config.ts?"
  exit 1
fi
rm -rf "${STANDALONE}/public" "${STANDALONE}/.next/static"
cp -r "${APP_DIR}/frontend/public" "${STANDALONE}/public"
mkdir -p "${STANDALONE}/.next"
cp -r "${APP_DIR}/frontend/.next/static" "${STANDALONE}/.next/static"

echo "=== 6/7  ensure sharp in standalone ==="
# npm ci --silent occasionally skips sharp's postinstall in standalone;
# install it explicitly so /_next/image works.
if [ ! -d "${STANDALONE}/node_modules/@img/sharp-linux-x64" ]; then
  cd "${STANDALONE}"
  npm install --no-audit --no-fund sharp >/dev/null 2>&1 || true
fi

echo "=== 6.5/7  resume-binary storage dir ==="
# Direct CV uploads now persist the original file under a per-tenant
# tree at HIREOPS_UPLOAD_DIR. Ensure the dir exists and is owned by the
# hireops service user. Also seed the .env var if missing, in case the
# systemd unit on this host hasn't been refreshed yet.
UPLOAD_DIR="/var/lib/hireops/uploads"
mkdir -p "${UPLOAD_DIR}"
if id -u hireops >/dev/null 2>&1; then
  chown -R hireops:hireops "${UPLOAD_DIR}" 2>/dev/null || true
fi
ENV_FILE="${APP_DIR}/backend/.env"
if [ -f "${ENV_FILE}" ] && ! grep -q '^HIREOPS_UPLOAD_DIR=' "${ENV_FILE}"; then
  echo "HIREOPS_UPLOAD_DIR=${UPLOAD_DIR}" >> "${ENV_FILE}"
  echo "  seeded HIREOPS_UPLOAD_DIR into .env"
fi

# Re-sync the systemd unit so the new Environment= line lands.
if [ -f "${APP_DIR}/deploy/hireops-backend.service" ]; then
  if ! cmp -s "${APP_DIR}/deploy/hireops-backend.service" /etc/systemd/system/hireops-backend.service 2>/dev/null; then
    cp "${APP_DIR}/deploy/hireops-backend.service" /etc/systemd/system/hireops-backend.service
    systemctl daemon-reload
    echo "  refreshed hireops-backend.service unit"
  fi
fi

echo "=== 7/7  restart services (only hireops) ==="
systemctl restart "${BACKEND_SERVICE}"
sleep 2
systemctl is-active --quiet "${BACKEND_SERVICE}" && echo "  backend: active" || (echo "  backend: FAILED"; exit 1)

systemctl restart "${FRONTEND_SERVICE}"
sleep 3
systemctl is-active --quiet "${FRONTEND_SERVICE}" && echo "  frontend: active" || (echo "  frontend: FAILED"; exit 1)

echo "=== health checks ==="
curl -s http://127.0.0.1:8001/api/v1/health || echo "  backend health: FAILED"
echo
curl -sI http://127.0.0.1:3001 | head -1 || echo "  frontend health: FAILED"

echo
echo "=== deploy complete @ $(date -Iseconds) ==="
git log --oneline -3
