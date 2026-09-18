#!/usr/bin/env bash
# Обёртка для cron: запускает проверку устаревания данных и дописывает результат в logs/staleness-check.log.
# Код выхода скрипта проверки сохраняется (1 — апстрим изменился).
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  python3 scripts/check_data_staleness.py
  code=$?
  echo "(код выхода: $code)"
  echo
} >> logs/staleness-check.log 2>&1
exit "${code:-0}"
