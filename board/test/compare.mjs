// compare.mjs — 앱(app.js)의 규칙 함수를 그대로 꺼내 돌리고, 보드 C 코드(logic_cli) 결과와 비교한다.
// 실행: board/test/run.sh
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const appSrc = fs.readFileSync(path.join(here, '../../app.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(here, '../../store.js'), 'utf8');

// app.js에서 함수 소스를 그대로 잘라 온다 (고쳐 쓰지 않음)
function grab(src, startRe) {
  const m = startRe.exec(src);
  if (!m) throw new Error('찾지 못함: ' + startRe);
  let i = m.index, depth = 0, seen = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) { i++; break; } }
  }
  // 한 줄짜리 화살표 함수(중괄호 없음)는 줄 끝까지
  const body = src.slice(m.index, i);
  return body;
}
function line(src, re) { const m = re.exec(src); if (!m) throw new Error('찾지 못함: ' + re); return src.slice(m.index, src.indexOf('\n', m.index)); }

const parts = [
  line(appSrc, /const WD = /),
  line(appSrc, /const hm = /),
  grab(appSrc, /function ikey\(/),
  grab(appSrc, /function vacationState\(/),
  line(appSrc, /const inVacation = /),
  line(appSrc, /const isSchoolDay = /),
  line(appSrc, /const tomorrowOf = /),
  grab(appSrc, /function nextSchoolDay\(/),
  grab(appSrc, /function eveningLabel\(/),
  grab(appSrc, /function autoMode\(/),
  grab(appSrc, /function clockFor\(/),
  grab(appSrc, /function timeLeft\(/),
  grab(appSrc, /function routineSteps\(/),
  line(appSrc, /function choresToday\(/),
].join('\n');
const dateKeySrc = grab(storeSrc, /function dateKey\(/);
// 앱은 불러온 설정을 normalizeConfig로 채워서 쓴다 → 같은 함수로 채운다
function grabAny(src, re) {
  const m = re.exec(src); if (!m) throw new Error('찾지 못함: ' + re);
  let i = m.index, d = 0, seen = false;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{' || c === '[') { d++; seen = true; } else if (c === '}' || c === ']') { d--; if (seen && d === 0) { i++; break; } } }
  return src.slice(m.index, i);
}
const normSrc = [/function skill\(/, /function stage2Defaults\(/, /function stage3Defaults\(/, /function stage4Defaults\(/, /function stage5Defaults\(/, /const VACATION_ROUTINE = /, /function normalizeConfig\(/]
  .map(re => grabAny(storeSrc, re)).join(';\n');

const [, , cfgPath, kid, ...epochs] = process.argv;
const rawConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const nctx = { JSON, Object };
vm.createContext(nctx);
vm.runInContext(normSrc + ';\nvar __cfg = normalizeConfig(' + JSON.stringify(rawConfig) + ');', nctx);
const config = nctx.__cfg;

// 고정 시각을 돌려주는 Date (앱 함수 안의 new Date()가 이 시각을 보게)
function makeDate(nowMs) {
  const Real = Date;
  return class FakeDate extends Real {
    constructor(...a) { if (a.length === 0) super(nowMs); else super(...a); }
    static now() { return nowMs; }
  };
}

const appResults = epochs.map(e => {
  const nowMs = Number(e) * 1000;
  const ctx = { console, Math, Number, String, Array, Set, Object, JSON };
  ctx.Date = makeDate(nowMs);
  vm.createContext(ctx);
  vm.runInContext(dateKeySrc + '\n' + 'var S = { config: ' + JSON.stringify(config) + ', mode: "firebase", dateKey };\nvar ui = { preview: "auto" };\n' + parts +
    '\nvar __out = (function(){ const d = new Date(); return { mode: autoMode(d), school: isSchoolDay(d), vac: ({ rest: 2, practice: 1 })[vacationState(d)] || 0, eveningLabel: eveningLabel(),' +
    ' leftMorning: (timeLeft("morning") || { mins: -9999 }).mins, leftEvening: (timeLeft("evening") || { mins: -9999 }).mins,' +
    ' morning: routineSteps(' + JSON.stringify(kid) + ', "morning").map(s => ({ id: s.id, items: s.items.map(it => ({ text: it.text, key: ikey(s.id, it.text), sup: !!it.sup })) })),' +
    ' evening: routineSteps(' + JSON.stringify(kid) + ', "evening").map(s => ({ id: s.id, items: s.items.map(it => ({ text: it.text, key: ikey(s.id, it.text), sup: !!it.sup })) })),' +
    ' chores: choresToday(' + JSON.stringify(kid) + ').map(c => c.id) }; })();', ctx);
  return Object.assign({ epoch: Number(e) }, ctx.__out);
});

const cli = path.join(here, 'build/logic_cli');
const cResults = JSON.parse(execFileSync(cli, [cfgPath, kid, ...epochs], { env: { ...process.env, TZ: 'Asia/Seoul' }, maxBuffer: 256 * 1024 * 1024 }).toString());

let fail = 0;
appResults.forEach((a, i) => {
  const c = cResults[i];
  // 앱은 쉬는 시간에 routineSteps를 부르지 않으므로 단계 목록은 늘 비교하고, 시간대는 따로 비교
  for (const k of ['mode', 'school', 'vac', 'eveningLabel', 'leftMorning', 'leftEvening', 'morning', 'evening', 'chores']) {
    const x = JSON.stringify(a[k]), y = JSON.stringify(c[k]);
    if (x !== y) { fail++; console.log(`다름 ${new Date(a.epoch * 1000).toISOString()} ${k}\n  앱:  ${x}\n  보드: ${y}`); }
  }
});
console.log(`${appResults.length}개 시각 × 9개 값 비교, 다른 곳 ${fail}개`);
process.exit(fail ? 1 : 0);
