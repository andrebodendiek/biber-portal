#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Biber-Portal – Build- und Deploy-Helfer (macOS/Linux, bash 3.2-kompatibel)
#
#   ./build.sh            Prüfen + Deploy-Paket (dist/biber-portal.tar) bauen
#   ./build.sh check      Abhängigkeiten installieren, Syntax und Tests prüfen
#   ./build.sh test       Unit- und Ende-zu-Ende-Tests (mit Test-IServ)
#   ./build.sh dev        Lokal starten: Portal http://localhost:3000 + Test-IServ :4000
#   ./build.sh docker     Docker-Image bauen und lokal auf Port 3000 starten
#   ./build.sh deploy     Paket bauen und mit der CapRover-CLI deployen –
#                         Server und App werden interaktiv aus deiner Liste gewählt
#   ./build.sh deploy APP direkt in die App APP deployen (auch: CAPROVER_APP=APP)
#   ./build.sh secrets    SESSION_SECRET und DATA_KEY erzeugen
#   ./build.sh clean      dist/ und lokale Laufzeitdaten löschen
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
APP_NAME="biber-portal"               # nur für lokale Docker-Namen
DIST="$ROOT/dist"
TAR="$DIST/biber-portal.tar"
PORT="${PORT:-3000}"
MOCK_PORT="${MOCK_PORT:-4000}"

c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
info() { printf '%s▸%s %s\n' "$c_dim" "$c_off" "$*"; }
ok()   { printf '%s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s!%s %s\n' "$c_warn" "$c_off" "$*"; }
fail() { printf '%s✗ %s%s\n' "$c_err" "$*" "$c_off" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "„$1“ wird benötigt, ist aber nicht installiert. $2"; }

check_node() {
  need node "Installation: https://nodejs.org (Version 20 oder neuer) oder 'brew install node'."
  need npm ""
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || fail "Node.js $major ist zu alt – bitte Version 20 oder neuer installieren."
  ok "Node.js $(node -v)"
}

install_deps() {
  # Nur installieren, wenn nötig (fehlend oder package-lock.json neuer). Erzwingen: FRESH=1 ./build.sh
  if [ -z "${FRESH:-}" ] && [ -f node_modules/.package-lock.json ] && [ ! package-lock.json -nt node_modules/.package-lock.json ]; then
    ok "Abhängigkeiten aktuell"
    return
  fi
  if [ -f package-lock.json ]; then
    info "Installiere Abhängigkeiten (npm ci) …"
    npm ci --no-audit --no-fund >/dev/null
  else
    info "Installiere Abhängigkeiten (npm install) …"
    npm install --no-audit --no-fund >/dev/null
  fi
  ok "Abhängigkeiten installiert"
}

check_syntax() {
  info "Prüfe JavaScript-Syntax …"
  local f
  for f in server.js lib/*.js public/js/*.js tools/*.js test/*.js; do
    node --check "$f" 2>/dev/null || { node --check "$f"; fail "Syntaxfehler in $f"; }
  done
  ok "Syntax in Ordnung"
}

check_icloud() {
  # macOS: Ist das Projekt in iCloud ausgelagert („dataless“), werden Tests extrem langsam oder hängen.
  [ "$(uname)" = "Darwin" ] || return 0
  if ls -lO package.json server.js lib/*.js node_modules/*/package.json 2>/dev/null | grep -q dataless; then
    warn "Teile des Projekts liegen nur in iCloud (ausgelagert) – Tests und Build können dadurch minutenlang hängen."
    warn "Abhilfe: Projekt aus „Schreibtisch“/„Dokumente“ verschieben (z. B. nach ~/Developer) oder im Finder"
    warn "auf den Ordner rechtsklicken → „Immer auf diesem Mac behalten“. Danach: FRESH=1 ./build.sh"
  fi
}

check_unit() {
  check_icloud
  info "Führe Tests aus (Import, Speicher, Phasen, IServ-Anmeldung) …"
  if ! npm test --silent >/tmp/biber-portal-test.log 2>&1; then
    tail -60 /tmp/biber-portal-test.log
    fail "Tests fehlgeschlagen – Ausgabe siehe oben (vollständig: /tmp/biber-portal-test.log)"
  fi
  ok "Tests bestanden ($(grep -E '^# pass' /tmp/biber-portal-test.log | awk '{print $3}') von $(grep -E '^# tests' /tmp/biber-portal-test.log | awk '{print $3}'))"
}

check_files() {
  local f
  for f in Dockerfile captain-definition package.json package-lock.json server.js public/css/app.css; do
    [ -f "$f" ] || fail "Datei fehlt: $f"
  done
}

package() {
  check_files
  mkdir -p "$DIST"
  info "Baue Deploy-Paket …"
  # COPYFILE_DISABLE verhindert macOS-Metadateien (._*) im Archiv
  local macflags=""
  if tar --version 2>/dev/null | grep -qi bsdtar; then macflags="--no-xattrs --no-mac-metadata"; fi
  # shellcheck disable=SC2086
  # Lesbare Dateirechte sicherstellen (zusätzlich zur Korrektur im Dockerfile)
  chmod -R a+rX server.js lib public package.json package-lock.json Dockerfile captain-definition 2>/dev/null || true
  # Erst in eine Temp-Datei schreiben, dann ersetzen (robust gegen gesperrte Dateien durch Cloud-Sync)
  local tmp="$DIST/.biber-portal.$$.tar"
  COPYFILE_DISABLE=1 tar $macflags -cf "$tmp" \
    --exclude='./node_modules' --exclude='./dist' --exclude='./data' \
    --exclude='./.git' --exclude='./.env' --exclude='./_to_delete' --exclude='*.log' --exclude='.DS_Store' --exclude='._*' \
    .
  mv -f "$tmp" "$TAR" || fail "Paket konnte nicht nach $TAR geschrieben werden (Datei gesperrt?) – liegt unter $tmp"
  local size
  size="$(du -h "$TAR" | cut -f1 | tr -d ' ')"
  ok "Paket erstellt: dist/biber-portal.tar ($size)"
  printf '%s  → In CapRover: App → Deployment → „Upload tar file“, oder ./build.sh deploy%s\n' "$c_dim" "$c_off"
}

