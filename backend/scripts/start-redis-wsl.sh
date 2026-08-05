#!/usr/bin/env bash
set -euo pipefail

redis_home="${WINDUP_REDIS_HOME:-$HOME/.local/redis-windup}"
redis_data="${WINDUP_REDIS_DATA:-$HOME/.local/share/windup-redis}"
redis_server="$redis_home/usr/bin/redis-server"
redis_cli="$redis_home/usr/bin/redis-cli"
export LD_LIBRARY_PATH="$redis_home/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

if [[ "${1:-}" == "--ping" ]]; then
  exec "$redis_cli" -h 127.0.0.1 -p 6379 ping
fi

if [[ ! -x "$redis_server" ]]; then
  echo "Redis runtime is missing. Run install-redis-wsl.sh first." >&2
  exit 1
fi

if "$redis_cli" -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -qx PONG; then
  echo "Redis is already running on 127.0.0.1:6379."
  exit 0
fi

mkdir -p "$redis_data"
exec "$redis_server" \
  --bind 127.0.0.1 \
  --port 6379 \
  --protected-mode yes \
  --dir "$redis_data" \
  --appendonly yes \
  --save 60 1 \
  --daemonize no
