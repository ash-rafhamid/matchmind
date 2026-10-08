# --- 1. build the web app -----------------------------------------------------
FROM node:22.15-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- 2. python runtime + synthetic match data --------------------------------
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    MATCHMIND_FRONTEND=/app/frontend/dist MATCHMIND_DATA=/app/backend/data/matches
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
# Rebuild the featured matches deterministically (same seeds -> identical data).
RUN python scripts/generate_showcase.py --fixed
COPY --from=web /web/dist /app/frontend/dist
EXPOSE 8000
CMD ["uvicorn", "matchmind.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
