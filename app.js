// app.js — 우리집 성장 앱 1단계: 아침 등교 준비 · 내일 준비 · 현관 대시보드
(function () {
  'use strict';
  const S = window.Store;
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const view = document.getElementById('view');
  const appEl = document.getElementById('app');

  const ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'
  };

  // ---------- 화면 상태 (이 기기에만 기억) ----------
  const UI_KEY = 'ugh-ui-v1';
  const ui = {
    device: null, preview: 'auto', parentTab: 'board', editKid: 'k1', editRoutine: 'morning', ttKid: 'k1',
    cardIdx: {}, review: {}, invite: null, err: '', armed: null, lastSpoken: '', audioOk: false, pending: false,
    // 2단계
    kidTab: 'today', studyPick: false, bookView: 'home', copy: null, readSel: null, readMood: null, cover: null,
    planKid: 'k1', exKind: null, timerChimed: {}, gallery: null, boardMedia: {}
  };
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    ['device', 'preview', 'parentTab', 'editKid', 'editRoutine', 'ttKid'].forEach(k => { if (saved[k]) ui[k] = saved[k]; });
  } catch (e) { /* 저장 공간을 못 써도 동작 */ }
  function saveUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        device: ui.device, preview: S.mode === 'demo' ? ui.preview : 'auto',
        parentTab: ui.parentTab, editKid: ui.editKid, editRoutine: ui.editRoutine, ttKid: ui.ttKid
      }));
    } catch (e) { /* 무시 */ }
  }

  // ---------- 도구 ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const fmtHM = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const fmtClock = s => { const m = hm(s); const h = Math.floor(m / 60), mm = m % 60; return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + ':' + String(mm).padStart(2, '0'); };
  const todayKey = () => S.dateKey(new Date());
  const clone = o => JSON.parse(JSON.stringify(o));
  function ikey(stepId, text) {
    let h = 5381; const s = String(text);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return stepId + '_' + h.toString(36);
  }
  function kidById(id) { return (S.config.kids || []).find(k => k.id === id); }
  // 방학: 시작일~끝일. 끝나기 전 7일은 "개학 연습 주간"이라 평소처럼 등교 준비를 연습한다
  function vacationState(d) {
    const v = S.config.vacation || {};
    if (!v.on || !v.start || !v.end) return null;
    const k = S.dateKey(d);
    if (k < v.start || k > v.end) return null;
    const [y, m, dd] = v.end.split('-').map(Number), pe = new Date(y, m - 1, dd - 6);
    return k >= S.dateKey(pe) ? 'practice' : 'rest';
  }
  const inVacation = d => vacationState(d || new Date()) === 'rest';
  const isSchoolDay = d => S.config.schoolDays.includes(d.getDay()) && vacationState(d) !== 'rest';
  const tomorrowOf = d => { const x = new Date(d); x.setDate(x.getDate() + 1); return x; };
  function nextSchoolDay(d) {
    for (let i = 1; i <= 60; i++) { const x = new Date(d); x.setDate(x.getDate() + i); if (isSchoolDay(x)) return x; }
    const x = new Date(d); x.setDate(x.getDate() + 1); return x;
  }
  function eveningLabel() {
    const d = new Date(), n = nextSchoolDay(d);
    const diff = Math.round((new Date(n.toDateString()) - new Date(d.toDateString())) / 864e5);
    return diff === 1 ? '내일 준비' : diff < 7 ? WD[n.getDay()] + '요일 준비' : (n.getMonth() + 1) + '/' + n.getDate() + ' 준비';
  }
  const routineName = mode => mode === 'morning' ? (inVacation() ? '아침 루틴' : '등교 준비') : eveningLabel();

  // 시간대: 아침(등교 준비) / 저녁(내일 준비) / 쉬는 시간
  function autoMode(d) {
    const c = S.config, t = c.times, m = d.getHours() * 60 + d.getMinutes();
    const school = isSchoolDay(d), tomorrowSchool = isSchoolDay(tomorrowOf(d));
    if (inVacation(d)) { const w = hm((c.vacation || {}).wake || '08:00'); if (m >= w && m < w + 120) return 'morning'; }
    if (school && m >= hm(t.morningStart) && m < hm(t.leave) + 30) return 'morning';
    if (tomorrowSchool && m >= hm(t.eveningStart) && m < hm(t.bed) + 60) return 'evening';
    return 'rest';
  }
  function currentMode() {
    const auto = autoMode(new Date());
    // 실제 사용에서 쉬는 시간에 직접 연 화면은 시간대가 바뀌면 저절로 풀린다 (체험 모드의 시간대 선택은 유지)
    if (S.mode !== 'demo' && ui.preview !== 'auto' && auto !== ui.previewFrom) ui.preview = 'auto';
    return (ui.preview === 'morning' || ui.preview === 'evening') ? ui.preview : auto;
  }

  // 체험 모드에서 미리보기 중이면 시간 막대를 그 시간대 한가운데처럼 보여 준다
  function clockFor(mode) {
    if (S.mode === 'demo' && ui.preview === mode) {
      const d = new Date(); const t = S.config.times;
      const mid = mode === 'morning' ? Math.round(hm(t.morningStart) * 0.35 + hm(t.leave) * 0.65) : Math.round(hm(t.eveningStart) * 0.5 + hm(t.bed) * 0.5);
      d.setHours(Math.floor(mid / 60), mid % 60, 0, 0); return d;
    }
    return new Date();
  }
  function timeLeft(mode) {
    const t = S.config.times, d = clockFor(mode), m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const vac = mode === 'morning' && inVacation(), w = hm((S.config.vacation || {}).wake || '08:00');
    const a = vac ? w : mode === 'morning' ? hm(t.morningStart) : hm(t.eveningStart);
    const b = vac ? w + 90 : mode === 'morning' ? hm(t.leave) : hm(t.bed);
    if (m < a - 1 || m > b + 60) return null;
    return { frac: Math.max(0, Math.min(1, (b - m) / (b - a))), mins: Math.round(b - m) };
  }

  // 아이의 오늘 루틴 (시간표 준비물을 해당 단계 확인 목록에 끼워 넣음)
  function routineSteps(kidId, mode) {
    const vac = mode === 'morning' && inVacation();
    const c = S.config, steps = ((c.routines || {})[kidId] || {})[vac ? 'vacation' : mode] || [];
    const target = mode === 'morning' ? new Date() : nextSchoolDay(new Date());
    // 요일 시간표 준비물 + 가정통신문에서 넣은 그 날짜 준비물
    const sup = vac ? [] : Array.from(new Set([].concat(((c.timetable || {})[kidId] || {})[target.getDay()] || [], (((c.dateSupplies || {})[kidId] || {})[S.dateKey(target)]) || [])));
    return steps.map(s => Object.assign({}, s, {
      items: [].concat(s.supplies ? sup.map(x => ({ text: x, sup: true })) : [], (s.checks || []).map(x => ({ text: x })))
    }));
  }
  function rlog(kidId, mode) {
    const l = S.logs[todayKey() + '_' + kidId] || {};
    const r = l[mode] || {};
    return { steps: r.steps || {}, items: r.items || {}, completedAt: r.completedAt, awarded: r.awarded };
  }
  // 쓸 수 있는 별 = 받은 별 - 부모가 승인한 바꾸기
  const stickers = kidId => { const s = (S.stats || {})[kidId] || {}; return Math.max(0, (s.stickers || 0) - (s.spent || 0)); };

  // ---------- 소리와 음성 ----------
  let actx = null;
  function chime(kid, big) {
    if (!kid || kid.effects === false) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      (big ? [660, 880, 1320] : [880, 1320]).forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.12;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.42);
      });
    } catch (e) { /* 소리를 못 내도 동작 */ }
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return false;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = Number(((S.config && kidById(ui.device)) || {}).voiceRate) || 0.88;
      speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }
  document.addEventListener('pointerdown', () => { ui.audioOk = true; }, { once: true });

  // ---------- 기록 남기기 ----------
  const fail = e => toast('저장하지 못했어요. 인터넷 연결을 확인해 주세요.', e);
  function write(patch, kidId) {
    const r = S.patchLog(todayKey(), kidId, patch);
    if (r && r.catch) r.catch(fail);
  }
  function settle(kidId, mode) {
    const steps = routineSteps(kidId, mode), rl = rlog(kidId, mode);
    const all = steps.length > 0 && steps.every(s => rl.steps[s.id]);
    if (all && !rl.completedAt) {
      const p = {}; p[mode + '.completedAt'] = Date.now();
      write(p, kidId);
      award(kidId, mode);
      chime(kidById(kidId), true);
      ui.review[kidId + mode] = false;
    } else if (!all && rl.completedAt) {
      const p = {}; p[mode + '.completedAt'] = null; write(p, kidId);
    }
  }
  function setStep(kidId, mode, step, on, withItems) {
    const p = {}; p[mode + '.steps.' + step.id] = on ? Date.now() : null;
    if (withItems) step.items.forEach(it => { p[mode + '.items.' + ikey(step.id, it.text)] = on ? true : null; });
    write(p, kidId);
    if (on) chime(kidById(kidId), false);
    settle(kidId, mode);
  }
  function setItem(kidId, mode, step, text, on, autoStep) {
    const k = ikey(step.id, text);
    const p = {}; p[mode + '.items.' + k] = on ? true : null;
    if (autoStep) {
      const rl = rlog(kidId, mode), items = Object.assign({}, rl.items);
      if (on) items[k] = true; else delete items[k];
      const all = step.items.every(it => items[ikey(step.id, it.text)]);
      if (all && !rl.steps[step.id]) p[mode + '.steps.' + step.id] = Date.now();
      if (!all && rl.steps[step.id]) p[mode + '.steps.' + step.id] = null;
    }
    write(p, kidId);
    settle(kidId, mode);
  }

  // ---------- 그리기 ----------
  function render() {
    const ae = document.activeElement;
    const editing = view.contains(ae) && (/SELECT|TEXTAREA/.test(ae.tagName) ||
      (ae.tagName === 'INPUT' && !/file|checkbox|radio|button/.test(ae.type)));
    if (editing) { ui.pending = true; return; }
    ui.pending = false;

    const top = document.getElementById('topbar');
    const bar = document.getElementById('demo-bar');

    if (S.status === 'loading' || !S.config && S.status !== 'signedOut' && S.status !== 'error') {
      top.innerHTML = brandHTML(''); bar.hidden = true;
      view.innerHTML = '<div class="gate"><p class="muted">불러오는 중…</p></div>'; return;
    }
    if (S.mode === 'firebase') {
      if (S.status === 'error') { top.innerHTML = brandHTML(''); bar.hidden = true; view.innerHTML = errorHTML(); return; }
      if (!S.member || !S.config) { top.innerHTML = brandHTML(''); bar.hidden = true; view.innerHTML = gateHTML(); return; }
      ui.device = S.member.role === 'parent' ? 'parent' : S.member.kidId;
    }
    if (!ui.device || (ui.device !== 'parent' && !kidById(ui.device))) ui.device = (S.config.kids[0] || {}).id || 'parent';

    const mode = currentMode();
    appEl.dataset.mode = mode;
    const kid = ui.device === 'parent' ? null : kidById(ui.device);
    appEl.classList.toggle('no-fx', !!kid && kid.effects === false);

    top.innerHTML = brandHTML(kid ? '<span><b>' + esc(kid.name) + '</b>의 화면</span>' : '<span><b>부모</b> 화면</span>' + (S.mode === 'firebase' ? ' <button class="linkbtn" data-act="signout">로그아웃</button>' : ''));
    if (S.mode === 'demo') { bar.hidden = false; bar.innerHTML = demoBarHTML(); } else bar.hidden = true;

    view.innerHTML = kid ? kidShell(kid, mode) : parentHTML(mode);
    document.body.classList.toggle('has-nav', !!kid);
    afterRender(kid, mode);
    hydrateMedia();
    tickTimer();
  }

  function brandHTML(right) {
    return '<div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="12" rx="10" ry="3.8"/><ellipse cx="12" cy="12" rx="10" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="3.8" transform="rotate(-60 12 12)"/><circle cx="12" cy="12" r="2.4" fill="var(--accent)" stroke="none"/></svg></span><span class="brand-name">우리집 성장 앱</span></div><div class="who">' + right + '</div>';
  }

  function demoBarHTML() {
    const dev = [['k1', S.config.kids[0] ? S.config.kids[0].name : '첫째'], ['k2', S.config.kids[1] ? S.config.kids[1].name : '둘째'], ['parent', '부모']];
    const tm = [['auto', '지금 시각'], ['morning', '아침'], ['evening', '저녁']];
    return '<p class="note"><b>체험 모드</b> · 이 브라우저에만 저장되는 예시 데이터예요. 기기와 시간대를 바꿔 가며 보세요.</p>' +
      '<span class="seg-group"><span class="seg-label">기기</span><span class="seg">' + dev.map(([id, n]) => '<button data-act="device" data-v="' + id + '" aria-pressed="' + (ui.device === id) + '">' + esc(n) + '</button>').join('') + '</span></span>' +
      '<span class="seg-group"><span class="seg-label">시간대</span><span class="seg">' + tm.map(([id, n]) => '<button data-act="preview" data-v="' + id + '" aria-pressed="' + (ui.preview === id) + '">' + n + '</button>').join('') + '</span></span>';
  }

  // ===== 아이 화면 =====
  function kidHTML(kid, mode) {
    const style = ' style="--fs:' + (Number(kid.fontScale) || 1) + '"';
    if (mode === 'rest') return '<section class="kid"' + style + '>' + restHTML(kid) + hubHTML(kid) + '</section>';
    const steps = routineSteps(kid.id, mode), rl = rlog(kid.id, mode);
    if (!steps.length) return '<section class="kid"' + style + '><div class="rest"><h1>' + routineName(mode) + '에 넣은 할 일이 없어요</h1><p class="next">부모 화면의 루틴 탭에서 단계를 추가해 주세요.</p></div></section>';
    const back = S.mode !== 'demo' && ui.preview !== 'auto' ? '<p><button class="linkbtn" data-act="preview" data-v="auto">지금 시간 화면으로 돌아가기</button></p>' : '';
    if (rl.completedAt && !ui.review[kid.id + mode]) return '<section class="kid"' + style + '>' + back + finishHTML(kid, mode, steps, rl) + '</section>';
    return '<section class="kid"' + style + '>' + back + (kid.view === 'list' ? listHTML(kid, mode, steps, rl) : cardsHTML(kid, mode, steps, rl)) + '</section>';
  }

  function timebarHTML(mode, withText) {
    const tl = timeLeft(mode);
    if (!tl) return '';
    const label = mode === 'morning' ? '출발' : '잠잘 시간';
    let text = '';
    if (withText) {
      text = tl.mins > 0
        ? '<div class="timebar-label"><span>' + label + '까지 ' + (tl.mins >= 60 ? Math.floor(tl.mins / 60) + '시간 ' : '') + (tl.mins % 60) + '분</span><span>' + fmtClock(mode === 'morning' ? S.config.times.leave : S.config.times.bed) + '</span></div>'
        : '<div class="timebar-label"><span>' + label + ' 시간이 되었어요</span><span></span></div>';
    }
    return '<div class="timebar" role="img" aria-label="' + label + '까지 남은 시간"><span style="width:' + (tl.frac * 100).toFixed(1) + '%"></span></div>' + text;
  }

  function cardsHTML(kid, mode, steps, rl) {
    const key = kid.id + mode;
    let idx = ui.cardIdx[key];
    const firstUndone = steps.findIndex(s => !rl.steps[s.id]);
    if (idx == null || idx >= steps.length || idx < 0) idx = firstUndone < 0 ? 0 : firstUndone;
    ui.cardIdx[key] = idx;
    const s = steps[idx], done = !!rl.steps[s.id];
    const itemsLeft = s.items.filter(it => !rl.items[ikey(s.id, it.text)]).length;
    const photo = s.photo && S.photos[s.photo];
    const dots = steps.map((x, i) => '<li class="' + (rl.steps[x.id] ? 'done' : i === idx ? 'now' : '') + '"></li>').join('');
    const checks = s.items.length ? '<ul class="checks">' + s.items.map(it => {
      const on = !!rl.items[ikey(s.id, it.text)];
      return '<li><button class="check" data-act="item" data-step="' + esc(s.id) + '" data-text="' + esc(it.text) + '" aria-pressed="' + on + '"><span class="box">' + ICON.check + '</span>' + esc(it.text) + (it.sup ? '<span class="tag">시간표</span>' : '') + '</button></li>';
    }).join('') + '</ul>' : '';
    const primary = done
      ? '<button class="btn primary" data-act="next">다음으로</button>'
      : '<button class="btn primary" data-act="done" ' + (itemsLeft ? 'disabled' : '') + '>다 했어요</button>';
    const hint = !done && itemsLeft ? '<p class="hint">위에서 ' + itemsLeft + '개를 더 누르면 "다 했어요"가 켜져요</p>' : '';
    return '<div class="routine-head"><h1>' + routineName(mode) + '</h1><ol class="dots" aria-label="' + steps.length + '단계 중 ' + (idx + 1) + '번째">' + dots + '</ol></div>' +
      timebarHTML(mode, false) +
      '<article class="card" id="card">' +
      '<div class="pic">' + (photo ? '<img src="' + photo + '" alt="' + esc(s.title) + ' 사진">' : '<span class="emo" aria-hidden="true">' + esc(s.emoji || '⭐') + '</span>') + (done ? '<span class="done-badge">했어요</span>' : '') + '</div>' +
      '<div class="card-body"><p class="step-no">' + (idx + 1) + '번째 할 일</p><h2 class="step-title">' + esc(s.title) + '</h2>' + (s.detail ? '<p class="step-detail">' + esc(s.detail) + '</p>' : '') + checks + '</div>' +
      '</article>' +
      '<div class="card-actions"><button class="btn" data-act="prev" ' + (idx === 0 ? 'disabled' : '') + ' aria-label="이전 단계">' + ICON.back + '이전</button>' +
      '<button class="btn" data-act="say">' + ICON.speaker + '듣기</button>' + primary + '</div>' + hint;
  }

  function listHTML(kid, mode, steps, rl) {
    const doneN = steps.filter(s => rl.steps[s.id]).length;
    const rows = steps.map(s => {
      const on = !!rl.steps[s.id];
      const subs = s.items.length ? '<ul class="sub-items">' + s.items.map(it => {
        const ion = !!rl.items[ikey(s.id, it.text)];
        return '<li><button class="mini" data-act="mini" data-step="' + esc(s.id) + '" data-text="' + esc(it.text) + '" aria-pressed="' + ion + '"><span class="box">' + ICON.check + '</span>' + esc(it.text) + (it.sup ? ' <span class="tag">시간표</span>' : '') + '</button></li>';
      }).join('') + '</ul>' : '';
      return '<li class="task' + (on ? ' done' : '') + '"><button class="tick" data-act="tick" data-step="' + esc(s.id) + '" aria-pressed="' + on + '" aria-label="' + esc(s.title) + (on ? ' 완료 취소' : ' 완료') + '">' + (on ? ICON.check : '<span aria-hidden="true">' + esc(s.emoji || '') + '</span>') + '</button>' +
        '<div class="task-main"><div class="task-title"><span class="t">' + esc(s.title) + '</span>' + (on ? '<span class="task-time">' + fmtHM(rl.steps[s.id]) + '</span>' : '') + '</div>' + subs + '</div></li>';
    }).join('');
    return '<div class="routine-head"><h1>' + routineName(mode) + '</h1><p class="sub">' + steps.length + '개 중 ' + doneN + '개 완료</p></div>' +
      timebarHTML(mode, true) + '<ul class="tasks">' + rows + '</ul>' +
      (rl.completedAt ? '<p class="hint"><button class="btn small" data-act="unreview">완료 화면 보기</button></p>' : '');
  }

  function finishHTML(kid, mode, steps, rl) {
    const morning = mode === 'morning';
    return '<div class="finish"><div class="sticker" aria-hidden="true">' + (morning ? '🌟' : '🌙') + '</div>' +
      '<h1>' + (morning ? (inVacation() ? '아침 루틴 끝! 좋은 하루 보내요' : '준비 끝! 잘 다녀와요') : routineName(mode) + ' 끝! 잘 자요') + '</h1>' +
      '<p class="when">' + fmtHM(rl.completedAt) + '에 다 했어요</p>' +
      '<div class="count">내 별 <span>' + stickers(kid.id) + '개</span></div>' +
      moodCheckHTML(kid, morning ? 'am' : 'pm', true) +
      '<ul class="recap">' + steps.map(s => '<li><span>' + esc(s.title) + '</span><span>' + (rl.steps[s.id] ? fmtHM(rl.steps[s.id]) : '') + '</span></li>').join('') + '</ul>' +
      '<p class="hint"><button class="btn small" data-act="review">다시 보기</button></p></div>';
  }

  function restHTML(kid) {
    const c = S.config, d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    const school = isSchoolDay(d), tomorrowSchool = isSchoolDay(tomorrowOf(d));
    let title, next;
    if (inVacation(d)) { title = '방학이에요'; next = '아침 루틴은 ' + fmtClock((c.vacation || {}).wake || '08:00') + '에 열려요. 개학 ' + ((c.vacation || {}).end ? '전 마지막 주에는 등교 준비를 연습해요.' : ''); }
    else if (school && m < hm(c.times.morningStart)) { title = '곧 등교 준비 시간이에요'; next = fmtClock(c.times.morningStart) + '부터 등교 준비가 열려요.'; }
    else if (tomorrowSchool && m < hm(c.times.eveningStart)) { title = school ? '학교 다녀온 시간이에요' : '오늘은 학교 안 가는 날이에요'; next = fmtClock(c.times.eveningStart) + '부터 ' + eveningLabel() + '가 열려요.'; }
    else if (!tomorrowSchool && !school) { title = '오늘은 학교 안 가는 날이에요'; next = '푹 쉬어요. 다음 ' + eveningLabel() + '는 전날 저녁에 열려요.'; }
    else if (!tomorrowSchool) { title = '내일은 쉬는 날이에요'; next = '이번 주도 수고했어요. ' + eveningLabel() + '는 전날 저녁에 열려요.'; }
    else { title = '오늘 할 일은 끝났어요'; next = '내일 아침 ' + fmtClock(c.times.morningStart) + '에 만나요.'; }
    const mr = rlog(kid.id, 'morning'), er = rlog(kid.id, 'evening');
    const lines = [];
    if (mr.completedAt) lines.push('오늘 ' + routineName('morning') + '는 ' + fmtHM(mr.completedAt) + '에 끝냈어요.');
    if (er.completedAt) lines.push(eveningLabel() + '는 ' + fmtHM(er.completedAt) + '에 끝냈어요.');
    return '<div class="rest"><p class="eyebrow">지금은 쉬는 시간</p><h1>' + title + '</h1><p class="next">' + next + '</p>' +
      (lines.length ? '<p>' + lines.join(' ') + '</p>' : '') +
      '<div class="count" style="justify-self:start">내 별 <span>' + stickers(kid.id) + '개</span>' + streakBadge(kid.id) + '</div>' +
      '<div class="rest-actions"><button class="btn" data-act="open" data-v="morning">' + routineName('morning') + ' 보기</button><button class="btn" data-act="open" data-v="evening">' + eveningLabel() + ' 보기</button></div></div>';
  }

  // ===== 부모 화면 =====
  const TABS = [['board', '관제 센터'], ['review', '돌아보기'], ['rewards', '보상'], ['life', '생활'], ['notice', '가정통신문'], ['dad', '아빠 기록'], ['routine', '루틴'], ['studyplan', '공부 계획'], ['timetable', '시간표'], ['kids', '아이 설정'], ['times', '시간'], ['family', '가족 연결']];
  function parentHTML(mode) {
    const tabs = '<nav class="tabs" role="tablist">' + TABS.map(([id, n]) => '<button role="tab" data-act="ptab" data-v="' + id + '" aria-selected="' + (ui.parentTab === id) + '">' + (id === 'dad' ? esc(adultName()) + ' 기록' : n) + '</button>').join('') + '</nav>';
    ui.stepCtx = ui.parentTab === 'life' ? 'skill' : 'routine';
    if (ui.album) return albumHTML();
    const body = { board: boardHTML, life: lifeParentHTML, notice: noticeHTML, review: reviewParentHTML, rewards: rewardsHTML, dad: dadHTML, routine: routineEditHTML, studyplan: studyPlanHTML, timetable: timetableHTML, kids: kidsEditHTML, times: timesHTML, family: familyHTML }[ui.parentTab] || boardHTML;
    return tabs + body(mode);
  }

  function progressBlock(kid, mode, title) {
    const steps = routineSteps(kid.id, mode), rl = rlog(kid.id, mode);
    const doneN = steps.filter(s => rl.steps[s.id]).length;
    const left = steps.filter(s => !rl.steps[s.id]);
    const pct = steps.length ? Math.round(doneN / steps.length * 100) : 0;
    let tail;
    if (rl.completedAt) tail = '<p class="donebig">' + fmtHM(rl.completedAt) + ' 완료</p>';
    else if (!doneN) tail = '<p class="muted">아직 시작 전이에요</p>';
    else tail = '<p class="left-label">남은 단계</p><ul class="chips">' + left.map(s => {
      const miss = s.items.filter(it => !rl.items[ikey(s.id, it.text)]).map(it => it.text);
      return '<li class="' + (miss.length && miss.length < s.items.length ? 'miss' : '') + '">' + esc(s.title) + (miss.length && miss.length < s.items.length ? ' · ' + esc(miss.join(', ')) + ' 남음' : '') + '</li>';
    }).join('') + '</ul>';
    return '<div class="block"><h3>' + title + ' <small>' + doneN + ' / ' + steps.length + '</small></h3><div class="meter ' + mode + '"><span style="width:' + pct + '%"></span></div>' + tail + '</div>';
  }

  function boardHTML(mode) {
    const d = new Date(), c = S.config;
    const nsd = nextSchoolDay(d);
    const head = '<div class="board-head"><div><h1>현관 관제 센터</h1><p>' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WD[d.getDay()] + '요일 · 출발 ' + fmtClock(c.times.leave) + '</p></div>' +
      '<p class="muted">' + (mode === 'morning' ? '지금은 등교 준비 시간' : mode === 'evening' ? '지금은 ' + eveningLabel() + ' 시간' : '지금은 쉬는 시간') + '</p></div>';
    const panels = c.kids.map(kid => {
      const focus = mode === 'evening' ? 'evening' : 'morning';
      const rl = rlog(kid.id, focus), steps = routineSteps(kid.id, focus);
      const doneN = steps.filter(s => rl.steps[s.id]).length;
      const pill = rl.completedAt ? '<span class="pill ok">' + (focus === 'morning' ? '준비 끝' : '내일 준비 끝') + '</span>'
        : doneN ? '<span class="pill go">준비 중</span>' : '<span class="pill idle">시작 전</span>';
      const supToday = (c.timetable[kid.id] || {})[d.getDay()] || [];
      const supNext = (c.timetable[kid.id] || {})[nsd.getDay()] || [];
      const isSchool = isSchoolDay(d);
      return '<article class="panel"><div class="panel-head"><h2>' + esc(kid.name) + '<span class="grade">' + esc(kid.grade || '') + '</span></h2>' + pill + '</div>' + moodBoardHTML(kid) + cheerComposerHTML(kid) +
        (isSchool || mode === 'morning' ? progressBlock(kid, 'morning', '오늘 등교 준비') : '') +
        progressBlock(kid, 'evening', eveningLabel()) +
        '<div class="block"><h3>시간표 준비물</h3>' +
        (isSchool ? '<p><span class="left-label">오늘</span> ' + (supToday.length ? esc(supToday.join(', ')) : '<span class="muted">없음</span>') + '</p>' : '') +
        '<p><span class="left-label">' + WD[nsd.getDay()] + '요일</span> ' + (supNext.length ? esc(supNext.join(', ')) : '<span class="muted">없음</span>') + '</p></div>' +
        studyBoardHTML(kid) + booksBoardHTML(kid) + lifeBoardHTML(kid) +
        '<div class="block"><h3>별 <small>남은 ' + stickers(kid.id) + '개 · 이번 주 ' + earnedThisWeek(kid.id) + '/' + capOf(kid.id) + streakText(kid.id) + '</small></h3></div></article>';
    }).join('');
    return head + '<div class="board-grid">' + panels + dadPanelHTML() + '</div>';
  }

  function segHTML(act, cur, opts) {
    return '<span class="seg">' + opts.map(([v, n]) => '<button data-act="' + act + '" data-v="' + esc(v) + '" aria-pressed="' + (cur === v) + '">' + esc(n) + '</button>').join('') + '</span>';
  }

  function routineEditHTML() {
    const c = S.config;
    if (!kidById(ui.editKid)) ui.editKid = c.kids[0].id;
    const steps = ((c.routines[ui.editKid] || {})[ui.editRoutine]) || [];
    const kidOpts = c.kids.map(k => [k.id, k.name]);
    const pre = 'f-' + ui.editKid + '-' + ui.editRoutine + '-';
    return '<div class="section"><div class="row">' + segHTML('ekid', ui.editKid, kidOpts) + segHTML('eroutine', ui.editRoutine, [['morning', '등교 준비'], ['evening', '내일 준비'], ['vacation', '방학 아침']]) + '</div>' +
      '<p class="lead">위에서부터 순서대로 아이 화면에 나와요. 사진을 넣으면 그림 대신 우리 집 교복·가방 사진이 보여요. 고친 내용은 바로 저장돼요.</p>' +
      stepRowsHTML(steps, pre, true) + '</div>';
  }

  // 단계 편집 목록 (루틴과 생활 기술이 함께 쓴다 — 어느 목록인지는 ui.stepCtx가 정함)
  function stepRowsHTML(steps, pre, routine) {
    const rows = steps.map((s, i) => {
      const ph = s.photo && S.photos[s.photo];
      const id = pre + s.id + '-';
      return '<li class="step-edit" data-step="' + esc(s.id) + '">' +
        '<div class="thumb">' + (ph ? '<img src="' + ph + '" alt="">' : '<span aria-hidden="true">' + esc(s.emoji || '⭐') + '</span>') + '</div>' +
        '<div class="step-fields">' +
        '<div class="two"><label class="field"><span>그림</span><input type="text" id="' + id + 'emoji" data-f="emoji" value="' + esc(s.emoji || '') + '" maxlength="8"></label>' +
        '<label class="field"><span>' + (i + 1) + '번째 할 일</span><input type="text" id="' + id + 'title" data-f="title" value="' + esc(s.title) + '"></label></div>' +
        '<label class="field"><span>설명 (카드에 보이고 소리로 읽어 줘요)</span><input type="text" id="' + id + 'detail" data-f="detail" value="' + esc(s.detail || '') + '"></label>' +
        (routine ? '<label class="field"><span>하나씩 확인할 것 (쉼표로 구분)</span><input type="text" id="' + id + 'checks" data-f="checks" value="' + esc((s.checks || []).join(', ')) + '" placeholder="예: 셔츠 넣기, 명찰 달기"></label>' : '') +
        (routine ? '<label class="toggle"><input type="checkbox" id="' + id + 'supplies" data-f="supplies"' + (s.supplies ? ' checked' : '') + '>시간표 준비물도 이 단계에서 확인</label>' : '') +
        '<div class="step-tools"><span class="btn small filebtn">사진 찍기<input type="file" accept="image/*" capture="environment" data-act="photo" aria-label="' + esc(s.title) + ' 사진 찍기"></span>' +
        '<span class="btn small filebtn">앨범에서 고르기<input type="file" accept="image/*" data-act="photo" aria-label="' + esc(s.title) + ' 사진 고르기"></span>' +
        (ph ? '<button class="btn small" data-act="unphoto">사진 빼기</button>' : '') +
        '<span class="spacer"></span><button class="btn small" data-act="up" ' + (i === 0 ? 'disabled' : '') + ' aria-label="위로">↑</button><button class="btn small" data-act="down" ' + (i === steps.length - 1 ? 'disabled' : '') + ' aria-label="아래로">↓</button>' +
        '<button class="btn small danger" data-act="del-step">' + (ui.armed === s.id ? '정말 삭제' : '삭제') + '</button></div>' +
        '</div></li>';
    }).join('');
    return '<ol class="steps-edit">' + rows + '</ol><div><button class="btn" data-act="add-step">단계 추가</button></div>';
  }

  function timetableHTML() {
    const c = S.config;
    if (!kidById(ui.ttKid)) ui.ttKid = c.kids[0].id;
    const tt = c.timetable[ui.ttKid] || {};
    const days = [1, 2, 3, 4, 5, 6, 0].filter(d => c.schoolDays.includes(d));
    return '<div class="section"><div class="row">' + segHTML('ttkid', ui.ttKid, c.kids.map(k => [k.id, k.name])) + '</div>' +
      '<p class="lead">요일마다 챙길 준비물을 쉼표로 적어 두세요. 아침에는 그날 준비물이, 저녁에는 다음 등교일 준비물이 "시간표 준비물도 확인"을 켠 단계에 자동으로 들어가요.</p>' +
      '<div class="scroll-x"><table class="tt"><thead><tr><th>요일</th><th>준비물</th></tr></thead><tbody>' +
      days.map(d => '<tr><td>' + WD[d] + '</td><td><input type="text" id="tt-' + ui.ttKid + '-' + d + '" data-tt="' + d + '" value="' + esc((tt[d] || []).join(', ')) + '" placeholder="예: 체육복, 리코더" aria-label="' + WD[d] + '요일 준비물"></td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function kidsEditHTML() {
    return S.config.kids.map(k => {
      const id = 'k-' + k.id + '-';
      return '<div class="section" data-kid="' + k.id + '"><h2>' + esc(k.name) + '</h2>' +
        '<div class="row"><label class="field" style="flex:1 1 160px"><span>이름 (아이 화면에 보여요)</span><input type="text" id="' + id + 'name" data-k="name" value="' + esc(k.name) + '"></label>' +
        '<label class="field" style="flex:0 1 110px"><span>학년</span><input type="text" id="' + id + 'grade" data-k="grade" value="' + esc(k.grade || '') + '"></label></div>' +
        '<div class="row"><label class="field" style="flex:1 1 200px"><span>화면 방식</span><select id="' + id + 'view" data-k="view"><option value="cards"' + (k.view !== 'list' ? ' selected' : '') + '>한 화면에 한 단계 (카드)</option><option value="list"' + (k.view === 'list' ? ' selected' : '') + '>한 화면 체크리스트</option></select></label>' +
        '<label class="field" style="flex:1 1 140px"><span>글자 크기</span><select id="' + id + 'fs" data-k="fontScale">' + [[1, '보통'], [1.15, '크게'], [1.3, '아주 크게']].map(([v, n]) => '<option value="' + v + '"' + (Number(k.fontScale) === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></div>' +
        '<div class="row"><label class="toggle"><input type="checkbox" id="' + id + 'voice" data-k="voice"' + (k.voice ? ' checked' : '') + '>단계를 소리로 읽어 주기</label>' +
        '<label class="toggle"><input type="checkbox" id="' + id + 'fx" data-k="effects"' + (k.effects !== false ? ' checked' : '') + '>완료 효과음과 움직임</label>' +
        '<label class="field" style="flex:0 1 150px"><span>읽어 주는 속도</span><select id="' + id + 'vr" data-k="voiceRate">' + [[0.75, '느리게'], [0.85, '조금 느리게'], [1, '보통']].map(([v, n]) => '<option value="' + v + '"' + (Number(k.voiceRate) === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
        '<button class="btn small" data-act="testvoice" data-kid="' + k.id + '">음성 들어 보기</button></div>' + copySettingsHTML(k) + '</div>';
    }).join('');
  }

  function timesHTML() { return timesBaseHTML() + timesMoreHTML(); }
  function timesBaseHTML() {
    const t = S.config.times, sd = S.config.schoolDays;
    const f = (k, n) => '<label class="field" style="flex:1 1 150px"><span>' + n + '</span><input type="time" id="t-' + k + '" data-t="' + k + '" value="' + esc(t[k]) + '"></label>';
    return '<div class="section"><h2>하루 시간</h2><p class="lead">이 시간에 맞춰 아이 화면이 저절로 바뀌어요. 아침 시작부터 출발까지는 등교 준비, 저녁 시작부터 잠잘 시간까지는 내일 준비가 열려요.</p>' +
      '<div class="row">' + f('morningStart', '아침 시작') + f('leave', '출발') + '</div><div class="row">' + f('eveningStart', '저녁 시작') + f('bed', '잠잘 시간') + '</div></div>' +
      '<div class="section"><h2>학교 가는 요일</h2><div class="row">' + [1, 2, 3, 4, 5, 6, 0].map(d => '<label class="toggle"><input type="checkbox" id="sd-' + d + '" data-sd="' + d + '"' + (sd.includes(d) ? ' checked' : '') + '>' + WD[d] + '</label>').join('') + '</div></div>';
  }

  function familyHTML() {
    if (S.mode === 'demo') {
      return '<div class="section"><h2>지금은 체험 모드예요</h2><p class="lead">기록이 이 브라우저에만 저장돼요. Firebase를 연결하면 부모 기기와 두 아이 기기가 같은 기록을 실시간으로 함께 봐요. 연결 방법은 함께 드린 README.md에 정리해 두었어요.</p>' +
        '<div><button class="btn danger" data-act="reset">' + (ui.armed === 'reset' ? '정말 처음으로 되돌리기' : '체험 데이터 처음으로') + '</button></div></div>';
    }
    const kids = S.config.kids;
    const inv = ui.invite ? '<div class="section"><h2>' + esc(kidById(ui.invite.kidId).name) + ' 기기 초대 코드</h2><div class="row"><span class="code" id="invite-code">' + esc(ui.invite.code) + '</span><button class="btn small" data-act="copy">복사</button></div>' +
      '<p class="lead">24시간 동안 쓸 수 있어요. 아이 기기에서 앱을 열고 "아이 기기 연결"에 이 코드를 넣으세요.</p></div>' : '';
    const devs = S.members.map(m => {
      const k = m.kidId && kidById(m.kidId);
      const label = m.role === 'parent' ? '부모 · ' + esc(m.name || '') : esc(k ? k.name : '아이') + ' 기기';
      const me = S.user && m.uid === S.user.uid;
      return '<li><span>' + label + (me ? ' (지금 이 기기)' : '') + '</span>' + (m.role === 'kid' ? '<button class="btn small danger" data-act="unlink" data-v="' + esc(m.uid) + '">' + (ui.armed === m.uid ? '정말 해제' : '연결 해제') + '</button>' : '') + '</li>';
    }).join('');
    return '<div class="section"><h2>아이 기기 연결하기</h2><p class="lead">아이마다 초대 코드를 만들어 아이 기기에서 한 번 입력하면, 그 기기는 계속 그 아이 화면으로 열려요.</p><div class="row">' +
      kids.map(k => '<button class="btn" data-act="invite" data-v="' + k.id + '">' + esc(k.name) + ' 초대 코드 만들기</button>').join('') + '</div></div>' + inv +
      '<div class="section"><h2>연결된 기기</h2><ul class="devices">' + (devs || '<li class="muted">아직 없어요</li>') + '</ul></div>';
  }

  // ===== 로그인 =====
  function gateHTML() {
    return '<div class="gate"><h1>우리집 성장 앱</h1>' +
      '<div class="section"><h2>부모님</h2><p class="lead">구글 계정으로 시작하면 우리 가족 공간이 만들어져요.</p><button class="btn primary" data-act="google">구글 계정으로 시작</button></div>' +
      '<div class="section"><h2>아이 기기 연결</h2><p class="lead">부모님 화면의 "가족 연결"에서 만든 8자리 코드를 넣어 주세요.</p>' +
      '<div class="row"><label class="field" style="flex:1 1 180px"><span>초대 코드</span><input type="text" id="join-code" autocomplete="off" autocapitalize="characters" maxlength="10"></label><button class="btn" data-act="join" style="align-self:end">연결하기</button></div></div>' +
      (ui.err ? '<p class="err" role="alert">' + esc(ui.err) + '</p>' : '') + '</div>';
  }
  function errorHTML() {
    return '<div class="gate"><div class="section"><h2>불러오지 못했어요</h2><p class="lead">' + esc(S.error || '') + '</p><p class="lead">config.js의 Firebase 설정과 인터넷 연결을 확인한 뒤 다시 열어 주세요.</p><button class="btn" data-act="reload">다시 열기</button></div></div>';
  }

  // ---------- 그린 뒤 ----------
  function afterRender(kid, mode) {
    if (!kid || mode === 'rest' || kid.view === 'list' || ui.kidTab !== 'today') return;
    const steps = routineSteps(kid.id, mode), rl = rlog(kid.id, mode);
    if (rl.completedAt && !ui.review[kid.id + mode]) return;
    const s = steps[ui.cardIdx[kid.id + mode]];
    if (!s) return;
    const key = kid.id + mode + s.id;
    if (kid.voice && ui.audioOk && ui.lastSpoken !== key) {
      ui.lastSpoken = key;
      setTimeout(() => speak(s.title + '. ' + (s.detail || '')), 150);
    }
  }

  let toastTimer;
  function toast(msg, err) {
    if (err) console.error(err);
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // =====================================================================
  // 2단계: 공부 기록 · 독서와 필사 · 아빠의 영역
  // =====================================================================
  const ACT2 = {};
  const ICON2 = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="10.5" ry="3.6" transform="rotate(-22 12 12)"/></svg>',
    study: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="M10 3v6.2L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9.2V3"/><path d="M7.2 14.5h9.6"/><circle cx="10.5" cy="17.5" r=".6" fill="currentColor"/><circle cx="13.6" cy="16.6" r=".6" fill="currentColor"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.6c3-1.4 6-1.3 9 .8 3-2.1 6-2.2 9-.8V19c-3-1.3-6-1.2-9 .8-3-2-6-2.1-9-.8z"/><path d="M12 6.4v13.4"/><path d="M17 9.2l.5 1.1 1.2.1-.9.8.3 1.2-1.1-.6-1.1.6.3-1.2-.9-.8 1.2-.1z" fill="currentColor" stroke-width="1"/></svg>',
    life: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5c3 2.1 4.5 5.4 4.5 9.6l-1.8 3.9H9.3l-1.8-3.9c0-4.2 1.5-7.5 4.5-9.6z"/><circle cx="12" cy="9.6" r="1.7"/><path d="M7.6 12.2 5 15.4l3.1.9M16.4 12.2 19 15.4l-3.1.9"/><path d="M10.6 19.2 12 22l1.4-2.8"/></svg>',
    family: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1.9" fill="currentColor"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-60 12 12)"/></svg>'
  };
  const MOODS = [['😀', '쉬웠어요'], ['🙂', '괜찮았어요'], ['😣', '어려웠어요']];
  const isObj = v => v && typeof v === 'object';
  const vals = o => Object.values(o || {}).filter(isObj);
  const subj = name => (S.config.subjects || []).find(s => s.name === name) || { name: name || '공부', emoji: '✏️' };
  const dayLog = (who, date) => S.logs[(date || todayKey()) + '_' + who] || {};
  const fmtMin = m => m >= 60 ? Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '') : m + '분';
  const adult = () => (S.config.adults || [])[0] || { id: 'dad', name: '아빠' };
  const adultName = () => adult().name;
  const monthKey = d => S.dateKey(d || new Date()).slice(0, 7);
  const isCards = kid => kid.view !== 'list';
  const myBooks = owner => Object.keys(S.books).map(id => Object.assign({ id }, S.books[id])).filter(b => b.owner === owner);
  const bookTitle = id => (S.books[id] || {}).title || '책';
  function mediaImg(id, alt, cls) {
    const src = S.mediaCache[id];
    return '<img class="' + (cls || '') + '" data-media="' + esc(id) + '" alt="' + esc(alt || '') + '"' + (src ? ' src="' + src + '"' : '') + '>';
  }
  function hydrateMedia() {
    view.querySelectorAll('img[data-media]:not([src])').forEach(img => {
      S.getMedia(img.dataset.media).then(src => { if (src) img.src = src; }).catch(() => {});
    });
  }
  // 오늘 이 활동으로 별을 받았는지 표시하고, 주간 상한 안에서 1개를 준다. 그다음 오늘의 미션을 확인한다.
  function award(who, cat) {
    const l = dayLog(who)[cat] || {};
    if (l.awarded) return false;
    const p = {}; p[cat + '.awarded'] = true; write(p, who);
    const got = grant(who, 1);
    if (cat !== 'quests') checkQuests(who);
    return got > 0;
  }

  // ---------- 아이 화면 틀: 아래 탭 ----------
  function kidNavHTML() {
    const items = [['today', '오늘', ICON2.today], ['study', '공부', ICON2.study], ['books', '책·필사', ICON2.book], ['life', '생활', ICON2.life], ['family', '가족', ICON2.family]];
    return '<nav class="kidnav" aria-label="화면 고르기"><div class="kidnav-in">' + items.map(([v, n, ic]) =>
      '<button data-act="ktab" data-v="' + v + '"' + (ui.kidTab === v ? ' aria-current="page"' : '') + '>' + ic + '<span>' + n + '</span></button>').join('') + '</div></nav>';
  }
  function kidShell(kid, mode) {
    const style = ' style="--fs:' + (Number(kid.fontScale) || 1) + '"';
    if (ui.kidTab === 'study') return '<section class="kid"' + style + '>' + studyHTML(kid) + '</section>' + kidNavHTML();
    if (ui.kidTab === 'books') return '<section class="kid"' + style + '>' + booksHTML(kid) + '</section>' + kidNavHTML();
    if (ui.kidTab === 'life') return '<section class="kid"' + style + '>' + lifeKidHTML(kid) + '</section>' + kidNavHTML();
    if (ui.album) return '<section class="kid"' + style + '>' + albumHTML() + '</section>' + kidNavHTML();
    if (ui.kidTab === 'family') return '<section class="kid"' + style + '>' + familyKidHTML(kid) + '</section>' + kidNavHTML();
    return kidHTML(kid, mode) + kidNavHTML();
  }
  ACT2.ktab = b => { ui.kidTab = b.dataset.v; ui.bookView = 'home'; ui.studyPick = false; render(); window.scrollTo(0, 0); };

  // 쉬는 시간 화면 아래: 오늘 할 일 타일 + 아빠의 오늘
  function hubHTML(kid) {
    const st = studyOf(kid.id), mins = studyMins(st);
    const rd = vals((dayLog(kid.id).reading || {}).items), cp = vals((dayLog(kid.id).copy || {}).items);
    const pages = rd.reduce((a, r) => a + (r.pages || 0), 0);
    const tile = (act, v, emo, name, state, done) => '<button class="tile' + (done ? ' done' : '') + '" data-act="' + act + '" data-v="' + v + '"><span class="tile-emo" aria-hidden="true">' + emo + '</span><span class="tile-name">' + name + '</span><span class="tile-state">' + state + '</span></button>';
    return vacationBannerHTML() + reminderBannerHTML(kid) + moodCheckHTML(kid, nowSlot(), false) + cheersInboxHTML(kid) + questBarHTML(kid) + freeTimeHTML(kid) + '<h2 class="hub-title">오늘 할 일</h2><div class="tiles four">' +
      tile('ktab', 'study', '✏️', '공부', st.active ? '지금 공부 중 · ' + esc(st.active.subject) : mins ? '오늘 ' + fmtMin(mins) : '아직 안 했어요', !!mins && !st.active) +
      tile('go-book', 'read', '📚', '독서', rd.length ? '오늘 ' + pages + '쪽' : '아직 안 했어요', !!rd.length) +
      tile('go-book', 'copy', '✍️', '필사', cp.length ? '오늘 했어요' : '아직 안 했어요', !!cp.length) +
      choreTileHTML(kid) +
      '</div>' + dadTodayHTML(false);
  }
  ACT2['go-book'] = b => { ui.kidTab = 'books'; ui.bookView = b.dataset.v; if (b.dataset.v === 'copy') ui.copy = null; render(); window.scrollTo(0, 0); };

  // 아빠의 오늘 (아이 화면에는 보이게 둔 기록만, 부모 화면에는 숨긴 것까지)
  function dadEntries(includeHidden) {
    const out = [], a = adult();
    const push = (src, hidden) => ['exercise', 'reading', 'research'].forEach(cat => {
      const items = ((src || {})[cat] || {}).items || {};
      Object.keys(items).forEach(id => { if (isObj(items[id])) out.push(Object.assign({ id, cat, hidden }, items[id])); });
    });
    push(dayLog(a.id), false);
    if (includeHidden) push(S.notes[todayKey()], true);
    return out.sort((x, y) => (x.at || 0) - (y.at || 0));
  }
  function dadLine(e) {
    if (e.cat === 'exercise') return '🏃 ' + esc(e.kind) + ' ' + fmtMin(e.mins || 0) + (e.memo ? ' · ' + esc(e.memo) : '');
    if (e.cat === 'reading') return '📚 「' + esc(bookTitle(e.bookId)) + '」 ' + (e.pages ? e.pages + '쪽' : '') + (e.note ? ' · ' + esc(e.note) : '');
    return '🔬 ' + esc(e.text) + (e.mins ? ' · ' + fmtMin(e.mins) : '');
  }
  function dadTodayHTML(parent) {
    const list = dadEntries(parent);
    if (!parent && !list.length) return '';
    return '<div class="dadcard"><h2>' + esc(adultName()) + '의 오늘</h2>' + (list.length ? '<ul>' + list.map(e => '<li>' + dadLine(e) + (e.hidden ? ' <span class="pill idle">숨김</span>' : '') + '</li>').join('') + '</ul>' : '<p class="muted">아직 기록이 없어요</p>') + '</div>';
  }

  // ---------- 공부 기록 ----------
  function studyOf(who, date) {
    const s = dayLog(who, date).study || {};
    return { active: isObj(s.active) ? s.active : null, sessions: s.sessions || {}, plan: s.plan || {}, awarded: s.awarded };
  }
  const studyMins = st => vals(st.sessions).reduce((a, s) => a + (s.mins || 0), 0);
  function planToday(kidId) {
    const cfg = (S.config.study || {})[kidId] || { plan: {} };
    const st = studyOf(kidId);
    const base = ((cfg.plan || {})[new Date().getDay()] || []).map((p, i) => ({ key: 'p' + i, subject: p.subject, task: p.task }));
    const own = Object.keys(st.plan).filter(k => isObj(st.plan[k])).map(k => ({ key: k, subject: st.plan[k].subject, task: st.plan[k].task, own: true }));
    return base.concat(own).map(p => {
      const ss = vals(st.sessions).filter(s => s.planKey === p.key);
      return Object.assign(p, { mins: ss.reduce((a, s) => a + (s.mins || 0), 0), doneAny: ss.length > 0 });
    });
  }
  function studyHTML(kid) {
    const st = studyOf(kid.id);
    if (st.active) return st.active.endedAt ? studyEndHTML(kid, st.active) : timerHTML(kid, st.active);
    if (ui.studyPick) return subjectPickHTML(kid);
    return isCards(kid) ? studyCardsHTML(kid, st) : studyListHTML(kid, st);
  }
  function studyCardsHTML(kid, st) {
    const plan = planToday(kid.id), unit = ((S.config.study || {})[kid.id] || {}).unitMins || 15;
    const idx = plan.findIndex(p => !p.doneAny), next = plan[idx];
    const dots = plan.map((p, i) => '<li class="' + (p.doneAny ? 'done' : i === idx ? 'now' : '') + '"></li>').join('');
    const head = '<div class="routine-head"><h1>공부</h1>' + (plan.length ? '<ol class="dots" aria-label="오늘 공부 ' + plan.length + '개">' + dots + '</ol>' : '') + '</div>';
    if (!plan.length) {
      return head + '<div class="rest"><h1>오늘 정해 둔 공부가 없어요</h1><p class="next">하고 싶은 공부가 있으면 골라서 시작해요.</p><div class="rest-actions"><button class="btn primary" data-act="study-free">공부 고르기</button></div></div>';
    }
    if (!next) {
      return head + '<div class="finish"><div class="sticker" aria-hidden="true">✏️</div><h1>오늘 공부 끝!</h1><p class="when">모두 ' + fmtMin(studyMins(st)) + ' 공부했어요</p>' +
        '<ul class="recap">' + plan.map(p => '<li><span>' + esc(subj(p.subject).emoji + ' ' + p.subject) + '</span><span>' + p.mins + '분</span></li>').join('') + '</ul>' +
        '<p class="hint"><button class="btn small" data-act="study-free">더 공부하기</button></p></div>';
    }
    const sj = subj(next.subject);
    return head + '<article class="card"><div class="pic"><span class="emo" aria-hidden="true">' + esc(sj.emoji) + '</span></div>' +
      '<div class="card-body"><p class="step-no">' + (idx + 1) + '번째 공부 · ' + unit + '분</p><h2 class="step-title">' + esc(next.subject) + '</h2>' + (next.task ? '<p class="step-detail">' + esc(next.task) + '</p>' : '') + '</div></article>' +
      '<div class="card-actions two"><button class="btn" data-act="say2" data-text="' + esc(next.subject + '. ' + (next.task || '')) + '">' + ICON.speaker + '듣기</button>' +
      '<button class="btn primary" data-act="study-start" data-key="' + next.key + '">시작하기</button></div>';
  }
  function studyListHTML(kid, st) {
    const plan = planToday(kid.id), total = studyMins(st);
    const subs = (S.config.subjects || []).map(s => '<option>' + esc(s.name) + '</option>').join('');
    const rows = plan.map(p => '<li class="task study' + (p.doneAny ? ' done' : '') + '"><span class="tick" aria-hidden="true">' + (p.doneAny ? ICON.check : esc(subj(p.subject).emoji)) + '</span>' +
      '<div class="task-main"><div class="task-title"><span class="t">' + esc(p.subject) + (p.task ? ' · ' + esc(p.task) : '') + '</span>' + (p.mins ? '<span class="task-time">' + p.mins + '분</span>' : '') + '</div></div>' +
      '<div class="task-act"><button class="btn small' + (p.doneAny ? '' : ' primary') + '" data-act="study-start" data-key="' + p.key + '">' + (p.doneAny ? '더 하기' : '시작') + '</button>' +
      (p.own ? '<button class="btn small" data-act="plan-del" data-key="' + p.key + '" aria-label="계획 지우기">×</button>' : '') + '</div></li>').join('');
    const sess = vals(st.sessions).sort((a, b) => (a.start || 0) - (b.start || 0));
    return '<div class="routine-head"><h1>공부</h1><p class="sub">오늘 ' + fmtMin(total) + '</p></div>' +
      '<h2 class="hub-title">오늘 계획</h2><ul class="tasks">' + (rows || '<li class="muted">아래에서 오늘 할 공부를 적어 보세요</li>') + '</ul>' +
      '<div class="addrow"><label class="field"><span>과목</span><select id="plan-subj">' + subs + '</select></label>' +
      '<label class="field grow"><span>할 일</span><input type="text" id="plan-task" placeholder="예: 문제집 3쪽"></label>' +
      '<button class="btn" data-act="plan-add">계획 추가</button></div>' +
      '<p><button class="btn small" data-act="study-free">계획 없이 공부 시작</button></p>' +
      '<h2 class="hub-title">이번 주 공부 시간</h2>' + weekChartHTML(kid.id) +
      (sess.length ? '<h2 class="hub-title">오늘 한 공부</h2><ul class="sesslist">' + sess.map(s => '<li><span>' + esc(subj(s.subject).emoji + ' ' + s.subject) + (s.task ? ' · ' + esc(s.task) : '') + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</span><span>' + (MOODS[s.mood] ? MOODS[s.mood][0] + ' ' : '') + s.mins + '분</span></li>').join('') + '</ul>' : '');
  }
  function subjectPickHTML(kid) {
    return '<div class="routine-head"><h1>무슨 공부를 할까요?</h1></div><div class="tiles">' +
      (S.config.subjects || []).map(s => '<button class="tile" data-act="study-start" data-subject="' + esc(s.name) + '"><span class="tile-emo" aria-hidden="true">' + esc(s.emoji) + '</span><span class="tile-name">' + esc(s.name) + '</span></button>').join('') +
      '</div><p class="hint"><button class="btn small" data-act="study-back">돌아가기</button></p>';
  }
  function weekChartHTML(who) {
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
    const data = days.map(d => ({ d, m: studyMins(studyOf(who, S.dateKey(d))) }));
    const max = Math.max(30, ...data.map(x => x.m)), W = 420, H = 190, top = 26, base = 150, bw = 34, gap = (W - 7 * bw) / 7;
    const total = data.reduce((a, x) => a + x.m, 0);
    const bars = data.map((x, i) => {
      const h = Math.round(x.m / max * (base - top)), xpos = Math.round(gap / 2 + i * (bw + gap)), today = i === 6;
      const r = Math.min(4, h);
      const path = h ? 'M' + xpos + ' ' + base + 'V' + (base - h + r) + 'Q' + xpos + ' ' + (base - h) + ' ' + (xpos + r) + ' ' + (base - h) + 'H' + (xpos + bw - r) + 'Q' + (xpos + bw) + ' ' + (base - h) + ' ' + (xpos + bw) + ' ' + (base - h + r) + 'V' + base + 'Z' : '';
      return '<g class="bar' + (today ? ' today' : '') + '"><title>' + WD[x.d.getDay()] + '요일 ' + x.m + '분</title>' +
        '<rect x="' + (xpos - gap / 2) + '" y="' + top + '" width="' + (bw + gap) + '" height="' + (base - top + 30) + '" fill="transparent"/>' +
        (path ? '<path d="' + path + '"/>' : '<rect x="' + xpos + '" y="' + (base - 2) + '" width="' + bw + '" height="2" class="zero"/>') +
        (x.m ? '<text class="val" x="' + (xpos + bw / 2) + '" y="' + (base - h - 8) + '" text-anchor="middle">' + x.m + '</text>' : '') +
        '<text class="lab" x="' + (xpos + bw / 2) + '" y="' + (base + 24) + '" text-anchor="middle">' + (today ? '오늘' : WD[x.d.getDay()]) + '</text></g>';
    }).join('');
    return '<figure class="weekchart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="최근 7일 공부 시간(분): ' + data.map(x => WD[x.d.getDay()] + ' ' + x.m).join(', ') + '">' +
      '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" class="axis"/>' + bars + '</svg><figcaption>7일 동안 ' + fmtMin(total) + ' · 막대 위 숫자는 분</figcaption></figure>';
  }
  function timerHTML(kid, a) {
    const sj = subj(a.subject);
    const cards = isCards(kid);
    return '<div class="timer" id="timer" data-start="' + a.start + '" data-target="' + (a.target || 15) * 60 + '" data-sid="' + esc(a.sid) + '" data-cards="' + cards + '">' +
      '<p class="eyebrow">지금 공부 중</p>' +
      '<div class="orbit" role="img" aria-label="남은 시간을 도는 행성으로 보여 줘요"><svg viewBox="0 0 220 220" aria-hidden="true"><circle class="orbit-track" cx="110" cy="110" r="94"/>' +
      '<circle class="orbit-fill" id="timer-ring" cx="110" cy="110" r="94" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0" transform="rotate(-90 110 110)"/>' +
      '<g id="timer-planet"><circle class="orbit-planet" cx="110" cy="16" r="11"/></g></svg>' +
      '<div class="orbit-core"><span class="timer-emo">' + esc(sj.emoji) + '</span>' + (cards ? '' : '<span class="clock" id="timer-clock">0:00</span>') + '</div></div>' +
      '<h1 class="step-title">' + esc(a.subject) + '</h1>' + (a.task ? '<p class="step-detail">' + esc(a.task) + '</p>' : '') +
      (cards ? '' : '<p class="muted">목표 ' + (a.target || 15) + '분</p>') +
      '<p class="hint" id="timer-msg">' + (cards ? '행성이 한 바퀴 돌 때까지 해 봐요' : '') + '</p>' +
      '<div class="card-actions two"><button class="btn" data-act="study-cancel">' + (ui.armed === 'cancel' ? '정말 그만하기' : '그만하기') + '</button>' +
      '<button class="btn primary" data-act="study-end">다 했어요</button></div></div>';
  }
  function tickTimer() {
    const t = document.getElementById('timer');
    if (!t) return;
    const start = Number(t.dataset.start), target = Number(t.dataset.target), el = Math.max(0, (Date.now() - start) / 1000);
    const bar = document.getElementById('timer-bar'), clock = document.getElementById('timer-clock'), msg = document.getElementById('timer-msg');
    const left = Math.max(0, 1 - el / target);
    if (bar) bar.style.width = (left * 100).toFixed(2) + '%';
    const ring = document.getElementById('timer-ring'), planet = document.getElementById('timer-planet');
    if (ring) ring.setAttribute('stroke-dashoffset', ((1 - left) * 100).toFixed(2));
    if (planet) planet.setAttribute('transform', 'rotate(' + ((1 - left) * 360).toFixed(1) + ' 110 110)');
    if (clock) clock.textContent = Math.floor(el / 60) + ':' + String(Math.floor(el % 60)).padStart(2, '0');
    if (el >= target) {
      if (msg) msg.textContent = '시간이 됐어요! 다 했으면 "다 했어요"를 눌러요';
      if (!ui.timerChimed[t.dataset.sid]) { ui.timerChimed[t.dataset.sid] = true; chime(kidById(ui.device), true); }
    }
  }
  setInterval(tickTimer, 1000);
  function studyEndHTML(kid, a) {
    const mins = Math.max(1, Math.round((a.endedAt - a.start) / 60000));
    return '<div class="finish"><div class="sticker" aria-hidden="true">' + esc(subj(a.subject).emoji) + '</div><h1>' + mins + '분 공부했어요!</h1>' +
      '<p class="when">' + esc(a.subject) + (a.task ? ' · ' + esc(a.task) : '') + '</p>' +
      (isCards(kid) ? '' : '<label class="field note-field"><span>한 줄 소감 (선택)</span><input type="text" id="study-note" maxlength="80" placeholder="예: 분수 나눗셈이 이제 이해됐다"></label>') +
      '<p class="mood-q">공부해 보니 어땠어요?</p><div class="moods">' +
      MOODS.map(([e, n], i) => '<button class="mood" data-act="study-mood" data-v="' + i + '"><span aria-hidden="true">' + e + '</span>' + n + '</button>').join('') + '</div></div>';
  }
  ACT2['study-free'] = () => { ui.studyPick = true; render(); };
  ACT2['study-back'] = () => { ui.studyPick = false; render(); };
  ACT2['say2'] = b => { if (!speak(b.dataset.text)) toast('이 기기에서는 소리 읽기를 쓸 수 없어요'); };
  ACT2['study-start'] = (b, kid) => {
    const unit = ((S.config.study || {})[kid.id] || {}).unitMins || 15;
    let p = { subject: b.dataset.subject, task: '', key: null };
    if (b.dataset.key) p = planToday(kid.id).find(x => x.key === b.dataset.key) || p;
    const a = { sid: S.newId(), subject: p.subject || '기타', task: p.task || '', planKey: p.key || null, start: Date.now(), target: unit };
    write({ 'study.active': a }, kid.id);
    ui.studyPick = false; ui.kidTab = 'study';
    chime(kid, false);
    if (kid.voice) speak(a.subject + ' 공부를 시작해요');
    render();
  };
  ACT2['study-end'] = (b, kid) => {
    const a = studyOf(kid.id).active; if (!a) return;
    write({ 'study.active.endedAt': Date.now() }, kid.id);
    chime(kid, false); render();
  };
  ACT2['study-cancel'] = (b, kid) => {
    if (ui.armed !== 'cancel') { arm('cancel'); return; }
    ui.armed = null;
    write({ 'study.active': null }, kid.id); render();
  };
  ACT2['study-mood'] = (b, kid) => {
    const a = studyOf(kid.id).active; if (!a) return;
    const noteEl = document.getElementById('study-note');
    const end = a.endedAt || Date.now();
    const s = { subject: a.subject, task: a.task || '', planKey: a.planKey || null, start: a.start, end, mins: Math.max(1, Math.round((end - a.start) / 60000)), mood: Number(b.dataset.v), note: noteEl ? noteEl.value.trim() : '' };
    const p = { 'study.active': null }; p['study.sessions.' + a.sid] = s;
    write(p, kid.id);
    const got = award(kid.id, 'study');
    chime(kid, true);
    toast(got ? '공부 별 1개를 받았어요' : '공부를 기록했어요');
    render();
  };
  ACT2['plan-add'] = (b, kid) => {
    const task = (document.getElementById('plan-task') || {}).value || '';
    const subject = (document.getElementById('plan-subj') || {}).value || '기타';
    const p = {}; p['study.plan.' + S.newId()] = { subject, task: task.trim() };
    write(p, kid.id); render();
  };
  ACT2['plan-del'] = (b, kid) => { const p = {}; p['study.plan.' + b.dataset.key] = null; write(p, kid.id); render(); };

  // 부모 대시보드: 공부 블록
  function studyBoardHTML(kid) {
    const st = studyOf(kid.id), total = studyMins(st), sess = vals(st.sessions).sort((a, b) => (a.start || 0) - (b.start || 0));
    let live = '';
    if (st.active) {
      const m = Math.floor((Date.now() - st.active.start) / 60000);
      live = '<p><span class="pill go">' + (st.active.endedAt ? '소감 고르는 중' : '지금 공부 중') + '</span> ' + esc(subj(st.active.subject).emoji + ' ' + st.active.subject) + ' · ' + m + '분째</p>';
    }
    return '<div class="block"><h3>공부 <small>오늘 ' + fmtMin(total) + '</small></h3>' + live +
      (sess.length ? '<ul class="sesslist">' + sess.map(s => '<li><span>' + esc(subj(s.subject).emoji + ' ' + s.subject) + (s.task ? ' · ' + esc(s.task) : '') + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</span><span>' + (MOODS[s.mood] ? MOODS[s.mood][0] + ' ' : '') + s.mins + '분</span></li>').join('') + '</ul>'
        : (st.active ? '' : '<p class="muted">아직 기록이 없어요</p>')) + '</div>';
  }

  // ---------- 책·필사 ----------
  function booksHTML(kid) {
    const v = ui.bookView;
    if (v === 'copy') return copyHTML(kid);
    if (v === 'read') return readHTML(kid);
    if (v === 'add') return addBookHTML(kid);
    if (v === 'quotes') return quotesHTML(kid);
    if (v === 'gallery') return galleryHTML(kid);
    const books = myBooks(kid.id), reading = books.filter(b => b.status !== 'done'), done = books.filter(b => b.status === 'done');
    const cp = vals((dayLog(kid.id).copy || {}).items), rd = vals((dayLog(kid.id).reading || {}).items);
    const qs = Object.keys(S.quotes).map(id => Object.assign({ id }, S.quotes[id])).filter(q => q.owner === kid.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const tile = (v2, emo, name, state, ok) => '<button class="tile' + (ok ? ' done' : '') + '" data-act="bv" data-v="' + v2 + '"><span class="tile-emo" aria-hidden="true">' + emo + '</span><span class="tile-name">' + name + '</span><span class="tile-state">' + state + '</span></button>';
    return '<div class="routine-head"><h1>책·필사</h1></div><div class="tiles two">' +
      tile('copy', '✍️', '필사하기', cp.length ? '오늘 ' + cp.map(c => c.from + (c.to && c.to !== c.from ? '~' + c.to : '') + '쪽').join(', ') + ' 완료' : copyGoalText(kid), !!cp.length) +
      tile('read', '📚', '읽은 만큼 기록', rd.length ? '오늘 ' + rd.reduce((a, r) => a + (r.pages || 0), 0) + '쪽 읽었어요' : '오늘 읽은 쪽을 적어요', !!rd.length) + '</div>' +
      '<section class="shelf"><div class="shelf-head"><h2>지금 읽는 책</h2><button class="btn small" data-act="bv" data-v="add">책 추가</button></div>' +
      (reading.length ? '<ul class="books">' + reading.map(b => bookCardHTML(b, true)).join('') + '</ul>' : '<p class="muted">읽고 있는 책을 추가해 주세요</p>') + '</section>' +
      '<section class="shelf"><div class="shelf-head"><h2>나의 문장 모음</h2>' + (qs.length > 3 ? '<button class="btn small" data-act="bv" data-v="quotes">모두 보기 (' + qs.length + ')</button>' : '') + '</div>' +
      (qs.length ? '<ul class="quotes">' + qs.slice(0, 3).map(quoteHTML).join('') + '</ul>' : '<p class="muted">필사하면서 고른 문장이 여기에 모여요</p>') + '</section>' +
      '<section class="shelf"><div class="shelf-head"><h2>이번 달 필사</h2><button class="btn small" data-act="bv" data-v="gallery">사진 모아 보기</button></div></section>' +
      (done.length ? '<section class="shelf"><h2>다 읽은 책</h2><ul class="books">' + done.map(b => bookCardHTML(b, false)).join('') + '</ul></section>' : '');
  }
  function copyGoalText(kid) {
    const c = (S.config.copy || {})[kid.id] || {};
    return c.unit === 'paragraph' ? '오늘 한 단락' : '오늘 ' + (c.pages || 1) + '쪽';
  }
  function bookCardHTML(b, active) {
    return '<li class="bookcard"><div class="cover">' + (b.cover ? mediaImg(b.cover, '', '') : '<span aria-hidden="true">' + esc((b.title || '책').slice(0, 1)) + '</span>') + '</div>' +
      '<div class="bk"><b>' + esc(b.title) + '</b><span class="muted">' + (b.status === 'done' ? '다 읽었어요' : (b.page ? b.page + '쪽까지' : '이제 시작')) + '</span></div>' +
      (active ? '<button class="btn small" data-act="book-done" data-id="' + esc(b.id) + '">' + (ui.armed === 'done-' + b.id ? '정말 다 읽었어요' : '다 읽었어요') + '</button>' : '') + '</li>';
  }
  function quoteHTML(q) {
    return '<li class="quote"><p>' + esc(q.text) + '</p><span class="muted">「' + esc(bookTitle(q.bookId)) + '」 · ' + esc((q.date || '').slice(5).replace('-', '/')) + '</span>' + (q.why ? '<small>고른 이유: ' + esc(q.why) + '</small>' : '') + '</li>';
  }
  ACT2.bv = b => { if (b.dataset.v === 'add') ui.afterAdd = ui.bookView === 'add' ? 'home' : ui.bookView; ui.bookView = b.dataset.v; if (b.dataset.v === 'copy') ui.copy = null; if (b.dataset.v === 'gallery') ui.gallery = null; render(); window.scrollTo(0, 0); };
  ACT2['book-done'] = (b, kid) => {
    const id = b.dataset.id;
    if (ui.armed !== 'done-' + id) { arm('done-' + id); return; }
    ui.armed = null;
    S.patchDoc('books', id, {}, { status: 'done', finishedAt: Date.now() }).catch(fail);
    toast('다 읽은 책으로 옮겼어요'); render();
  };
  function backHTML() { return '<p><button class="linkbtn" data-act="bv" data-v="home">책·필사로 돌아가기</button></p>'; }
  function bookPickHTML(owner, sel, act) {
    const list = myBooks(owner).filter(b => b.status !== 'done');
    if (!list.length) return '<p class="muted">먼저 읽고 있는 책을 추가해 주세요. <button class="btn small" data-act="bv" data-v="add">책 추가</button></p>';
    return '<div class="chips-pick">' + list.map(b => '<button class="pick" data-act="' + act + '" data-id="' + esc(b.id) + '" aria-pressed="' + (sel === b.id) + '">' + esc(b.title) + '</button>').join('') + '</div>';
  }

  // 책 추가
  function addBookHTML(kid) {
    return backHTML() + '<div class="section"><h2>책 추가</h2>' +
      '<label class="field"><span>책 제목</span><input type="text" id="book-title" maxlength="60"></label>' +
      '<label class="field"><span>지은이 (선택)</span><input type="text" id="book-author" maxlength="40"></label>' +
      '<div class="row"><div class="cover big">' + (ui.cover ? '<img src="' + ui.cover + '" alt="표지">' : '<span aria-hidden="true">표지</span>') + '</div>' +
      '<span class="btn small filebtn">표지 찍기<input type="file" accept="image/*" capture="environment" data-act="photo2" data-kind="cover" aria-label="표지 찍기"></span>' +
      '<span class="btn small filebtn">앨범에서<input type="file" accept="image/*" data-act="photo2" data-kind="cover" aria-label="표지 고르기"></span></div>' +
      '<div><button class="btn primary" data-act="book-save">책장에 넣기</button></div></div>';
  }
  ACT2['book-save'] = async (b, kid) => {
    const title = ((document.getElementById('book-title') || {}).value || '').trim();
    if (!title) { toast('책 제목을 적어 주세요'); return; }
    const owner = kid ? kid.id : adult().id;
    const id = S.newId(), doc = { owner, title, author: ((document.getElementById('book-author') || {}).value || '').trim(), status: 'reading', page: 0, createdAt: Date.now() };
    if (ui.cover) { const cid = S.newId(); S.saveMedia(cid, ui.cover, { owner, kind: 'cover', date: todayKey() }).catch(fail); doc.cover = cid; }
    S.patchDoc('books', id, {}, doc).catch(fail);
    ui.cover = null;
    if (kid) { ui.bookView = ui.afterAdd || 'home'; ui.afterAdd = null; if (ui.bookView === 'read') ui.readSel = id; if (ui.copy) ui.copy.bookId = id; }
    toast('책장에 넣었어요'); render();
  };

  // 읽은 만큼 기록
  function readHTML(kid) {
    const sel = ui.readSel && S.books[ui.readSel] ? ui.readSel : (myBooks(kid.id).find(b => b.status !== 'done') || {}).id;
    ui.readSel = sel;
    const bk = S.books[sel] || {};
    return backHTML() + '<div class="section"><h2>읽은 만큼 기록하기</h2><p class="lead">어떤 책을 읽었나요?</p>' + bookPickHTML(kid.id, sel, 'read-pick') +
      (sel ? '<div class="row"><label class="field" style="flex:1 1 160px"><span>오늘 몇 쪽까지 읽었어요? (지난번 ' + (bk.page || 0) + '쪽)</span><input type="number" inputmode="numeric" id="read-to" min="' + (bk.page || 0) + '" value=""></label>' +
        '<label class="field" style="flex:1 1 120px"><span>읽은 시간 (선택)</span><select id="read-mins"><option value="">고르지 않음</option>' + [10, 15, 20, 30, 40, 60].map(m => '<option value="' + m + '">' + m + '분</option>').join('') + '</select></label></div>' +
        (isCards(kid) ? '<p class="mood-q">읽어 보니 어땠어요?</p><div class="moods">' + [['😊', '재미있어요'], ['🤔', '궁금해요'], ['😐', '그저 그래요']].map(([e, n], i) => '<button class="mood" data-act="read-mood" data-v="' + i + '" aria-pressed="' + (ui.readMood === i) + '"><span aria-hidden="true">' + e + '</span>' + n + '</button>').join('') + '</div>'
          : '<label class="field"><span>한 줄 느낌 (선택)</span><input type="text" id="read-note" maxlength="80"></label>') +
        '<label class="toggle"><input type="checkbox" id="read-finish">이 책을 다 읽었어요</label>' +
        '<div><button class="btn primary" data-act="read-save">기록하기</button></div>' : '') + '</div>';
  }
  ACT2['read-pick'] = b => { ui.readSel = b.dataset.id; render(); };
  // 고르기 버튼은 화면을 다시 그리지 않고 표시만 바꾼다 (적어 둔 입력이 지워지지 않게)
  function pressOnly(b) {
    b.parentElement.querySelectorAll('[aria-pressed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }
  ACT2['read-mood'] = b => { ui.readMood = Number(b.dataset.v); pressOnly(b); };
  ACT2['read-save'] = (b, kid) => {
    const bk = S.books[ui.readSel]; if (!bk) return;
    const to = Number((document.getElementById('read-to') || {}).value);
    if (!to || to < (bk.page || 0)) { toast('지난번보다 뒤쪽 숫자를 적어 주세요 (지난번 ' + (bk.page || 0) + '쪽)'); return; }
    const mins = Number((document.getElementById('read-mins') || {}).value) || 0;
    const noteEl = document.getElementById('read-note');
    const finish = (document.getElementById('read-finish') || {}).checked;
    const item = { bookId: ui.readSel, from: bk.page || 0, to, pages: to - (bk.page || 0), mins, note: noteEl ? noteEl.value.trim() : '', mood: ui.readMood, at: Date.now() };
    const p = {}; p['reading.items.' + S.newId()] = item;
    write(p, kid.id);
    S.patchDoc('books', ui.readSel, {}, finish ? { page: to, status: 'done', finishedAt: Date.now() } : { page: to }).catch(fail);
    const got = award(kid.id, 'reading');
    chime(kid, true); ui.readMood = null; ui.bookView = 'home';
    toast(item.pages + '쪽 읽었어요' + (got ? ' · 독서 별 1개' : '')); render();
  };

  // 필사: 책·쪽 정하기 → (쪽마다) 쓰고 사진 → 쉬기 → 마음에 든 문장 → 끝
  function lastCopyTo(bookId) {
    let best = 0;
    Object.values(S.logs).forEach(l => vals((l.copy || {}).items).forEach(c => { if (c.bookId === bookId && (c.to || 0) > best) best = c.to; }));
    return best || ((S.books[bookId] || {}).copyTo || 0);
  }
  function copyHTML(kid) {
    const cfg = (S.config.copy || {})[kid.id] || { pages: 1, quote: 'optional', rest: 0, unit: 'page' };
    if (!ui.copy) {
      const first = myBooks(kid.id).find(b => b.status !== 'done');
      ui.copy = { step: 'setup', bookId: first ? first.id : null, photos: [] };
    }
    const c = ui.copy;
    if (c.step === 'setup') {
      const from = lastCopyTo(c.bookId) + 1, para = cfg.unit === 'paragraph';
      return backHTML() + '<div class="section"><h2>오늘의 필사</h2><p class="lead">' + (para ? '마음에 드는 한 단락을 골라 공책에 옮겨 써요.' : '오늘은 ' + cfg.pages + '쪽을 공책에 옮겨 써요. 한 쪽 쓸 때마다 사진을 찍어요.') + '</p>' +
        bookPickHTML(kid.id, c.bookId, 'copy-pick') + (c.bookId ? '<div class="row">' +
          '<label class="field" style="flex:1 1 120px"><span>' + (para ? '몇 쪽에 있는 단락인가요?' : '시작 쪽') + '</span><input type="number" inputmode="numeric" id="copy-from" value="' + from + '" min="1"></label>' +
          (para ? '' : '<label class="field" style="flex:1 1 120px"><span>끝 쪽</span><input type="number" inputmode="numeric" id="copy-to" value="' + (from + cfg.pages - 1) + '" min="1"></label>') +
          '</div><div><button class="btn primary" data-act="copy-start">시작하기</button></div>' : '') + '</div>';
    }
    if (c.step === 'page') {
      const para = c.from === c.to && cfg.unit === 'paragraph';
      const pageNo = c.cur;
      const shot = c.photos.filter(ph => ph.page === pageNo);
      return '<div class="routine-head"><h1>필사</h1><p class="sub">「' + esc(bookTitle(c.bookId)) + '」 ' + c.from + (c.to !== c.from ? '~' + c.to : '') + '쪽</p></div>' +
        '<article class="card"><div class="pic"><span class="emo" aria-hidden="true">📝</span></div><div class="card-body">' +
        '<p class="step-no">' + (c.to > c.from ? (pageNo - c.from + 1) + ' / ' + (c.to - c.from + 1) + '쪽' : '') + '</p>' +
        '<h2 class="step-title">' + (para ? pageNo + '쪽 한 단락을 써요' : pageNo + '쪽을 공책에 써요') + '</h2>' +
        '<p class="step-detail">다 쓰면 공책을 사진으로 찍어요</p>' +
        (shot.length ? '<div class="thumbs">' + shot.map(ph => mediaImg(ph.thumb, pageNo + '쪽 필사 사진', 'thumb')).join('') + '</div>' : '') +
        '</div></article><div class="card-actions two">' +
        '<span class="btn primary filebtn">' + (shot.length ? '한 장 더 찍기' : '다 썼어요, 사진 찍기') + '<input type="file" accept="image/*" capture="environment" data-act="photo2" data-kind="copy" aria-label="필사 사진 찍기"></span>' +
        '<span class="btn filebtn">앨범에서 고르기<input type="file" accept="image/*" data-act="photo2" data-kind="copy" aria-label="필사 사진 고르기"></span></div>' +
        (shot.length ? '<div class="card-actions one"><button class="btn good" data-act="copy-next">' + (pageNo < c.to ? '이 쪽 끝! 다음으로' : '다 썼어요') + '</button></div>' : '');
    }
    if (c.step === 'rest') {
      const left = Math.max(0, (c.restUntil - Date.now()) / 1000);
      return '<div class="finish"><div class="sticker" aria-hidden="true">🌿</div><h1>잘했어요! 잠깐 쉬어요</h1><p class="when">물 한 모금 마시고 손을 풀어요</p>' +
        '<div class="timer" id="timer" data-start="' + (c.restUntil - (cfg.rest || 60) * 1000) + '" data-target="' + (cfg.rest || 60) + '" data-sid="rest' + c.cur + '" data-cards="true"><div class="timebar big"><span id="timer-bar" style="width:' + (left / (cfg.rest || 60) * 100) + '%"></span></div><p class="hint" id="timer-msg"></p></div>' +
        '<p class="hint"><button class="btn primary" data-act="copy-resume">' + c.cur + '쪽 쓰러 가기</button></p></div>';
    }
    if (c.step === 'quote') {
      const req = cfg.quote === 'required';
      return '<div class="routine-head"><h1>마음에 든 문장</h1></div><div class="section">' +
        '<p class="lead">오늘 쓴 부분에서 가장 마음에 든 문장을 하나 적어요. "나의 문장 모음"에 모여요.</p>' +
        '<label class="field"><span>마음에 든 문장' + (req ? '' : ' (선택)') + '</span><textarea id="quote-text" rows="3" maxlength="200"></textarea></label>' +
        (req ? '<label class="field"><span>고른 이유 한 줄</span><input type="text" id="quote-why" maxlength="80"></label>' : '') +
        '<div class="row"><button class="btn primary" data-act="copy-save">저장하기</button>' + (req ? '' : '<button class="btn" data-act="copy-save" data-skip="1">건너뛰기</button>') + '</div></div>';
    }
    // done
    return '<div class="finish"><div class="sticker" aria-hidden="true">✍️</div><h1>오늘 필사 끝!</h1><p class="when">「' + esc(bookTitle(c.bookId)) + '」 ' + c.from + (c.to !== c.from ? '~' + c.to : '') + '쪽 · 사진 ' + c.photos.length + '장</p>' +
      '<div class="thumbs center">' + c.photos.map(ph => mediaImg(ph.thumb, '필사 사진', 'thumb')).join('') + '</div>' +
      '<p class="hint"><button class="btn small" data-act="bv" data-v="home">책·필사로</button></p></div>';
  }
  ACT2['copy-pick'] = b => { ui.copy.bookId = b.dataset.id; render(); };
  ACT2['copy-start'] = (b, kid) => {
    const from = Number((document.getElementById('copy-from') || {}).value) || 1;
    const toEl = document.getElementById('copy-to');
    const to = toEl ? Math.max(from, Number(toEl.value) || from) : from;
    if (to - from > 9) { toast('한 번에 10쪽까지만 정할 수 있어요'); return; }
    Object.assign(ui.copy, { step: 'page', from, to, cur: from, photos: [] });
    if (kid.voice) speak(from + '쪽을 공책에 써요');
    render(); window.scrollTo(0, 0);
  };
  ACT2['copy-next'] = (b, kid) => {
    const c = ui.copy, cfg = (S.config.copy || {})[kid.id] || {};
    if (c.cur < c.to) {
      c.cur += 1;
      if (cfg.rest) { c.step = 'rest'; c.restUntil = Date.now() + cfg.rest * 1000; } else c.step = 'page';
    } else c.step = 'quote';
    chime(kid, false); render(); window.scrollTo(0, 0);
  };
  ACT2['copy-resume'] = (b, kid) => { ui.copy.step = 'page'; if (kid.voice) speak(ui.copy.cur + '쪽을 공책에 써요'); render(); };
  ACT2['copy-save'] = (b, kid) => {
    const c = ui.copy, cfg = (S.config.copy || {})[kid.id] || {};
    const text = b.dataset.skip ? '' : ((document.getElementById('quote-text') || {}).value || '').trim();
    const why = ((document.getElementById('quote-why') || {}).value || '').trim();
    if (cfg.quote === 'required' && !text) { toast('마음에 든 문장을 하나 적어 주세요'); return; }
    let quoteId = null;
    if (text) { quoteId = S.newId(); S.patchDoc('quotes', quoteId, {}, { owner: kid.id, bookId: c.bookId, text, why, date: todayKey() }).catch(fail); }
    const p = {}; p['copy.items.' + S.newId()] = { bookId: c.bookId, from: c.from, to: c.to, photos: c.photos, quoteId, at: Date.now() };
    write(p, kid.id);
    S.patchDoc('books', c.bookId, {}, { copyTo: c.to }).catch(fail);
    const got = award(kid.id, 'copy');
    c.step = 'done'; chime(kid, true);
    if (got) toast('필사 별 1개를 받았어요');
    render(); window.scrollTo(0, 0);
  };

  function quotesHTML(kid) {
    const qs = Object.keys(S.quotes).map(id => Object.assign({ id }, S.quotes[id])).filter(q => q.owner === kid.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return backHTML() + '<div class="routine-head"><h1>나의 문장 모음</h1><p class="sub">' + qs.length + '개</p></div><ul class="quotes">' + qs.map(quoteHTML).join('') + '</ul>';
  }
  function galleryHTML(kid) {
    const m = monthKey();
    if (!ui.gallery || ui.gallery.key !== kid.id + m) {
      ui.gallery = { key: kid.id + m, list: null };
      S.listThumbs(kid.id, m).then(list => { if (ui.gallery && ui.gallery.key === kid.id + m) { ui.gallery.list = list; render(); } }).catch(err => toast('사진을 불러오지 못했어요', err));
    }
    const list = ui.gallery.list;
    const [y, mo] = m.split('-');
    return backHTML() + '<div class="routine-head"><h1>' + Number(mo) + '월 필사</h1><p class="sub">' + (list ? list.length + '장' : '불러오는 중') + '</p></div>' +
      (list ? (list.length ? '<div class="gallery">' + list.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(t => '<figure>' + mediaImg(t.id, t.date + ' 필사', '') + '<figcaption>' + esc((t.date || '').slice(5).replace('-', '/')) + '</figcaption></figure>').join('') + '</div>'
        : '<p class="muted">이번 달 필사 사진이 아직 없어요</p>') : '');
  }

  // 부모 대시보드: 독서·필사 블록 (필사 사진은 작게, 누르면 크게)
  function booksBoardHTML(kid) {
    const rd = vals((dayLog(kid.id).reading || {}).items), cp = vals((dayLog(kid.id).copy || {}).items);
    if (!rd.length && !cp.length) return '<div class="block"><h3>독서·필사</h3><p class="muted">아직 기록이 없어요</p></div>';
    return '<div class="block"><h3>독서·필사</h3>' +
      rd.map(r => '<p>📚 「' + esc(bookTitle(r.bookId)) + '」 ' + r.from + '→' + r.to + '쪽 (' + r.pages + '쪽)' + (r.note ? ' · ' + esc(r.note) : '') + '</p>').join('') +
      cp.map(c => '<p>✍️ 「' + esc(bookTitle(c.bookId)) + '」 ' + c.from + (c.to !== c.from ? '~' + c.to : '') + '쪽 필사' + (c.quoteId && S.quotes[c.quoteId] ? '<br><span class="muted">“' + esc(S.quotes[c.quoteId].text) + '”</span>' : '') + '</p>' +
        '<div class="thumbs">' + (c.photos || []).map(ph => '<button class="thumbbtn" data-act="open-media" data-v="' + esc(ph.full) + '" aria-label="필사 사진 크게 보기">' + mediaImg(ph.thumb, '필사 사진', 'thumb') + '</button>').join('') + '</div>').join('') + '</div>';
  }
  ACT2['open-media'] = async b => {
    const src = await S.getMedia(b.dataset.v);
    if (!src) { toast('사진을 불러오지 못했어요'); return; }
    let ov = document.getElementById('viewer');
    if (!ov) { ov = document.createElement('div'); ov.id = 'viewer'; ov.className = 'viewer'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '사진 크게 보기'); document.body.appendChild(ov); }
    ov.innerHTML = '<img src="' + src + '" alt="필사 사진"><button class="btn" data-act="close-media">닫기</button>';
    ov.hidden = false;
  };
  ACT2['close-media'] = () => { const ov = document.getElementById('viewer'); if (ov) ov.hidden = true; };

  // ---------- 아빠 기록 (부모 화면) ----------
  function dadHTML() {
    const a = adult(), kinds = S.config.exerciseKinds || [];
    if (!ui.exKind) ui.exKind = kinds[0];
    const books = myBooks(a.id).filter(b => b.status !== 'done');
    if (!S.books[ui.dadBook] && books[0]) ui.dadBook = books[0].id;
    const minsSel = (id, list) => '<select id="' + id + '">' + list.map(m => '<option value="' + m + '">' + fmtMin(m) + '</option>').join('') + '</select>';
    const entries = dadEntries(true);
    return '<div class="board-head"><div><h1>' + esc(a.name) + ' 기록</h1><p>아이들에게 보이게 둔 기록은 아이 화면 "오늘"에 나와요</p></div></div>' +
      '<div class="section"><h2>오늘 기록 <small class="muted">' + entries.length + '개</small></h2>' +
      (entries.length ? '<ul class="devices">' + entries.map(e => '<li><span>' + dadLine(e) + '</span><span class="row">' +
        '<button class="btn small" data-act="dad-hide" data-cat="' + e.cat + '" data-id="' + esc(e.id) + '" data-hidden="' + e.hidden + '">' + (e.hidden ? '아이들에게 보이기' : '아이들에게 숨기기') + '</button>' +
        '<button class="btn small danger" data-act="dad-del" data-cat="' + e.cat + '" data-id="' + esc(e.id) + '" data-hidden="' + e.hidden + '">' + (ui.armed === 'del-' + e.id ? '정말 삭제' : '삭제') + '</button></span></li>').join('') + '</ul>' : '<p class="muted">아래에서 오늘 한 일을 기록하세요</p>') + '</div>' +
      '<div class="section"><h2>운동</h2><div class="chips-pick">' + kinds.map(k => '<button class="pick" data-act="ex-kind" data-v="' + esc(k) + '" aria-pressed="' + (ui.exKind === k) + '">' + esc(k) + '</button>').join('') + '</div>' +
      '<div class="addrow"><label class="field"><span>시간</span>' + minsSel('ex-mins', [10, 20, 30, 40, 60, 90]) + '</label><label class="field grow"><span>메모 (선택)</span><input type="text" id="ex-memo" maxlength="60" placeholder="예: 5km"></label><button class="btn primary" data-act="dad-add" data-cat="exercise">기록하기</button></div></div>' +
      '<div class="section"><h2>독서</h2>' + (books.length ? '<div class="chips-pick">' + books.map(b => '<button class="pick" data-act="dad-book" data-id="' + esc(b.id) + '" aria-pressed="' + (ui.dadBook === b.id) + '">' + esc(b.title) + ' <small>' + (b.page || 0) + '쪽</small></button>').join('') + '</div>' : '') +
      '<div class="addrow"><label class="field"><span>몇 쪽까지</span><input type="number" inputmode="numeric" id="dr-to"></label><label class="field grow"><span>한 줄 (선택)</span><input type="text" id="dr-note" maxlength="80"></label><button class="btn primary" data-act="dad-add" data-cat="reading">기록하기</button></div>' +
      '<label class="field"><span>아이들과 나눌 문장 (선택)</span><input type="text" id="dr-quote" maxlength="200"></label>' +
      '<div class="addrow"><label class="field grow"><span>새 책 제목</span><input type="text" id="book-title" maxlength="60"></label><button class="btn" data-act="book-save">책 추가</button></div></div>' +
      '<div class="section"><h2>연구 활동</h2><div class="addrow"><label class="field grow"><span>오늘 한 일 한 줄</span><input type="text" id="rs-text" maxlength="80" placeholder="예: 실험 결과 정리"></label><label class="field"><span>시간</span>' + minsSel('rs-mins', [30, 60, 90, 120, 180, 240]) + '</label><button class="btn primary" data-act="dad-add" data-cat="research">기록하기</button></div></div>';
  }
  ACT2['ex-kind'] = b => { ui.exKind = b.dataset.v; pressOnly(b); };
  ACT2['dad-book'] = b => { ui.dadBook = b.dataset.id; pressOnly(b); };
  ACT2['dad-add'] = b => dadAdd(b.dataset.cat, adult());
  function dadAdd(cat, a) {
    const val = id => ((document.getElementById(id) || {}).value || '').trim();
    let item;
    if (cat === 'exercise') item = { kind: ui.exKind || '운동', mins: Number(val('ex-mins')) || 0, memo: val('ex-memo') };
    if (cat === 'research') { if (!val('rs-text')) { toast('오늘 한 일을 한 줄 적어 주세요'); return; } item = { text: val('rs-text'), mins: Number(val('rs-mins')) || 0 }; }
    if (cat === 'reading') {
      const bk = S.books[ui.dadBook]; if (!bk) { toast('읽은 책을 골라 주세요'); return; }
      const to = Number(val('dr-to')) || bk.page || 0;
      item = { bookId: ui.dadBook, from: bk.page || 0, to, pages: Math.max(0, to - (bk.page || 0)), note: val('dr-note') };
      if (to > (bk.page || 0)) S.patchDoc('books', ui.dadBook, {}, { page: to }).catch(fail);
      if (val('dr-quote')) S.patchDoc('quotes', S.newId(), {}, { owner: a.id, bookId: ui.dadBook, text: val('dr-quote'), why: '', date: todayKey() }).catch(fail);
    }
    if (!item) return;
    item.at = Date.now();
    const p = {}; p[cat + '.items.' + S.newId()] = item;
    write(p, a.id);
    toast('기록했어요'); render();
  }
  ACT2['dad-hide'] = b => {
    const a = adult(), cat = b.dataset.cat, id = b.dataset.id, hidden = b.dataset.hidden === 'true', d = todayKey();
    const src = hidden ? ((S.notes[d] || {})[cat] || {}).items : ((dayLog(a.id)[cat] || {}).items);
    const item = src && src[id]; if (!item) return;
    const p = {}; p[cat + '.items.' + id] = null;
    const q = {}; q[cat + '.items.' + id] = item;
    if (hidden) { S.patchDoc('notes', d, { date: d }, p).catch(fail); write(q, a.id); }
    else { write(p, a.id); S.patchDoc('notes', d, { date: d }, q).catch(fail); }
    render();
  };
  ACT2['dad-del'] = b => {
    const a = adult(), cat = b.dataset.cat, id = b.dataset.id, d = todayKey();
    if (ui.armed !== 'del-' + id) { arm('del-' + id); return; }
    ui.armed = null;
    const p = {}; p[cat + '.items.' + id] = null;
    if (b.dataset.hidden === 'true') S.patchDoc('notes', d, { date: d }, p).catch(fail); else write(p, a.id);
    render();
  };
  function dadPanelHTML() {
    return '<article class="panel"><div class="panel-head"><h2>' + esc(adultName()) + '</h2><button class="btn small" data-act="ptab" data-v="dad">기록하기</button></div>' +
      (function () { const l = dadEntries(true); return l.length ? '<ul class="sesslist">' + l.map(e => '<li><span>' + dadLine(e) + '</span><span>' + (e.hidden ? '<span class="pill idle">숨김</span>' : '') + '</span></li>').join('') + '</ul>' : '<p class="muted">오늘 기록이 아직 없어요</p>'; })() + '</article>';
  }

  // ---------- 부모 설정: 공부 계획 ----------
  function studyPlanHTML() {
    const c = S.config;
    if (!kidById(ui.planKid)) ui.planKid = c.kids[0].id;
    const sp = (c.study || {})[ui.planKid] || { unitMins: 15, plan: {} };
    const subs = (c.subjects || []).map(s => s.name);
    const days = [1, 2, 3, 4, 5, 6, 0];
    return '<div class="section"><div class="row">' + segHTML('plankid', ui.planKid, c.kids.map(k => [k.id, k.name])) + '</div>' +
      '<p class="lead">요일마다 할 공부 카드를 정해 두면 ' + esc(kidById(ui.planKid).name) + ' 화면에 순서대로 나와요. ' + (isCards(kidById(ui.planKid)) ? '한 장씩 보여 주고, 타이머 막대가 다 줄면 알려 줘요.' : '아이는 여기에 자기 계획을 더할 수 있어요.') + '</p>' +
      '<label class="field" style="max-width:220px"><span>한 번 공부 시간 (타이머)</span><select id="sp-unit" data-sp="unit">' + [10, 15, 20, 25, 30, 40, 50].map(m => '<option value="' + m + '"' + (sp.unitMins === m ? ' selected' : '') + '>' + m + '분</option>').join('') + '</select></label></div>' +
      days.map(d => {
        const list = (sp.plan || {})[d] || [];
        return '<div class="section" data-day="' + d + '"><div class="shelf-head"><h2>' + WD[d] + '요일</h2><button class="btn small" data-act="sp-add" data-day="' + d + '">카드 추가</button></div>' +
          (list.length ? '<ul class="steps-edit">' + list.map((p, i) => '<li class="plan-edit" data-i="' + i + '">' +
            '<label class="field"><span>과목</span><select id="sp-' + ui.planKid + '-' + d + '-' + i + '-s" data-sp="subject">' + subs.map(s => '<option' + (s === p.subject ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></label>' +
            '<label class="field grow"><span>할 일</span><input type="text" id="sp-' + ui.planKid + '-' + d + '-' + i + '-t" data-sp="task" value="' + esc(p.task || '') + '"></label>' +
            '<button class="btn small danger" data-act="sp-del" data-day="' + d + '" data-i="' + i + '" aria-label="카드 지우기">삭제</button></li>').join('') + '</ul>' : '<p class="muted">쉬는 날</p>') + '</div>';
      }).join('');
  }
  ACT2.plankid = b => { ui.planKid = b.dataset.v; render(); };
  ACT2['sp-add'] = b => saveCfg(cfg => { const sp = cfg.study[ui.planKid]; sp.plan = sp.plan || {}; (sp.plan[b.dataset.day] = sp.plan[b.dataset.day] || []).push({ subject: (cfg.subjects[0] || {}).name || '국어', task: '' }); });
  ACT2['sp-del'] = b => saveCfg(cfg => { cfg.study[ui.planKid].plan[b.dataset.day].splice(Number(b.dataset.i), 1); });

  function copySettingsHTML(k) {
    const c = (S.config.copy || {})[k.id] || {};
    const id = 'cp-' + k.id + '-';
    return '<div class="row"><label class="field" style="flex:1 1 140px"><span>필사 단위</span><select id="' + id + 'unit" data-cp="unit"><option value="page"' + (c.unit !== 'paragraph' ? ' selected' : '') + '>쪽 단위</option><option value="paragraph"' + (c.unit === 'paragraph' ? ' selected' : '') + '>한 단락</option></select></label>' +
      '<label class="field" style="flex:1 1 120px"><span>필사 분량</span><select id="' + id + 'pages" data-cp="pages">' + [1, 2, 3, 4].map(n => '<option value="' + n + '"' + (c.pages === n ? ' selected' : '') + '>' + n + '쪽</option>').join('') + '</select></label>' +
      '<label class="field" style="flex:1 1 140px"><span>쪽 사이 쉬는 시간</span><select id="' + id + 'rest" data-cp="rest">' + [[0, '없음'], [30, '30초'], [60, '1분'], [120, '2분']].map(([v, n]) => '<option value="' + v + '"' + (Number(c.rest) === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<label class="field" style="flex:1 1 140px"><span>마음에 든 문장</span><select id="' + id + 'quote" data-cp="quote"><option value="optional"' + (c.quote !== 'required' ? ' selected' : '') + '>선택</option><option value="required"' + (c.quote === 'required' ? ' selected' : '') + '>꼭 적기</option></select></label></div>';
  }

  // 2단계 입력 바꾸기
  function CHANGE2(el) {
    if (el.dataset.act === 'photo2' && el.files && el.files[0]) { photo2(el); return true; }
    if (el.dataset.sp) {
      const li = el.closest('[data-i]'), day = el.closest('[data-day]');
      saveCfg(cfg => {
        const sp = cfg.study[ui.planKid];
        if (el.dataset.sp === 'unit') sp.unitMins = Number(el.value);
        else sp.plan[day.dataset.day][Number(li.dataset.i)][el.dataset.sp] = el.value.trim();
      });
      return true;
    }
    if (el.dataset.cp) {
      const kidId = el.closest('[data-kid]').dataset.kid, k = el.dataset.cp;
      saveCfg(cfg => { cfg.copy[kidId][k] = (k === 'pages' || k === 'rest') ? Number(el.value) : el.value; });
      return true;
    }
    return CHANGE3(el);
  }
  async function photo2(el) {
    const kind = el.dataset.kind, file = el.files[0], kid = kidById(ui.device);
    try {
      if (kind === 'cover') {
        ui.cover = await compressPhoto(file, PHOTO.cover);
        render(); return;
      }
      if (kind === 'notice') {
        ui.notice = { img: await compressPhoto(file, PHOTO.notice), rows: null, busy: false };
        render();
        if (aiKey()) analyzeNotice();
        return;
      }
      toast('사진을 줄이는 중…');
      const full = await compressPhoto(file, PHOTO.copy), thumb = await compressPhoto(file, PHOTO.thumb);
      const fid = S.newId(), tid = S.newId(), d = todayKey(), owner = kid.id;
      S.saveMedia(fid, full, { owner, kind: 'copy', date: d, ownerMonth: owner + '_' + d.slice(0, 7) }).catch(fail);
      S.saveMedia(tid, thumb, { owner, kind: 'thumb', full: fid, date: d, ownerMonth: owner + '_' + d.slice(0, 7) }).catch(fail);
      ui.copy.photos.push({ full: fid, thumb: tid, page: ui.copy.cur });
      chime(kid, false);
      toast('사진을 저장했어요 (' + fmtSize(file.size) + ' → ' + fmtSize(full.length * 3 / 4) + ')');
      render();
    } catch (err) { toast(err.message || '사진을 넣지 못했어요', err); }
    el.value = '';
  }

  // =====================================================================
  // 3단계: 감정 체크인 · 부모 한마디 · 오늘의 미션와 연속 기록 · 보상 · 칭찬 카드 · 주간 돌아보기
  // =====================================================================
  const MOOD5 = [['😄', '신나요'], ['🙂', '좋아요'], ['😐', '그저 그래요'], ['😢', '속상해요'], ['😠', '화나요']];
  const nowSlot = () => new Date().getHours() < 15 ? 'am' : 'pm';
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayKeyAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return S.dateKey(d); };
  function nameOf(id) { const k = kidById(id); if (k) return k.name; const a = (S.config.adults || []).find(x => x.id === id); return a ? a.name : '가족'; }
  const people = () => S.config.kids.map(k => k.id).concat((S.config.adults || []).map(a => a.id));

  // ---------- 주 단위 별 (상한) ----------
  function weekStartDate(d) { const x = new Date(d || new Date()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); x.setHours(0, 0, 0, 0); return x; }
  const weekKey = d => S.dateKey(weekStartDate(d));
  function weekDates() {
    const s = weekStartDate(), out = [], now = new Date();
    for (let i = 0; i < 7; i++) { const x = new Date(s); x.setDate(s.getDate() + i); if (x <= now) out.push(S.dateKey(x)); }
    return out;
  }
  const earnedThisWeek = who => weekDates().reduce((a, d) => a + ((S.logs[d + '_' + who] || {}).stars || 0), 0);
  const capOf = () => Number(S.config.weeklyCap) || 25;
  function grant(who, n) {
    const left = capOf(who) - earnedThisWeek(who), g = Math.max(0, Math.min(n, left));
    if (!g) { toast('이번 주 별을 다 모았어요. 다음 주에 또 모아요'); return 0; }
    write({ stars: (dayLog(who).stars || 0) + g }, who);
    const r = S.addSticker(who, g); if (r && r.catch) r.catch(fail);
    return g;
  }

  // ---------- 오늘의 미션 · 연속 기록 · 쉬어 가기 카드 ----------
  function questsFor(who) {
    const l = dayLog(who), q = [];
    if (isSchoolDay(new Date()) || inVacation()) q.push({ key: 'morning', name: inVacation() ? '아침 루틴' : '등교 준비', emo: inVacation() ? '🛏️' : '🎒', done: !!(l.morning || {}).completedAt });
    q.push({ key: 'study', name: '공부', emo: '✏️', done: vals((l.study || {}).sessions).length > 0 });
    q.push({ key: 'copy', name: '필사', emo: '✍️', done: vals((l.copy || {}).items).length > 0 });
    return q;
  }
  function checkQuests(who) {
    if (!kidById(who)) return;
    const q = questsFor(who);
    if (!q.every(x => x.done) || (dayLog(who).quests || {}).awarded) return;
    const got = award(who, 'quests');
    bumpStreak(who);
    setTimeout(() => toast('오늘의 미션 완료!' + (got ? ' 보너스 별 1개' : '')), 1200);
  }
  function freezeState(who) {
    const f = ((S.stats[who] || {}).freezes) || {}, wk = weekKey();
    return f.week === wk ? { week: wk, left: f.left || 0 } : { week: wk, left: Number(S.config.freezesPerWeek) || 0 };
  }
  // last 다음 날부터 today 전날까지 빠진 학교 가는 날 수
  function missedSchoolDays(last, today) {
    let n = 0; const d = parseKey(last); d.setDate(d.getDate() + 1);
    while (S.dateKey(d) < today) { if (isSchoolDay(d) || inVacation(d)) n++; d.setDate(d.getDate() + 1); }
    return n;
  }
  function bumpStreak(who) {
    const s = (S.stats[who] || {}).streak || { count: 0, last: null }, today = todayKey();
    if (s.last === today) return;
    const fz = freezeState(who);
    let count = 1;
    if (s.last) {
      const missed = missedSchoolDays(s.last, today);
      if (missed === 0) count = (s.count || 0) + 1;
      else if (missed <= fz.left) { count = (s.count || 0) + 1; fz.left -= missed; setTimeout(() => toast('쉬어 가기 카드 ' + missed + '장으로 연속 기록을 지켰어요'), 2600); }
    }
    const r = S.updateStats(who, { streak: { count, last: today }, freezes: fz }); if (r && r.catch) r.catch(fail);
  }
  function streakOf(who) {
    const s = (S.stats[who] || {}).streak;
    if (!s || !s.last) return 0;
    const today = todayKey();
    if (s.last === today) return s.count || 0;
    return missedSchoolDays(s.last, today) <= freezeState(who).left ? (s.count || 0) : 0;
  }
  const streakBadge = who => { const n = streakOf(who); return n ? ' <span class="streak-b">🚀 ' + n + '일 연속</span>' : ''; };
  const streakText = who => { const n = streakOf(who); return n ? ' · 🚀 ' + n + '일 연속' : ''; };
  function questBarHTML(kid) {
    const q = questsFor(kid.id), done = q.filter(x => x.done).length, bonus = (dayLog(kid.id).quests || {}).awarded;
    return '<div class="quests">' + rocketSVG(q, bonus) + '<div class="q-main"><div class="q-head"><b>오늘의 미션</b><span>' + done + ' / ' + q.length + (bonus ? ' · 발사 성공!' : ' · 다 하면 발사, 보너스 별') + '</span></div>' +
      '<ol class="q-list">' + q.map(x => '<li class="' + (x.done ? 'done' : '') + '"><span class="q-box" aria-hidden="true">' + (x.done ? ICON.check : x.emo) + '</span>' + x.name + '</li>').join('') + '</ol>' +
      '<p class="q-foot">🚀 ' + streakOf(kid.id) + '일 연속 발사 · 쉬어 가기 카드 ' + freezeState(kid.id).left + '장</p></div></div>';
  }
  // 오늘의 미션 로켓: 미션 하나가 로켓 한 단. 모두 채우면 불꽃이 켜진다
  function rocketSVG(q, launched) {
    const n = q.length, top = 34, bottom = 96, h = (bottom - top) / n;
    const segs = q.map((x, i) => '<rect x="18" y="' + (bottom - (i + 1) * h + 1.5).toFixed(1) + '" width="24" height="' + (h - 3).toFixed(1) + '" rx="3" class="' + (x.done ? 'on' : '') + '"/>').join('');
    return '<svg viewBox="0 0 60 126" class="rocket' + (launched ? ' launched' : '') + '" role="img" aria-label="미션 로켓 ' + n + '단 중 ' + q.filter(x => x.done).length + '단 채움">' +
      '<path class="nose" d="M30 5C40 13 42.5 23 42.5 31.5H17.5C17.5 23 20 13 30 5Z"/>' + segs +
      '<path class="fin" d="M17.5 72 7 96.5 17.5 92Z"/><path class="fin" d="M42.5 72 53 96.5 42.5 92Z"/>' +
      (launched ? '<path class="flame" d="M21 99Q30 128 39 99Z"/><path class="flame-in" d="M25.5 99Q30 115 34.5 99Z"/>' : '<path class="pad" d="M10 104H50"/>') + '</svg>';
  }

  // ---------- 감정 체크인 ----------
  function moodCheckHTML(kid, slot, compact) {
    const m = (dayLog(kid.id).mood || {})[slot], label = slot === 'am' ? '아침' : '저녁';
    if (m && ui.moodRedo !== slot) {
      if (ui.moodNote === slot && !isCards(kid)) {
        return '<div class="moodcheck"><p class="mood-done">' + label + ' 기분: ' + MOOD5[m.v][0] + ' ' + MOOD5[m.v][1] + '</p>' +
          '<div class="addrow"><label class="field grow"><span>왜 그런 기분인지 한 줄 (선택)</span><input type="text" id="mood-note" maxlength="80"></label>' +
          '<button class="btn" data-act="mood-note" data-slot="' + slot + '">저장</button><button class="btn" data-act="mood-skip">건너뛰기</button></div></div>';
      }
      return compact ? '' : '<p class="mood-done">' + label + ' 기분 ' + MOOD5[m.v][0] + ' ' + MOOD5[m.v][1] + (m.note ? ' · ' + esc(m.note) : '') + ' <button class="linkbtn" data-act="mood-redo" data-slot="' + slot + '">바꾸기</button></p>';
    }
    return '<div class="moodcheck"><h2>' + (compact ? '지금 기분은 어때요?' : label + ' 기분은 어때요?') + '</h2><div class="moods five">' +
      MOOD5.map(([e, n], i) => '<button class="mood" data-act="mood-set" data-slot="' + slot + '" data-v="' + i + '"><span aria-hidden="true">' + e + '</span>' + n + '</button>').join('') + '</div></div>';
  }
  ACT2['mood-set'] = (b, kid) => {
    const p = {}; p['mood.' + b.dataset.slot] = { v: Number(b.dataset.v), at: Date.now() };
    write(p, kid.id);
    ui.moodRedo = null; ui.moodNote = isCards(kid) ? null : b.dataset.slot;
    if (kid.voice) speak(MOOD5[Number(b.dataset.v)][1] + '. 말해 줘서 고마워요');
    render();
  };
  ACT2['mood-note'] = (b, kid) => {
    const v = ((document.getElementById('mood-note') || {}).value || '').trim();
    if (v) { const p = {}; p['mood.' + b.dataset.slot + '.note'] = v; write(p, kid.id); }
    ui.moodNote = null; render();
  };
  ACT2['mood-skip'] = () => { ui.moodNote = null; render(); };
  ACT2['mood-redo'] = b => { ui.moodRedo = b.dataset.slot; render(); };
  function hardDay(who, d) { const m = (S.logs[d + '_' + who] || {}).mood || {}; return ['am', 'pm'].some(s => m[s] && m[s].v >= 3); }
  function moodBoardHTML(kid) {
    const m = dayLog(kid.id).mood || {};
    const show = s => m[s] ? MOOD5[m[s].v][0] + ' ' + MOOD5[m[s].v][1] + (m[s].note ? ' (' + esc(m[s].note) + ')' : '') : '—';
    const alert = hardDay(kid.id, todayKey()) && hardDay(kid.id, dayKeyAgo(1))
      ? '<p class="alert">이틀째 힘든 기분을 골랐어요. 오늘 저녁에 천천히 이야기를 들어 주세요.</p>' : '';
    return '<p class="moodline">기분 · 아침 ' + show('am') + ' · 저녁 ' + show('pm') + '</p>' + alert;
  }

  // ---------- 부모 한마디 ----------
  function cheersOf(kidId, withYesterday) {
    const list = [];
    [todayKey()].concat(withYesterday ? [dayKeyAgo(1)] : []).forEach(d => {
      const c = (S.logs[d + '_' + kidId] || {}).cheers || {};
      Object.keys(c).forEach(id => { if (isObj(c[id]) && (d === todayKey() || !c[id].seen)) list.push(Object.assign({ id, date: d }, c[id])); });
    });
    return list.sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  function cheersInboxHTML(kid) {
    const list = cheersOf(kid.id, true);
    if (!list.length) return '';
    return '<div class="cheers"><h2>' + esc(adultName()) + '의 한마디</h2><ul>' + list.map(c =>
      '<li class="' + (c.seen ? '' : 'new') + '"><span class="ch-emo" aria-hidden="true">' + esc(c.emoji || '💬') + '</span><div class="ch-body"><p>' + esc(c.text || '') + '</p><small>' + esc(c.label || '오늘') + ' · ' + fmtHM(c.at) + '</small></div>' +
      '<div class="ch-act">' + (kid.voice ? '<button class="btn small" data-act="say2" data-text="' + esc((c.from || '') + '의 한마디. ' + (c.text || '')) + '" aria-label="소리로 듣기">' + ICON.speaker + '</button>' : '') +
      (c.seen ? '' : '<button class="btn small good" data-act="cheer-seen" data-id="' + esc(c.id) + '" data-date="' + c.date + '">고마워요</button>') + '</div></li>').join('') + '</ul></div>';
  }
  ACT2['cheer-seen'] = (b, kid) => {
    const p = {}; p['cheers.' + b.dataset.id + '.seen'] = Date.now();
    const r = S.patchLog(b.dataset.date, kid.id, p); if (r && r.catch) r.catch(fail);
    chime(kid, false); render();
  };
  const CHEER_EMO = ['🌟', '👏', '❤️', '💪', '😊'];
  const CHEER_FOR = ['오늘 전체', '등교 준비', '공부', '독서·필사', '내일 준비'];
  function cheerComposerHTML(kid) {
    const sent = cheersOf(kid.id, false);
    const list = sent.length ? '<ul class="sent">' + sent.map(c => '<li>' + esc(c.emoji || '') + ' ' + esc(c.text || '') + ' <small class="muted">' + (c.seen ? '읽음' : '아직 안 읽음') + '</small></li>').join('') + '</ul>' : '';
    if (ui.cheerKid !== kid.id) return '<div class="block cheerbox"><h3>' + esc(adultName()) + '의 한마디 <button class="btn small" data-act="cheer-open" data-v="' + kid.id + '">보내기</button></h3>' + list + '</div>';
    ui.cheerEmo = ui.cheerEmo || CHEER_EMO[0]; ui.cheerFor = ui.cheerFor || CHEER_FOR[0];
    return '<div class="block cheerbox"><h3>' + esc(kid.name) + '에게 한마디</h3>' +
      '<div class="chips-pick">' + CHEER_FOR.map(f => '<button class="pick" data-act="cheer-for" data-v="' + f + '" aria-pressed="' + (ui.cheerFor === f) + '">' + f + '</button>').join('') + '</div>' +
      '<div class="chips-pick">' + CHEER_EMO.map(e => '<button class="pick emo" data-act="cheer-emo" data-v="' + e + '" aria-pressed="' + (ui.cheerEmo === e) + '">' + e + '</button>').join('') + '</div>' +
      '<div class="addrow"><label class="field grow"><span>한마디</span><input type="text" id="cheer-text-' + kid.id + '" maxlength="80" placeholder="예: 혼자 교복 단추까지 다 잠갔구나!"></label>' +
      '<button class="btn primary" data-act="cheer-send" data-v="' + kid.id + '">보내기</button><button class="btn" data-act="cheer-open" data-v="">닫기</button></div>' + list + '</div>';
  }
  ACT2['cheer-open'] = b => { ui.cheerKid = b.dataset.v || null; render(); };
  ACT2['cheer-for'] = b => { ui.cheerFor = b.dataset.v; pressOnly(b); };
  ACT2['cheer-emo'] = b => { ui.cheerEmo = b.dataset.v; pressOnly(b); };
  ACT2['cheer-send'] = b => {
    const kidId = b.dataset.v, el = document.getElementById('cheer-text-' + kidId), text = el ? el.value.trim() : '';
    if (!text) { toast('한마디를 적어 주세요'); return; }
    const p = {}; p['cheers.' + S.newId()] = { emoji: ui.cheerEmo, text, label: ui.cheerFor, from: adultName(), at: Date.now() };
    const r = S.patchLog(todayKey(), kidId, p); if (r && r.catch) r.catch(fail);
    ui.cheerKid = null; toast(nameOf(kidId) + '에게 보냈어요'); render();
  };

  // ---------- 가족 탭 (아이) ----------
  function familyKidHTML(kid) {
    const sunday = new Date().getDay() === 0;
    return '<div class="routine-head"><h1>우리 가족</h1></div>' +
      (sunday ? '<p class="banner">오늘은 일요일, 가족이 함께 이번 주를 돌아보는 날이에요</p>' : '') +
      walletHTML(kid) + coopHTML(kid) + cardSendHTML(kid.id) + cardsReceivedHTML(kid.id, kid) +
      '<div class="section albumcta"><h2>올해 성장 앨범</h2><p class="lead">한 해 동안 읽은 책, 고른 문장, 필사 사진, 해낸 일을 한 권으로 모아 봐요.</p><div><button class="btn primary" data-act="album" data-v="' + kid.id + '">앨범 보기</button></div></div>' +
      '<h2 class="hub-title">이번 주 돌아보기</h2>' + reviewFamilyHTML(kid.id);
  }
  function pendingCost(kidId) { return vals(S.redeems).filter(r => r.kidId === kidId && r.status === 'requested').reduce((a, r) => a + (r.cost || 0), 0); }
  function walletHTML(kid) {
    const avail = stickers(kid.id) - pendingCost(kid.id), fz = freezeState(kid.id);
    const mine = Object.keys(S.redeems).map(id => Object.assign({ id }, S.redeems[id])).filter(r => r.kidId === kid.id).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 5);
    const st = { requested: '기다리는 중', done: '받았어요', rejected: '다음에' };
    return '<div class="wallet"><div class="w-num"><span class="big">' + avail + '</span><span>쓸 수 있는 별</span></div>' +
      '<p class="w-meta">이번 주 ' + earnedThisWeek(kid.id) + ' / ' + capOf(kid.id) + '개 · 🚀 ' + streakOf(kid.id) + '일 연속 · 쉬어 가기 카드 ' + fz.left + '장</p></div>' +
      '<h2 class="hub-title">별로 바꾸기</h2><ul class="shop">' + (S.config.rewards || []).map(r =>
        '<li><span class="r-emo" aria-hidden="true">' + (r.kind === 'money' ? '💰' : '🎉') + '</span><div class="r-body"><b>' + esc(r.name) + '</b><small>별 ' + r.cost + '개</small></div>' +
        '<button class="btn small primary" data-act="redeem" data-id="' + esc(r.id) + '"' + (avail < r.cost ? ' disabled' : '') + '>' + (ui.armed === 'rd-' + r.id ? '정말 바꿀래요' : '바꾸기') + '</button></li>').join('') + '</ul>' +
      (mine.length ? '<ul class="sesslist">' + mine.map(r => '<li><span>' + esc(r.name) + '</span><span>' + (st[r.status] || '') + '</span></li>').join('') + '</ul>' : '');
  }
  ACT2.redeem = (b, kid) => {
    const r = (S.config.rewards || []).find(x => x.id === b.dataset.id); if (!r) return;
    if (stickers(kid.id) - pendingCost(kid.id) < r.cost) { toast('별이 조금 더 필요해요'); return; }
    if (ui.armed !== 'rd-' + r.id) { arm('rd-' + r.id); return; }
    ui.armed = null;
    S.patchDoc('redeems', S.newId(), {}, { kidId: kid.id, rewardId: r.id, name: r.name, cost: r.cost, kind: r.kind, amount: r.amount || 0, status: 'requested', at: Date.now(), date: todayKey() }).catch(fail);
    chime(kid, true); toast(adultName() + '에게 신청했어요'); render();
  };
  function coopPages() {
    const days = weekDates();
    return S.config.kids.reduce((a, k) => a + days.reduce((b, d) => b + vals(((S.logs[d + '_' + k.id] || {}).copy || {}).items).reduce((c, x) => c + ((x.to || 0) - (x.from || 0) + 1), 0), 0), 0);
  }
  function coopHTML(kid) {
    const c = S.config.coop || { target: 10, bonus: 2 };
    if (!c.target || S.config.kids.length < 2) return '';
    const got = coopPages(), pct = Math.min(100, Math.round(got / c.target * 100)), claimed = ((S.stats[kid.id] || {}).coop) === weekKey();
    return '<div class="coop"><div class="q-head"><b>형제 협동 미션</b><span>' + Math.min(got, c.target) + ' / ' + c.target + '쪽</span></div>' +
      '<p class="muted">' + S.config.kids.map(k => esc(k.name)).join(' + ') + '가 이번 주에 함께 필사 ' + c.target + '쪽을 채우면 각자 별 ' + c.bonus + '개</p>' +
      '<div class="meter evening"><span style="width:' + pct + '%"></span></div>' +
      (got >= c.target ? (claimed ? '<p class="donebig">이번 주 협동 보상을 받았어요</p>' : '<p><button class="btn good" data-act="coop-claim">협동 보상 받기</button></p>') : '') + '</div>';
  }
  ACT2['coop-claim'] = (b, kid) => {
    const c = S.config.coop || {}; if (((S.stats[kid.id] || {}).coop) === weekKey() || coopPages() < c.target) return;
    const g = grant(kid.id, c.bonus || 2);
    S.updateStats(kid.id, { coop: weekKey() }).catch(fail);
    chime(kid, true); if (g) toast('협동 보상 별 ' + g + '개'); render();
  };
  const CARD_PHRASES = ['도와줘서 고마워', '끝까지 해낸 게 멋져', '같이 놀아 줘서 좋았어', '양보해 줘서 고마워', '내일도 힘내!'];
  function cardSendHTML(fromId) {
    const to = people().filter(p => p !== fromId);
    if (!to.includes(ui.cardTo)) ui.cardTo = to[0];
    ui.cardEmo = ui.cardEmo || '❤️';
    return '<div class="section cardsend"><h2>칭찬 카드 보내기</h2>' +
      '<div class="chips-pick">' + to.map(p => '<button class="pick" data-act="card-to" data-v="' + p + '" aria-pressed="' + (ui.cardTo === p) + '">' + esc(nameOf(p)) + '에게</button>').join('') + '</div>' +
      '<div class="chips-pick">' + ['❤️', '👏', '🤝', '🌟', '💪'].map(e => '<button class="pick emo" data-act="card-emo" data-v="' + e + '" aria-pressed="' + (ui.cardEmo === e) + '">' + e + '</button>').join('') + '</div>' +
      '<div class="chips-pick">' + CARD_PHRASES.map(t => '<button class="pick light" data-act="card-phrase" data-v="' + t + '">' + t + '</button>').join('') + '</div>' +
      '<div class="addrow"><label class="field grow"><span>하고 싶은 말</span><input type="text" id="card-text" maxlength="80"></label><button class="btn primary" data-act="card-send">보내기</button></div></div>';
  }
  ACT2['card-to'] = b => { ui.cardTo = b.dataset.v; pressOnly(b); };
  ACT2['card-emo'] = b => { ui.cardEmo = b.dataset.v; pressOnly(b); };
  ACT2['card-phrase'] = b => { const el = document.getElementById('card-text'); if (el) { el.value = b.dataset.v; } };
  ACT2['card-send'] = (b, kid) => {
    const text = ((document.getElementById('card-text') || {}).value || '').trim();
    if (!text) { toast('하고 싶은 말을 골라 주거나 적어 주세요'); return; }
    const from = kid ? kid.id : adult().id;
    S.patchDoc('cheercards', S.newId(), {}, { from, to: ui.cardTo, emoji: ui.cardEmo, text, date: todayKey(), at: Date.now() }).catch(fail);
    if (kid) chime(kid, true);
    toast(nameOf(ui.cardTo) + '에게 칭찬 카드를 보냈어요'); render();
  };
  function cardsThisWeek(who, dir) {
    const wk = weekKey();
    return Object.keys(S.cheercards).map(id => Object.assign({ id }, S.cheercards[id]))
      .filter(c => (c.date || '') >= wk && (who == null || c[dir || 'to'] === who)).sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  function cardsReceivedHTML(who, kid) {
    const list = cardsThisWeek(who, 'to');
    return '<h2 class="hub-title">이번 주 받은 칭찬 카드</h2>' + (list.length ? '<ul class="pcards">' + list.map(c =>
      '<li><span class="ch-emo" aria-hidden="true">' + esc(c.emoji || '❤️') + '</span><div class="ch-body"><p>' + esc(c.text) + '</p><small>' + esc(iGa(nameOf(c.from))) + ' · ' + esc((c.date || '').slice(5).replace('-', '/')) + '</small></div>' +
      (kid && kid.voice ? '<button class="btn small" data-act="say2" data-text="' + esc(iGa(nameOf(c.from)) + ' 보낸 칭찬. ' + c.text) + '" aria-label="소리로 듣기">' + ICON.speaker + '</button>' : '') + '</li>').join('') + '</ul>' : '<p class="muted">아직 없어요. 먼저 칭찬 카드를 보내 볼까요?</p>');
  }

  // ---------- 주간 돌아보기 ----------
  function reviewStats(who) {
    const days = weekDates(), L = d => S.logs[d + '_' + who] || {};
    if (kidById(who)) {
      const morning = days.filter(d => (L(d).morning || {}).completedAt).length;
      const study = days.reduce((a, d) => a + studyMins(studyOf(who, d)), 0);
      const pages = days.reduce((a, d) => a + vals((L(d).reading || {}).items).reduce((b, r) => b + (r.pages || 0), 0), 0);
      const copy = days.filter(d => vals((L(d).copy || {}).items).length).length;
      const chore = days.filter(d => (L(d).chores || {}).awarded).length;
      const skill = days.reduce((a, d) => a + vals((L(d).skills || {}).items).length, 0);
      return '등교 준비 ' + morning + '일 · 공부 ' + fmtMin(study) + ' · 독서 ' + pages + '쪽 · 필사 ' + copy + '일 · 집안일 ' + chore + '일 · 생활 기술 연습 ' + skill + '번 · 별 ' + earnedThisWeek(who) + '개';
    }
    let ex = 0, rs = 0, pg = 0;
    days.forEach(d => { const l = L(d); vals((l.exercise || {}).items).forEach(x => { ex += x.mins || 0; }); vals((l.research || {}).items).forEach(x => { rs += x.mins || 0; }); vals((l.reading || {}).items).forEach(x => { pg += x.pages || 0; }); });
    return '운동 ' + fmtMin(ex) + ' · 독서 ' + pg + '쪽 · 연구 ' + fmtMin(rs);
  }
  function reviewCardHTML(who, editable) {
    const rv = S.reviews[weekKey() + '_' + who] || {}, wk = weekKey();
    const qs = Object.keys(S.quotes).map(id => Object.assign({ id }, S.quotes[id])).filter(q => q.owner === who).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12);
    const recv = cardsThisWeek(who, 'to').length;
    const q = rv.quoteId && S.quotes[rv.quoteId];
    const fld = (f, label, ph) => '<label class="field"><span>' + label + '</span><input type="text" id="rv-' + who + '-' + f + '" data-rv="' + f + '" data-who="' + who + '" maxlength="80" value="' + esc(rv[f] || '') + '" placeholder="' + ph + '"></label>';
    return '<article class="rv' + (editable ? ' mine' : '') + '"><h3>' + esc(nameOf(who)) + (editable ? ' <small>(나)</small>' : '') + '</h3><p class="rv-stats">' + reviewStats(who) + ' · 받은 칭찬 ' + recv + '장</p>' +
      (editable
        ? fld('good', '이번 주 잘한 것 1개', '예: 아침마다 혼자 가방을 쌌다') + fld('change', '다음 주 바꿀 것 1개', '예: 필사를 저녁 먹기 전에 하기') +
          '<label class="field"><span>이번 주의 문장</span><select id="rv-' + who + '-quote" data-rv="quoteId" data-who="' + who + '"><option value="">고르지 않음</option>' +
          qs.map(x => '<option value="' + esc(x.id) + '"' + (x.id === rv.quoteId ? ' selected' : '') + '>' + esc(x.text.slice(0, 40)) + '</option>').join('') + '</select></label>'
        : '<dl class="rv-list"><dt>잘한 것</dt><dd>' + (rv.good ? esc(rv.good) : '<span class="muted">아직 안 적었어요</span>') + '</dd><dt>바꿀 것</dt><dd>' + (rv.change ? esc(rv.change) : '<span class="muted">아직 안 적었어요</span>') + '</dd>' +
          (q ? '<dt>이번 주의 문장</dt><dd class="rv-quote">“' + esc(q.text) + '”</dd>' : '') + '</dl>') + '</article>';
  }
  function reviewRange() { const s = weekStartDate(), e = new Date(s); e.setDate(s.getDate() + 6); return (s.getMonth() + 1) + '/' + s.getDate() + ' ~ ' + (e.getMonth() + 1) + '/' + e.getDate(); }
  function reviewFamilyHTML(me) {
    return '<p class="muted">' + reviewRange() + ' · 일요일 저녁에 가족이 함께 봐요</p><div class="rv-grid">' + reviewCardHTML(me, true) + people().filter(p => p !== me).map(p => reviewCardHTML(p, false)).join('') + '</div>';
  }
  function reviewParentHTML() {
    const all = cardsThisWeek(null);
    return '<div class="board-head"><div><h1>이번 주 돌아보기</h1><p>' + reviewRange() + ' · 일요일 저녁에 가족이 함께 보세요</p></div></div>' +
      '<div class="rv-grid">' + reviewCardHTML(adult().id, true) + S.config.kids.map(k => reviewCardHTML(k.id, false)).join('') + '</div>' +
      '<div class="section albumcta"><h2>올해 성장 앨범</h2><p class="lead">한 해 기록을 한 권으로 모아 PDF로 저장할 수 있어요.</p><div class="row">' + people().map(p => '<button class="btn" data-act="album" data-v="' + p + '">' + esc(nameOf(p)) + ' 앨범</button>').join('') + '</div></div>' +
      '<div class="section"><h2>이번 주 칭찬 카드 <small class="muted">' + all.length + '장</small></h2>' + (all.length ? '<ul class="pcards">' + all.map(c => '<li><span class="ch-emo" aria-hidden="true">' + esc(c.emoji || '❤️') + '</span><div class="ch-body"><p>' + esc(c.text) + '</p><small>' + esc(nameOf(c.from)) + ' → ' + esc(nameOf(c.to)) + ' · ' + esc((c.date || '').slice(5).replace('-', '/')) + '</small></div></li>').join('') + '</ul>' : '<p class="muted">아직 없어요</p>') + '</div>' +
      cardSendHTML(adult().id);
  }

  // ---------- 보상 (부모) ----------
  function rewardsHTML() {
    const rs = Object.keys(S.redeems).map(id => Object.assign({ id }, S.redeems[id]));
    const pend = rs.filter(r => r.status === 'requested').sort((a, b) => (a.at || 0) - (b.at || 0));
    const wk = weekKey(), money = rs.filter(r => r.status === 'done' && r.kind === 'money' && (r.date || '') >= wk);
    const c = S.config, coop = c.coop || {};
    return '<div class="board-head"><div><h1>보상</h1><p>아이가 신청한 것을 승인하면 별이 빠져요</p></div></div>' +
      '<div class="section"><h2>승인 기다리는 신청 <small class="muted">' + pend.length + '건</small></h2>' + (pend.length ? '<ul class="devices">' + pend.map(r =>
        '<li><span><b>' + esc(nameOf(r.kidId)) + '</b> · ' + esc(r.name) + ' <small class="muted">별 ' + r.cost + '개 · 남은 ' + stickers(r.kidId) + '개</small></span><span class="row">' +
        '<button class="btn small good" data-act="rd-approve" data-id="' + esc(r.id) + '">승인</button><button class="btn small" data-act="rd-reject" data-id="' + esc(r.id) + '">다음에</button></span></li>').join('') + '</ul>' : '<p class="muted">새 신청이 없어요</p>') + '</div>' +
      '<div class="section"><h2>이번 주 용돈 정산</h2>' + (money.length ? '<ul class="devices">' + S.config.kids.map(k => { const sum = money.filter(r => r.kidId === k.id).reduce((a, r) => a + (r.amount || 0), 0); return sum ? '<li><span>' + esc(k.name) + '</span><b>' + sum.toLocaleString('ko-KR') + '원</b></li>' : ''; }).join('') + '</ul>' : '<p class="muted">이번 주 승인한 용돈이 없어요</p>') + '</div>' +
      '<div class="section"><h2>바꿀 수 있는 것</h2><ul class="steps-edit">' + (c.rewards || []).map((r, i) => '<li class="plan-edit" data-ri="' + i + '">' +
        '<label class="field grow"><span>이름</span><input type="text" id="rw-' + i + '-name" data-rw="name" value="' + esc(r.name) + '"></label>' +
        '<label class="field"><span>별</span><input type="number" id="rw-' + i + '-cost" data-rw="cost" min="1" value="' + r.cost + '" style="width:80px"></label>' +
        '<label class="field"><span>종류</span><select id="rw-' + i + '-kind" data-rw="kind"><option value="family"' + (r.kind !== 'money' ? ' selected' : '') + '>가족 활동</option><option value="money"' + (r.kind === 'money' ? ' selected' : '') + '>용돈</option></select></label>' +
        (r.kind === 'money' ? '<label class="field"><span>금액(원)</span><input type="number" id="rw-' + i + '-amount" data-rw="amount" min="0" step="100" value="' + (r.amount || 0) + '" style="width:100px"></label>' : '') +
        '<button class="btn small danger" data-act="rw-del" data-i="' + i + '">삭제</button></li>').join('') + '</ul><div><button class="btn" data-act="rw-add">추가</button></div></div>' +
      '<div class="section"><h2>규칙</h2><div class="row">' +
        '<label class="field" style="flex:1 1 150px"><span>한 주 별 상한 (아이별)</span><input type="number" id="r3-cap" data-r3="weeklyCap" min="1" value="' + capOf() + '"></label>' +
        '<label class="field" style="flex:1 1 150px"><span>쉬어 가기 카드 (한 주)</span><select id="r3-fz" data-r3="freezesPerWeek">' + [0, 1, 2, 3].map(n => '<option value="' + n + '"' + (Number(c.freezesPerWeek) === n ? ' selected' : '') + '>' + n + '장</option>').join('') + '</select></label>' +
        '<label class="field" style="flex:1 1 150px"><span>협동 미션 필사 쪽수</span><input type="number" id="r3-ct" data-r3="coop.target" min="0" value="' + (coop.target || 0) + '"></label>' +
        '<label class="field" style="flex:1 1 150px"><span>협동 보상 별</span><input type="number" id="r3-cb" data-r3="coop.bonus" min="0" value="' + (coop.bonus || 0) + '"></label></div>' +
        '<p class="lead">별은 하루에 등교 준비·내일 준비·공부·독서·필사 각 1개, 오늘의 미션을 모두 하면 보너스 1개를 받아요. 상한을 넘으면 그 주에는 더 받지 않아요.</p></div>';
  }
  ACT2['rd-approve'] = b => {
    const r = S.redeems[b.dataset.id]; if (!r || r.status !== 'requested') return;
    S.patchDoc('redeems', b.dataset.id, {}, { status: 'done', doneAt: Date.now() }).catch(fail);
    S.updateStats(r.kidId, null, { spent: r.cost }).catch(fail);
    toast(nameOf(r.kidId) + ' · ' + r.name + ' 승인했어요'); render();
  };
  ACT2['rd-reject'] = b => {
    const r = S.redeems[b.dataset.id]; if (!r || r.status !== 'requested') return;
    S.patchDoc('redeems', b.dataset.id, {}, { status: 'rejected', doneAt: Date.now() }).catch(fail); render();
  };
  ACT2['rw-add'] = () => saveCfg(cfg => { cfg.rewards.push({ id: 'r' + Date.now().toString(36), name: '새 보상', cost: 5, kind: 'family' }); });
  ACT2['rw-del'] = b => saveCfg(cfg => { cfg.rewards.splice(Number(b.dataset.i), 1); });

  function CHANGE3(el) {
    if (el.dataset.rv) {
      const who = el.dataset.who, wk = weekKey(), p = {}; p[el.dataset.rv] = el.value.trim();
      S.patchDoc('reviews', wk + '_' + who, { week: wk, who }, p).catch(fail);
      return true;
    }
    if (el.dataset.rw) {
      const i = Number(el.closest('[data-ri]').dataset.ri), f = el.dataset.rw;
      saveCfg(cfg => { const r = cfg.rewards[i]; r[f] = (f === 'cost' || f === 'amount') ? Math.max(0, Number(el.value) || 0) : el.value.trim() || r[f]; if (f === 'cost' && !r.cost) r.cost = 1; });
      return true;
    }
    if (el.dataset.r3) {
      const path = el.dataset.r3.split('.'), v = Math.max(0, Number(el.value) || 0);
      saveCfg(cfg => { if (path.length === 2) { cfg[path[0]] = cfg[path[0]] || {}; cfg[path[0]][path[1]] = v; } else cfg[path[0]] = v; });
      return true;
    }
    return CHANGE4(el);
  }

  // =====================================================================
  // 4단계: 생활 자립 기술 · 집안일 · 용돈 기입장과 저축 목표
  // =====================================================================
  const LEVELS = [['together', '함께', '부모님과 같이 해요'], ['watch', '지켜봐 줌', '부모님이 옆에서 지켜봐요'], ['alone', '혼자', '혼자서 할 수 있어요']];
  const levelIdx = v => Math.max(0, LEVELS.findIndex(l => l[0] === v));
  const won = n => (Number(n) || 0).toLocaleString('ko-KR') + '원';
  const skillsOf = kidId => ((S.config.skills || {})[kidId] || []);
  const skillById = (kidId, id) => skillsOf(kidId).find(x => x.id === id);
  const skillStat = (kidId, id) => ((((S.stats[kidId] || {}).skills) || {})[id]) || { count: 0, alone: 0 };

  function lifeKidHTML(kid) {
    if (ui.skillRun) return skillRunHTML(kid);
    ui.lifeView = ui.lifeView || 'chores';
    const seg = '<div class="seg big-seg">' + [['chores', '집안일'], ['skills', '생활 기술'], ['money', '용돈']].map(([v, n]) =>
      '<button data-act="lifeview" data-v="' + v + '" aria-pressed="' + (ui.lifeView === v) + '">' + n + '</button>').join('') + '</div>';
    const body = ui.lifeView === 'skills' ? skillsKidHTML(kid) : ui.lifeView === 'money' ? moneyKidHTML(kid) : choresKidHTML(kid);
    return '<div class="routine-head"><h1>생활</h1></div>' + seg + body;
  }
  ACT2.lifeview = b => { ui.lifeView = b.dataset.v; render(); };

  // ---------- 집안일 ----------
  function choresToday(kidId) { const d = new Date().getDay(); return ((S.config.chores || {})[kidId] || []).filter(c => !c.days || c.days.includes(d)); }
  const choreItems = kidId => ((dayLog(kidId).chores || {}).items) || {};
  function choreTileHTML(kid) {
    const list = choresToday(kid.id), done = list.filter(c => choreItems(kid.id)[c.id]).length;
    if (!list.length) return '';
    return '<button class="tile' + (done === list.length ? ' done' : '') + '" data-act="go-life" data-v="chores"><span class="tile-emo" aria-hidden="true">🏠</span><span class="tile-name">집안일</span><span class="tile-state">' + (done === list.length ? '다 했어요' : done + ' / ' + list.length) + '</span></button>';
  }
  ACT2['go-life'] = b => { ui.kidTab = 'life'; ui.lifeView = b.dataset.v; ui.skillRun = null; render(); window.scrollTo(0, 0); };
  function choresKidHTML(kid) {
    const list = choresToday(kid.id), items = choreItems(kid.id), done = list.filter(c => items[c.id]).length;
    if (!list.length) return '<div class="rest"><h1>오늘은 맡은 집안일이 없어요</h1><p class="next">내일 또 만나요.</p></div>';
    return '<p class="sub-line">오늘 ' + done + ' / ' + list.length + (done === list.length ? ' · 다 했어요! 고마워요' : ' · 다 하면 별 1개') + '</p><ul class="tasks">' + list.map(c => {
      const on = !!items[c.id];
      return '<li class="task study' + (on ? ' done' : '') + '"><button class="tick" data-act="chore-tick" data-id="' + esc(c.id) + '" aria-pressed="' + on + '" aria-label="' + esc(c.title) + (on ? ' 완료 취소' : ' 완료') + '">' + (on ? ICON.check : '<span aria-hidden="true">' + esc(c.emoji || '🏠') + '</span>') + '</button>' +
        '<div class="task-main"><div class="task-title"><span class="t">' + esc(c.title) + '</span>' + (on ? '<span class="task-time">' + fmtHM(items[c.id]) + '</span>' : '') + '</div></div>' +
        (c.skillId && skillById(kid.id, c.skillId) && !on ? '<div class="task-act"><button class="btn small" data-act="skill-run" data-id="' + esc(c.skillId) + '" data-chore="' + esc(c.id) + '">방법 보기</button></div>' : '<span></span>') + '</li>';
    }).join('') + '</ul>';
  }
  function setChore(kid, id, on) {
    const p = {}; p['chores.items.' + id] = on ? Date.now() : null;
    write(p, kid.id);
    if (on) chime(kid, false);
    const list = choresToday(kid.id), items = choreItems(kid.id);
    if (on && list.every(c => items[c.id])) { const got = award(kid.id, 'chores'); chime(kid, true); toast('오늘 집안일 끝! 고마워요' + (got ? ' · 별 1개' : '')); }
  }
  ACT2['chore-tick'] = (b, kid) => { setChore(kid, b.dataset.id, b.getAttribute('aria-pressed') !== 'true'); render(); };

  // ---------- 생활 기술 ----------
  function levelDotsHTML(level) {
    const li = levelIdx(level);
    return '<span class="lv" aria-label="지금 단계: ' + LEVELS[li][1] + '">' + LEVELS.map((l, i) => '<span class="lv-step' + (i <= li ? ' on' : '') + '">' + l[1] + '</span>').join('<span class="lv-arrow" aria-hidden="true">→</span>') + '</span>';
  }
  function skillsKidHTML(kid) {
    const list = skillsOf(kid.id);
    const can = list.filter(s => s.level === 'alone');
    return '<h2 class="hub-title">할 수 있어요 <small class="muted">' + can.length + '개</small></h2>' +
      (can.length ? '<div class="cando">' + can.map(s => '<span class="cando-chip"><span aria-hidden="true">' + esc(s.emoji) + '</span>' + esc(s.title) + '</span>').join('') + '</div>' : '<p class="muted">혼자 할 수 있게 된 기술이 여기에 모여요</p>') +
      '<h2 class="hub-title">연습하기</h2><ul class="skills">' + list.map(s => {
        const st = skillStat(kid.id, s.id);
        return '<li class="skill"><span class="sk-emo" aria-hidden="true">' + esc(s.emoji) + '</span><div class="sk-body"><b>' + esc(s.title) + '</b><small class="muted">' + esc(s.area || '') + ' · 연습 ' + (st.count || 0) + '번 · 혼자 ' + (st.alone || 0) + '번</small>' + levelDotsHTML(s.level) + '</div>' +
          '<button class="btn small primary" data-act="skill-run" data-id="' + esc(s.id) + '">연습하기</button></li>';
      }).join('') + '</ul>';
  }
  ACT2['skill-run'] = (b, kid) => {
    ui.skillRun = { skillId: b.dataset.id, idx: 0, choreId: b.dataset.chore || null, checked: {}, step: 'steps' };
    ui.kidTab = 'life';
    const sk = skillById(kid.id, b.dataset.id);
    if (kid.voice && sk && isCards(kid) && sk.steps[0]) speak(sk.title + '. 첫 번째, ' + sk.steps[0].title);
    render(); window.scrollTo(0, 0);
  };
  function skillRunHTML(kid) {
    const r = ui.skillRun, sk = skillById(kid.id, r.skillId);
    if (!sk) { ui.skillRun = null; return ''; }
    const steps = sk.steps || [];
    const back = '<p><button class="linkbtn" data-act="skill-quit">그만하고 돌아가기</button></p>';
    if (r.step === 'who') {
      return back + '<div class="finish"><div class="sticker" aria-hidden="true">' + esc(sk.emoji) + '</div><h1>' + esc(sk.title) + ' 다 했어요!</h1><p class="mood-q">누구랑 했어요?</p><div class="moods">' +
        [['together', '🤝', '함께 했어요'], ['watch', '👀', '지켜봐 줬어요'], ['alone', '💪', '혼자 했어요']].map(([v, e, n]) => '<button class="mood" data-act="skill-finish" data-v="' + v + '"><span aria-hidden="true">' + e + '</span>' + n + '</button>').join('') + '</div></div>';
    }
    if (r.step === 'done') {
      const st = skillStat(kid.id, sk.id), suggest = st.alone >= 3 && sk.level !== 'alone';
      return '<div class="finish"><div class="sticker" aria-hidden="true">' + esc(sk.emoji) + '</div><h1>' + esc(sk.title) + ' 연습 끝!</h1><p class="when">지금까지 ' + (st.count || 0) + '번 연습했고, 혼자 ' + (st.alone || 0) + '번 했어요</p>' +
        levelDotsHTML(sk.level) + (suggest ? '<p class="banner">혼자 ' + st.alone + '번 해냈어요! 부모님께 "혼자" 단계로 올려 달라고 말해 봐요</p>' : '') +
        '<p class="hint"><button class="btn small" data-act="skill-quit">생활로 돌아가기</button></p></div>';
    }
    if (!isCards(kid)) {
      const all = steps.every(s => r.checked[s.id]);
      return back + '<div class="routine-head"><h1>' + esc(sk.emoji + ' ' + sk.title) + '</h1><p class="sub">' + steps.filter(s => r.checked[s.id]).length + ' / ' + steps.length + '</p></div>' +
        '<ul class="tasks">' + steps.map((s, i) => '<li class="task' + (r.checked[s.id] ? ' done' : '') + '"><button class="tick" data-act="skill-check" data-id="' + esc(s.id) + '" aria-pressed="' + !!r.checked[s.id] + '" aria-label="' + esc(s.title) + '">' + (r.checked[s.id] ? ICON.check : '<span aria-hidden="true">' + (i + 1) + '</span>') + '</button>' +
          '<div class="task-main"><div class="task-title"><span class="t">' + esc(s.title) + '</span></div>' + (s.detail ? '<small class="muted">' + esc(s.detail) + '</small>' : '') + '</div></li>').join('') + '</ul>' +
        '<div class="card-actions one"><button class="btn primary" data-act="skill-who"' + (all ? '' : ' disabled') + '>다 했어요</button></div>';
    }
    const s = steps[r.idx], photo = s && s.photo && S.photos[s.photo];
    const dots = steps.map((x, i) => '<li class="' + (i < r.idx ? 'done' : i === r.idx ? 'now' : '') + '"></li>').join('');
    return back + '<div class="routine-head"><h1>' + esc(sk.title) + '</h1><ol class="dots" aria-label="' + steps.length + '단계 중 ' + (r.idx + 1) + '번째">' + dots + '</ol></div>' +
      '<article class="card"><div class="pic">' + (photo ? '<img src="' + photo + '" alt="' + esc(s.title) + ' 사진">' : '<span class="emo" aria-hidden="true">' + esc(s.emoji || sk.emoji) + '</span>') + '</div>' +
      '<div class="card-body"><p class="step-no">' + (r.idx + 1) + '번째</p><h2 class="step-title">' + esc(s.title) + '</h2>' + (s.detail ? '<p class="step-detail">' + esc(s.detail) + '</p>' : '') + '</div></article>' +
      '<div class="card-actions"><button class="btn" data-act="skill-prev"' + (r.idx === 0 ? ' disabled' : '') + '>' + ICON.back + '이전</button>' +
      '<button class="btn" data-act="say2" data-text="' + esc(s.title + '. ' + (s.detail || '')) + '">' + ICON.speaker + '듣기</button>' +
      '<button class="btn primary" data-act="skill-next">다 했어요</button></div>';
  }
  ACT2['skill-quit'] = () => { ui.skillRun = null; render(); };
  ACT2['skill-prev'] = () => { ui.skillRun.idx = Math.max(0, ui.skillRun.idx - 1); render(); };
  ACT2['skill-next'] = (b, kid) => {
    const r = ui.skillRun, sk = skillById(kid.id, r.skillId);
    chime(kid, false);
    if (r.idx < sk.steps.length - 1) {
      r.idx += 1;
      if (kid.voice) { const s = sk.steps[r.idx]; speak(s.title + '. ' + (s.detail || '')); }
    } else r.step = 'who';
    render(); const card = document.querySelector('.card'); if (card) card.classList.add('bump');
  };
  ACT2['skill-check'] = (b, kid) => { const r = ui.skillRun; r.checked[b.dataset.id] = !r.checked[b.dataset.id]; if (r.checked[b.dataset.id]) chime(kid, false); render(); };
  ACT2['skill-who'] = () => { ui.skillRun.step = 'who'; render(); };
  ACT2['skill-finish'] = (b, kid) => {
    const r = ui.skillRun, id = r.skillId, st = skillStat(kid.id, id), withWho = b.dataset.v;
    const p = {}; p['skills.items.' + S.newId()] = { skillId: id, with: withWho, at: Date.now() };
    write(p, kid.id);
    const sp = {}; sp['skills.' + id + '.count'] = (st.count || 0) + 1; sp['skills.' + id + '.alone'] = (st.alone || 0) + (withWho === 'alone' ? 1 : 0); sp['skills.' + id + '.last'] = Date.now();
    S.patchDoc('stats', kid.id, {}, sp).catch(fail);
    if (r.choreId) setChore(kid, r.choreId, true);
    const got = award(kid.id, 'skills');
    chime(kid, true); if (got) toast('생활 기술 별 1개');
    r.step = 'done'; render(); window.scrollTo(0, 0);
  };

  // ---------- 용돈 기입장 · 저축 목표 ----------
  function moneyOf(kidId) {
    const list = Object.keys(S.money).map(id => Object.assign({ id }, S.money[id])).filter(m => m.owner === kidId);
    vals(S.redeems).forEach(r => { if (r.kidId === kidId && r.kind === 'money' && r.status === 'done' && r.amount) list.push({ type: 'in', amount: r.amount, memo: '별로 바꾼 용돈', date: r.date || '', at: r.doneAt || r.at || 0, auto: true }); });
    let wallet = 0, saved = 0;
    list.forEach(m => {
      if (m.type === 'in') wallet += m.amount;
      else if (m.type === 'out') wallet -= m.amount;
      else if (m.type === 'save') { wallet -= m.amount; saved += m.amount; }
      else if (m.type === 'usesave') saved -= m.amount;
    });
    return { list: list.sort((a, b) => (b.at || 0) - (a.at || 0)), wallet, saved };
  }
  const activeGoal = kidId => Object.keys(S.goals).map(id => Object.assign({ id }, S.goals[id])).find(g => g.owner === kidId && g.status === 'active');
  function goalHTML(kid, m) {
    const g = activeGoal(kid.id);
    if (!g) {
      return '<div class="section goal"><h2>저축 목표 정하기</h2><p class="lead">사고 싶은 것을 정하면 저금할 때마다 얼마나 모였는지 보여 줘요.</p>' +
        '<div class="addrow"><label class="field grow"><span>사고 싶은 것</span><input type="text" id="goal-title" maxlength="40"></label><label class="field"><span>가격(원)</span><input type="number" inputmode="numeric" id="goal-price" min="100" step="100" style="width:120px"></label></div>' +
        '<div class="row"><div class="cover big">' + (ui.cover ? '<img src="' + ui.cover + '" alt="목표 사진">' : '<span aria-hidden="true">사진</span>') + '</div>' +
        '<span class="btn small filebtn">사진 찍기<input type="file" accept="image/*" capture="environment" data-act="photo2" data-kind="cover" aria-label="목표 사진 찍기"></span>' +
        '<span class="btn small filebtn">앨범에서<input type="file" accept="image/*" data-act="photo2" data-kind="cover" aria-label="목표 사진 고르기"></span></div>' +
        '<div><button class="btn primary" data-act="goal-save">목표 정하기</button></div></div>';
    }
    const pct = Math.min(100, Math.round(m.saved / g.price * 100)), left = Math.max(0, g.price - m.saved);
    return '<div class="section goal"><div class="goal-top"><div class="cover big">' + (g.photo ? mediaImg(g.photo, g.title, '') : '<span aria-hidden="true">🎯</span>') + '</div>' +
      '<div class="goal-info"><p class="eyebrow">저축 목표</p><h2>' + esc(g.title) + '</h2><p>' + won(g.price) + '</p></div></div>' +
      '<div class="meter goal-meter"><span style="width:' + pct + '%"></span></div><p class="sub-line">' + won(Math.max(0, m.saved)) + ' 모았어요 · ' + pct + '%' + (left ? ' · ' + won(left) + ' 남았어요' : '') + '</p>' +
      (left ? '' : '<p class="banner">목표 달성! 부모님과 함께 사러 가요</p><div><button class="btn good" data-act="goal-buy" data-id="' + esc(g.id) + '">샀어요</button></div>') + '</div>';
  }
  function moneyKidHTML(kid) {
    const m = moneyOf(kid.id), type = ui.moneyType || 'out';
    const cats = S.config.moneyCats || [];
    ui.moneyCat = ui.moneyCat || (cats[0] || {}).name;
    const icon = x => x.type === 'in' ? '💵' : x.type === 'save' ? '🐷' : x.type === 'usesave' ? '🎯' : ((cats.find(c => c.name === x.cat) || {}).emoji || '🛍️');
    const sign = x => x.type === 'in' ? '+' : x.type === 'usesave' ? '' : '−';
    return '<div class="money-sum"><div><span class="eyebrow">지갑</span><b>' + won(m.wallet) + '</b></div><div><span class="eyebrow">저금통</span><b>' + won(Math.max(0, m.saved)) + '</b></div></div>' +
      goalHTML(kid, m) +
      '<div class="section"><h2>기록하기</h2><div class="seg big-seg">' + [['in', '받았어요'], ['out', '썼어요'], ['save', '저금했어요']].map(([v, n]) => '<button data-act="mtype" data-v="' + v + '" aria-pressed="' + (type === v) + '">' + n + '</button>').join('') + '</div>' +
      '<div class="addrow"><label class="field grow"><span>얼마예요? (원)</span><input type="number" inputmode="numeric" id="m-amount" min="0" step="100"></label></div>' +
      '<div class="chips-pick">' + [500, 1000, 5000].map(n => '<button class="pick light" data-act="m-add" data-v="' + n + '">+' + n.toLocaleString('ko-KR') + '</button>').join('') + '</div>' +
      (type === 'out' ? '<p class="mood-q">어디에 썼어요?</p><div class="cats">' + cats.map(c => '<button class="mood" data-act="m-cat" data-v="' + esc(c.name) + '" aria-pressed="' + (ui.moneyCat === c.name) + '"><span aria-hidden="true">' + esc(c.emoji) + '</span>' + esc(c.name) + '</button>').join('') + '</div>' : '') +
      '<label class="field"><span>메모 (선택)</span><input type="text" id="m-memo" maxlength="40" placeholder="' + (type === 'in' ? '예: 할머니께 받은 용돈' : type === 'out' ? '예: 우유' : '예: 목표를 위해') + '"></label>' +
      '<div><button class="btn primary" data-act="m-save">기록하기</button></div></div>' +
      '<h2 class="hub-title">최근 기록</h2>' + (m.list.length ? '<ul class="ledger">' + m.list.slice(0, 15).map(x => '<li class="' + x.type + '"><span class="l-emo" aria-hidden="true">' + icon(x) + '</span><span class="l-body">' + esc(x.memo || x.cat || (x.type === 'save' ? '저금' : x.type === 'in' ? '받은 돈' : '쓴 돈')) + '<small>' + esc((x.date || '').slice(5).replace('-', '/')) + (x.type === 'save' ? ' · 저금통으로' : '') + '</small></span><span class="l-amt">' + sign(x) + won(x.amount) + '</span></li>').join('') + '</ul>' : '<p class="muted">아직 기록이 없어요</p>');
  }
  ACT2.mtype = b => { ui.moneyType = b.dataset.v; render(); };
  ACT2['m-cat'] = b => { ui.moneyCat = b.dataset.v; pressOnly(b); };
  ACT2['m-add'] = b => { const el = document.getElementById('m-amount'); if (el) el.value = (Number(el.value) || 0) + Number(b.dataset.v); };
  ACT2['m-save'] = (b, kid) => {
    const amount = Math.round(Number((document.getElementById('m-amount') || {}).value) || 0);
    if (amount <= 0) { toast('금액을 적어 주세요'); return; }
    const type = ui.moneyType || 'out', m = moneyOf(kid.id);
    if ((type === 'out' || type === 'save') && amount > m.wallet) { toast('지갑에 ' + won(m.wallet) + '이 있어요. 금액을 확인해 주세요'); return; }
    const memo = ((document.getElementById('m-memo') || {}).value || '').trim();
    S.patchDoc('money', S.newId(), {}, { owner: kid.id, type, amount, cat: type === 'out' ? ui.moneyCat : '', memo, date: todayKey(), at: Date.now() }).catch(fail);
    chime(kid, type === 'save');
    toast(type === 'save' ? won(amount) + ' 저금했어요' : '기록했어요'); render();
  };
  ACT2['goal-save'] = (b, kid) => {
    const title = ((document.getElementById('goal-title') || {}).value || '').trim(), price = Math.round(Number((document.getElementById('goal-price') || {}).value) || 0);
    if (!title || price <= 0) { toast('사고 싶은 것과 가격을 적어 주세요'); return; }
    const doc = { owner: kid.id, title, price, status: 'active', createdAt: Date.now() };
    if (ui.cover) { const cid = S.newId(); S.saveMedia(cid, ui.cover, { owner: kid.id, kind: 'cover', date: todayKey() }).catch(fail); doc.photo = cid; ui.cover = null; }
    S.patchDoc('goals', S.newId(), {}, doc).catch(fail);
    chime(kid, true); toast('목표를 정했어요'); render();
  };
  ACT2['goal-buy'] = (b, kid) => {
    const g = S.goals[b.dataset.id]; if (!g) return;
    if (ui.armed !== 'buy') { arm('buy'); return; }
    ui.armed = null;
    S.patchDoc('goals', b.dataset.id, {}, { status: 'done', doneAt: Date.now() }).catch(fail);
    S.patchDoc('money', S.newId(), {}, { owner: kid.id, type: 'usesave', amount: g.price, cat: '', memo: g.title + ' 샀어요', date: todayKey(), at: Date.now() }).catch(fail);
    chime(kid, true); toast('축하해요! 목표를 이뤘어요'); render();
  };

  // ---------- 부모: 대시보드 생활 블록 ----------
  function lifeBoardHTML(kid) {
    const list = choresToday(kid.id), items = choreItems(kid.id);
    const prac = vals((dayLog(kid.id).skills || {}).items);
    const ready = skillsOf(kid.id).filter(s => s.level !== 'alone' && skillStat(kid.id, s.id).alone >= 3);
    const WHO = { together: '함께', watch: '지켜봄', alone: '혼자' };
    return '<div class="block"><h3>생활 <small>집안일 ' + list.filter(c => items[c.id]).length + ' / ' + list.length + '</small></h3>' +
      (list.length ? '<ul class="chips">' + list.map(c => '<li class="' + (items[c.id] ? '' : 'miss') + '">' + esc(c.emoji + ' ' + c.title) + (items[c.id] ? ' ✓' : '') + '</li>').join('') + '</ul>' : '') +
      prac.map(p => { const sk = skillById(kid.id, p.skillId) || {}; return '<p>' + esc((sk.emoji || '') + ' ' + (sk.title || '생활 기술')) + ' 연습 · ' + (WHO[p.with] || '') + '</p>'; }).join('') +
      ready.map(s => '<p class="alert">' + esc(s.title) + ': 혼자 ' + skillStat(kid.id, s.id).alone + '번 해냈어요. "생활" 탭에서 "혼자" 단계로 올려 줄까요?</p>').join('') + '</div>';
  }

  // ---------- 부모: 생활 탭 ----------
  function lifeParentHTML() {
    const c = S.config;
    if (!kidById(ui.skKid)) ui.skKid = c.kids[0].id;
    const kid = kidById(ui.skKid), chores = (c.chores || {})[kid.id] || [], skills = skillsOf(kid.id);
    if (ui.skSel && !skillById(kid.id, ui.skSel)) ui.skSel = null;
    const order = [1, 2, 3, 4, 5, 6, 0];
    const m = moneyOf(kid.id), g = activeGoal(kid.id);
    return '<div class="section"><div class="row">' + segHTML('skkid', ui.skKid, c.kids.map(k => [k.id, k.name])) + '</div></div>' +
      '<div class="section"><div class="shelf-head"><h2>집안일</h2><button class="btn small" data-act="ch-add">집안일 추가</button></div><p class="lead">요일을 고른 날에만 아이 화면에 나와요. 생활 기술과 이어 두면 "방법 보기"로 단계를 안내해요.</p>' +
        '<ul class="steps-edit">' + chores.map((ch, i) => '<li class="plan-edit" data-ci="' + i + '">' +
          '<label class="field" style="width:64px"><span>그림</span><input type="text" id="ch-' + kid.id + '-' + i + '-e" data-ch="emoji" maxlength="8" value="' + esc(ch.emoji || '') + '"></label>' +
          '<label class="field grow"><span>할 일</span><input type="text" id="ch-' + kid.id + '-' + i + '-t" data-ch="title" value="' + esc(ch.title) + '"></label>' +
          '<label class="field"><span>생활 기술과 잇기</span><select id="ch-' + kid.id + '-' + i + '-s" data-ch="skillId"><option value="">없음</option>' + skills.map(s => '<option value="' + esc(s.id) + '"' + (s.id === ch.skillId ? ' selected' : '') + '>' + esc(s.title) + '</option>').join('') + '</select></label>' +
          '<div class="days">' + order.map(d => '<label class="toggle"><input type="checkbox" id="ch-' + kid.id + '-' + i + '-d' + d + '" data-chday="' + d + '"' + ((ch.days || []).includes(d) ? ' checked' : '') + '>' + WD[d] + '</label>').join('') + '</div>' +
          '<button class="btn small danger" data-act="ch-del" data-i="' + i + '">삭제</button></li>').join('') + '</ul></div>' +
      '<div class="section"><div class="shelf-head"><h2>생활 기술</h2><button class="btn small" data-act="sk-add">기술 추가</button></div>' +
        '<p class="lead">아이가 "혼자 했어요"를 3번 고르면 대시보드에 알려 줘요. 단계는 직접 보고 정해 주세요.</p><ul class="skills">' + skills.map((s, i) => {
          const st = skillStat(kid.id, s.id);
          return '<li class="skill edit' + (ui.skSel === s.id ? ' sel' : '') + '" data-si="' + i + '"><span class="sk-emo" aria-hidden="true">' + esc(s.emoji) + '</span>' +
            '<div class="sk-body"><div class="addrow tight"><label class="field" style="width:60px"><span>그림</span><input type="text" id="sk-' + kid.id + '-' + i + '-e" data-skf="emoji" maxlength="8" value="' + esc(s.emoji) + '"></label>' +
            '<label class="field grow"><span>기술 이름</span><input type="text" id="sk-' + kid.id + '-' + i + '-t" data-skf="title" value="' + esc(s.title) + '"></label>' +
            '<label class="field"><span>영역</span><input type="text" id="sk-' + kid.id + '-' + i + '-a" data-skf="area" value="' + esc(s.area || '') + '" style="width:80px"></label>' +
            '<label class="field"><span>지금 단계</span><select id="sk-' + kid.id + '-' + i + '-l" data-skf="level">' + LEVELS.map(l => '<option value="' + l[0] + '"' + (s.level === l[0] ? ' selected' : '') + '>' + l[1] + '</option>').join('') + '</select></label></div>' +
            '<small class="muted">연습 ' + (st.count || 0) + '번 · 혼자 ' + (st.alone || 0) + '번 · 단계 ' + (s.steps || []).length + '개</small></div>' +
            '<div class="task-act"><button class="btn small" data-act="sk-sel" data-id="' + esc(s.id) + '">' + (ui.skSel === s.id ? '단계 닫기' : '단계 편집') + '</button>' +
            '<button class="btn small danger" data-act="sk-del" data-i="' + i + '">' + (ui.armed === 'sk-' + s.id ? '정말 삭제' : '삭제') + '</button></div></li>';
        }).join('') + '</ul>' +
        (ui.skSel ? '<div class="section inner"><h2>' + esc((skillById(kid.id, ui.skSel) || {}).title) + ' 단계</h2><p class="lead">우리 집 욕실·빨래 바구니 같은 실제 사진을 넣으면 첫째가 더 잘 알아봐요.</p>' + stepRowsHTML((skillById(kid.id, ui.skSel) || {}).steps || [], 'skf-' + kid.id + '-' + ui.skSel + '-', false) + '</div>' : '') + '</div>' +
      '<div class="section"><h2>' + esc(kid.name) + '의 용돈 기입장</h2><div class="money-sum"><div><span class="eyebrow">지갑</span><b>' + won(m.wallet) + '</b></div><div><span class="eyebrow">저금통</span><b>' + won(Math.max(0, m.saved)) + '</b></div></div>' +
        (g ? '<p class="sub-line">목표: ' + esc(g.title) + ' ' + won(g.price) + ' · ' + Math.min(100, Math.round(m.saved / g.price * 100)) + '%</p>' : '<p class="muted">저축 목표가 아직 없어요</p>') +
        (m.list.length ? '<ul class="ledger">' + m.list.slice(0, 10).map(x => '<li class="' + x.type + '"><span class="l-body">' + esc(x.memo || x.cat || '') + '<small>' + esc((x.date || '').slice(5).replace('-', '/')) + '</small></span><span class="l-amt">' + (x.type === 'in' ? '+' : x.type === 'usesave' ? '' : '−') + won(x.amount) + '</span></li>').join('') + '</ul>' : '') + '</div>';
  }
  ACT2.skkid = b => { ui.skKid = b.dataset.v; ui.skSel = null; render(); };
  ACT2['sk-sel'] = b => { ui.skSel = ui.skSel === b.dataset.id ? null : b.dataset.id; render(); };
  ACT2['ch-add'] = () => saveCfg(cfg => { (cfg.chores[ui.skKid] = cfg.chores[ui.skKid] || []).push({ id: 'c' + Date.now().toString(36), emoji: '🏠', title: '새 집안일', days: [1, 2, 3, 4, 5] }); });
  ACT2['ch-del'] = b => saveCfg(cfg => { cfg.chores[ui.skKid].splice(Number(b.dataset.i), 1); });
  ACT2['sk-add'] = () => {
    const id = 'sk' + Date.now().toString(36);
    saveCfg(cfg => { (cfg.skills[ui.skKid] = cfg.skills[ui.skKid] || []).push({ id, emoji: '⭐', title: '새 생활 기술', area: '', level: 'together', steps: [{ id: id + '-1', emoji: '1️⃣', title: '첫 단계', detail: '' }] }); });
    ui.skSel = id; render();
  };
  ACT2['sk-del'] = b => {
    const s = skillsOf(ui.skKid)[Number(b.dataset.i)]; if (!s) return;
    if (ui.armed !== 'sk-' + s.id) { arm('sk-' + s.id); return; }
    ui.armed = null; if (ui.skSel === s.id) ui.skSel = null;
    saveCfg(cfg => { cfg.skills[ui.skKid].splice(Number(b.dataset.i), 1); });
  };
  function CHANGE4(el) {
    if (el.dataset.ch || el.dataset.chday) {
      const i = Number(el.closest('[data-ci]').dataset.ci);
      saveCfg(cfg => {
        const ch = cfg.chores[ui.skKid][i];
        if (el.dataset.chday) { const d = Number(el.dataset.chday), set = new Set(ch.days || []); if (el.checked) set.add(d); else set.delete(d); ch.days = Array.from(set).sort(); }
        else if (el.dataset.ch === 'skillId') { if (el.value) ch.skillId = el.value; else delete ch.skillId; }
        else ch[el.dataset.ch] = el.value.trim() || ch[el.dataset.ch];
      });
      return true;
    }
    if (el.dataset.skf) {
      const i = Number(el.closest('[data-si]').dataset.si);
      saveCfg(cfg => { const s = cfg.skills[ui.skKid][i]; s[el.dataset.skf] = el.value.trim() || s[el.dataset.skf]; });
      return true;
    }
    return CHANGE5(el);
  }

  // =====================================================================
  // 5단계: 가정통신문 사진 등록 · 기기 사용 규칙 · 방학 모드
  // 6단계: 알림(캐릭터) · 다듬기 · 연말 성장 앨범
  // =====================================================================
  // 받침에 따라 이/가 고르기 (우리별이, 둘째가)
  const iGa = w => { const c = String(w).charCodeAt(String(w).length - 1); return w + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? '이' : '가'); };
  const mascot = () => Object.assign({ name: '우리별', emoji: '⭐' }, S.config.mascot || {});
  function daysUntil(key) { const [y, m, d] = key.split('-').map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 864e5); }
  function vacationBannerHTML() {
    const st = vacationState(new Date()), v = S.config.vacation || {};
    if (!st) return '';
    const dday = daysUntil(v.end) + 1;
    return st === 'practice'
      ? '<p class="banner">개학 연습 주간이에요 · 개학 D-' + dday + ' · 평소처럼 등교 준비를 연습해요</p>'
      : '<p class="banner">방학 중이에요 · 개학까지 ' + dday + '일</p>';
  }

  // ---------- 기기 사용 규칙 ----------
  function freeTimeHTML(kid) {
    const dr = S.config.deviceRule || {};
    if (!dr.on) return '';
    const left = questsFor(kid.id).filter(x => !x.done).length, open = !dr.needQuests || left === 0;
    return '<div class="freecard ' + (open ? 'open' : 'locked') + '"><span class="fc-emo" aria-hidden="true">' + (open ? '🎮' : '🔒') + '</span><div><b>자유 시간</b><p>' + esc(dr.text || '') + '</p>' +
      '<small>' + (open ? '자유 시간이에요! 약속한 시간만큼 즐겨요' : '미션 ' + left + '개를 마치면 열려요') + '</small></div></div>';
  }

  // ---------- 알림 (앱이 켜져 있을 때 캐릭터가 알려 줌) ----------
  function dueReminders(kid) {
    const c = S.config, r = c.reminders || {}, out = [], d = new Date(), m = d.getHours() * 60 + d.getMinutes(), l = dayLog(kid.id);
    if (!r.on) return out;
    const add = (key, time, text, go, done) => { if (!time) return; const t = hm(time); if (m >= t && m < t + 120 && !done) out.push({ key, text, go }); };
    if (isSchoolDay(d)) add('morning', c.times.morningStart, '등교 준비할 시간이야!', 'today', (l.morning || {}).completedAt);
    else if (inVacation(d)) add('morning', (c.vacation || {}).wake, '아침 루틴을 시작해 볼까?', 'today', (l.morning || {}).completedAt);
    if (isSchoolDay(tomorrowOf(d))) add('evening', c.times.eveningStart, eveningLabel() + '할 시간이야!', 'today', (l.evening || {}).completedAt);
    const st = studyOf(kid.id);
    add('study', r.study, '공부할 시간이야! 공부 카드를 열어 봐', 'study', vals(st.sessions).length > 0 || st.active);
    add('copy', r.copy, '필사할 시간이야! ' + copyGoalText(kid), 'copy', vals(((l.copy || {}).items)).length > 0);
    return out;
  }
  function upcomingText() {
    const r = S.config.reminders || {}, t = [];
    if (r.study) t.push(fmtClock(r.study) + ' 공부');
    if (r.copy) t.push(fmtClock(r.copy) + ' 필사');
    return t.join(', ');
  }
  function reminderBannerHTML(kid) {
    const r = S.config.reminders || {}, ms = mascot();
    if (!r.on) return '';
    const due = dueReminders(kid);
    const perm = ('Notification' in window) && Notification.permission === 'default'
      ? ' <button class="linkbtn" data-act="notify-perm">알림 허용하기</button>' : '';
    if (!due.length) return '<p class="mascot-line">' + esc(ms.emoji + ' ' + iGa(ms.name)) + ' 알려 줄게요: ' + upcomingText() + perm + '</p>';
    const x = due[0];
    return '<div class="mascot"><span class="m-emo" aria-hidden="true">' + esc(ms.emoji) + '</span><div class="m-body"><b>' + esc(ms.name) + '</b><p>' + esc(x.text) + '</p></div>' +
      '<button class="btn primary" data-act="rem-go" data-v="' + x.go + '">지금 하기</button></div>';
  }
  ACT2['rem-go'] = b => {
    const v = b.dataset.v;
    if (v === 'copy') { ui.kidTab = 'books'; ui.bookView = 'copy'; ui.copy = null; }
    else if (v === 'study') ui.kidTab = 'study';
    else ui.kidTab = 'today';
    render(); window.scrollTo(0, 0);
  };
  ACT2['notify-perm'] = () => { try { Notification.requestPermission().then(() => render()); } catch (e) { toast('이 기기에서는 알림을 켤 수 없어요'); } };
  function systemNotify(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'ugh-reminder' })).catch(() => {});
      else new Notification(title, { body, icon: 'icons/icon-192.png' });
    } catch (e) { /* 알림을 못 띄워도 화면 안내는 남는다 */ }
  }
  function announceReminders() {
    if (!S.config || S.status !== 'ready' || ui.device === 'parent') return;
    const kid = kidById(ui.device); if (!kid) return;
    const due = dueReminders(kid); if (!due.length) return;
    let seen = {}; try { seen = JSON.parse(localStorage.getItem('ugh-rem') || '{}'); } catch (e) { /* 없음 */ }
    if (seen.date !== todayKey()) seen = { date: todayKey(), keys: [] };
    const fresh = due.filter(r => !seen.keys.includes(r.key)); if (!fresh.length) return;
    fresh.forEach(r => seen.keys.push(r.key));
    try { localStorage.setItem('ugh-rem', JSON.stringify(seen)); } catch (e) { /* 무시 */ }
    const ms = mascot();
    chime(kid, true);
    if (kid.voice && ui.audioOk) speak(iGa(ms.name) + ' 말해요. ' + fresh[0].text);
    systemNotify(ms.emoji + ' ' + ms.name, fresh[0].text);
    render();
  }
  setInterval(announceReminders, 30000);
  S.onChange(() => setTimeout(announceReminders, 500));

  // ---------- 부모: 시간 탭 아래 (방학 · 기기 규칙 · 알림) ----------
  function timesMoreHTML() {
    const v = S.config.vacation || {}, dr = S.config.deviceRule || {}, r = S.config.reminders || {}, ms = mascot();
    return '<div class="section"><h2>방학 모드</h2><p class="lead">방학 동안에는 등교 준비 대신 "방학 아침" 루틴이 일어날 시간에 열리고, 내일 준비는 쉬어요. 개학 전 마지막 7일은 개학 연습 주간이라 평소 등교 준비를 연습해요. 방학 아침 루틴은 "루틴" 탭에서 고쳐요.</p>' +
      '<label class="toggle"><input type="checkbox" id="vac-on" data-vac="on"' + (v.on ? ' checked' : '') + '>방학 모드 켜기</label>' +
      '<div class="row"><label class="field" style="flex:1 1 150px"><span>방학 시작</span><input type="date" id="vac-start" data-vac="start" value="' + esc(v.start || '') + '"></label>' +
      '<label class="field" style="flex:1 1 150px"><span>방학 끝 (개학 전날)</span><input type="date" id="vac-end" data-vac="end" value="' + esc(v.end || '') + '"></label>' +
      '<label class="field" style="flex:1 1 120px"><span>일어날 시간</span><input type="time" id="vac-wake" data-vac="wake" value="' + esc(v.wake || '08:00') + '"></label></div></div>' +
      '<div class="section"><h2>기기 사용 규칙</h2><p class="lead">아이 "오늘" 화면에 자유 시간 카드로 보여요. 웹앱은 다른 앱을 실제로 막을 수 없어서, 휴대폰의 자녀 보호 기능과 함께 써 주세요.</p>' +
      '<label class="toggle"><input type="checkbox" id="dr-on" data-dr="on"' + (dr.on ? ' checked' : '') + '>규칙 보여 주기</label>' +
      '<label class="field"><span>가족 규칙</span><input type="text" id="dr-text" data-dr="text" maxlength="60" value="' + esc(dr.text || '') + '"></label>' +
      '<label class="toggle"><input type="checkbox" id="dr-need" data-dr="needQuests"' + (dr.needQuests ? ' checked' : '') + '>오늘의 미션을 다 해야 자유 시간 카드가 열려요</label></div>' +
      '<div class="section"><h2>알림과 캐릭터</h2><p class="lead">정한 시간이 되면 캐릭터가 아이 화면에서 알려 주고, 첫째에게는 소리로 읽어 줘요. 앱이 열려 있거나 홈 화면 앱이 켜져 있을 때 동작해요. 이미 한 일은 알리지 않아요.</p>' +
      '<label class="toggle"><input type="checkbox" id="rem-on" data-rem="on"' + (r.on ? ' checked' : '') + '>알림 켜기 (등교 준비·내일 준비 시간에도 알려요)</label>' +
      '<div class="row"><label class="field" style="flex:1 1 140px"><span>공부 알림</span><input type="time" id="rem-study" data-rem="study" value="' + esc(r.study || '') + '"></label>' +
      '<label class="field" style="flex:1 1 140px"><span>필사 알림</span><input type="time" id="rem-copy" data-rem="copy" value="' + esc(r.copy || '') + '"></label>' +
      '<label class="field" style="flex:1 1 140px"><span>캐릭터 이름</span><input type="text" id="ms-name" data-masc="name" maxlength="10" value="' + esc(ms.name) + '"></label>' +
      '<label class="field" style="flex:0 1 90px"><span>그림</span><input type="text" id="ms-emoji" data-masc="emoji" maxlength="8" value="' + esc(ms.emoji) + '"></label></div></div>';
  }

  // ---------- 부모: 가정통신문 ----------
  const AI_KEY = 'ugh-ai-key';
  function aiKey() { try { return localStorage.getItem(AI_KEY) || ''; } catch (e) { return ''; } }
  function noticeHTML() {
    const n = ui.notice, c = S.config, key = aiKey(), today = todayKey();
    const kidSel = (id, val, attr) => '<select id="' + id + '" ' + attr + '><option value="all"' + (val === 'all' ? ' selected' : '') + '>모두</option>' + c.kids.map(k => '<option value="' + k.id + '"' + (val === k.id ? ' selected' : '') + '>' + esc(k.name) + '</option>').join('') + '</select>';
    let photo = '<div class="section"><h2>사진으로 등록</h2><p class="lead">알림장이나 가정통신문을 찍으면 날짜와 준비물을 찾아 줘요. 확인한 뒤 넣으면 그날 등교 준비(전날 저녁 가방 싸기 포함)에 자동으로 나와요.</p>' +
      '<div class="row"><span class="btn primary filebtn">사진 찍기<input type="file" accept="image/*" capture="environment" data-act="photo2" data-kind="notice" aria-label="가정통신문 찍기"></span>' +
      '<span class="btn filebtn">앨범에서 고르기<input type="file" accept="image/*" data-act="photo2" data-kind="notice" aria-label="가정통신문 고르기"></span>' +
      (S.mode === 'demo' ? '<button class="btn" data-act="notice-sample">예시 결과로 해 보기</button>' : '') + '</div>';
    if (n && n.img) photo += '<div class="notice-img"><img src="' + n.img + '" alt="가정통신문 사진"></div>';
    if (n && n.busy) photo += '<p class="muted">사진을 읽는 중이에요…</p>';
    if (n && n.err) photo += '<p class="err">' + esc(n.err) + '</p>';
    if (n && n.img && !n.rows && !n.busy) photo += key ? '<div><button class="btn" data-act="notice-analyze">다시 읽기</button></div>' : '<p class="muted">아래 "AI 설정"에 키를 넣으면 사진을 자동으로 읽어요. 지금은 아래 "직접 넣기"로 적어 주세요.</p>';
    if (n && n.rows) {
      photo += n.rows.length ? '<h3 class="sub-h">찾은 준비물 · 확인하고 고쳐 주세요</h3><ul class="steps-edit">' + n.rows.map((r, i) => '<li class="plan-edit" data-ni="' + i + '">' +
        '<label class="toggle"><input type="checkbox" id="nt-' + i + '-use" data-nt="use"' + (r.use ? ' checked' : '') + '>넣기</label>' +
        '<label class="field"><span>날짜</span><input type="date" id="nt-' + i + '-date" data-nt="date" value="' + esc(r.date || '') + '"></label>' +
        '<label class="field"><span>누구</span>' + kidSel('nt-' + i + '-kid', r.kid, 'data-nt="kid"') + '</label>' +
        '<label class="field grow"><span>준비물 (쉼표로 구분)</span><input type="text" id="nt-' + i + '-items" data-nt="items" value="' + esc(r.items || '') + '"></label>' +
        (r.note ? '<small class="muted" style="width:100%">' + esc(r.note) + '</small>' : '') + '</li>').join('') + '</ul><div class="row"><button class="btn primary" data-act="notice-apply">준비물에 넣기</button><button class="btn" data-act="notice-clear">취소</button></div>'
        : '<p class="muted">사진에서 준비물을 찾지 못했어요. 아래에서 직접 넣어 주세요.</p>';
    }
    photo += '</div>';
    const manual = '<div class="section"><h2>직접 넣기</h2><div class="addrow"><label class="field"><span>날짜</span><input type="date" id="nm-date" min="' + today + '"></label>' +
      '<label class="field"><span>누구</span>' + kidSel('nm-kid', 'all', '') + '</label>' +
      '<label class="field grow"><span>준비물 (쉼표로 구분)</span><input type="text" id="nm-items" placeholder="예: 물감, 붓"></label><button class="btn" data-act="notice-add">넣기</button></div></div>';
    const ds = c.dateSupplies || {}, up = [];
    Object.keys(ds).forEach(k => Object.keys(ds[k] || {}).forEach(d => { if (d >= today && (ds[k][d] || []).length) up.push({ k, d, items: ds[k][d] }); }));
    up.sort((a, b) => a.d.localeCompare(b.d));
    const list = '<div class="section"><h2>다가오는 날짜별 준비물 <small class="muted">' + up.length + '건</small></h2>' + (up.length ? '<ul class="devices">' + up.map(x => {
      const [y, m, d] = x.d.split('-').map(Number), wd = WD[new Date(y, m - 1, d).getDay()];
      return '<li><span><b>' + m + '/' + d + '(' + wd + ')</b> ' + esc(nameOf(x.k)) + ' · ' + esc(x.items.join(', ')) + '</span><button class="btn small danger" data-act="ds-del" data-kid="' + x.k + '" data-date="' + x.d + '">지우기</button></li>';
    }).join('') + '</ul>' : '<p class="muted">아직 없어요</p>') + '</div>';
    const ai = '<div class="section"><h2>AI 설정</h2><p class="lead">사진 읽기는 Google Gemini API를 써요. Google AI Studio에서 받은 API 키를 넣으면 <b>이 기기 브라우저에만</b> 저장되고, 가족 공유 데이터나 앱 코드에는 들어가지 않아요. 사진은 분석할 때 Google로 보내지고 앱에는 저장하지 않아요.</p>' +
      '<div class="addrow"><label class="field grow"><span>API 키 ' + (key ? '(저장됨)' : '') + '</span><input type="password" id="ai-key" data-aikey="1" autocomplete="off" placeholder="' + (key ? '바꾸려면 새 키를 넣으세요' : 'AIza로 시작하는 키') + '"></label>' +
      (key ? '<button class="btn" data-act="ai-key-del">키 지우기</button>' : '') + '</div>' +
      '<label class="field" style="max-width:320px"><span>모델</span><input type="text" id="ai-model" data-ai="model" value="' + esc((c.ai || {}).model || 'gemini-3.1-flash-lite') + '"></label>' +
      '<p class="lead">모델 이름은 Google이 바꿀 수 있어요. 읽기가 갑자기 안 되면 Google AI Studio에서 지금 쓰는 모델 이름을 확인해 바꿔 주세요.</p></div>';
    return '<div class="board-head"><div><h1>가정통신문</h1><p>날짜가 정해진 준비물을 아이 등교 준비에 넣어요</p></div></div>' + photo + manual + list + ai;
  }
  async function analyzeNotice() {
    const n = ui.notice, key = aiKey();
    if (!n || !n.img || !key) return;
    n.busy = true; n.err = ''; render();
    try {
      const model = ((S.config.ai || {}).model || 'gemini-3.1-flash-lite').trim();
      const d = new Date();
      const prompt = '이 사진은 한국 학교의 가정통신문이나 알림장이다. 오늘은 ' + todayKey() + '(' + WD[d.getDay()] + '요일)이다. ' +
        '학생이 챙겨 가야 할 준비물과 그 날짜를 모두 찾아라. 날짜가 "월/일"이나 요일로만 적혀 있으면 오늘 이후 가장 가까운 날짜로 바꿔라. ' +
        '준비물이 아닌 일정만 있는 항목은 빼라. 반드시 JSON 배열로만 답하라: [{"date":"YYYY-MM-DD","items":["준비물"],"note":"어떤 일 때문인지 짧게"}]. 없으면 [].';
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: n.img.split(',')[1] } }, { text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
        })
      });
      if (!res.ok) throw new Error(res.status === 400 || res.status === 403 ? 'API 키를 확인해 주세요 (' + res.status + ')' : res.status === 404 ? '모델 이름을 찾을 수 없어요. AI 설정에서 모델 이름을 확인해 주세요' : '사진을 읽지 못했어요 (' + res.status + ')');
      const j = await res.json();
      const text = (((j.candidates || [])[0] || {}).content || {}).parts ? j.candidates[0].content.parts.map(p => p.text || '').join('') : '[]';
      let arr = [];
      try { arr = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch (e) { throw new Error('읽은 결과를 이해하지 못했어요. 다시 읽기를 눌러 주세요'); }
      if (!Array.isArray(arr)) arr = [];
      n.rows = arr.filter(x => x && (x.items || []).length).map(x => ({ use: true, date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : '', kid: 'all', items: (x.items || []).join(', '), note: x.note || '' }));
    } catch (e) { n.err = e.message || '사진을 읽지 못했어요'; console.error(e); }
    n.busy = false; render();
  }
  ACT2['notice-analyze'] = () => analyzeNotice();
  ACT2['notice-sample'] = () => {
    const d1 = new Date(); d1.setDate(d1.getDate() + ((3 - d1.getDay() + 7) % 7 || 7));
    const d2 = new Date(); d2.setDate(d2.getDate() + ((5 - d2.getDay() + 7) % 7 || 7));
    ui.notice = Object.assign(ui.notice || {}, { busy: false, err: '', rows: [
      { use: true, date: S.dateKey(d1), kid: 'k2', items: '물감, 붓, 팔레트', note: '미술 시간 (예시)' },
      { use: true, date: S.dateKey(d2), kid: 'all', items: '체험학습 동의서', note: '담임 선생님께 제출 (예시)' }
    ] });
    render();
  };
  ACT2['notice-clear'] = () => { ui.notice = null; render(); };
  function addDateSupplies(cfg, kid, date, items) {
    const kids = kid === 'all' ? cfg.kids.map(k => k.id) : [kid];
    cfg.dateSupplies = cfg.dateSupplies || {};
    kids.forEach(k => {
      const m = cfg.dateSupplies[k] = cfg.dateSupplies[k] || {};
      m[date] = Array.from(new Set((m[date] || []).concat(items)));
    });
    // 지난 날짜는 정리
    const today = todayKey();
    Object.keys(cfg.dateSupplies).forEach(k => Object.keys(cfg.dateSupplies[k]).forEach(d => { if (d < today) delete cfg.dateSupplies[k][d]; }));
  }
  ACT2['notice-apply'] = () => {
    const rows = ((ui.notice || {}).rows || []).filter(r => r.use && r.date && r.items.trim());
    if (!rows.length) { toast('넣을 항목을 확인해 주세요 (날짜와 준비물)'); return; }
    saveCfg(cfg => rows.forEach(r => addDateSupplies(cfg, r.kid, r.date, r.items.split(',').map(x => x.trim()).filter(Boolean))));
    ui.notice = null; toast(rows.length + '건을 준비물에 넣었어요');
  };
  ACT2['notice-add'] = () => {
    const date = (document.getElementById('nm-date') || {}).value, kid = (document.getElementById('nm-kid') || {}).value || 'all';
    const items = ((document.getElementById('nm-items') || {}).value || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!date || !items.length) { toast('날짜와 준비물을 적어 주세요'); return; }
    saveCfg(cfg => addDateSupplies(cfg, kid, date, items));
    toast('준비물에 넣었어요');
  };
  ACT2['ds-del'] = b => saveCfg(cfg => { delete ((cfg.dateSupplies || {})[b.dataset.kid] || {})[b.dataset.date]; });
  ACT2['ai-key-del'] = () => { try { localStorage.removeItem(AI_KEY); } catch (e) { /* 무시 */ } toast('이 기기에서 키를 지웠어요'); render(); };

  function CHANGE5(el) {
    const set = (path, v) => saveCfg(cfg => { const [a, b] = path; cfg[a] = cfg[a] || {}; cfg[a][b] = v; });
    if (el.dataset.vac) { set(['vacation', el.dataset.vac], el.type === 'checkbox' ? el.checked : el.value); return true; }
    if (el.dataset.dr) { set(['deviceRule', el.dataset.dr], el.type === 'checkbox' ? el.checked : el.value.trim()); return true; }
    if (el.dataset.rem) { set(['reminders', el.dataset.rem], el.type === 'checkbox' ? el.checked : el.value); return true; }
    if (el.dataset.masc) { if (el.value.trim()) set(['mascot', el.dataset.masc], el.value.trim()); return true; }
    if (el.dataset.ai) { if (el.value.trim()) set(['ai', el.dataset.ai], el.value.trim()); return true; }
    if (el.dataset.aikey) {
      const v = el.value.trim();
      if (v) { try { localStorage.setItem(AI_KEY, v); toast('이 기기에 키를 저장했어요'); } catch (e) { toast('이 브라우저에는 저장할 수 없어요'); } }
      render(); return true;
    }
    if (el.dataset.nt) {
      const r = ui.notice.rows[Number(el.closest('[data-ni]').dataset.ni)];
      r[el.dataset.nt] = el.type === 'checkbox' ? el.checked : el.value;
      return true;
    }
    return false;
  }

  // ---------- 연말 성장 앨범 ----------
  ACT2.album = b => { ui.album = { who: b.dataset.v, data: null }; render(); window.scrollTo(0, 0); loadAlbum(); };
  ACT2['album-close'] = () => { ui.album = null; render(); };
  ACT2['album-print'] = () => {
    try { window.print(); } catch (e) { /* 무시 */ }
    toast('인쇄 창에서 "PDF로 저장"을 고르세요. 체험판 화면에서는 인쇄 창이 열리지 않을 수 있어요');
  };
  async function loadAlbum() {
    const a = ui.album, who = a.who, y = new Date().getFullYear(), from = y + '-01-01';
    try {
      const [logs, cards] = await Promise.all([S.fetchSince('logs', from), S.fetchSince('cheercards', from)]);
      const months = [];
      for (let m = 1; m <= new Date().getMonth() + 1; m++) months.push(y + '-' + String(m).padStart(2, '0'));
      const thumbs = kidById(who) ? (await Promise.all(months.map(mk => S.listThumbs(who, mk).catch(() => [])))) : [];
      if (ui.album !== a) return;
      a.data = { logs: logs.filter(l => l.kidId === who), cards: cards.filter(c => c.to === who), thumbs, months, year: y, from };
      render();
    } catch (e) { toast('앨범을 만들지 못했어요', e); }
  }
  function albumHTML() {
    const a = ui.album, who = a.who, isKid = !!kidById(who);
    const tools = '<div class="album-tools no-print"><button class="btn" data-act="album-close">닫기</button><button class="btn primary" data-act="album-print">PDF로 저장</button></div>';
    if (!a.data) return tools + '<div class="album"><p class="muted">한 해 기록을 모으는 중이에요…</p></div>';
    const { logs, cards, thumbs, months, year, from } = a.data;
    const yearTs = new Date(year, 0, 1).getTime();
    const sum = f => logs.reduce((acc, l) => acc + f(l), 0);
    let nums;
    if (isKid) {
      nums = [
        ['🎒', '등교 준비', sum(l => (l.morning || {}).completedAt ? 1 : 0) + '일'],
        ['✏️', '공부', fmtMin(sum(l => vals((l.study || {}).sessions).reduce((x, s) => x + (s.mins || 0), 0)))],
        ['📚', '독서', sum(l => vals((l.reading || {}).items).reduce((x, r) => x + (r.pages || 0), 0)) + '쪽'],
        ['✍️', '필사', sum(l => vals((l.copy || {}).items).length ? 1 : 0) + '일'],
        ['🏠', '집안일', sum(l => (l.chores || {}).awarded ? 1 : 0) + '일'],
        ['🌱', '생활 기술 연습', sum(l => vals((l.skills || {}).items).length) + '번'],
        ['🌟', '받은 별', ((S.stats[who] || {}).stickers || 0) + '개'],
        ['💌', '받은 칭찬 카드', cards.length + '장']
      ];
    } else {
      nums = [
        ['🏃', '운동', fmtMin(sum(l => vals((l.exercise || {}).items).reduce((x, e) => x + (e.mins || 0), 0)))],
        ['📚', '독서', sum(l => vals((l.reading || {}).items).reduce((x, r) => x + (r.pages || 0), 0)) + '쪽'],
        ['🔬', '연구 활동', fmtMin(sum(l => vals((l.research || {}).items).reduce((x, e) => x + (e.mins || 0), 0)))],
        ['💌', '받은 칭찬 카드', cards.length + '장']
      ];
    }
    const monthly = months.map(mk => logs.filter(l => (l.date || '').startsWith(mk)).reduce((x, l) => x + (isKid
      ? vals((l.study || {}).sessions).reduce((y2, s) => y2 + (s.mins || 0), 0)
      : vals((l.exercise || {}).items).reduce((y2, e) => y2 + (e.mins || 0), 0)), 0));
    const books = myBooks(who).filter(b => b.status === 'done' && (b.finishedAt || 0) >= yearTs);
    const qs = Object.keys(S.quotes).map(id => S.quotes[id]).filter(q => q.owner === who && (q.date || '') >= from).sort((p, q) => (p.date || '').localeCompare(q.date || ''));
    const skills = isKid ? skillsOf(who).filter(s => s.level === 'alone') : [];
    const goals = Object.keys(S.goals).map(id => S.goals[id]).filter(g => g.owner === who && g.status === 'done' && (g.doneAt || 0) >= yearTs);
    const sec = (title, body) => body ? '<section class="al-sec"><h2>' + title + '</h2>' + body + '</section>' : '';
    const photoSec = thumbs.map((list, i) => list.length ? '<div class="al-month"><h3>' + Number(months[i].slice(5)) + '월 <small>' + list.length + '장</small></h3><div class="al-thumbs">' + list.slice(0, 12).map(t => mediaImg(t.id, months[i] + ' 필사', '')).join('') + '</div></div>' : '').join('');
    return tools + '<article class="album" id="album">' +
      '<header class="al-cover"><p class="eyebrow">우리집 성장 앨범</p><h1>' + esc(nameOf(who)) + '의 ' + year + '년</h1><p>' + from.replace(/-/g, '.') + ' ~ ' + todayKey().replace(/-/g, '.') + '</p></header>' +
      '<section class="al-sec"><h2>숫자로 본 한 해</h2><div class="al-nums">' + nums.map(([e, n, v]) => '<div class="al-num"><span aria-hidden="true">' + e + '</span><b>' + v + '</b><small>' + n + '</small></div>').join('') + '</div></section>' +
      sec(isKid ? '달마다 공부한 시간' : '달마다 운동한 시간', monthChartHTML(months, monthly)) +
      sec('다 읽은 책 <small>' + books.length + '권</small>', books.length ? '<ul class="al-list">' + books.map(b => '<li>📕 ' + esc(b.title) + (b.author ? ' <small>' + esc(b.author) + '</small>' : '') + '</li>').join('') + '</ul>' : '') +
      sec('나의 문장 <small>' + qs.length + '개</small>', qs.length ? '<ul class="quotes">' + qs.slice(-12).map(q => '<li class="quote"><p>' + esc(q.text) + '</p><span class="muted">「' + esc(bookTitle(q.bookId)) + '」 · ' + esc((q.date || '').slice(5).replace('-', '/')) + '</span></li>').join('') + '</ul>' : '') +
      sec('혼자 할 수 있게 된 일', skills.length ? '<div class="cando">' + skills.map(s => '<span class="cando-chip"><span aria-hidden="true">' + esc(s.emoji) + '</span>' + esc(s.title) + '</span>').join('') + '</div>' : '') +
      sec('이룬 저축 목표', goals.length ? '<ul class="al-list">' + goals.map(g => '<li>🎯 ' + esc(g.title) + ' <small>' + won(g.price) + '</small></li>').join('') + '</ul>' : '') +
      sec('달마다 모은 필사', photoSec) +
      sec('받은 칭찬 카드', cards.length ? '<ul class="pcards">' + cards.sort((p, q) => (q.at || 0) - (p.at || 0)).slice(0, 12).map(c => '<li><span class="ch-emo" aria-hidden="true">' + esc(c.emoji || '❤️') + '</span><div class="ch-body"><p>' + esc(c.text) + '</p><small>' + esc(nameOf(c.from)) + ' · ' + esc((c.date || '').slice(5).replace('-', '/')) + '</small></div></li>').join('') + '</ul>' : '') +
      '<footer class="al-foot">' + year + '년, 하루하루 쌓은 기록이에요.</footer></article>';
  }
  function monthChartHTML(months, values) {
    if (!values.some(v => v)) return '';
    const W = 420, H = 200, top = 28, base = 160, n = months.length, slot = W / n, bw = Math.min(28, slot * 0.62), max = Math.max(...values, 60);
    const bars = values.map((v, i) => {
      const h = Math.round(v / max * (base - top)), x = Math.round(i * slot + (slot - bw) / 2), r = Math.min(4, h);
      const path = h ? 'M' + x + ' ' + base + 'V' + (base - h + r) + 'Q' + x + ' ' + (base - h) + ' ' + (x + r) + ' ' + (base - h) + 'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + (base - h) + ' ' + (x + bw) + ' ' + (base - h + r) + 'V' + base + 'Z' : '';
      return '<g class="bar"><title>' + Number(months[i].slice(5)) + '월 ' + fmtMin(v) + '</title>' + (path ? '<path d="' + path + '"/>' : '') +
        (v ? '<text class="val" x="' + (x + bw / 2) + '" y="' + (base - h - 8) + '" text-anchor="middle">' + (v < 60 ? '<1' : v < 600 ? (v / 60).toFixed(1) : Math.round(v / 60)) + '</text>' : '') +
        '<text class="lab" x="' + (x + bw / 2) + '" y="' + (base + 24) + '" text-anchor="middle">' + Number(months[i].slice(5)) + '월</text></g>';
    }).join('');
    return '<figure class="weekchart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="달마다 시간(분): ' + months.map((m, i) => Number(m.slice(5)) + '월 ' + values[i]).join(', ') + '"><line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" class="axis"/>' + bars + '</svg><figcaption>막대 위 숫자는 시간</figcaption></figure>';
  }

  // ---------- 설정 저장 ----------
  function saveCfg(mutate) {
    const cfg = clone(S.config);
    mutate(cfg);
    const r = S.saveConfig(cfg);
    if (r && r.catch) r.catch(fail);
  }
  function stepList(cfg) {
    if (ui.stepCtx === 'skill') {
      const sk = ((cfg.skills || {})[ui.skKid] || []).find(x => x.id === ui.skSel);
      if (!sk) return [];
      return sk.steps = sk.steps || [];
    }
    cfg.routines[ui.editKid] = cfg.routines[ui.editKid] || { morning: [], evening: [] };
    return cfg.routines[ui.editKid][ui.editRoutine] = cfg.routines[ui.editKid][ui.editRoutine] || [];
  }
  // ---------- 사진 자동 줄이기 ----------
  // 찍은 사진이든 앨범 사진이든 저장 전에 긴 변을 줄이고, 목표 용량 아래가 될 때까지 화질을 낮춘다.
  // card: 루틴 카드 사진 (2단계 필사 사진은 글씨가 보여야 해서 더 크게 잡을 예정)
  const PHOTO = {
    card: { max: 720, targetKB: 80 },     // 루틴 카드 사진
    cover: { max: 400, targetKB: 40 },    // 책 표지
    copy: { max: 1600, targetKB: 250 },   // 필사 공책: 글씨가 읽히도록 크게
    thumb: { max: 320, targetKB: 18 },    // 필사 미리보기 (갤러리·대시보드)
    notice: { max: 1600, targetKB: 350 }  // 가정통신문 (AI에게 보낼 때만 쓰고 저장하지 않음)
  };
  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadImageEl(file));
    }
    return loadImageEl(file);
  }
  function loadImageEl(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이 사진 형식은 읽지 못했어요. JPG나 PNG로 다시 골라 주세요.')); };
      img.src = url;
    });
  }
  async function compressPhoto(file, opt) {
    const img = await loadImage(file);
    const limit = opt.targetKB * 1024 * 4 / 3; // base64로 저장되면 약 1.33배가 된다
    let sc = Math.min(1, opt.max / Math.max(img.width, img.height)), url = '';
    for (let pass = 0; pass < 4; pass++) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // 투명 PNG도 흰 바탕으로
      ctx.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.82, 0.72, 0.62, 0.52]) {
        url = c.toDataURL('image/jpeg', q);
        if (url.length <= limit) return url;
      }
      sc *= 0.8; // 그래도 크면 크기를 한 번 더 줄인다
    }
    return url;
  }
  const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';
  function arm(id) {
    ui.armed = id; render();
    setTimeout(() => { if (ui.armed === id) { ui.armed = null; render(); } }, 3500);
  }

  // ---------- 누르기 ----------
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || b.tagName === 'INPUT') return;
    const act = b.dataset.act, v = b.dataset.v;
    const kid = ui.device !== 'parent' ? kidById(ui.device) : null;
    const mode = currentMode();
    ui.audioOk = true;

    switch (act) {
      case 'device': ui.device = v; saveUi(); render(); break;
      case 'preview': ui.preview = v; saveUi(); render(); break;
      case 'open': ui.preview = v; ui.previewFrom = autoMode(new Date()); saveUi(); render(); break;
      case 'ptab': ui.parentTab = v; ui.armed = null; saveUi(); render(); break;
      case 'ekid': ui.editKid = v; saveUi(); render(); break;
      case 'eroutine': ui.editRoutine = v; saveUi(); render(); break;
      case 'ttkid': ui.ttKid = v; saveUi(); render(); break;

      // 카드 (첫째)
      case 'done': case 'next': case 'prev': case 'say': case 'item': {
        const steps = routineSteps(kid.id, mode), key = kid.id + mode;
        const idx = ui.cardIdx[key] || 0, s = steps[idx];
        if (act === 'say') { if (!speak(s.title + '. ' + (s.detail || ''))) toast('이 기기에서는 소리 읽기를 쓸 수 없어요'); break; }
        if (act === 'prev') { ui.cardIdx[key] = Math.max(0, idx - 1); render(); break; }
        if (act === 'item') {
          const t = b.dataset.text, on = b.getAttribute('aria-pressed') !== 'true';
          if (on) chime(kid, false);
          setItem(kid.id, mode, s, t, on, false); break;
        }
        if (act === 'done') setStep(kid.id, mode, s, true, false);
        const rl = rlog(kid.id, mode);
        let n = steps.findIndex((x, i) => i > idx && !rl.steps[x.id]);
        if (n < 0) n = steps.findIndex(x => !rl.steps[x.id]);
        ui.cardIdx[key] = n < 0 ? Math.min(idx + 1, steps.length - 1) : n;
        render();
        const card = document.getElementById('card'); if (card) card.classList.add('bump');
        break;
      }
      // 체크리스트 (둘째)
      case 'tick': {
        const s = routineSteps(kid.id, mode).find(x => x.id === b.dataset.step);
        setStep(kid.id, mode, s, !rlog(kid.id, mode).steps[s.id], true); break;
      }
      case 'mini': {
        const s = routineSteps(kid.id, mode).find(x => x.id === b.dataset.step);
        setItem(kid.id, mode, s, b.dataset.text, b.getAttribute('aria-pressed') !== 'true', true); break;
      }
      case 'review': ui.review[kid.id + mode] = true; ui.cardIdx[kid.id + mode] = 0; render(); break;
      case 'unreview': ui.review[kid.id + mode] = false; render(); break;

      // 루틴 편집
      case 'add-step': saveCfg(cfg => { const L = stepList(cfg); L.push({ id: 's' + Date.now().toString(36), emoji: '⭐', title: '새 할 일', detail: '' }); }); break;
      case 'up': case 'down': {
        const sid = b.closest('[data-step]').dataset.step;
        saveCfg(cfg => { const L = stepList(cfg), i = L.findIndex(x => x.id === sid), j = act === 'up' ? i - 1 : i + 1; if (j >= 0 && j < L.length) { const t = L[i]; L[i] = L[j]; L[j] = t; } });
        break;
      }
      case 'del-step': {
        const sid = b.closest('[data-step]').dataset.step;
        if (ui.armed !== sid) { arm(sid); break; }
        ui.armed = null;
        const photo = (stepList(clone(S.config)).find(x => x.id === sid) || {}).photo;
        saveCfg(cfg => { const L = stepList(cfg); L.splice(L.findIndex(x => x.id === sid), 1); });
        if (photo) S.deletePhoto(photo);
        break;
      }
      case 'unphoto': {
        const sid = b.closest('[data-step]').dataset.step;
        const photo = (stepList(clone(S.config)).find(x => x.id === sid) || {}).photo;
        saveCfg(cfg => { const st = stepList(cfg).find(x => x.id === sid); delete st.photo; });
        if (photo) { const r = S.deletePhoto(photo); if (r && r.catch) r.catch(fail); }
        break;
      }
      case 'testvoice': if (b.dataset.kid) { const pd = ui.device; ui.device = b.dataset.kid; const ok = speak('안녕! 오늘도 하나씩 해 보자.'); ui.device = pd; if (!ok) toast('이 기기에서는 소리 읽기를 쓸 수 없어요'); break; } if (!speak('안녕! 오늘도 하나씩 해 보자.')) toast('이 기기에서는 소리 읽기를 쓸 수 없어요'); break;
      case 'reset':
        if (ui.armed !== 'reset') { arm('reset'); break; }
        ui.armed = null; ui.cardIdx = {}; ui.review = {}; S.resetDemo(); toast('체험 데이터를 처음으로 되돌렸어요'); break;

      // 가족 연결
      case 'invite':
        try { ui.invite = { kidId: v, code: await S.createInvite(v) }; render(); }
        catch (err) { toast('초대 코드를 만들지 못했어요', err); }
        break;
      case 'copy': {
        const code = ui.invite && ui.invite.code;
        try { await navigator.clipboard.writeText(code); toast('복사했어요'); }
        catch (err) { const el = document.getElementById('invite-code'); const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('코드를 선택해 두었어요. 길게 눌러 복사하세요'); }
        break;
      }
      case 'unlink':
        if (ui.armed !== v) { arm(v); break; }
        ui.armed = null;
        try { await S.removeMember(v); toast('연결을 해제했어요'); } catch (err) { toast('해제하지 못했어요', err); }
        break;
      case 'google':
        ui.err = '';
        try { await S.signInParent(); } catch (err) { ui.err = '로그인하지 못했어요: ' + err.message; render(); }
        break;
      case 'join': {
        ui.err = '';
        const code = (document.getElementById('join-code') || {}).value;
        b.disabled = true;
        try { await S.joinWithCode(code); } catch (err) { ui.err = err.message; render(); }
        break;
      }
      case 'signout': await S.signOut(); break;
      case 'reload': location.reload(); break;
      default: if (ACT2[act]) await ACT2[act](b, kid);
    }
  });

  // ---------- 입력 바꾸기 (부모 설정) ----------
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.dataset.act === 'photo' && el.files && el.files[0]) {
      const sid = el.closest('[data-step]').dataset.step;
      const pid = ui.stepCtx === 'skill' ? 'skill-' + ui.skKid + '-' + ui.skSel + '-' + sid : ui.editKid + '-' + ui.editRoutine + '-' + sid;
      try {
        const file = el.files[0];
        toast('사진을 줄이는 중…');
        const url = await compressPhoto(file, PHOTO.card);
        const r = S.savePhoto(pid, url); if (r && r.catch) r.catch(fail);
        saveCfg(cfg => { stepList(cfg).find(x => x.id === sid).photo = pid; });
        toast('사진을 넣었어요 (' + fmtSize(file.size) + ' → ' + fmtSize(url.length * 3 / 4) + ')');
      } catch (err) { toast(err.message || '사진을 넣지 못했어요', err); }
      el.value = '';
      return;
    }
    if (el.dataset.f) {
      const sid = el.closest('[data-step]').dataset.step, f = el.dataset.f;
      saveCfg(cfg => {
        const st = stepList(cfg).find(x => x.id === sid);
        if (f === 'supplies') st.supplies = el.checked;
        else if (f === 'checks') st.checks = el.value.split(',').map(x => x.trim()).filter(Boolean);
        else st[f] = el.value.trim();
        if (f === 'title' && !st.title) st.title = '할 일';
      });
      return;
    }
    if (el.dataset.tt) {
      const day = el.dataset.tt;
      saveCfg(cfg => { cfg.timetable[ui.ttKid] = cfg.timetable[ui.ttKid] || {}; cfg.timetable[ui.ttKid][day] = el.value.split(',').map(x => x.trim()).filter(Boolean); });
      return;
    }
    if (el.dataset.k) {
      const kidId = el.closest('[data-kid]').dataset.kid, k = el.dataset.k;
      saveCfg(cfg => {
        const kd = cfg.kids.find(x => x.id === kidId);
        if (k === 'voice' || k === 'effects') kd[k] = el.checked;
        else if (k === 'fontScale' || k === 'voiceRate') kd[k] = Number(el.value);
        else kd[k] = el.value.trim() || kd[k];
      });
      return;
    }
    if (el.dataset.t) { if (el.value) saveCfg(cfg => { cfg.times[el.dataset.t] = el.value; }); return; }
    if (el.dataset.sd) {
      const d = Number(el.dataset.sd);
      saveCfg(cfg => { const s = new Set(cfg.schoolDays); if (el.checked) s.add(d); else s.delete(d); cfg.schoolDays = Array.from(s).sort(); });
      return;
    }
    if (CHANGE2(el)) return;
  });
  document.addEventListener('focusout', () => { setTimeout(() => { if (ui.pending) render(); }, 0); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'join-code') document.querySelector('[data-act="join"]').click();
  });

  // ---------- 시작 ----------
  S.onChange(render);
  setInterval(() => { S.refreshDay(); render(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { S.refreshDay(); render(); } });
  render();
  S.init();

  if ('serviceWorker' in navigator && window.FIREBASE_CONFIG) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 지원하지 않는 곳에서는 생략 */ });
  }
})();
