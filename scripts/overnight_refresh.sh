#!/usr/bin/env bash
# Overnight full refresh: clear everything (local + DB data), re-scrape all providers,
# translate titles, sync to DB, and regenerate embeddings on translated text.
#
# Safe to run with or without sudo. If sudoed, we demote node/npm commands back to
# $SUDO_USER so Playwright can find the browsers under that user's ~/.cache.
#
# Usage:
#   bash scripts/overnight_refresh.sh                 # run for real
#   bash scripts/overnight_refresh.sh --dry-run       # show phases, do nothing
#   bash scripts/overnight_refresh.sh --skip-scrape   # re-use current data/*.json
#
# Exits non-zero on fatal errors (DB unreachable, migration failed, sync failed).
# Individual scraper failures are logged but do not abort the rest.

set -o pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
RUN_TS="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$LOG_DIR/overnight_$RUN_TS.log"

DRY_RUN=0
SKIP_SCRAPE=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --skip-scrape) SKIP_SCRAPE=1 ;;
    esac
done

# ─── Root / sudo handling ─────────────────────────────────────────────────────
# If running as root via sudo, demote to the invoking user for node/npm so
# Playwright finds ~/.cache/ms-playwright and nvm paths.
RUN_AS_USER=""
if [[ $EUID -eq 0 ]]; then
    if [[ -n "${SUDO_USER:-}" && "${SUDO_USER:-}" != "root" ]]; then
        RUN_AS_USER="$SUDO_USER"
        echo "[pre] Running as root; will demote node/npm to user: $RUN_AS_USER"
    else
        echo "[pre] ERROR: Running as root without SUDO_USER — refusing to proceed." >&2
        echo "[pre]   Re-run as: sudo -E bash scripts/overnight_refresh.sh" >&2
        echo "[pre]   Or directly: bash scripts/overnight_refresh.sh" >&2
        exit 1
    fi
fi

# Resolve the target user's home for Playwright + nvm
if [[ -n "$RUN_AS_USER" ]]; then
    TARGET_HOME="$(getent passwd "$RUN_AS_USER" | cut -d: -f6)"
else
    TARGET_HOME="$HOME"
fi

# Locate node (nvm-installed). Prefer the target user's nvm node.
NODE_BIN="$(su - "${RUN_AS_USER:-$USER}" -c 'command -v node' 2>/dev/null || command -v node)"
NPM_BIN="$(su - "${RUN_AS_USER:-$USER}" -c 'command -v npm' 2>/dev/null || command -v npm)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
    echo "[pre] ERROR: node not found. Install Node via nvm for the invoking user." >&2
    exit 1
fi

# ─── Helpers ──────────────────────────────────────────────────────────────────
log() {
    local msg="$*"
    echo "[$(date +'%H:%M:%S')] $msg" | tee -a "$LOG_FILE"
}
run_node() {
    # Run a node command as the target user with the right HOME + PATH.
    local cmd="$*"
    if [[ $DRY_RUN -eq 1 ]]; then
        log "DRY: node $cmd"
        return 0
    fi
    if [[ -n "$RUN_AS_USER" ]]; then
        sudo -u "$RUN_AS_USER" env HOME="$TARGET_HOME" \
            PLAYWRIGHT_BROWSERS_PATH="$TARGET_HOME/.cache/ms-playwright" \
            PATH="$TARGET_HOME/.nvm/versions/node/$($NODE_BIN --version | tr -d v)/bin:$PATH" \
            bash -c "cd '$PROJECT_DIR' && node $cmd" 2>&1 | tee -a "$LOG_FILE"
    else
        PLAYWRIGHT_BROWSERS_PATH="$TARGET_HOME/.cache/ms-playwright" \
            "$NODE_BIN" $cmd 2>&1 | tee -a "$LOG_FILE"
    fi
    return "${PIPESTATUS[0]}"
}
run_npm() {
    local cmd="$*"
    if [[ $DRY_RUN -eq 1 ]]; then
        log "DRY: npm $cmd"
        return 0
    fi
    if [[ -n "$RUN_AS_USER" ]]; then
        sudo -u "$RUN_AS_USER" env HOME="$TARGET_HOME" \
            PATH="$TARGET_HOME/.nvm/versions/node/$($NODE_BIN --version | tr -d v)/bin:$PATH" \
            bash -c "cd '$PROJECT_DIR' && npm $cmd" 2>&1 | tee -a "$LOG_FILE"
    else
        "$NPM_BIN" $cmd 2>&1 | tee -a "$LOG_FILE"
    fi
    return "${PIPESTATUS[0]}"
}

