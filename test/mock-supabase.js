// 테스트 전용: supabase-js의 Realtime 채널(broadcast + presence)을 같은 브라우저 안의 BroadcastChannel로 흉내 낸다.
// 실제 배포에는 포함되지 않는다 (테스트 러너가 CDN 요청을 이 파일로 바꿔치기함).
window.supabase = {
  createClient() {
    return {
      channel(name, opts) {
        const bc = new BroadcastChannel('mock-' + name);
        const self = opts?.config?.broadcast?.self;
        const key = opts?.config?.presence?.key || Math.random().toString(36).slice(2);
        const handlers = { broadcast: {}, presence: {} };
        const others = new Map(); // key -> {meta, seen}
        let mine = null;
        const fire = (type, ev, payload) => (handlers[type][ev] || []).forEach(fn => setTimeout(() => fn(payload), 0));
        const sync = () => fire('presence', 'sync');
        bc.onmessage = ({ data }) => {
          if (data.k === 'b') fire('broadcast', data.event, { payload: data.payload });
          if (data.k === 'p') { others.set(data.key, { meta: data.meta, seen: Date.now() }); sync(); }
          if (data.k === 'pq' && mine) bc.postMessage({ k: 'p', key, meta: mine });
          if (data.k === 'pl') { others.delete(data.key); sync(); }
        };
        setInterval(() => {
          if (mine) bc.postMessage({ k: 'p', key, meta: mine });
          const now = Date.now(); let changed = false;
          for (const [k, v] of others) if (now - v.seen > 4000) { others.delete(k); changed = true; }
          if (changed) sync();
        }, 1000);
        addEventListener('pagehide', () => bc.postMessage({ k: 'pl', key }));
        const ch = {
          on(type, filter, fn) { (handlers[type][filter.event] ||= []).push(fn); return ch; },
          subscribe(cb) { setTimeout(() => { bc.postMessage({ k: 'pq' }); cb('SUBSCRIBED'); }, 50); return ch; },
          async track(meta) { mine = meta; bc.postMessage({ k: 'p', key, meta }); sync(); },
          send({ event, payload }) {
            bc.postMessage({ k: 'b', event, payload });
            if (self) fire('broadcast', event, { payload: JSON.parse(JSON.stringify(payload)) });
            return Promise.resolve('ok');
          },
          presenceState() {
            const st = {};
            for (const [k, v] of others) st[k] = [v.meta];
            if (mine) st[key] = [mine];
            return st;
          },
        };
        return ch;
      },
    };
  },
};
