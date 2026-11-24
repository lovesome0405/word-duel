// 단어 유사도 대결 — 온라인 멀티 (Supabase Realtime broadcast + presence)
//
// 역할 분담
//  - 방장(가장 먼저 들어온 접속자): 공개 상태 S를 들고 모두에게 'state'로 방송. 규칙 판정의 중심.
//  - 출제자: 정답을 자기 브라우저에만 보관. 힌트 검증(95% 이상)과 추측 채점만 해서 결과를 방장에게 보냄.
//  - 나머지: 명령('cmd')을 방장에게 보내고, 받은 상태를 그린다.
// 꼬오맨틀(semantle-koo)은 서버가 세션별 정답을 들고 판정하는데, 여기서는 서버 대신 출제자 브라우저가 그 역할을 한다.
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const COLORS = ['#ffd23f', '#35d0c4', '#ff8fb1', '#8fb3ff'];
  const MAX = 4, PASS_PCT = 95;
  const store = {
    get: (k, d) => { try { const v = sessionStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
    lget: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    lset: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };

  const ME = { id: store.get('duel:id', null) || Math.random().toString(36).slice(2, 10), name: store.lget('duel:name', '') };
  store.set('duel:id', ME.id);
  let sb = null, ch = null, code = '', S = null, hostId = '', peers = [];
  let A = null;            // 출제자 전용: 정답 분석 결과 (Engine.analyze)
  let pendingGuesses = {}; // 방장 전용: 이번 힌트에 대한 추측 단어
  let hintTries = 0, choices = [], rerolled = false, localRound = -1, settled = false, lastStage = '', suggestHtml = '', suggestKey = '';
  // 라운드가 바뀌면 출제자 전용 정보 초기화 (방장 본인이 바꾼 경우도 포함)
  function syncLocal() {
    if (S && S.round !== localRound) { localRound = S.round; A = null; hintTries = 0; choices = []; rerolled = false; restoreSecret(); }
  }

  // ---------- 공통 유틸 ----------
  const playerIdx = id => S ? S.players.findIndex(p => p.id === id) : -1;
  const pname = id => (S?.players.find(p => p.id === id)?.name) || '?';
  const dot = id => { const i = playerIdx(id); return `<span class="dot" style="background:${COLORS[i] || '#888'}">${esc(pname(id).slice(0, 1))}</span>`; };
  const amHost = () => hostId === ME.id;
  const amSetter = () => S && S.setterId === ME.id;
  const amPlayer = () => playerIdx(ME.id) >= 0;
  const guessersOnline = () => S.players.filter(p => p.id !== S.setterId && p.online).map(p => p.id);
  const fmtScore = r => r.correct ? '정답!' : (r.rank ? `${r.pct.toFixed(1)}% · ${r.rank}위` : `1000위 밖 · ${r.sim.toFixed(1)}`);
  const secretKey = () => `duel:secret:${code}:${S?.round}`;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }
  function show(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id); }

  // ---------- 통신 ----------
  const send = (event, payload) => ch && ch.send({ type: 'broadcast', event, payload });
  const cmd = (type, data = {}) => send('cmd', { type, from: ME.id, round: S?.round, ...data });

  async function join(roomCode) {
    code = roomCode.toUpperCase();
    history.replaceState(null, '', `?room=${code}`);
    const at = store.get(`duel:at:${code}`, Date.now());
    store.set(`duel:at:${code}`, at);
    $('roomCode').textContent = code;
    show('s-room'); $('conn').textContent = '연결 중…';
    const cfg = window.DUEL_CONFIG;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { realtime: { params: { eventsPerSecond: 20 } } });
    ch = sb.channel(`word-duel-${code}`, { config: { broadcast: { self: true }, presence: { key: ME.id } } });
    ch.on('broadcast', { event: 'state' }, ({ payload }) => onState(payload));
    ch.on('broadcast', { event: 'cmd' }, ({ payload }) => onCmd(payload));
    ch.on('broadcast', { event: 'hello' }, () => { if (amHost() && S) send('state', S); });
    ch.on('broadcast', { event: 'judge' }, ({ payload }) => onJudge(payload));
    ch.on('presence', { event: 'sync' }, onPresence);
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        $('conn').textContent = '연결됨';
        await ch.track({ id: ME.id, name: ME.name, at });
        send('hello', {});
        // 다른 사람들의 presence/상태가 도착할 시간을 준 뒤에만 방장 역할을 시작 (빈 방 착각 방지)
        setTimeout(() => { settled = true; onPresence(); }, 1500);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        $('conn').textContent = '연결 끊김 · 새로고침해줘';
      }
    });
  }

  function onPresence() {
    const st = ch.presenceState();
    peers = Object.values(st).map(a => a[0]).filter(Boolean).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    const prevHost = hostId;
    hostId = peers[0]?.id || '';
    if (amHost() && (settled || S)) {
      // 참가자 목록·접속 여부·방장이 실제로 바뀐 경우에만 방송
      const next = JSON.parse(JSON.stringify(S || freshState()));
      const ids = new Set(peers.map(p => p.id));
      if (next.phase === 'lobby') {
        next.players = next.players.filter(p => ids.has(p.id));
        for (const p of peers) if (!next.players.some(q => q.id === p.id) && next.players.length < MAX) next.players.push({ id: p.id, name: p.name || '손님', score: 0, online: true });
      }
      for (const p of next.players) p.online = ids.has(p.id);
      next.hostId = ME.id;
      if (!S || JSON.stringify([next.players, next.hostId]) !== JSON.stringify([S.players, S.hostId])) {
        hostUpdate(st => { st.players = next.players; st.hostId = ME.id; });
        return;
      }
    }
    if (prevHost !== hostId) render(); else renderPlayers();
  }

  // ---------- 방장: 상태 관리 ----------
  const freshState = () => ({ v: 0, phase: 'lobby', hostId: ME.id, players: [], order: [], setterId: '', round: 0,
    rounds: 1, maxHints: 5, hints: [], submitted: {}, answer: '', top: [], winners: [], note: '' });

  function hostUpdate(fn) {
    const base = S ? JSON.parse(JSON.stringify(S)) : freshState();
    fn(base);
    base.v = (S?.v || 0) + 1;
    S = base;
    send('state', S);
    syncLocal(); render();
  }

  function onState(st) {
    // 지금 방장이 보낸 상태이거나 더 새로운 버전만 받는다
    if (S && st.hostId !== hostId && st.v <= S.v) return;
    if (S && st.hostId === S.hostId && st.v < S.v) return;
    S = st;
    syncLocal(); render();
  }

  function startRound(s, round) {
    s.round = round;
    s.setterId = s.order[(round - 1) % s.order.length];
    s.phase = 'choose'; s.hints = []; s.submitted = {}; s.answer = ''; s.top = []; s.winners = []; s.note = '';
  }

  function onCmd(m) {
    if (!amHost() || !S) return;
    const isSetter = m.from === S.setterId;
    switch (m.type) {
      case 'settings':
        if (m.from !== ME.id || S.phase !== 'lobby') return;
        hostUpdate(s => { s.maxHints = m.maxHints; s.rounds = m.rounds; });
        break;
      case 'start':
        if (m.from !== ME.id || S.phase !== 'lobby' || S.players.length < 2) return;
        hostUpdate(s => { s.order = s.players.map(p => p.id); s.players.forEach(p => (p.score = 0)); startRound(s, 1); });
        break;
      case 'chosen':
        if (!isSetter || S.phase !== 'choose' || m.round !== S.round) return;
        hostUpdate(s => { s.phase = 'hint'; });
        break;
      case 'hint':
        if (!isSetter || S.phase !== 'hint' || m.round !== S.round) return;
        hostUpdate(s => { s.hints.push({ word: m.word, pct: m.pct, rank: m.rank, guesses: [] }); s.phase = 'guess'; s.submitted = {}; });
        pendingGuesses = {};
        break;
      case 'guess': {
        if (S.phase !== 'guess' || m.round !== S.round || isSetter || playerIdx(m.from) < 0 || S.submitted[m.from]) return;
        pendingGuesses[m.from] = m.word;
        hostUpdate(s => { s.submitted[m.from] = true; });
        maybeJudge(false);
        break;
      }
      case 'skip':
        if (m.from !== ME.id || S.phase !== 'guess') return;
        maybeJudge(true);
        break;
      case 'judged':
        if (!isSetter || m.round !== S.round || S.phase !== 'judging' || m.hintNo !== S.hints.length) return;
        hostUpdate(s => {
          const h = s.hints[s.hints.length - 1];
          h.guesses = m.results;
          const winners = m.results.filter(r => r.correct).map(r => r.id);
          if (winners.length) {
            for (const id of winners) s.players.find(p => p.id === id).score += 2;
            s.winners = winners; s.phase = 'reveal';
          } else if (s.hints.length >= s.maxHints) {
            s.players.find(p => p.id === s.setterId).score += 2;
            s.winners = []; s.phase = 'reveal';
          } else s.phase = 'hint';
          if (s.phase === 'reveal') { s.answer = m.answer; s.top = m.top; }
        });
        break;
      case 'next':
        if (m.from !== ME.id || S.phase !== 'reveal') return;
        hostUpdate(s => {
          const total = s.order.length * s.rounds;
          if (s.round >= total) s.phase = 'end'; else startRound(s, s.round + 1);
        });
        break;
      case 'void':
        if (m.from !== ME.id || !['choose', 'hint', 'guess', 'judging'].includes(S.phase)) return;
        hostUpdate(s => { s.phase = 'reveal'; s.answer = ''; s.top = []; s.winners = []; s.note = '출제자 연결이 끊겨 이번 라운드는 무효야.'; });
        break;
      case 'lobby':
        if (m.from !== ME.id) return;
        hostUpdate(s => { const keep = s.players.filter(p => p.online); Object.assign(s, freshState(), { players: keep.map(p => ({ ...p, score: 0 })), maxHints: s.maxHints, rounds: s.rounds }); });
        break;
    }
  }

  function maybeJudge(force) {
    const need = guessersOnline();
    const done = need.every(id => S.submitted[id]);
    if (!done && !force) return;
    hostUpdate(s => { s.phase = 'judging'; });
    send('judge', { round: S.round, hintNo: S.hints.length, guesses: pendingGuesses });
  }

  // ---------- 출제자: 정답 보관, 힌트 검증, 채점 ----------
  function restoreSecret() {
    if (!S || !amSetter()) return;
    const w = store.get(secretKey(), null);
    if (w && Engine.ready) { const i = Engine.find(w); if (i >= 0) A = Engine.analyze(i); }
    else if (!w) A = null;
  }

  function onJudge(m) {
    if (!S || !amSetter() || m.round !== S.round || !A) return;
    const results = Object.entries(m.guesses).map(([id, word]) => {
      const i = Engine.find(word);
      const r = i >= 0 ? Engine.score(A, i) : { word, sim: 0, rank: 0, pct: 0, correct: false };
      return { id, word: r.word, sim: r.sim, rank: r.rank, pct: r.pct, correct: r.correct };
    }).sort((a, b) => b.pct - a.pct || b.sim - a.sim);
    const over = results.some(r => r.correct) || m.hintNo >= S.maxHints;
    const extra = over ? { answer: Engine.W[A.s], top: A.top.slice(0, 10).map(i => { const r = Engine.score(A, i); return { word: r.word, pct: r.pct, rank: r.rank }; }) } : {};
    cmd('judged', { hintNo: m.hintNo, results, ...extra });
  }

  function chooseWord(i) {
    store.set(secretKey(), Engine.W[i]);
    A = Engine.analyze(i);
    cmd('chosen');
  }

  function tryHint(raw) {
    const msg = $('hintMsg');
    const i = Engine.find(raw);
    const w = Engine.clean(raw), ans = Engine.W[A.s];
    if (!w) return;
    if (i < 0) { msg.textContent = `'${w}'은(는) 사전에 없는 단어야.`; return; }
    if (i === A.s || w.includes(ans) || ans.includes(w)) { msg.textContent = '정답이거나 정답을 품은 단어는 힌트로 못 써.'; return; }
    if (S.hints.some(h => h.word === w)) { msg.textContent = '이미 낸 힌트야.'; return; }
    const r = Engine.score(A, i);
    if (r.pct < PASS_PCT) {
      hintTries++;
      msg.textContent = `'${w}' ${r.rank ? `${r.pct.toFixed(1)}% (${r.rank}위)` : '1000위 밖'} → 95% 미만이라 못 써. 51위 안의 단어를 찾아봐.`;
      renderSuggest();
      return;
    }
    msg.textContent = '';
    $('hintIn').value = '';
    cmd('hint', { word: w, pct: r.pct, rank: r.rank });
  }

  // ---------- 화면 ----------
  function renderPlayers() {
    if (!S) { $('players').innerHTML = ''; return; }
    $('players').innerHTML = S.players.map(p => `<li class="${p.online ? '' : 'off'}${p.id === S.setterId && !['lobby', 'end'].includes(S.phase) ? ' setter' : ''}">${dot(p.id)}<span class="nm">${esc(p.name)}${p.id === ME.id ? ' (나)' : ''}${p.id === S.hostId ? ' · 방장' : ''}${p.id === S.setterId && S.phase !== 'lobby' && S.phase !== 'end' ? ' · 출제' : ''}</span><b>${p.score}</b></li>`).join('');
    const spect = peers.filter(p => !S.players.some(q => q.id === p.id));
    $('spect').textContent = spect.length ? `관전 ${spect.map(p => p.name).join(', ')}` : '';
  }

  function renderTimeline() {
    if (!S?.hints.length) { $('timeline').innerHTML = '<li class="empty">아직 힌트가 없어. 출제자의 첫 힌트를 기다리는 중.</li>'; return; }
    $('timeline').innerHTML = S.hints.map((h, k) => `<li class="hint">
      <div class="hhead"><span class="hno">힌트 ${k + 1}</span><span class="hw">${esc(h.word)}</span><span class="hp">${h.pct.toFixed(1)}% · ${h.rank}위</span></div>
      <div class="bar"><i style="width:${h.pct}%"></i></div>
      ${h.guesses.length ? `<ul class="gl">${h.guesses.map(g => `<li class="${g.correct ? 'ok' : ''}">${dot(g.id)}<span>${esc(pname(g.id))}</span><b>${esc(g.word)}</b><em>${esc(fmtScore(g))}</em><span class="gbar"><i style="width:${g.correct ? 100 : g.pct}%"></i></span></li>`).join('')}</ul>`
        : `<p class="note">${S.phase === 'judging' ? '채점 중…' : '추측 받는 중…'}</p>`}
    </li>`).join('');
  }

  function renderSuggest() {
    const box = $('suggest');
    if (hintTries < 3 || !A) { box.hidden = true; return; }
    const used = new Set(S.hints.map(h => Engine.IDX.get(h.word)));
    const ans = Engine.W[A.s];
    const ok = A.top.slice(0, 51).filter(i => !used.has(i) && !Engine.W[i].includes(ans) && !ans.includes(Engine.W[i]));
    const key = `${S.round}:${S.hints.length}:${Math.floor(hintTries / 3)}`;
    if (key !== suggestKey) {
      suggestKey = key;
      const pick = ok.sort(() => Math.random() - 0.5).slice(0, 3);
      suggestHtml = `막히면 이런 단어도 돼: ${pick.map(i => `<button type="button" class="chip" data-w="${esc(Engine.W[i])}">${esc(Engine.W[i])}</button>`).join(' ')}`;
    }
    box.hidden = false;
    box.innerHTML = suggestHtml;
  }

  function render() {
    renderPlayers();
    if (!S) { $('stage').innerHTML = '<p class="note">방 정보를 받는 중…</p>'; return; }
    const total = S.order.length * S.rounds || 0;
    $('roundLine').textContent = S.phase === 'lobby' ? '대기실' : S.phase === 'end' ? '게임 끝' : `${S.round} / ${total} 라운드 · 출제 ${pname(S.setterId)} · 힌트 ${S.hints.length}/${S.maxHints}`;
    const hostTools = amHost() && ['choose', 'hint', 'guess', 'judging'].includes(S.phase)
      ? `<div class="row tools">${S.phase === 'guess' ? '<button class="ghost" data-act="skip">미제출자 건너뛰기</button>' : ''}${!S.players.find(p => p.id === S.setterId)?.online ? '<button class="ghost" data-act="void">출제자 없음 · 라운드 무효</button>' : ''}</div>` : '';
    $('board').hidden = ['lobby', 'end'].includes(S.phase);
    document.querySelector('.desk').classList.toggle('solo', $('board').hidden);
    renderTimeline();
    let h = '';
    if (S.phase === 'lobby') {
      const canStart = amHost() && S.players.length >= 2;
      h = `<h2>대기실</h2><p class="note">친구에게 방 코드나 링크를 보내줘. 2~4명이 모이면 방장이 시작해.</p>
        ${amHost() ? `<div class="grid2"><label>힌트 최대 개수<select id="setHints">${[3, 5, 7].map(n => `<option ${n === S.maxHints ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>판 수<select id="setRounds"><option value="1" ${S.rounds === 1 ? 'selected' : ''}>모두 한 번씩 출제</option><option value="2" ${S.rounds === 2 ? 'selected' : ''}>모두 두 번씩 출제</option></select></label></div>
        <button id="startBtn" ${canStart ? '' : 'disabled'}>게임 시작</button>${S.players.length < 2 ? '<p class="note">혼자서는 시작할 수 없어.</p>' : ''}`
        : `<p>방장(${esc(pname(S.hostId))})이 시작하길 기다리는 중 · 힌트 ${S.maxHints}개 · ${S.rounds === 2 ? '두 번씩' : '한 번씩'} 출제</p>`}
        ${!amPlayer() && S.players.length >= MAX ? '<p class="err">방이 꽉 찼어(최대 4명). 관전만 가능해.</p>' : ''}`;
    } else if (S.phase === 'choose') {
      if (amSetter()) {
        if (!Engine.ready) h = '<p class="note">사전 불러오는 중…</p>';
        else {
          if (!choices.length) choices = Engine.pick(Engine.EASY, 5);
          h = `<h2>정답으로 낼 단어를 하나 골라</h2><p class="note">다른 사람에게는 안 보여. 고른 뒤 95% 이상인 힌트를 내야 해.</p>
            <div class="cards">${choices.map(i => `<button class="card5" data-pick="${i}">${esc(Engine.W[i])}</button>`).join('')}</div>
            ${rerolled ? '' : '<button class="ghost" id="reroll">다시 뽑기 (1번)</button>'}`;
        }
      } else h = `<h2>${esc(pname(S.setterId))}이(가) 정답을 고르는 중</h2><p class="note">쉬운 단어 5개 중 하나야.</p>`;
    } else if (S.phase === 'hint') {
      if (amSetter()) {
        h = A ? `<h2>힌트 ${S.hints.length + 1} 내기</h2><p class="note">정답: <b class="secret">${esc(Engine.W[A.s])}</b> · 유사도 95% 이상(51위 이내) 단어만 통과해. 정답을 품은 단어는 안 돼.</p>
          <form id="hintForm" class="row"><input id="hintIn" autocomplete="off" spellcheck="false" placeholder="힌트 단어"><button>힌트 보내기</button></form>
          <p class="err" id="hintMsg"></p><p class="note" id="suggest" hidden></p>`
          : '<p class="err">이 기기에 정답 정보가 없어(다른 기기에서 고른 것 같아). 방장에게 라운드 무효를 부탁해.</p>';
      } else h = `<h2>${esc(pname(S.setterId))}이(가) ${S.hints.length + 1}번째 힌트를 찾는 중</h2><p class="note">출제자는 95% 이상 가까운 단어만 낼 수 있어.</p>`;
    } else if (S.phase === 'guess') {
      const last = S.hints[S.hints.length - 1];
      const waiting = guessersOnline().filter(id => !S.submitted[id]).map(pname);
      if (amPlayer() && !amSetter()) {
        h = S.submitted[ME.id] ? `<h2>제출 완료</h2><p class="note">남은 사람: ${esc(waiting.join(', ') || '없음')}</p>`
          : `<h2>힌트 '${esc(last.word)}' → 정답은?</h2><p class="note">한 단어만 낼 수 있어. 모두 내면 한꺼번에 공개돼.</p>
            <form id="guessForm" class="row"><input id="guessIn" autocomplete="off" spellcheck="false" placeholder="추측 단어"><button>제출</button></form><p class="err" id="guessMsg"></p>`;
      } else h = `<h2>도전자들이 추측하는 중</h2><p class="note">아직: ${esc(waiting.join(', ') || '없음')}</p>`;
    } else if (S.phase === 'judging') {
      h = '<h2>채점 중…</h2><p class="note">출제자 기기에서 유사도를 계산하고 있어.</p>';
    } else if (S.phase === 'reveal') {
      const who = S.winners.length ? `${S.winners.map(pname).join(', ')} 정답! 각 +2점` : S.note ? S.note : `아무도 못 맞혀서 출제자 ${pname(S.setterId)} +2점`;
      h = `<p class="who">${esc(who)}</p>${S.answer ? `<div class="big">${esc(S.answer)}</div>` : ''}
        ${S.top.length ? `<p class="note">정답과 가까운 단어</p><ul class="nb">${S.top.map(t => `<li>${esc(t.word)}<small>${t.rank}위 · ${t.pct.toFixed(1)}%</small></li>`).join('')}</ul>` : ''}
        ${amHost() ? `<button id="nextBtn">${S.round >= S.order.length * S.rounds ? '최종 결과 보기' : '다음 라운드'}</button>` : '<p class="note">방장이 다음 라운드를 열기를 기다리는 중</p>'}`;
    } else if (S.phase === 'end') {
      const rank = [...S.players].sort((a, b) => b.score - a.score);
      h = `<h2>최종 결과</h2><ol class="final">${rank.map(p => `<li>${dot(p.id)}<span>${esc(p.name)}</span><b>${p.score}점</b></li>`).join('')}</ol>
        ${amHost() ? '<button id="againBtn">같은 멤버로 다시 하기</button>' : ''}`;
    }
    // 다시 그려도 입력 중인 글자와 안내 문구는 유지
    if (h + hostTools === lastStage) { if (S.phase === 'hint' && amSetter()) renderSuggest(); return; }
    lastStage = h + hostTools;
    const keep = ['hintIn', 'guessIn', 'hintMsg', 'guessMsg'].map(id => [id, $(id) ? ($(id).value ?? $(id).textContent) : null, document.activeElement?.id === id]);
    $('stage').innerHTML = h + hostTools;
    for (const [id, val, focused] of keep) {
      const el = $(id); if (!el || val === null) continue;
      if ('value' in el && el.tagName === 'INPUT') el.value = val; else el.textContent = val;
      if (focused) el.focus();
    }
    if (S.phase === 'hint' && amSetter()) renderSuggest();
    const f = $('hintIn') || $('guessIn'); if (f && document.activeElement?.tagName !== 'INPUT') f.focus();
  }

  // ---------- 이벤트 ----------
  $('stage').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pick) chooseWord(+b.dataset.pick);
    else if (b.id === 'reroll') { rerolled = true; choices = []; render(); }
    else if (b.id === 'startBtn') cmd('start');
    else if (b.id === 'nextBtn') cmd('next');
    else if (b.id === 'againBtn') cmd('lobby');
    else if (b.dataset.act) cmd(b.dataset.act);
    else if (b.dataset.w) { $('hintIn').value = b.dataset.w; }
  });
  $('stage').addEventListener('change', e => {
    if (e.target.id === 'setHints' || e.target.id === 'setRounds') cmd('settings', { maxHints: +$('setHints').value, rounds: +$('setRounds').value });
  });
  $('stage').addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'hintForm') tryHint($('hintIn').value);
    if (e.target.id === 'guessForm') {
      const w = Engine.clean($('guessIn').value);
      if (!w) return;
      if (Engine.ready && Engine.find(w) < 0) { $('guessMsg').textContent = `'${w}'은(는) 사전에 없는 단어야. 기본형으로 넣어줘.`; return; }
      cmd('guess', { word: w });
    }
  });

  $('homeForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('nameIn').value.trim().slice(0, 8);
    if (!name) { $('homeErr').textContent = '이름을 입력해줘.'; return; }
    ME.name = name; store.lset('duel:name', name);
    const action = e.submitter?.value || 'join';
    let c = $('codeIn').value.trim().toUpperCase();
    if (action === 'create') {
      const A26 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      c = Array.from({ length: 4 }, () => A26[Math.floor(Math.random() * A26.length)]).join('');
    } else if (!/^[A-Z0-9]{4}$/.test(c)) { $('homeErr').textContent = '방 코드 4자리를 입력해줘.'; return; }
    join(c);
  });
  $('copyLink').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${code}`;
    try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어'); } catch { toast(url); }
  });

  // ---------- 시작 ----------
  $('nameIn').value = ME.name;
  const qs = new URLSearchParams(location.search).get('room');
  if (qs) $('codeIn').value = qs.toUpperCase();
  Engine.load().then(() => { $('dictState').textContent = `사전 ${Engine.W.length.toLocaleString()}단어 준비됨`; restoreSecret(); if (code) render(); })
    .catch(err => { $('dictState').textContent = '사전을 못 불러왔어: ' + err.message; });
  window.__duel = { get S() { return S; }, get A() { return A; }, ME, get hostId() { return hostId; } }; // 테스트용
})();