# Read DB creds from .env so we don't hardcode them here.
# Requires: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
load_env() {
    if [[ -f "$PROJECT_DIR/.env" ]]; then
        # shellcheck disable=SC2046
        set -a
        # Only export the 5 vars we care about — don't let the whole .env bleed in.
        while IFS='=' read -r key val; do
            case "$key" in
                DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME|TRANSLATOR_URL)
                    export "$key=$val" ;;
            esac
        done < <(grep -E '^(DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME|TRANSLATOR_URL)=' "$PROJECT_DIR/.env" | sed 's/#.*//')
        set +a
    fi
    : "${DB_HOST:=localhost}"
    : "${DB_PORT:=5432}"
    : "${DB_USER:=postgres}"
    : "${DB_PASSWORD:=postgres}"
    : "${DB_NAME:=postgres}"
    : "${TRANSLATOR_URL:=http://127.0.0.1:8000}"
}
psql_run() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q "$@" 2>&1 | tee -a "$LOG_FILE"
    return "${PIPESTATUS[0]}"
}

# ─── Phase 0: Pre-flight ──────────────────────────────────────────────────────
log "════════════════════════════════════════════════════════════════"
log "Overnight refresh starting. Log: $LOG_FILE"
log "Mode: $([[ $DRY_RUN -eq 1 ]] && echo DRY-RUN || echo LIVE)$([[ $SKIP_SCRAPE -eq 1 ]] && echo ' (skip-scrape)')"
log "Target user: ${RUN_AS_USER:-$USER}  Home: $TARGET_HOME"
log "Node: $($NODE_BIN --version)"
log "════════════════════════════════════════════════════════════════"

load_env
log "[phase 0] Pre-flight checks..."

# Docker services
if ! docker ps --format '{{.Names}}' | grep -q '^product_aggregator_postgres$'; then
    log "[phase 0] ERROR: product_aggregator_postgres not running."
    exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -q '^product_aggregator_translator$'; then
    log "[phase 0] ERROR: product_aggregator_translator not running."
    exit 1
fi
log "[phase 0] ✓ Docker containers healthy."

# DB ping
if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
    log "[phase 0] ERROR: Cannot connect to Postgres at $DB_HOST:$DB_PORT."
    exit 1
fi
log "[phase 0] ✓ Postgres reachable."

# Translator ping
if ! curl -sf -X POST "$TRANSLATOR_URL/translate" -H 'Content-Type: application/json' \
    -d '{"text":"ping","to":"en"}' --max-time 10 >/dev/null 2>&1; then
    log "[phase 0] ERROR: Translator at $TRANSLATOR_URL did not respond."
    exit 1
fi
log "[phase 0] ✓ Translator responding."

# Playwright browsers
if [[ ! -d "$TARGET_HOME/.cache/ms-playwright/chromium-1200" ]]; then
    log "[phase 0] WARN: Playwright chromium not found at $TARGET_HOME/.cache/ms-playwright/"
    log "[phase 0]        Run: sudo -u ${RUN_AS_USER:-$USER} npx playwright install chromium"
fi

# Disk space (need at least 5GB free)
FREE_GB=$(df -BG "$PROJECT_DIR" | awk 'NR==2 {gsub("G","",$4); print $4}')
log "[phase 0] ✓ Free disk: ${FREE_GB}GB"
if [[ ${FREE_GB:-0} -lt 5 ]]; then
    log "[phase 0] ERROR: Need at least 5GB free disk, have ${FREE_GB}GB."
    exit 1
fi

# ─── Phase 1: Clear local data ────────────────────────────────────────────────
log "[phase 1] Clearing local JSON data..."
if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY: would rm data/products_*.json data/normalized_db*.json data/category_mapping_*.json"
else
    rm -f "$PROJECT_DIR"/data/products_*.json
    rm -f "$PROJECT_DIR"/data/normalized_db*.json
    # Drop the category_mapping cache so normalizer re-evaluates against the updated
    # category_rules.js (word-boundary matching introduced 2026-04-18).
    rm -f "$PROJECT_DIR"/data/category_mapping_*.json
    log "[phase 1] ✓ Cleared raw + normalized JSONs + category mapping cache. Kept unified_categories.json + translation_cache.json."
fi

# ─── Phase 2: Clear DB data (preserving schema) ───────────────────────────────
log "[phase 2] Clearing DB tables (products, categories, price_history, etc.)..."
if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY: would TRUNCATE price_history, product_stocks, category_links, products, categories, providers"
else
    psql_run <<'EOF' || { log "[phase 2] ERROR: truncate failed"; exit 1; }
BEGIN;
TRUNCATE TABLE price_history RESTART IDENTITY CASCADE;
TRUNCATE TABLE product_stocks RESTART IDENTITY CASCADE;
TRUNCATE TABLE category_links RESTART IDENTITY CASCADE;
TRUNCATE TABLE products RESTART IDENTITY CASCADE;
TRUNCATE TABLE categories RESTART IDENTITY CASCADE;
TRUNCATE TABLE providers RESTART IDENTITY CASCADE;
COMMIT;
EOF
    log "[phase 2] ✓ DB tables cleared."
fi

# ─── Phase 3: Apply migrations ────────────────────────────────────────────────
log "[phase 3] Running knex migrations (apply any pending)..."
run_npm run migrate || { log "[phase 3] ERROR: migration failed"; exit 1; }
log "[phase 3] ✓ Migrations up to date."

