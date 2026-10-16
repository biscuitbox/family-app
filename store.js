// store.js — 앱 데이터 저장소
// config.js에 Firebase 설정이 있으면 Firestore(가족 기기끼리 실시간 공유),
// 없으면 체험 모드(이 브라우저에만 저장)로 동작한다. 화면 코드는 어느 쪽인지 몰라도 된다.
(function () {
  'use strict';

  const SDK = '10.12.2';
  const DEMO_KEY = 'ugh-demo-v1';

  // ---------- 기본 설정 (새 가족을 만들 때와 체험 모드에서 사용) ----------
  function defaultConfig() {
    return {
      version: 1,
      kids: [
        { id: 'k1', name: '첫째', grade: '중1', view: 'cards', fontScale: 1.15, voice: true, effects: true },
        { id: 'k2', name: '둘째', grade: '초5', view: 'list', fontScale: 1, voice: false, effects: true }
      ],
      times: { morningStart: '06:40', leave: '08:10', eveningStart: '19:30', bed: '22:00' },
      schoolDays: [1, 2, 3, 4, 5],
      routines: {
        k1: {
          morning: [
            { id: 'm1', emoji: '🧼', title: '세수하기', detail: '얼굴과 손을 깨끗이 씻어요' },
            { id: 'm2', emoji: '🍚', title: '아침 먹기', detail: '천천히 꼭꼭 씹어 먹어요' },
            { id: 'm3', emoji: '🪥', title: '양치하기', detail: '위아래 구석구석 닦아요' },
            { id: 'm4', emoji: '👔', title: '교복 입기', detail: '어제 꺼내 둔 교복을 입어요' },
            { id: 'm5', emoji: '🎒', title: '가방 확인', detail: '오늘 챙길 것을 하나씩 확인해요', supplies: true, checks: ['필통', '물병'] },
            { id: 'm6', emoji: '🪞', title: '거울 앞 복장 확인', detail: '하나씩 보고 눌러요', checks: ['셔츠 넣기', '명찰 달기', '양말 신기', '머리 빗기'] },
            { id: 'm7', emoji: '👟', title: '신발 신고 인사하기', detail: '"다녀오겠습니다!"' }
          ],
          evening: [
            { id: 'e1', emoji: '📒', title: '알림장 보여 드리기', detail: '엄마 아빠에게 알림장을 보여 드려요' },
            { id: 'e2', emoji: '🎒', title: '가방 싸기', detail: '내일 챙길 것을 가방에 넣어요', supplies: true, checks: ['숙제', '필통'] },
            { id: 'e3', emoji: '👕', title: '교복 꺼내 두기', detail: '내일 입을 옷을 의자 위에 둬요', checks: ['셔츠', '바지', '양말', '명찰'] }
          ]
        },
        k2: {
          morning: [
            { id: 'm1', emoji: '🧼', title: '세수하고 옷 입기' },
            { id: 'm2', emoji: '🍚', title: '아침 먹기' },
            { id: 'm3', emoji: '🪥', title: '양치하기' },
            { id: 'm4', emoji: '🎒', title: '가방 확인', supplies: true, checks: ['필통', '숙제'] },
            { id: 'm5', emoji: '💧', title: '물병 챙기기' }
          ],
          evening: [
            { id: 'e1', emoji: '📒', title: '알림장 확인하기' },
            { id: 'e2', emoji: '✏️', title: '숙제 마무리 확인' },
            { id: 'e3', emoji: '🎒', title: '가방 싸기', supplies: true },
            { id: 'e4', emoji: '👕', title: '내일 입을 옷 꺼내 두기' }
          ]
        }
      },
      // 요일(1=월 … 5=금)별 시간표 준비물 — 예시
      timetable: {
        k1: { 1: ['체육복'], 2: [], 3: ['수채화 도구'], 4: ['체육복'], 5: ['실내화 주머니'] },
        k2: { 1: ['실내화'], 2: ['체육복'], 3: ['리코더'], 4: [], 5: ['실내화 주머니'] }
      },
      ...stage2Defaults()
    };
  }

  // 2단계: 공부 기록 · 독서와 필사 · 아빠의 영역
  function stage2Defaults() {
    return {
      subjects: [
        { name: '국어', emoji: '📖' }, { name: '수학', emoji: '➗' }, { name: '영어', emoji: '🔤' },
        { name: '과학', emoji: '🔬' }, { name: '사회', emoji: '🌏' }, { name: '독서록', emoji: '✍️' }, { name: '기타', emoji: '✏️' }
      ],
      // 요일별 공부 카드 (예시) — 첫째는 이 순서대로 한 장씩, 둘째는 오늘 계획의 출발점
      study: {
        k1: {
          unitMins: 15,
          plan: {
            1: [{ subject: '수학', task: '연산 문제 1쪽' }, { subject: '국어', task: '받아쓰기 연습 10문장' }],
            2: [{ subject: '영어', task: '단어 5개 따라 쓰기' }, { subject: '수학', task: '연산 문제 1쪽' }],
            3: [{ subject: '수학', task: '연산 문제 1쪽' }, { subject: '과학', task: '교과서 한 쪽 소리 내어 읽기' }],
            4: [{ subject: '국어', task: '받아쓰기 연습 10문장' }, { subject: '영어', task: '단어 5개 따라 쓰기' }],
            5: [{ subject: '수학', task: '연산 문제 1쪽' }]
          }
        },
        k2: {
          unitMins: 25,
          plan: {
            1: [{ subject: '수학', task: '익힘책 2쪽' }, { subject: '영어', task: '단어 20개' }],
            2: [{ subject: '국어', task: '교과서 복습' }, { subject: '수학', task: '문제집 3쪽' }],
            3: [{ subject: '수학', task: '익힘책 2쪽' }, { subject: '사회', task: '단원 정리' }],
            4: [{ subject: '영어', task: '단어 20개' }, { subject: '과학', task: '실험 관찰 정리' }],
            5: [{ subject: '수학', task: '문제집 3쪽' }]
          }
        }
      },
      // 필사: 첫째는 소설 2쪽부터, 둘째는 한 단락
      copy: {
        k1: { pages: 2, quote: 'optional', rest: 60, unit: 'page' },
        k2: { pages: 1, quote: 'required', rest: 0, unit: 'paragraph' }
      },
      adults: [{ id: 'dad', name: '아빠' }],
      exerciseKinds: ['걷기', '달리기', '근력 운동', '자전거', '수영', '스트레칭']
    };
  }

  // 3단계: 보상·주간 상한·쉬어 가기 카드·형제 협동 미션
  function stage3Defaults() {
    return {
      rewards: [
        { id: 'r1', name: '주말 외식 메뉴 고르기', cost: 10, kind: 'family' },
        { id: 'r2', name: '가족 영화 고르기', cost: 8, kind: 'family' },
        { id: 'r3', name: '주말 놀이 고르기', cost: 6, kind: 'family' },
        { id: 'r4', name: '용돈 1,000원', cost: 5, kind: 'money', amount: 1000 }
      ],
      weeklyCap: 25,            // 아이별 한 주에 받을 수 있는 별 수
      freezesPerWeek: 2,        // 쉬어 가기 카드 (연속 기록 지켜 주기)
      coop: { target: 10, bonus: 2 } // 형제 협동 미션: 둘이 합쳐 한 주 필사 쪽수
    };
  }

  // 4단계: 생활 자립 기술 · 집안일 · 용돈 분류
  function skill(id, emoji, title, area, level, steps) {
    return { id, emoji, title, area, level, steps: steps.map((x, i) => ({ id: id + '-' + (i + 1), emoji: x[0], title: x[1], detail: x[2] || '' })) };
  }
  function stage4Defaults() {
    return {
      skills: {
        k1: [
          skill('shower', '🚿', '샤워하기', '위생', 'watch', [['🧺', '옷 벗어 빨래 바구니에 넣기'], ['🌡️', '물 온도 손으로 확인하기', '따뜻하면 좋아요'], ['🧴', '머리 감기'], ['🧼', '몸 씻기'], ['🧻', '수건으로 닦기'], ['👕', '잠옷 입기']]),
          skill('laundry', '👕', '빨래 개기', '정리', 'together', [['🖐️', '옷을 바닥에 펴요'], ['↔️', '반으로 접어요'], ['🔁', '한 번 더 접어요'], ['🗄️', '서랍에 넣어요']]),
          skill('snack', '🥪', '간단한 간식 만들기', '식사', 'together', [['🧼', '손 씻기'], ['🍞', '빵 두 장 꺼내기'], ['🍓', '잼 바르기'], ['🍽️', '접시에 담기'], ['🧽', '쓴 것 정리하기']]),
          skill('bus', '🚌', '버스 타기', '외출', 'together', [['🚏', '정류장 이름 확인하기'], ['🔢', '버스 번호 확인하기'], ['💳', '카드 찍기'], ['👂', '내릴 정류장 안내 듣기'], ['🔔', '벨 누르고 내리기']]),
          skill('store', '🏪', '편의점에서 계산하기', '외출', 'together', [['🛒', '살 것 고르기'], ['🧍', '줄 서기'], ['🧾', '계산대에 올리기'], ['💳', '카드나 돈 내기'], ['🙇', '"감사합니다" 인사하기']])
        ],
        k2: [
          skill('egg', '🍳', '계란 프라이 만들기', '식사', 'watch', [['🍳', '팬에 기름 두르기', '어른과 함께 불 켜기'], ['🥚', '계란 깨서 넣기'], ['⏲️', '2분 기다리기'], ['🍽️', '접시에 옮기기'], ['🔥', '불 끄고 확인하기']]),
          skill('route', '🗺️', '버스 길 찾기', '외출', 'watch', [['📱', '지도 앱에서 도착지 찾기'], ['🚏', '타는 정류장과 버스 번호 확인'], ['⏱️', '걸리는 시간 확인'], ['🗣️', '부모님께 계획 말하기']]),
          skill('room', '🧹', '방 정리', '정리', 'alone', [['📚', '책은 책장에'], ['👕', '옷은 바구니나 옷장에'], ['🗑️', '쓰레기 버리기'], ['🛏️', '이불 정리하기']])
        ]
      },
      chores: {
        k1: [
          { id: 'c1', emoji: '🥢', title: '수저 놓기', days: [0, 1, 2, 3, 4, 5, 6] },
          { id: 'c2', emoji: '👕', title: '내 빨래 개기', days: [2, 4, 6], skillId: 'laundry' }
        ],
        k2: [
          { id: 'c1', emoji: '🍽️', title: '식사 후 그릇 치우기', days: [0, 1, 2, 3, 4, 5, 6] },
          { id: 'c2', emoji: '♻️', title: '분리수거 돕기', days: [3, 0] },
          { id: 'c3', emoji: '🧹', title: '내 방 정리', days: [6], skillId: 'room' }
        ]
      },
      moneyCats: [
        { name: '간식', emoji: '🍪' }, { name: '장난감', emoji: '🧸' }, { name: '학용품', emoji: '✏️' },
        { name: '선물', emoji: '🎁' }, { name: '기타', emoji: '🛍️' }
      ]
    };
  }

  // 5·6단계: 방학 · 날짜별 준비물(가정통신문) · 기기 사용 규칙 · 알림 · 캐릭터 · AI 모델
  function stage5Defaults() {
    return {
      vacation: { on: false, start: '', end: '', wake: '08:00' },
      dateSupplies: {},
      deviceRule: { on: true, text: '오늘의 미션을 다 하면 자유 시간 1시간', needQuests: true },
      reminders: { on: true, study: '16:30', copy: '20:00' },
      mascot: { name: '우리별', emoji: '⭐' },
      ai: { model: 'gemini-3.1-flash-lite' }
    };
  }
  const VACATION_ROUTINE = [
    { id: 'v1', emoji: '🛏️', title: '일어나서 이불 개기' },
    { id: 'v2', emoji: '🧼', title: '세수하기' },
    { id: 'v3', emoji: '🍚', title: '아침 먹기' },
    { id: 'v4', emoji: '🪥', title: '양치하기' },
    { id: 'v5', emoji: '📋', title: '오늘 할 일 보기', detail: '공부, 필사, 집안일을 확인해요' }
  ];

  // 예전 설정(1~4단계)에 새 기본값을 채워 넣는다
  function normalizeConfig(cfg) {
    const d = Object.assign(stage2Defaults(), stage3Defaults(), stage4Defaults(), stage5Defaults());
    Object.keys(d).forEach(k => { if (cfg[k] == null) cfg[k] = d[k]; });
    (cfg.kids || []).forEach(kid => {
      if (!cfg.study[kid.id]) cfg.study[kid.id] = { unitMins: 20, plan: {} };
      if (!cfg.copy[kid.id]) cfg.copy[kid.id] = { pages: 1, quote: 'optional', rest: 0, unit: 'page' };
      if (!cfg.skills[kid.id]) cfg.skills[kid.id] = [];
      cfg.routines[kid.id] = cfg.routines[kid.id] || { morning: [], evening: [] };
      if (!cfg.routines[kid.id].vacation) cfg.routines[kid.id].vacation = JSON.parse(JSON.stringify(VACATION_ROUTINE));
      if (kid.voiceRate == null) kid.voiceRate = kid.view === 'list' ? 1 : 0.85;
      if (!cfg.chores[kid.id]) cfg.chores[kid.id] = [];
    });
    return cfg;
  }

  // ---------- 공통 도구 ----------
  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // 'a.b.c' 경로에 값 넣기 (null이면 삭제)
  function applyPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (val === null) delete o[last]; else o[last] = val;
  }
  function setPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] = o[parts[i]] || {});
    o[parts[parts.length - 1]] = val;
  }
  function randomCode(n) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    return Array.from(buf, x => abc[x % abc.length]).join('');
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('불러오기 실패: ' + src));
      document.head.appendChild(s);
    });
  }

  const listeners = new Set();
  const Store = {
    mode: 'demo',          // 'demo' | 'firebase'
    status: 'loading',     // 'loading' | 'signedOut' | 'ready' | 'error'
    error: null,
    config: null,
    logs: {},              // `${date}_${kidId}` → { morning: {...}, evening: {...} }
    stats: {},             // kidId → { stickers }
    photos: {},            // photoId → dataURL (루틴 카드 사진, 모두 미리 받아 둠)
    books: {},             // bookId → { owner, title, author, cover, status, page, ... }
    quotes: {},            // quoteId → { owner, bookId, text, why, date }
    notes: {},             // date → 부모만 보는 기록 (아이들에게 숨긴 아빠 기록)
    cheercards: {},        // 가족 칭찬 카드
    reviews: {},           // `${주 시작일}_${사람}` → 주간 돌아보기
    redeems: {},           // 별 바꾸기 신청
    money: {},             // 용돈 기입장 (받은 돈 · 쓴 돈 · 저금)
    goals: {},             // 저축 목표
    mediaCache: {},        // 필사·표지 사진: 볼 때만 받아 온다
    member: null,          // { role: 'parent' | 'kid', kidId? }
    members: [],           // 부모 화면용: 연결된 기기 목록
    user: null,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },
    defaultConfig,
    dateKey
  };

  // =====================================================================
  // 체험 모드: localStorage + 다른 탭과 동기화
  // =====================================================================
  const Demo = {
    data: null,
    read() {
      try { return JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { return null; }
    },
    write() {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.data)); } catch (e) { /* 저장 공간이 없어도 화면은 계속 동작 */ }
    },
    seed() {
      // 화면이 어떻게 보이는지 알 수 있도록 오늘 기록을 조금 채워 둔다 (예시)
      const today = dateKey(new Date());
      const t = Date.now();
      const logs = {};
      logs[today + '_k1'] = { date: today, kidId: 'k1', morning: { steps: { m1: t - 3.2e6, m2: t - 2.4e6, m3: t - 1.6e6 }, items: {} } };
      logs[today + '_k2'] = {
        date: today, kidId: 'k2',
        morning: { steps: { m1: t - 3e6, m2: t - 2.2e6, m3: t - 1.5e6, m4: t - 1.2e6, m5: t - 1.1e6 }, items: {}, completedAt: t - 1.1e6, awarded: true }
      };
      const data = { config: defaultConfig(), logs, stats: { k1: { stickers: 12 }, k2: { stickers: 18 } }, photos: {}, seededAt: t };
      this.seed2(data);
      return data;
    },
    // 2단계 예시: 책, 문장, 지난 6일 공부 시간, 아빠 기록 (모두 예시)
    seed2(data) {
      const t = Date.now(), today = dateKey(new Date());
      data.books = data.books || {
        b1: { owner: 'k1', title: '바다로 간 고래 (예시)', author: '', status: 'reading', page: 22, createdAt: t - 9e8 },
        b2: { owner: 'k2', title: '숲속 탐험대 (예시)', author: '', status: 'reading', page: 64, createdAt: t - 8e8 },
        b3: { owner: 'k2', title: '별을 세는 아이 (예시)', author: '', status: 'done', page: 120, finishedAt: t - 5e8, createdAt: t - 2e9 },
        b4: { owner: 'dad', title: '아침 습관 (예시)', author: '', status: 'reading', page: 88, createdAt: t - 7e8 }
      };
      data.quotes = data.quotes || {
        q1: { owner: 'k2', bookId: 'b2', text: '길을 잃어도 지도를 다시 펴면 된다. (예시 문장)', why: '틀려도 다시 하면 된다는 말 같아서', date: dateKey(new Date(t - 864e5)) },
        q2: { owner: 'k1', bookId: 'b1', text: '고래는 천천히 그러나 멈추지 않고 헤엄쳤다. (예시 문장)', why: '', date: dateKey(new Date(t - 2 * 864e5)) }
      };
      data.notes = data.notes || {};
      data.cheercards = data.cheercards || {};
      data.reviews = data.reviews || {};
      data.redeems = data.redeems || {};
      data.money = data.money || {};
      data.goals = data.goals || {};
      if (!data.seeded4) {
        const dd = n => dateKey(new Date(t - n * 864e5));
        data.money.m1 = { owner: 'k1', type: 'in', amount: 5000, cat: '', memo: '할머니께 받은 용돈', date: dd(5), at: t - 5 * 864e5 };
        data.money.m2 = { owner: 'k1', type: 'out', amount: 1200, cat: '간식', memo: '우유', date: dd(3), at: t - 3 * 864e5 };
        data.money.m3 = { owner: 'k1', type: 'save', amount: 2000, cat: '', memo: '', date: dd(2), at: t - 2 * 864e5 };
        data.money.m4 = { owner: 'k2', type: 'in', amount: 10000, cat: '', memo: '이번 달 용돈', date: dd(6), at: t - 6 * 864e5 };
        data.money.m5 = { owner: 'k2', type: 'out', amount: 3500, cat: '학용품', memo: '색연필', date: dd(4), at: t - 4 * 864e5 };
        data.money.m6 = { owner: 'k2', type: 'save', amount: 5000, cat: '', memo: '', date: dd(1), at: t - 864e5 };
        data.goals.g1 = { owner: 'k1', title: '버스 장난감 (예시)', price: 12000, status: 'active', createdAt: t - 9e8 };
        data.goals.g2 = { owner: 'k2', title: '줄넘기 (예시)', price: 8000, status: 'active', createdAt: t - 9e8 };
        Object.assign(data.stats.k1 || (data.stats.k1 = {}), { skills: { shower: { count: 6, alone: 2, last: t - 864e5 }, laundry: { count: 3, alone: 0, last: t - 2 * 864e5 } } });
        Object.assign(data.stats.k2 || (data.stats.k2 = {}), { skills: { room: { count: 9, alone: 9, last: t - 864e5 }, egg: { count: 2, alone: 0, last: t - 4 * 864e5 } } });
        data.seeded4 = true;
      }
      if (!data.seeded3) {
        const d1 = dateKey(new Date(t - 864e5)), d2 = dateKey(new Date(t - 2 * 864e5));
        data.cheercards.c1 = { from: 'k2', to: 'k1', emoji: '🤝', text: '가방 싸는 거 도와줘서 고마워', date: d1, at: t - 864e5 };
        data.cheercards.c2 = { from: 'dad', to: 'k2', emoji: '👏', text: '숙제를 스스로 끝까지 해낸 게 멋져', date: d2, at: t - 2 * 864e5 };
        data.cheercards.c3 = { from: 'k1', to: 'dad', emoji: '❤️', text: '산책 같이 가 줘서 좋았어요', date: d1, at: t - 8e7 };
        data.redeems.x1 = { kidId: 'k2', rewardId: 'r4', name: '용돈 1,000원', cost: 5, kind: 'money', amount: 1000, status: 'requested', at: t - 5e6, date: today };
        const yk = dateKey(new Date(t - 864e5)) + '_k1';
        const ylog = data.logs[yk] || (data.logs[yk] = { date: dateKey(new Date(t - 864e5)), kidId: 'k1' });
        ylog.mood = { am: { v: 3, at: t - 864e5 - 2e7 }, pm: { v: 3, at: t - 864e5 } };
        const tl = data.logs[today + '_k1'] || (data.logs[today + '_k1'] = { date: today, kidId: 'k1' });
        tl.mood = { am: { v: 3, at: t - 3.5e6 } };
        tl.cheers = { h1: { emoji: '🌟', text: '세수하고 아침 먹는 것까지 혼자 했구나! 멋져', label: '등교 준비', from: '아빠', at: t - 3e6 } };
        Object.assign(data.stats.k1 || (data.stats.k1 = {}), { streak: { count: 4, last: dateKey(new Date(t - 864e5)) } });
        Object.assign(data.stats.k2 || (data.stats.k2 = {}), { streak: { count: 9, last: dateKey(new Date(t - 864e5)) } });
        data.seeded3 = true;
      }
      if (!data.seeded2) {
        const mins = [40, 25, 0, 50, 35, 30];
        mins.forEach((m, i) => {
          if (!m) return;
          const d = dateKey(new Date(t - (6 - i) * 864e5)), id = d + '_k2';
          const log = data.logs[id] || (data.logs[id] = { date: d, kidId: 'k2' });
          log.study = { sessions: { ['s' + i]: { subject: i % 2 ? '영어' : '수학', task: '', mins: m, start: t - (6 - i) * 864e5, end: t - (6 - i) * 864e5 + m * 6e4, mood: 2 } } };
        });
        const k2 = data.logs[today + '_k2'] || (data.logs[today + '_k2'] = { date: today, kidId: 'k2' });
        k2.study = { sessions: { s9: { subject: '수학', task: '익힘책 2쪽', mins: 25, start: t - 9e6, end: t - 9e6 + 15e5, mood: 2, note: '분수 나눗셈이 조금 헷갈렸다' } }, awarded: true };
        data.logs[today + '_dad'] = { date: today, kidId: 'dad', exercise: { items: { x1: { kind: '걷기', mins: 30, at: t - 2e7 } } }, research: { items: { r1: { text: '실험 자료 정리', mins: 60, at: t - 1e7 } } } };
        data.seeded2 = true;
      }
    },
    sync() {
      Store.config = normalizeConfig(this.data.config);
      Store.logs = this.data.logs;
      Store.stats = this.data.stats;
      Store.photos = this.data.photos;
      Store.books = this.data.books;
      Store.quotes = this.data.quotes;
      Store.notes = this.data.notes;
      Store.cheercards = this.data.cheercards;
      Store.reviews = this.data.reviews;
      Store.redeems = this.data.redeems;
      Store.money = this.data.money;
      Store.goals = this.data.goals;
    },
    init() {
      this.data = this.read() || this.seed();
      this.seed2(this.data); // 1단계 체험 데이터에도 2단계 예시를 더한다
      this.write();
      this.sync();
      Store.member = { role: 'demo' };
      Store.status = 'ready';
      window.addEventListener('storage', e => {
        if (e.key !== DEMO_KEY) return;
        const d = this.read();
        if (d) { this.data = d; this.sync(); Store.emit(); }
      });
    },
    reset() {
      this.data = this.seed();
      this.write(); this.sync(); Store.emit();
    }
  };

  // =====================================================================
  // Firebase 모드
  // =====================================================================
  const FB = {
    db: null, auth: null, fid: null, unsubs: [], logsFrom: null,
    fam() { return this.db.collection('families').doc(this.fid); },

    async init(cfg) {
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore-compat.js`);
      firebase.initializeApp(cfg);
      this.auth = firebase.auth();
      this.db = firebase.firestore();
      try { await this.db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* 오프라인 저장을 못 써도 동작 */ }
      try { await this.auth.getRedirectResult(); } catch (e) { Store.error = e.message; }
      this.auth.onAuthStateChanged(user => this.onUser(user));
    },

    async onUser(user) {
      if (this.joining) return; // 초대 코드로 연결하는 중에는 joinWithCode가 마무리한다
      this.stop();
      Store.user = user;
      if (!user) { Store.member = null; Store.status = 'signedOut'; Store.emit(); return; }
      try {
        const u = await this.db.collection('users').doc(user.uid).get();
        if (u.exists && u.data().familyId) {
          this.fid = u.data().familyId;
          const m = await this.fam().collection('members').doc(user.uid).get();
          if (m.exists) { Store.member = m.data(); this.listen(); return; }
        }
        // 가족에 아직 연결되지 않음
        Store.member = null;
        if (!user.isAnonymous) await this.createFamily(user); // 부모(구글 로그인): 새 가족 만들기
        else { Store.status = 'signedOut'; Store.emit(); }    // 아이 기기: 초대 코드 입력 대기
      } catch (e) {
        Store.status = 'error'; Store.error = e.message; Store.emit();
      }
    },

    async createFamily(user) {
      this.fid = user.uid;
      await this.fam().set({ owner: user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await this.fam().collection('members').doc(user.uid).set({ role: 'parent', name: user.displayName || '부모', joinedAt: Date.now() });
      await this.db.collection('users').doc(user.uid).set({ familyId: this.fid });
      const c = await this.fam().collection('state').doc('config').get();
      if (!c.exists) await this.fam().collection('state').doc('config').set(defaultConfig());
      Store.member = { role: 'parent' };
      this.listen();
    },

    listen() {
      const fam = this.fam();
      this.unsubs.push(fam.collection('state').doc('config').onSnapshot(s => {
        Store.config = normalizeConfig(s.exists ? s.data() : defaultConfig());
        if (Store.status !== 'ready') Store.status = 'ready';
        Store.emit();
      }, e => { Store.status = 'error'; Store.error = e.message; Store.emit(); }));
      this.listenLogs();
      this.unsubs.push(fam.collection('stats').onSnapshot(q => {
        const st = {}; q.forEach(d => { st[d.id] = d.data(); }); Store.stats = st; Store.emit();
      }));
      this.unsubs.push(fam.collection('photos').onSnapshot(q => {
        const ph = {}; q.forEach(d => { ph[d.id] = d.data().data; }); Store.photos = ph; Store.emit();
      }));
      this.unsubs.push(fam.collection('books').onSnapshot(q => {
        const b = {}; q.forEach(d => { b[d.id] = d.data(); }); Store.books = b; Store.emit();
      }));
      this.unsubs.push(fam.collection('quotes').onSnapshot(q => {
        const b = {}; q.forEach(d => { b[d.id] = d.data(); }); Store.quotes = b; Store.emit();
      }));
      // 3단계: 보상 신청은 모두, 칭찬 카드와 돌아보기는 최근 2주만
      this.unsubs.push(fam.collection('redeems').onSnapshot(q => {
        const b = {}; q.forEach(d => { b[d.id] = d.data(); }); Store.redeems = b; Store.emit();
      }));
      // 4단계: 용돈 기입장과 저축 목표 (아이마다 몇십 건 정도라 모두 받는다)
      ['money', 'goals'].forEach(cn => this.unsubs.push(fam.collection(cn).onSnapshot(q => {
        const b = {}; q.forEach(d => { b[d.id] = d.data(); }); Store[cn] = b; Store.emit();
      })));
      const two = new Date(); two.setDate(two.getDate() - 13);
      this.unsubs.push(fam.collection('cheercards').where('date', '>=', dateKey(two)).onSnapshot(q => {
        const b = {}; q.forEach(d => { b[d.id] = d.data(); }); Store.cheercards = b; Store.emit();
      }));
      this.unsubs.push(fam.collection('reviews').where('week', '>=', dateKey(two)).onSnapshot(q => {
        const b = {}; q.forEach(d => { b[d.id] = d.data(); }); Store.reviews = b; Store.emit();
      }));
      if (Store.member.role === 'parent') {
        this.unsubs.push(fam.collection('members').onSnapshot(q => {
          Store.members = q.docs.map(d => Object.assign({ uid: d.id }, d.data())); Store.emit();
        }));
      }
    },

    // 기록은 최근 7일만 받아 온다 (주간 그래프용)
    listenLogs() {
      const from = new Date(); from.setDate(from.getDate() - 6);
      this.logsFrom = dateKey(new Date());
      const unsub = this.fam().collection('logs').where('date', '>=', dateKey(from)).onSnapshot(q => {
        const lg = {}; q.forEach(d => { lg[d.id] = d.data(); }); Store.logs = lg; Store.emit();
      });
      this.logsUnsub = unsub;
      this.unsubs.push(unsub);
      if (Store.member && Store.member.role === 'parent') {
        const un2 = this.fam().collection('notes').where('date', '>=', dateKey(from)).onSnapshot(q => {
          const n = {}; q.forEach(d => { n[d.id] = d.data(); }); Store.notes = n; Store.emit();
        });
        this.notesUnsub = un2;
        this.unsubs.push(un2);
      }
    },

    // 날짜가 바뀌면 기록 구독을 새 날짜 기준으로 다시 건다
    refreshDay() {
      if (!this.fid || this.logsFrom === dateKey(new Date())) return;
      [this.logsUnsub, this.notesUnsub].forEach(u => { if (u) { u(); this.unsubs = this.unsubs.filter(x => x !== u); } });
      this.listenLogs();
    },

    stop() { this.unsubs.forEach(u => u()); this.unsubs = []; }
  };

  // =====================================================================
  // 화면에서 부르는 동작
  // =====================================================================
  Store.init = async function () {
    const cfg = window.FIREBASE_CONFIG;
    if (cfg && cfg.apiKey) {
      Store.mode = 'firebase';
      try { await FB.init(cfg); } catch (e) { Store.status = 'error'; Store.error = e.message; Store.emit(); }
    } else {
      Store.mode = 'demo';
      Demo.init();
      Store.emit();
    }
  };

  Store.saveConfig = async function (cfg) {
    Store.config = cfg;
    if (Store.mode === 'demo') { Demo.data.config = cfg; Demo.write(); Store.emit(); return; }
    Store.emit();
    return FB.fam().collection('state').doc('config').set(cfg);
  };

  // 문서 일부 고치기. patch: { 'morning.steps.m1': 1712345, 'morning.items.x': null } — null은 삭제
  // coll: 'logs' | 'books' | 'quotes' | 'notes'. base는 문서에 늘 함께 들어갈 기본 필드.
  const COLL = { logs: 'logs', books: 'books', quotes: 'quotes', notes: 'notes', cheercards: 'cheercards', reviews: 'reviews', redeems: 'redeems', money: 'money', goals: 'goals', stats: 'stats' };
  Store.patchDoc = function (coll, id, base, patch) {
    const map = Store[coll];
    if (Store.mode === 'demo') {
      const doc = Demo.data[coll][id] || (Demo.data[coll][id] = Object.assign({}, base));
      Object.keys(patch).forEach(p => applyPath(doc, p, patch[p]));
      Demo.write(); Store.emit(); return Promise.resolve();
    }
    // 화면에 먼저 반영하고(오프라인이어도 바로 보이게) 서버에는 한 번에 병합 저장한다
    const local = map[id] || (map[id] = Object.assign({}, base));
    Object.keys(patch).forEach(p => applyPath(local, p, patch[p]));
    Store.emit();
    const nested = Object.assign({}, base);
    Object.keys(patch).forEach(p => setPath(nested, p, patch[p] === null ? firebase.firestore.FieldValue.delete() : patch[p]));
    return FB.fam().collection(COLL[coll]).doc(id).set(nested, { merge: true });
  };
  Store.removeDoc = function (coll, id) {
    delete Store[coll][id];
    if (Store.mode === 'demo') { delete Demo.data[coll][id]; Demo.write(); Store.emit(); return Promise.resolve(); }
    Store.emit();
    return FB.fam().collection(COLL[coll]).doc(id).delete();
  };
  Store.patchLog = (date, who, patch) => Store.patchDoc('logs', date + '_' + who, { date, kidId: who }, patch);
  Store.newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // 필사·표지 사진: 따로 저장하고, 화면에 나올 때만 받아 온다
  Store.saveMedia = function (id, dataUrl, meta) {
    Store.mediaCache[id] = dataUrl;
    if (Store.mode === 'demo') {
      try { localStorage.setItem('ugh-media-' + id, dataUrl); } catch (e) { /* 체험 모드 저장 공간이 차면 이번 화면에서만 보인다 */ }
      Demo.data.mediaIndex = Demo.data.mediaIndex || {};
      Demo.data.mediaIndex[id] = Object.assign({}, meta);
      Demo.write();
      return Promise.resolve();
    }
    return FB.fam().collection('media').doc(id).set(Object.assign({ data: dataUrl, at: Date.now() }, meta));
  };
  // 한 달 필사 갤러리: 작은 미리보기 사진만 골라 받아 온다 (필드 두 개 같음 조건이라 별도 색인이 필요 없다)
  Store.listThumbs = function (owner, month) {
    const key = owner + '_' + month;
    if (Store.mode === 'demo') {
      const idx = (Demo.data.mediaIndex || {});
      const list = Object.keys(idx).filter(id => idx[id].ownerMonth === key && idx[id].kind === 'thumb')
        .map(id => Object.assign({ id }, idx[id]));
      list.forEach(m => { if (!Store.mediaCache[m.id]) { try { const v = localStorage.getItem('ugh-media-' + m.id); if (v) Store.mediaCache[m.id] = v; } catch (e) { /* 없음 */ } } });
      return Promise.resolve(list);
    }
    return FB.fam().collection('media').where('ownerMonth', '==', key).where('kind', '==', 'thumb').get().then(q => q.docs.map(d => {
      const v = d.data(); Store.mediaCache[d.id] = v.data;
      return { id: d.id, date: v.date, full: v.full, ownerMonth: v.ownerMonth, kind: v.kind };
    }));
  };
  const mediaWait = {};
  Store.getMedia = function (id) {
    if (Store.mediaCache[id]) return Promise.resolve(Store.mediaCache[id]);
    if (mediaWait[id]) return mediaWait[id];
    if (Store.mode === 'demo') {
      let v = null; try { v = localStorage.getItem('ugh-media-' + id); } catch (e) { /* 없음 */ }
      if (v) Store.mediaCache[id] = v;
      return Promise.resolve(v);
    }
    return (mediaWait[id] = FB.fam().collection('media').doc(id).get().then(s => {
      delete mediaWait[id];
      const v = s.exists ? s.data().data : null;
      if (v) Store.mediaCache[id] = v;
      return v;
    }));
  };

  Store.addSticker = async function (kidId, n) {
    if (Store.mode === 'demo') {
      const s = Demo.data.stats[kidId] || (Demo.data.stats[kidId] = { stickers: 0 });
      s.stickers = (s.stickers || 0) + n; Demo.write(); Store.emit(); return;
    }
    const s = Store.stats[kidId] || (Store.stats[kidId] = { stickers: 0 });
    s.stickers = (s.stickers || 0) + n; Store.emit();
    return FB.fam().collection('stats').doc(kidId).set({ stickers: firebase.firestore.FieldValue.increment(n) }, { merge: true });
  };

  // 별 통계 고치기: inc는 더하기(쓴 별 등), set은 덮어쓰기(연속 기록 등)
  Store.updateStats = function (who, set, inc) {
    const s = Store.stats[who] || (Store.stats[who] = { stickers: 0 });
    Object.assign(s, set || {});
    Object.keys(inc || {}).forEach(k => { s[k] = (s[k] || 0) + inc[k]; });
    if (Store.mode === 'demo') { Demo.data.stats[who] = s; Demo.write(); Store.emit(); return Promise.resolve(); }
    Store.emit();
    const body = Object.assign({}, set || {});
    Object.keys(inc || {}).forEach(k => { body[k] = firebase.firestore.FieldValue.increment(inc[k]); });
    return FB.fam().collection('stats').doc(who).set(body, { merge: true });
  };

  // 사진은 작게 줄인 JPEG를 Firestore 문서에 저장한다 (Cloud Storage는 유료 요금제가 필요해서)
  Store.savePhoto = async function (id, dataUrl) {
    if (Store.mode === 'demo') { Demo.data.photos[id] = dataUrl; Demo.write(); Store.emit(); return; }
    Store.photos[id] = dataUrl; Store.emit();
    await FB.fam().collection('photos').doc(id).set({ data: dataUrl, at: Date.now() });
  };
  Store.deletePhoto = async function (id) {
    if (Store.mode === 'demo') { delete Demo.data.photos[id]; Demo.write(); Store.emit(); return; }
    delete Store.photos[id]; Store.emit();
    await FB.fam().collection('photos').doc(id).delete();
  };

  Store.resetDemo = () => Demo.reset();

  // 성장 앨범: 올해 기록을 한 번만 받아 온다 (실시간 구독 아님)
  Store.fetchSince = function (coll, from) {
    if (Store.mode === 'demo') {
      const src = Demo.data[coll] || {};
      return Promise.resolve(Object.keys(src).filter(id => (src[id].date || '') >= from).map(id => Object.assign({ id }, src[id])));
    }
    return FB.fam().collection(coll).where('date', '>=', from).get().then(q => q.docs.map(d => Object.assign({ id: d.id }, d.data())));
  };
  Store.refreshDay = () => { if (Store.mode === 'firebase') FB.refreshDay(); };

  // ---------- 로그인과 기기 연결 ----------
  Store.signInParent = async function () {
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await FB.auth.signInWithPopup(provider); }
    catch (e) {
      if (/popup|operation-not-supported/.test(e.code || '')) await FB.auth.signInWithRedirect(provider);
      else throw e;
    }
  };

  // 아이 기기: 익명 로그인 후 부모가 만든 초대 코드로 가족에 들어간다
  Store.joinWithCode = async function (raw) {
    const code = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) throw new Error('초대 코드 8자리를 확인해 주세요.');
    FB.joining = true;
    try {
      if (!FB.auth.currentUser) await FB.auth.signInAnonymously();
      const uid = FB.auth.currentUser.uid;
      const inv = await FB.db.collection('invites').doc(code).get();
      if (!inv.exists) throw new Error('없는 초대 코드예요. 부모님 기기에서 새 코드를 만들어 주세요.');
      const d = inv.data();
      if (d.expiresAt.toMillis() < Date.now()) throw new Error('시간이 지난 초대 코드예요. 새 코드를 만들어 주세요.');
      FB.fid = d.familyId;
      await FB.fam().collection('members').doc(uid).set({ role: 'kid', kidId: d.kidId, code, joinedAt: Date.now() });
      await FB.db.collection('users').doc(uid).set({ familyId: d.familyId, kidId: d.kidId });
      FB.stop();
      Store.user = FB.auth.currentUser;
      Store.member = { role: 'kid', kidId: d.kidId };
      FB.listen();
    } finally {
      FB.joining = false;
    }
  };

  Store.createInvite = async function (kidId) {
    const code = randomCode(8);
    await FB.db.collection('invites').doc(code).set({
      familyId: FB.fid, kidId, createdBy: FB.auth.currentUser.uid,
      expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000)
    });
    return code;
  };

  Store.removeMember = async function (uid) {
    await FB.fam().collection('members').doc(uid).delete();
  };

  Store.signOut = async function () { if (FB.auth) await FB.auth.signOut(); };

  window.Store = Store;
})();
