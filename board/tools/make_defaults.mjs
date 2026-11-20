// make_defaults.mjs — 앱(store.js)이 예전 설정에 채워 넣는 기본값을 꺼내 보드용 JSON으로 만든다.
// 앱은 normalizeConfig()로 저장된 설정에 없는 칸(집안일, 방학 등)을 기본값으로 채워서 보여 준다.
// 보드도 같은 기본값을 써야 앱과 같은 화면이 나온다.
// 실행: node board/tools/make_defaults.mjs   (store.js의 기본값을 바꾸면 다시 실행)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(here, '../../store.js'), 'utf8');

function grab(re) {
  const m = re.exec(src);
  if (!m) throw new Error('찾지 못함: ' + re);
  let i = m.index, depth = 0, seen = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '[') { depth++; seen = true; }
    else if (c === '}' || c === ']') { depth--; if (seen && depth === 0) { i++; break; } }
  }
  return src.slice(m.index, i);
}

const code = [
  grab(/function skill\(/),
  grab(/function stage2Defaults\(/),
  grab(/function stage3Defaults\(/),
  grab(/function stage4Defaults\(/),
  grab(/function stage5Defaults\(/),
  grab(/const VACATION_ROUTINE = /) + ';',
  'var __out = { defaults: Object.assign(stage2Defaults(), stage3Defaults(), stage4Defaults(), stage5Defaults()), vacationRoutine: VACATION_ROUTINE };',
].join('\n');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const out = path.join(here, '../main/config_defaults.json');
fs.writeFileSync(out, JSON.stringify(ctx.__out));
console.log('기본값을 썼어요:', path.relative(process.cwd(), out), Object.keys(ctx.__out.defaults).join(', '));
