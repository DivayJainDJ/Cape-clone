#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$line" ]] && continue
    if [[ "$line" == *"="* ]]; then
      export "$(echo "$line" | cut -d'=' -f1)"="$(echo "$line" | cut -d'=' -f2-)"
    fi
  done < "$ENV_FILE"
fi

check_url() {
  local label="$1"
  local url="$2"
  if curl -fsS "$url" >/tmp/cape_check_out 2>/tmp/cape_check_err; then
    echo "[OK] $label -> $url"
  else
    echo "[FAIL] $label -> $url"
    if [ -s /tmp/cape_check_err ]; then
      echo "       $(head -n 1 /tmp/cape_check_err)"
    fi
  fi
}

normalize_http_url() {
  local raw="$1"
  raw="${raw%/}"
  raw="${raw/ws:\/\//http://}"
  raw="${raw/wss:\/\//https://}"
  echo "$raw"
}

echo "CAPE demo readiness"
echo "Repo: $ROOT_DIR"
echo

if [ -n "${OPENCLAW_BASE_URL:-}" ]; then
  check_url "OpenClaw" "$(normalize_http_url "$OPENCLAW_BASE_URL")/health"
else
  echo "[WARN] OPENCLAW_BASE_URL missing"
fi

check_url "Ollama" "${OLLAMA_BASE_URL:-http://127.0.0.1:11434}/api/tags"
check_url "CAPE Gateway" "http://127.0.0.1:8787/health"
check_url "Dashboard" "http://127.0.0.1:8787/dashboard"
check_url "Runtime diagnostics" "http://127.0.0.1:8787/v1/runtime/dependencies"

if [ -n "${GOOGLE_MAPS_API_KEY:-}" ] && [[ "$GOOGLE_MAPS_API_KEY" != replace_with* ]]; then
  echo "[OK] Google Maps API key is configured"
else
  echo "[FAIL] Google Maps API key is missing"
fi

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] && [[ "$TELEGRAM_BOT_TOKEN" != replace_with* ]]; then
  echo "[OK] Telegram credentials are configured"
else
  echo "[FAIL] Telegram credentials are missing"
fi
