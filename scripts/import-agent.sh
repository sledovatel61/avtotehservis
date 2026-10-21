#!/usr/bin/env bash
# Импорт работы агента из его ветки в папку проекта — с проверками.
#
# Примеры:
#   scripts/import-agent.sh --branch agent/01-brand-concept
#   scripts/import-agent.sh --pr 12
#   scripts/import-agent.sh --branch agent/01-brand-concept --stage 2
#   scripts/import-agent.sh --branch agent/01-brand-concept --dry-run
#
# Скрипт НЕ мержит ветку и НЕ меняет текущую ветку. Он читает файлы из
# указанного ref и копирует только agents/agent-NN/* в agents-output/ (этап 1)
# или mockups/ (этап 2).

set -euo pipefail

BRANCH=""
PR=""
AGENT=""
STAGE="1"
DRY=0

usage() {
  cat <<'EOF'
Импорт работы агента из его ветки в папку проекта — с проверками.
Скрипт НЕ мержит ветку и НЕ меняет текущую ветку. Он читает файлы из
указанного ref и копирует только agents/agent-NN/* в agents-output/ (этап 1)
или mockups/ (этап 2).

Примеры:
  scripts/import-agent.sh --branch agent/01-brand-concept
  scripts/import-agent.sh --pr 12
  scripts/import-agent.sh --branch agent/01-brand-concept --stage 2
  scripts/import-agent.sh --branch agent/01-brand-concept --dry-run

Опции:
  --branch <name>   ветка агента (например agent/01-brand-concept)
  --pr <number>     номер PR (ветка берётся из gh; путь не тестировался на живом PR)
  --agent <NN>      номер агента; если не указан — определяется по путям
  --stage <1|2>     1 = концепции (по умолчанию), 2 = мокапы
  --dry-run         только проверки, без копирования
  -h, --help        эта справка
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --pr) PR="${2:-}"; shift 2 ;;
    --agent) AGENT="${2:-}"; shift 2 ;;
    --stage) STAGE="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестная опция: $1" >&2; usage; exit 2 ;;
  esac
done

REPO="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO" ]]; then
  echo "ОШИБКА: запускать из git-репозитория проекта" >&2
  exit 2
fi

cd "$REPO"

if [[ -z "$BRANCH" && -n "$PR" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "ОШИБКА: gh не установлен, передай --branch" >&2
    exit 2
  fi
  BRANCH="$(gh pr view "$PR" --json headRefName --jq .headRefName 2>/dev/null || true)"
  if [[ -z "$BRANCH" ]]; then
    echo "ОШИБКА: не удалось получить ветку PR #$PR (нет доступа или PR не найден)" >&2
    exit 2
  fi
fi

if [[ -z "$BRANCH" ]]; then
  echo "ОШИБКА: нужен --branch или --pr" >&2
  usage
  exit 2
fi

# Определяем ref: сначала origin/<branch>, потом локальная ветка.
REF=""
for candidate in "refs/remotes/origin/$BRANCH" "refs/heads/$BRANCH"; do
  if git rev-parse --verify --quiet "$candidate" >/dev/null; then
    REF="$candidate"
    break
  fi
done

if [[ -z "$REF" ]]; then
  echo "Пробую git fetch origin $BRANCH …"
  if git fetch --quiet origin "$BRANCH" 2>/dev/null; then
    REF="refs/remotes/origin/$BRANCH"
  fi
fi

if [[ -z "$REF" ]] || ! git rev-parse --verify --quiet "$REF" >/dev/null; then
  echo "ОШИБКА: ветка '$BRANCH' не найдена ни локально, ни на origin." >&2
  echo "Проверь название или попроси агента запушить ветку." >&2
  exit 1
fi

SHA="$(git rev-parse --short "$REF")"
SUBJECT="$(git log -1 --pretty=%s "$REF")"

if [[ -z "$AGENT" ]]; then
  AGENT="$(git ls-tree -r --name-only "$REF" | sed -n 's#^agents/agent-\([0-9][0-9]\)/.*#\1#p' | head -1)"
fi

if [[ -z "$AGENT" ]]; then
  echo "ОШИБКА: в ветке нет папки agents/agent-NN/ — нарушен git-протокол." >&2
  echo "Файлы в ветке:" >&2
  git ls-tree -r --name-only "$REF" | sed -n '1,40p' >&2
  exit 1
fi

PREFIX="agents/agent-$AGENT"
mapfile -t FILES < <(git ls-tree -r --name-only "$REF" -- "$PREFIX" | sed "s#^$PREFIX/##")

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "ОШИБКА: папка $PREFIX пуста." >&2
  exit 1
fi

REQUIRED="concept.md"
[[ "$STAGE" == "2" ]] && REQUIRED="mockup.html"

WARNINGS=()
ERRORS=()
TOTAL=0

for f in "${FILES[@]}"; do
  # только безопасные имена
  if [[ "$f" == *".."* || "$f" == /* ]]; then
    ERRORS+=("недопустимый путь: $f"); continue
  fi

  size="$(git cat-file -s "$REF:$PREFIX/$f")"
  TOTAL=$((TOTAL + size))

  ext="${f##*.}"
  case "$ext" in
    md|html|txt|svg|json) ;;
    *) ERRORS+=("запрещённый тип файла: $f"); continue ;;
  esac

  if [[ "$ext" == "md" && "$size" -gt 204800 ]]; then
    ERRORS+=("md больше 200 КБ: $f")
  fi
  if [[ "$ext" == "html" && "$size" -gt 614400 ]]; then
    ERRORS+=("html больше 600 КБ: $f")
  fi

  content="$(git show "$REF:$PREFIX/$f")"

  if grep -Eq 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}' <<<"$content"; then
    ERRORS+=("похоже на секрет/ключ: $f")
  fi
  if grep -Eqi '(password|passwd|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*[^[:space:]<{[$]' <<<"$content"; then
    WARNINGS+=("возможный секрет в тексте: $f")
  fi
  if [[ "$ext" == "html" ]] && grep -Eq '<script[^>]+src=' <<<"$content"; then
    ERRORS+=("внешний JS запрещён в мокапе: $f")
  fi
done

found_required=0
for f in "${FILES[@]}"; do
  [[ "$f" == "$REQUIRED" ]] && found_required=1
done
[[ $found_required -eq 0 ]] && ERRORS+=("нет обязательного файла $REQUIRED")

if [[ $TOTAL -gt 2097152 ]]; then
  ERRORS+=("суммарный размер больше 2 МБ: $TOTAL байт")
fi

DEST_DIR="agents-output/round1/agent-$AGENT"
[[ "$STAGE" == "2" ]] && DEST_DIR="mockups/agent-$AGENT"

echo "──────────────────────────────────────────────"
echo "Ветка:   $BRANCH"
echo "Ref:     $REF"
echo "Коммит:  $SHA — $SUBJECT"
echo "Агент:   $AGENT"
echo "Этап:    $STAGE"
echo "Файлов:  ${#FILES[@]}, суммарно $TOTAL байт"
echo "Куда:    $DEST_DIR"
echo "──────────────────────────────────────────────"
for f in "${FILES[@]}"; do
  printf '  %-40s %8s байт\n' "$f" "$(git cat-file -s "$REF:$PREFIX/$f")"
done
echo "──────────────────────────────────────────────"

for w in "${WARNINGS[@]:-}"; do [[ -n "$w" ]] && echo "  ВНИМАНИЕ: $w"; done
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo "ПРОВЕРКА НЕ ПРОЙДЕНА:"
  for e in "${ERRORS[@]}"; do echo "  ✗ $e"; done
  exit 1
fi

echo "Проверки: OK (типы, размеры, секреты, внешний JS)"
echo "ВНИМАНИЕ: содержательная проверка (факты, плагиат, качество) — вручную."

if [[ $DRY -eq 1 ]]; then
  echo "DRY-RUN: файлы не копировались."
  exit 0
fi

mkdir -p "$DEST_DIR"
for f in "${FILES[@]}"; do
  mkdir -p "$DEST_DIR/$(dirname "$f")"
  git show "$REF:$PREFIX/$f" > "$DEST_DIR/$f"
done

echo "Импортировано: $DEST_DIR"
echo "Дальше: git add '$DEST_DIR' && git commit -m 'import agent-$AGENT stage $STAGE'"
