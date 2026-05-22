#!/bin/bash

set -e

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ] && [ -x "/opt/homebrew/bin/node" ]; then
    NODE_BIN="/opt/homebrew/bin/node"
fi
if [ -z "$NODE_BIN" ] && [ -x "/Applications/Codex.app/Contents/Resources/node" ]; then
    NODE_BIN="/Applications/Codex.app/Contents/Resources/node"
fi
if [ -z "$NODE_BIN" ]; then
    echo "Node.js not found. Set NODE_BIN or install Node."
    exit 1
fi

export CAPE_GATEWAY_HOST="127.0.0.1"
export CAPE_GATEWAY_PORT="8787"
export OLLAMA_MODEL="gemma4:latest"
export OLLAMA_TIMEOUT_MS="30000"
export OPENCLAW_CAPE_MEMORY_DIR="$(dirname "$0")/../openclaw/runtime"
export OPENCLAW_CAPE_PROFILE_DIR="$(dirname "$0")/../openclaw/memory"

# Load .env file if it exists
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip comments and empty lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$line" ]] && continue
        
        # Export environment variables
        if [[ "$line" == *"="* ]]; then
            export "$(echo "$line" | cut -d'=' -f1)"="$(echo "$line" | cut -d'=' -f2-)"
        fi
    done < "$ENV_FILE"
fi

if command -v adb >/dev/null 2>&1; then
    if adb reverse tcp:8787 tcp:8787 >/dev/null 2>&1; then
        echo "ADB reverse tunnel established on tcp:8787"
    else
        echo "ADB reverse unavailable right now; continuing without USB tunnel"
    fi
else
    echo "adb not found; continuing without USB tunnel"
fi

echo "CAPE gateway starting on http://${CAPE_GATEWAY_HOST}:${CAPE_GATEWAY_PORT}"
echo "Dashboard will be available at http://${CAPE_GATEWAY_HOST}:${CAPE_GATEWAY_PORT}/dashboard"

"$NODE_BIN" packages/cape-gateway/src/server.js
