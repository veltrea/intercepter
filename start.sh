#!/bin/bash
# start.sh — ai_proxy + chat-client + dashboard を一発で起動
#
#   chat-client → ai_proxy (:5555) → LM Studio (:1234)
#                     ↓
#              Dashboard (:5556)
#
# 使い方:
#   ./start.sh                        # デフォルト構成
#   ./start.sh --upstream http://192.0.2.22:1234
#   ./start.sh --port 8080            # プロキシポート変更
#   ./start.sh --no-client            # chat-client を起動しない
#   ./start.sh --no-dashboard         # dashboard を起動しない

set -euo pipefail
cd "$(dirname "$0")"

PROXY_PORT=5555
UPSTREAM="http://localhost:1234"
LAUNCH_CLIENT=true
LAUNCH_DASHBOARD=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)          PROXY_PORT="$2"; shift 2 ;;
    --upstream)      UPSTREAM="$2"; shift 2 ;;
    --no-client)     LAUNCH_CLIENT=false; shift ;;
    --no-dashboard)  LAUNCH_DASHBOARD=false; shift ;;
    -h|--help)
      echo "Usage: $0 [--port PORT] [--upstream URL] [--no-client] [--no-dashboard]"
      echo ""
      echo "  --port PORT       プロキシポート (default: 5555)"
      echo "  --upstream URL    上流 LLM エンドポイント (default: http://localhost:1234)"
      echo "  --no-client       chat-client を起動しない"
      echo "  --no-dashboard    dashboard アプリを起動しない"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

ENDPOINT="http://localhost:${PROXY_PORT}"

echo "┌─────────────────────────────────────────────┐"
echo "│  AI Proxy Debug Stack                       │"
echo "│                                             │"
echo "│  chat-client → proxy → upstream LLM         │"
echo "│                    ↓                        │"
echo "│              Dashboard                      │"
echo "│                                             │"
echo "│  Proxy:     :${PROXY_PORT}                          │"
echo "│  Upstream:  ${UPSTREAM}"
echo "│  Dashboard: :5556                           │"
echo "│  Client:    $(${LAUNCH_CLIENT} && echo 'yes' || echo 'no')                              │"
echo "│  Dashboard: $(${LAUNCH_DASHBOARD} && echo 'yes' || echo 'no')                              │"
echo "└─────────────────────────────────────────────┘"

# --- Node.js パス解決 (node@20 を優先: better-sqlite3 の互換性) ---
if [[ -x /opt/homebrew/Cellar/node@20/20.20.0/bin/node ]]; then
  NODE=/opt/homebrew/Cellar/node@20/20.20.0/bin/node
elif command -v node >/dev/null 2>&1; then
  NODE=node
elif [[ -x /opt/homebrew/Cellar/node/25.9.0/bin/node ]]; then
  NODE=/opt/homebrew/Cellar/node/25.9.0/bin/node
else
  echo "[start.sh] Error: node not found" >&2; exit 1
fi
TSX="./node_modules/.bin/tsx"
if [[ ! -x "$TSX" ]]; then
  echo "[start.sh] Error: tsx not found (run npm install)" >&2; exit 1
fi

echo "[start.sh] Using node: $($NODE -v)"

# --- ai_proxy 起動 ---
export PROXY_PORT UPSTREAM
"$NODE" "$TSX" src/main.ts &
PROXY_PID=$!

cleanup() {
  echo ""
  echo "[start.sh] Shutting down (pid: ${PROXY_PID})..."
  kill "$PROXY_PID" 2>/dev/null || true
  wait "$PROXY_PID" 2>/dev/null || true
  echo "[start.sh] Done."
}
trap cleanup EXIT INT TERM

# プロキシの起動待ち
echo "[start.sh] Waiting for proxy on :${PROXY_PORT}..."
for i in $(seq 1 30); do
  if curl -s "${ENDPOINT}/v1/models" >/dev/null 2>&1; then
    echo "[start.sh] Proxy is ready."
    break
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "[start.sh] Proxy process died." >&2
    exit 1
  fi
  sleep 0.3
done

# --- Dashboard アプリ起動 ---
if $LAUNCH_DASHBOARD; then
  DASHBOARD_APP="./gui/src-tauri/target/release/bundle/macos/Veltrea Interceptor.app"
  DASHBOARD_BIN="./gui/src-tauri/target/release/dashboard"
  if [[ -d "$DASHBOARD_APP" ]]; then
    open "$DASHBOARD_APP"
    echo "[start.sh] Veltrea Interceptor.app launched."
  elif [[ -x "$DASHBOARD_BIN" ]]; then
    "$DASHBOARD_BIN" &
    echo "[start.sh] Dashboard binary launched."
  else
    echo "[start.sh] Warning: dashboard not built, skipping. Run: cd dashboard && npx tauri build"
  fi
fi

# --- chat-client 起動 ---
if $LAUNCH_CLIENT; then
  if [[ -d ./ChatClient.app ]]; then
    ENDPOINT="${ENDPOINT}" open ./ChatClient.app
    echo "[start.sh] ChatClient.app launched."
  elif [[ -x ./chat-client ]]; then
    ENDPOINT="${ENDPOINT}" ./chat-client &
    echo "[start.sh] chat-client binary launched."
  else
    echo "[start.sh] Warning: chat-client binary not found, skipping."
  fi
fi

echo "[start.sh] Press Ctrl+C to stop."
wait "$PROXY_PID"
