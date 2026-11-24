// 단어 유사도 엔진 (브라우저 전용, 서버 없음)
// - data/words.json : w(단어), e(쉬운 출제 후보), r(순위 계산 범위) 인덱스
// - data/vectors.bin: 단어마다 300바이트 int8 벡터 (fastText cc.ko.300에서 추출)
// 퍼센트 = (1001 - 순위) / 10  ← 꼬오맨틀 진행 막대와 같은 공식. 1위=100%, 51위=95%, 1000위 밖=0%
window.Engine = (() => {
  const DIM = 300;
  const E = { W: [], IDX: new Map(), EASY: [], R: null, V: null, NORM: null, ready: false };

  E.load = async (base = 'data/') => {
    const [meta, buf] = await Promise.all([
      fetch(base + 'words.json').then(r => r.json()),
      fetch(base + 'vectors.bin').then(r => r.arrayBuffer()),
    ]);
    E.W = meta.w; E.EASY = meta.e; E.R = Int32Array.from(meta.r);
    E.W.forEach((w, i) => E.IDX.set(w, i));
    E.V = new Int8Array(buf);
    E.NORM = new Float32Array(E.W.length);
    for (let j = 0; j < E.W.length; j++) {
      let s = 0; const o = j * DIM;
      for (let k = 0; k < DIM; k++) { const x = E.V[o + k]; s += x * x; }
      E.NORM[j] = Math.sqrt(s) || 1;
    }
    E.ready = true;
  };

  E.clean = raw => String(raw || '').normalize('NFC').replace(/\s+/g, '');
  E.find = raw => { const w = E.clean(raw); return E.IDX.has(w) ? E.IDX.get(w) : -1; };

  E.sim = (a, b) => {
    let d = 0; const oa = a * DIM, ob = b * DIM;
    for (let k = 0; k < DIM; k++) d += E.V[oa + k] * E.V[ob + k];
    return d / (E.NORM[a] * E.NORM[b]);
  };

  // 정답 s 기준 분석: 순위 범위(R) 안에서 상위 1000개 순위표
  E.analyze = s => {
    const R = E.R, n = R.length, sims = new Float32Array(n);
    for (let k = 0; k < n; k++) sims[k] = E.sim(s, R[k]);
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => sims[b] - sims[a]);
    const rank = new Map(); const top = [];
    let r = 0;
    for (const k of order) {
      const i = R[k];
      if (i === s) continue;
      r++; rank.set(i, r); top.push(i);
      if (r >= 1000) break;
    }
    return { s, rank, top };
  };

  // 한 단어의 점수: { idx, word, sim(-100~100), rank(1~1000 | 0), pct(0~100), correct }
  E.score = (A, i) => {
    if (i === A.s) return { idx: i, word: E.W[i], sim: 100, rank: 0, pct: 100, correct: true };
    const rank = A.rank.get(i) || 0;
    return { idx: i, word: E.W[i], sim: Math.round(E.sim(A.s, i) * 10000) / 100, rank,
             pct: rank ? (1001 - rank) / 10 : 0, correct: false };
  };

  E.pick = (list, n, avoid = new Set()) => {
    const out = new Set(); let guard = 0;
    while (out.size < n && guard++ < 1000) {
      const i = list[Math.floor(Math.random() * list.length)];
      if (!avoid.has(i)) out.add(i);
    }
    return [...out];
  };
  return E;
})();
