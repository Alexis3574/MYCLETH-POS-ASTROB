#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

MODE="${1:-scan}"
SCOPE="$MODE"

if [[ "$MODE" == "preflight" ]]; then
  SCOPE="${2:-all}"
fi

case "$MODE" in
  scan|preflight|integration|http|all) ;;
  *)
    echo "Uso: $0 scan|preflight|integration|http|all"
    exit 1
    ;;
esac

case "$SCOPE" in
  scan|integration|http|all) ;;
  *)
    echo "Alcance inválido."
    exit 1
    ;;
esac

MODULES=(
  products-catalogo
  inventory
  transfers
  cash
  customers
  suppliers
)

discover() {
  local directory="tests/$1"
  local category="$2"

  [[ -d "$directory" ]] || return 0

  if [[ "$category" == "integration" ]]; then
    find "$directory" -type f \
      \( -iname "*integration*.ts" \
      -o -iname "*integration*.mjs" \
      -o -iname "*postgres*.ts" \
      -o -iname "*postgres*.mjs" \
      -o -iname "*concurrency*.ts" \
      -o -iname "*concurrency*.mjs" \) | sort
  else
    find "$directory" -type f \
      \( -iname "*http*.ts" \
      -o -iname "*http*.mjs" \
      -o -iname "*http*.js" \) | sort
  fi
}

issues=0

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[FALTA] $name"
    ((issues+=1))
  else
    echo "[OK] $name configurada"
  fi
}

