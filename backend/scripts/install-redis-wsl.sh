#!/usr/bin/env bash
set -euo pipefail

redis_home="${WINDUP_REDIS_HOME:-$HOME/.local/redis-windup}"
redis_server="$redis_home/usr/bin/redis-server"
redis_cli="$redis_home/usr/bin/redis-cli"
export LD_LIBRARY_PATH="$redis_home/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

if [[ -x "$redis_server" && -x "$redis_cli" ]]; then
  "$redis_server" --version
  exit 0
fi

install_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$install_dir"
}
trap cleanup EXIT

cd "$install_dir"
apt download redis-server redis-tools liblzf1 >/dev/null
mkdir -p "$redis_home"
for package in ./*.deb; do
  dpkg-deb -x "$package" "$redis_home"
done

mkdir -p "${WINDUP_REDIS_DATA:-$HOME/.local/share/windup-redis}"
"$redis_server" --version
