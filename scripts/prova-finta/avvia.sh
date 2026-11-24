#!/bin/bash
# Avvia la dashboard costruita (prima: npx next build) con dati finti e server in UTC,
# come su Vercel. Niente chiavi vere: Guesty, Edge Config e PriceLabs sono finti
# (rete-finta.cjs, pricelabs-finto.mjs), i prezzi PriceLabs finiscono in una cartella
# temporanea. Va bene anche in una copia della cartella.
#   bash scripts/prova-finta/avvia.sh        → http://localhost:3311
set -e
QUI="$(cd "$(dirname "$0")" && pwd)"
RADICE="$(cd "$QUI/../.." && pwd)"
TMP="$(mktemp -d)"
export TZ=UTC NEXT_TELEMETRY_DISABLED=1
# tra virgolette: il percorso della cartella ha degli spazi
export NODE_OPTIONS="--require \"$QUI/rete-finta.cjs\""
export ARCHIVIO_FINTO_FILE="$TMP/archivio.json" RETE_FINTA_LOG="$TMP/rete.log"
export GUESTY_CLIENT_ID=finto GUESTY_CLIENT_SECRET=finto GUESTY_ACCESS_TOKEN=gettone-finto
export DASHBOARD_PASSWORD="prova-$(openssl rand -hex 4)" SESSION_SECRET="$(openssl rand -hex 24)" CRON_SECRET="$(openssl rand -hex 16)"
export EDGE_CONFIG='https://edge-config.finto/ecfg_finto?token=t' EDGE_CONFIG_ID=ecfg_finto VERCEL_API_TOKEN=finto
export PRICELABS_API_KEY=chiave-finta PRICELABS_BASE_URL=http://127.0.0.1:4011 PREZZI_DIR="$TMP/prezzi"
unset VERCEL BLOB_READ_WRITE_TOKEN
echo "Password di prova: $DASHBOARD_PASSWORD"
echo "Cron:  curl -H 'Authorization: Bearer $CRON_SECRET' http://localhost:3311/api/pricelabs/salva"
echo "File:  $TMP (registro rete finta, archivio, prezzi)"
NODE_OPTIONS= node "$QUI/pricelabs-finto.mjs" & PL=$!
trap 'kill $PL 2>/dev/null' EXIT
cd "$RADICE" && npx next start -p "${PORTA:-3311}"