check_database() {
  if ! node -e '
    try {
      const u = new URL(process.argv[1]);
      const name = decodeURIComponent(u.pathname.slice(1));
      const local = ["localhost", "127.0.0.1", "[::1]"]
        .includes(u.hostname);
      const test = /(?:^|[_-])test$/i.test(name);
      const pg = ["postgres:", "postgresql:"]
        .includes(u.protocol);
      process.exit(local && test && pg ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "${TEST_DATABASE_URL:-}" >/dev/null 2>&1; then
    echo "[BLOQUEADO] TEST_DATABASE_URL debe apuntar a PostgreSQL local y una BD terminada en _test."
    ((issues+=1))
  else
    echo "[OK] Formato de TEST_DATABASE_URL"
  fi
}

check_http() {
  if ! node -e '
    try {
      const u = new URL(process.argv[1]);
      const local = ["localhost", "127.0.0.1", "[::1]"]
        .includes(u.hostname);
      process.exit(local && u.protocol === "http:" ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "${TEST_HTTP_BASE_URL:-}" >/dev/null 2>&1; then
    echo "[BLOQUEADO] TEST_HTTP_BASE_URL debe apuntar a HTTP local."
    ((issues+=1))
  else
    echo "[OK] Formato de TEST_HTTP_BASE_URL"
  fi

  if [[ "${TEST_HTTP_ISOLATED:-}" != "SI" ]]; then
    echo "[BLOQUEADO] Falta confirmar TEST_HTTP_ISOLATED=SI."
    ((issues+=1))
  fi

  for variable in \
    INVENTORY_READ_TOKEN \
    INVENTORY_DENIED_ADJUST_TOKEN \
    INVENTORY_ADJUST_TOKEN \
    TRANSFERS_HTTP_TOKEN \
    TRANSFERS_HTTP_READ_ONLY_TOKEN \
    TRANSFERS_HTTP_OTHER_COMPANY_TOKEN \
    TRANSFERS_HTTP_BODY_JSON
  do
    required "$variable"
  done

  if [[ -n "${TRANSFERS_HTTP_BODY_JSON:-}" ]]; then
    if ! node -e '
      JSON.parse(process.argv[1])
    ' "$TRANSFERS_HTTP_BODY_JSON" >/dev/null 2>&1; then
      echo "[BLOQUEADO] TRANSFERS_HTTP_BODY_JSON no contiene JSON válido."
      ((issues+=1))
    fi
  fi
}

echo "========================================"
echo " POSMYCLETH - PRUEBAS INTEGRACION Y HTTP"
echo "========================================"
echo "Modo: $MODE"
echo "Alcance: $SCOPE"
echo ""

if [[ "$MODE" != "scan" ]]; then
  check_database

  if [[ "$SCOPE" == "http" || "$SCOPE" == "all" ]]; then
    check_http
  fi

  echo ""

  if ((issues > 0)); then
    echo "Resultado: BLOQUEADO ($issues requisitos pendientes)."
    echo "No se ejecutaron pruebas."
    exit 3
  fi

  if [[ "$MODE" == "preflight" ]]; then
    echo "Preflight correcto: requisitos declarados presentes."
    echo "Todavía debes verificar que los servicios realmente utilicen la base de pruebas."
    echo "No se ejecutaron pruebas."
    exit 0
  fi

  export DATABASE_URL="$TEST_DATABASE_URL"
  export DIRECT_URL="$TEST_DATABASE_URL"
  export INVENTORY_CONCURRENCY_DATABASE_URL="$TEST_DATABASE_URL"
  export TRANSFERS_TEST_DATABASE_URL="$TEST_DATABASE_URL"
  export TRANSFERS_ALLOW_DB_TESTS="true"
  export INVENTORY_SYNC_ENABLED="false"

  if [[ "$SCOPE" == "http" || "$SCOPE" == "all" ]]; then
    export INVENTORY_API_URL="$TEST_HTTP_BASE_URL"
    export TRANSFERS_HTTP_API_URL="$TEST_HTTP_BASE_URL"
    export TRANSFERS_HTTP_TEST_ENABLED="true"
    export TRANSFERS_HTTP_ISOLATED_ENVIRONMENT="true"
  fi

  REPORT_DIR="${TMPDIR:-/tmp}/posmycleth-check-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$REPORT_DIR"

  echo "Registros: $REPORT_DIR"
fi

passed=0
failed=0
pending=0

for module in "${MODULES[@]}"; do
  echo ""
  echo "========== $module =========="

  for category in integration http; do
    if [[ "$MODE" != "scan" && "$SCOPE" != "all" && "$SCOPE" != "$category" ]]; then
      continue
    fi

    mapfile -t files < <(discover "$module" "$category")

    echo "Categoria: $category"

    if ((${#files[@]} == 0)); then
      echo "[PENDIENTE] Sin scripts disponibles."
      ((pending+=1))
      continue
    fi

    for file in "${files[@]}"; do
      echo "Archivo: $file"

      if [[ "$MODE" == "scan" ]]; then
        echo "[DETECTADO] Sin ejecutar."
        continue
      fi

      if [[ "$file" == *.ts ]]; then
        command=(npx --no-install tsx --test)
      else
        command=(node --test)
      fi

      log="$REPORT_DIR/$module-$(basename "$file").log"

      "${command[@]}" "$file" 2>&1 | tee "$log"
      result=${PIPESTATUS[0]}

      if ((result != 0)); then
        echo "[FALLIDO] $file"
        ((failed+=1))
      elif grep -q '\[PENDIENTE\]' "$log"; then
        echo "[INCOMPLETO] $file"
        ((pending+=1))
      else
        echo "[APROBADO] $file"
        ((passed+=1))
      fi
    done
  done
done

echo ""
echo "========================================"
echo " RESUMEN FINAL"
echo "========================================"
echo "Scripts aprobados: $passed"
echo "Scripts fallidos: $failed"
echo "Pendientes: $pending"

if [[ "$MODE" == "scan" ]]; then
  echo "Inspección finalizada. No se ejecutaron pruebas."
  exit 0
fi

echo "Registros: $REPORT_DIR"

if ((failed > 0)); then
  exit 1
fi

if ((pending > 0)); then
  echo "Validación incompleta."
  exit 2
fi

echo "Validación completada."
exit 0