# ─── Phase 4: Scrape all providers (sequential) ───────────────────────────────
SCRAPER_FAILS=()
if [[ $SKIP_SCRAPE -eq 1 ]]; then
    log "[phase 4] --skip-scrape set; skipping scrapers."
else
    for provider in sas_am yerevan_city parma_am carrefour_am; do
        log "[phase 4] Scraping $provider ..."
        if ! run_node "crons/$provider/job.js"; then
            log "[phase 4] WARN: $provider scraper exited non-zero."
            SCRAPER_FAILS+=("$provider")
        else
            log "[phase 4] ✓ $provider scrape done."
        fi
    done
fi
if [[ ${#SCRAPER_FAILS[@]} -gt 0 ]]; then
    log "[phase 4] ${#SCRAPER_FAILS[@]} scraper(s) failed: ${SCRAPER_FAILS[*]}. Continuing with what we have."
fi

# ─── Phase 5: Deduplicate ─────────────────────────────────────────────────────
log "[phase 5] Deduplicating raw product JSON..."
run_node "processors/deduplicate.js" || log "[phase 5] WARN: deduplicate exited non-zero."

# ─── Phase 6: Normalize ───────────────────────────────────────────────────────
log "[phase 6] Normalizing per provider..."
NORM_FAILS=()
for provider in sas_am yerevan_city parma_am carrefour_am; do
    RAW="data/products_${provider}_clean.json"
    if [[ "$provider" == "sas_am" ]]; then RAW="data/products_sas_clean.json"; fi
    if [[ ! -f "$PROJECT_DIR/$RAW" ]]; then
        # fall back to uncleaned file
        alt="data/products_${provider}.json"
        if [[ "$provider" == "sas_am" ]]; then alt="data/products_sas.json"; fi
        if [[ -f "$PROJECT_DIR/$alt" ]]; then RAW="$alt"; else
            log "[phase 6] SKIP $provider: no raw file."
            NORM_FAILS+=("$provider")
            continue
        fi
    fi
    OUT="data/normalized_db_${provider}.json"
    if ! run_node "processors/normalizer_v2.js $provider $RAW $OUT"; then
        log "[phase 6] WARN: normalizer failed for $provider"
        NORM_FAILS+=("$provider")
    fi
done
[[ ${#NORM_FAILS[@]} -gt 0 ]] && log "[phase 6] Normalizer issues: ${NORM_FAILS[*]}"

# ─── Phase 7: Sync DB ─────────────────────────────────────────────────────────
log "[phase 7] Syncing to DB..."
if ! run_node "cmd/sync_db.js"; then
    log "[phase 7] ERROR: sync_db failed. Aborting — embeddings would be useless."
    exit 1
fi
log "[phase 7] ✓ DB sync complete."

# ─── Phase 8: Translate titles ────────────────────────────────────────────────
log "[phase 8] Translating product titles via $TRANSLATOR_URL ..."
if ! run_node "processors/translate_products.js"; then
    log "[phase 8] WARN: translation pass exited non-zero. Continuing with original titles."
fi

# ─── Phase 9: Generate embeddings on (translated) titles ──────────────────────
log "[phase 9] Generating embeddings..."
if ! run_node "processors/generate_embeddings.js"; then
    log "[phase 9] ERROR: embedding generation failed."
    exit 1
fi
log "[phase 9] ✓ Embeddings done."

# ─── Phase 10: Verification report ────────────────────────────────────────────
log "[phase 10] Final verification:"
if [[ $DRY_RUN -eq 0 ]]; then
    psql_run <<'EOF'
\echo '=== Row counts ==='
SELECT 'providers' AS t, count(*) FROM providers
UNION ALL SELECT 'categories', count(*) FROM categories
UNION ALL SELECT 'category_links', count(*) FROM category_links
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'products_with_embedding', count(*) FROM products WHERE embedding IS NOT NULL
UNION ALL SELECT 'products_translated', count(*) FROM products WHERE metadata ? 'original_title'
UNION ALL SELECT 'price_history', count(*) FROM price_history;

\echo '=== Per-provider breakdown ==='
SELECT p.name, count(*) AS products
FROM products pr JOIN providers p ON p.id = pr.provider_id
GROUP BY p.name ORDER BY p.name;

\echo '=== Sample products (1 per provider) ==='
SELECT p.name AS provider, pr.title, pr.price, pr.weight
FROM providers p
JOIN LATERAL (SELECT title, price, weight FROM products WHERE provider_id = p.id LIMIT 1) pr ON TRUE;
EOF
fi

log "════════════════════════════════════════════════════════════════"
log "DONE. Total time: $SECONDS seconds."
log "Log saved to: $LOG_FILE"
if [[ ${#SCRAPER_FAILS[@]} -gt 0 ]]; then
    log "⚠  Scraper failures: ${SCRAPER_FAILS[*]}"
fi
log "════════════════════════════════════════════════════════════════"
