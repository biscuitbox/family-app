// make_configs.mjs — 앱의 기본 설정(store.js defaultConfig)으로 시험용 설정 파일을 만든다
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, 'build');
fs.mkdirSync(out, { recursive: true });

const ctx = { window: {}, console, crypto: globalThis.crypto, Uint32Array, Date, Math, JSON, Object, Array, Set, Promise };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here, '../../store.js'), 'utf8'), ctx);
const base = JSON.parse(JSON.stringify(ctx.window.Store.defaultConfig()));

// 1) 기본 + 가정통신문 준비물 + 숫자로 시작하는 단계ID + 이모지·특수문자 준비물
const a = JSON.parse(JSON.stringify(base));
a.dateSupplies = { k1: { '2026-11-23': ['색종이', '체육복'], '2026-11-18': ['우유갑 🥛'] }, k2: { '2026-11-19': ['리코더', '"자" 30cm'] } };
a.routines.k1.morning.push({ id: '1x9z', emoji: '🧢', title: '모자 쓰기', checks: ['모자', 'é ñ 😀'] });
a.vacation = { on: false, start: '', end: '', wake: '08:00' };
fs.writeFileSync(path.join(out, 'config_school.json'), JSON.stringify(a));

// 2) 방학 (개학 연습 주간 포함) + 방학 아침 루틴
const b = JSON.parse(JSON.stringify(a));
b.vacation = { on: true, start: '2026-11-17', end: '2026-11-27', wake: '08:30' };
b.routines.k1.vacation = [{ id: 'v1', emoji: '🛏️', title: '일어나서 이불 개기' }, { id: 'v2', emoji: '🧼', title: '세수하기', checks: ['얼굴', '손'] }];
b.routines.k2.vacation = [{ id: 'v1', title: '이불 개기' }];
fs.writeFileSync(path.join(out, 'config_vacation.json'), JSON.stringify(b));
console.log('설정 2개를 만들었어요');
