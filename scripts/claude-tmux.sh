#!/bin/bash
# Поднимает сессию Claude Code в tmux (сессия «claude», каталог проекта).
# Если сессия уже есть — ничего не делает. Всегда возобновляется именно эта сессия Claude (новых не создаёт).
set -e
export PATH=/root/.local/bin:/usr/local/bin:/usr/bin:/bin
export HOME=/root
SESSION=claude
DIR=/opt/albion-market-table
CLAUDE_SESSION_ID=103905a5-e856-4f50-a09d-2fe7693a0f54

if tmux has-session -t "$SESSION" 2>/dev/null; then
  exit 0
fi
# после выхода из claude оболочка остаётся, чтобы окно tmux не закрывалось
tmux new-session -d -s "$SESSION" -c "$DIR" "claude --resume $CLAUDE_SESSION_ID; exec bash"
