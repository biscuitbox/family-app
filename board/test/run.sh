#!/usr/bin/env bash
# run.sh — 보드의 규칙 코드(C)를 컴퓨터에서 빌드하고, 앱(app.js)과 같은 결과를 내는지 비교한다.
# 필요: gcc, node 18+, git (cJSON을 처음 한 번 받아 온다)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
if [ ! -f build/cJSON/cJSON.c ]; then
  git clone --depth 1 https://github.com/DaveGamble/cJSON.git build/cJSON >/dev/null 2>&1
fi
SRC="../main/ikey.c ../main/model.c ../main/fs_json.c build/cJSON/cJSON.c"
CFLAGS="-std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -Wno-unused-result -O1 -I../main -Ibuild/cJSON"
gcc $CFLAGS -o build/logic_cli logic_cli.c $SRC -lm
gcc $CFLAGS -o build/test_patch test_patch.c $SRC -lm
node make_configs.mjs

# 2026-11-16(월) ~ 2026-11-29(일), 10분 간격 (KST)
START=$(TZ=Asia/Seoul date -d '2026-11-16 00:00' +%s)
EPOCHS=$(seq "$START" 600 $((START + 14 * 86400 - 1)) | tr '\n' ' ')
node ../tools/make_defaults.mjs
for cfg in build/config_school.json build/config_vacation.json build/config_old.json; do
  for kid in k1 k2; do
    echo "== $(basename "$cfg") $kid"
    TZ=Asia/Seoul node compare.mjs "$cfg" "$kid" $EPOCHS
  done
done
TZ=Asia/Seoul ./build/test_patch build/config_school.json