cmd_dev() {
  check_node
  [ -d node_modules ] || install_deps
  mkdir -p "$ROOT/data/dev"
  info "Starte Test-IServ auf http://localhost:$MOCK_PORT …"
  MOCK_PORT="$MOCK_PORT" node tools/mock-iserv.js &
  local mock_pid=$!
  trap 'kill $mock_pid 2>/dev/null || true' EXIT INT TERM
  sleep 1
  info "Starte Portal auf http://localhost:$PORT – Anmeldung über den Test-IServ (Admin: andre.bodendiek) – Beenden mit Strg+C"
  NODE_ENV=development PORT="$PORT" BASE_URL="http://localhost:$PORT" ISERV_URL="http://localhost:$MOCK_PORT" \
    OIDC_CLIENT_ID=biber-portal OIDC_CLIENT_SECRET=dev-secret ADMIN_ACCOUNTS="${ADMIN_ACCOUNTS:-andre.bodendiek}" \
    DATA_DIR="${DATA_DIR:-$ROOT/data/dev}" node server.js
}

cmd_docker() {
  need docker "Installation: https://www.docker.com/products/docker-desktop"
  info "Baue Docker-Image $APP_NAME …"
  docker build -t "$APP_NAME" .
  ok "Image gebaut"
  docker rm -f "$APP_NAME" >/dev/null 2>&1 || true
  docker volume create "${APP_NAME}-data" >/dev/null
  local secret key
  secret="$(node -e 'console.log(require("crypto").randomBytes(36).toString("base64url"))')"
  key="${DATA_KEY:-lokaler-docker-schluessel-nur-zum-testen-0000}"
  docker run -d --name "$APP_NAME" -p "$PORT:80" \
    -e BASE_URL="http://localhost:$PORT" \
    -e ISERV_URL="${ISERV_URL:-http://host.docker.internal:$MOCK_PORT}" \
    -e OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-biber-portal}" -e OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-dev-secret}" \
    -e ADMIN_ACCOUNTS="${ADMIN_ACCOUNTS:-andre.bodendiek}" \
    -e SESSION_SECRET="${SESSION_SECRET:-$secret}" -e DATA_KEY="$key" -e TRUST_PROXY="" \
    -v "${APP_NAME}-data:/app/data" "$APP_NAME" >/dev/null
  ok "Container läuft: http://localhost:$PORT"
  printf '%s  Ohne echtes IServ: vorher in einem zweiten Terminal „npm run mock-iserv“ starten.%s\n' "$c_dim" "$c_off"
  printf '%s  Logs: docker logs -f %s · Stoppen: docker rm -f %s%s\n' "$c_dim" "$APP_NAME" "$APP_NAME" "$c_off"
}

cmd_deploy() {
  need caprover "Installation: npm install -g caprover · danach einmalig: caprover login"
  local app="${1:-${CAPROVER_APP:-}}"
  build_all
  if [ -n "$app" ]; then
    info "Deploye nach CapRover (App: $app) …"
    caprover deploy -t "$TAR" -a "$app"
  else
    info "Deploye nach CapRover – Server und App bitte in der folgenden Auswahl festlegen …"
    caprover deploy -t "$TAR"
  fi
  ok "Deployment abgeschlossen. In der App prüfen: Umgebungsvariablen (.env.example), Persistent Directory /app/data, Container-Port 80."
}

cmd_secrets() {
  check_node >/dev/null
  node -e '
    const c = require("crypto")
    console.log(`SESSION_SECRET=${c.randomBytes(48).toString("base64url")}`)
    console.log(`DATA_KEY=${c.randomBytes(48).toString("base64url")}`)
  '
  printf '%s  → In CapRover: App → „App Configs“ → „Environmental Variables“ → „Bulk Edit“ einfügen → „Save & Update“.%s\n' "$c_dim" "$c_off"
  printf '%s  Neuer SESSION_SECRET meldet alle ab.%s\n' "$c_dim" "$c_off"
  printf '%s  ACHTUNG: DATA_KEY nur beim ersten Einrichten setzen – ein neuer Schlüssel macht gespeicherte Zugangsdaten unlesbar.%s\n' "$c_warn" "$c_off"
}

build_all() {
  check_node
  install_deps
  check_syntax
  check_unit
  package
}

case "${1:-build}" in
  build)   build_all ;;
  check)   check_node; install_deps; check_syntax; check_unit ;;
  test)    check_node; install_deps; check_unit ;;
  dev)     cmd_dev ;;
  docker)  cmd_docker ;;
  deploy)  cmd_deploy "${2:-}" ;;
  secrets) cmd_secrets ;;
  clean)   rm -rf "$DIST" "$ROOT/data/dev"; ok "dist/ und data/dev/ gelöscht" ;;
  -h|--help|help) sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) fail "Unbekannter Befehl „$1“ – ./build.sh help zeigt alle Optionen." ;;
esac
