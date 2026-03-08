#!/bin/bash
# Rose Glass News — Daily Ingest + Poem Agent Cron
# Runs at 6:00 AM local time every day
#
# Install:
#   chmod +x scripts/cron_ingest.sh
#   crontab -e
#   Add: 0 6 * * * /Users/chris/rose-glass-news/scripts/cron_ingest.sh

set -e

HOME_DIR="/Users/chris"
PYTHON="$HOME_DIR/IPAI/.venv/bin/python3"
SCRIPTS="$HOME_DIR/rose-glass-news/scripts"
LOG="$HOME_DIR/rose-glass-news/logs/ingest.log"

mkdir -p "$HOME_DIR/rose-glass-news/logs"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting daily ingest" >> "$LOG"

# 1. Harvest new articles
PYTHONPATH="$HOME_DIR/IPAI" \
  "$PYTHON" "$SCRIPTS/daily_ingest.py" --discover \
  >> "$LOG" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ingest complete. Running poem agent..." >> "$LOG"

# 2. Poem any new sources
PYTHONPATH="$HOME_DIR/IPAI" \
  "$PYTHON" "$SCRIPTS/poem_agent.py" --limit 200 --workers 8 \
  >> "$LOG" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Poem agent complete" >> "$LOG"
