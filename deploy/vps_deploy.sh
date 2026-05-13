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
# hireops service user; the path is inside the systemd unit's
# ReadWritePaths sandbox. The env var is sourced via EnvironmentFile=
# from backend/.env — we never overwrite the live systemd unit here
# (the repo copy may have diverged from the live one on this host).
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

# One-shot fix: a previous deploy iteration accidentally pushed an
# 8017-port unit over the live 8001-port one. If we still see 8017 in
# the live unit (the only host this would ever match), correct it back
# to 8001 and reload. Safe no-op on every other host/unit.
LIVE_UNIT=/etc/systemd/system/hireops-backend.service
RELOAD_UNIT=0
if [ -f "${LIVE_UNIT}" ] && grep -q -- '--port 8017' "${LIVE_UNIT}"; then
  sed -i 's/--port 8017/--port 8001/' "${LIVE_UNIT}"
  RELOAD_UNIT=1
  echo "  patched live unit port 8017 -> 8001"
fi

# The repo unit assumes a 'hireops' system user, but this host runs the
# service as root (and the previous good unit had no User=/Group= at
# all). If a User=hireops line ended up in the live unit and no such
# user exists, comment those lines out so the service falls back to
# root and matches the pre-overwrite behavior. Safe no-op elsewhere.
if [ -f "${LIVE_UNIT}" ] && grep -q '^User=hireops' "${LIVE_UNIT}" && ! id -u hireops >/dev/null 2>&1; then
  sed -i 's/^User=hireops$/#&/' "${LIVE_UNIT}"
  sed -i 's/^Group=hireops$/#&/' "${LIVE_UNIT}"
  RELOAD_UNIT=1
  echo "  commented out User=hireops / Group=hireops (no such user on host)"
fi

if [ "${RELOAD_UNIT}" = "1" ]; then
  systemctl daemon-reload
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
