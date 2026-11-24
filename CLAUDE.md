# CLAUDE.md — word-duel

2~4인 온라인 단어 유사도 게임. 정적 사이트(GitHub Pages) + Supabase Realtime. 서버 코드 없음.

## 작업 규칙
- 답변·커밋 메시지·주석은 한국어.
- 게임 규칙(README의 '규칙')을 바꾸면 `index.html` 첫 화면 규칙 문구와 README를 같이 고친다.
- 정답은 출제자 브라우저 밖으로 내보내지 않는다. 공개 상태 `S`에 정답을 넣는 건 `reveal` 단계에서만.
- 방장만 `S`를 바꾼다(`hostUpdate`). 다른 사람은 `cmd`를 보낸다.
- 비밀값을 커밋하지 않는다. `js/config.js`의 Supabase **publishable** 키는 공개용이라 괜찮지만,
  service_role 키·DB 비밀번호·.env는 절대 넣지 않는다.
- 데이터(`data/`)를 다시 만들 때는 `tools/` 스크립트를 쓴다. 원본 fastText 파일(7GB)은 커밋하지 않는다.
- 라이선스는 GPL-3.0(꼬오맨틀에서 파생). 외부 코드를 가져오면 출처를 README에 적는다.

## 확인 방법
- 로직: `python3 test/playtest.py http://localhost:8766/ /tmp/shots` (가짜 Realtime, 3인 3라운드)
  → `errors: []`, 점수(정답 +2 / 전원 실패 시 출제자 +2), `guesser A is null: True` 확인.
- 실제 통신: 배포 주소를 브라우저 탭 2~3개로 열어 같은 방 코드로 한 판.

## 구조
- `js/engine.js` 유사도·순위(퍼센트 = (1001-순위)/10, 95% = 51위 이내)
- `js/app.js` 방·통신·진행 (방장=presence에서 가장 먼저 들어온 사람)
- `data/words.json` 키: `w` 단어, `e` 쉬운 출제 후보, `r` 순위 계산 범위, `c` 흔한 명사
