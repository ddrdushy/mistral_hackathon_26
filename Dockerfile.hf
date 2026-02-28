# ═══════════════════════════════════════════════════════════════════════
# HireOps AI — Hugging Face Spaces Dockerfile
# Runs backend (FastAPI) + frontend (Next.js) + nginx on port 7860
# ═══════════════════════════════════════════════════════════════════════

FROM node:22-slim AS frontend-builder

WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./

# Build Next.js as standalone for production
ENV NEXT_PUBLIC_API_URL=/api/v1
RUN npm run build

# ═══════════════════════════════════════════════════════════════════════
# Final image
# ═══════════════════════════════════════════════════════════════════════

FROM python:3.11-slim

# Install Node.js, nginx, supervisor
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Backend setup ──
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .

# ── Frontend setup ──
WORKDIR /app/frontend
COPY --from=frontend-builder /build/.next/standalone ./
COPY --from=frontend-builder /build/.next/static ./.next/static
COPY --from=frontend-builder /build/public ./public

# ── Nginx config ──
COPY deploy/nginx.conf /etc/nginx/nginx.conf

# ── Supervisord config ──
COPY deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# ── Data directory (SQLite persists here) ──
RUN mkdir -p /data && chmod 777 /data

# ── Expose HF Spaces port ──
EXPOSE 7860

WORKDIR /app
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
