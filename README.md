# 단어 유사도 대결 (word-duel)

2~4명이 각자 자기 기기로 같은 방에 들어와 하는 단어 유사도 추리 게임.
한 명이 쉬운 단어 5개 중 하나를 몰래 정답으로 고르고, **정답과 95% 이상 가까운 단어로만** 힌트를 준다.
나머지는 힌트를 보고 정답을 맞힌다.

## 규칙

1. 방장이 방을 만들고 방 코드(4자리)나 초대 링크를 공유한다. 최대 4명.
2. 라운드마다 출제자가 바뀐다. 출제자는 쉬운 단어 5개 중 하나를 고른다(1번 다시 뽑기 가능).
3. 출제자는 힌트를 낸다. 힌트는 정답과의 유사도가 **95% 이상**(정답 기준 순위 51위 이내)이어야 통과한다.
   정답이거나 정답을 품은 단어(예: 결혼식 → 결혼식장)는 쓸 수 없다.
4. 힌트가 나올 때마다 도전자 전원이 한 단어씩 동시에 제출하고, 모두 내면 결과가 한꺼번에 공개된다.
5. 맞힌 사람은 +2점. 정해진 힌트 수(3·5·7개 중 선택)를 다 써도 아무도 못 맞히면 출제자 +2점.

**유사도 퍼센트** = (1001 − 순위) / 10. 1위 100%, 51위 95%, 1000위 밖 0%.
꼬오맨틀의 진행 막대와 같은 공식이다. 원래 코사인 유사도(-100~100)도 함께 표시한다.

## 구조

| 부분 | 하는 일 |
|---|---|
| `index.html` | 화면(첫 화면, 방) |
| `js/engine.js` | 단어 사전·벡터 로딩, 유사도·순위 계산 (전부 브라우저에서) |
| `js/app.js` | 방 입장, Supabase Realtime 통신, 게임 진행 |
| `js/config.js` | Supabase 프로젝트 URL과 publishable 키 |
| `data/words.json` | 단어 32,682개, 쉬운 출제 후보(`e`), 순위 계산 범위(`r`) |
| `data/vectors.bin` | 단어마다 300바이트 int8 벡터 |
| `tools/` | fastText 원본에서 위 두 데이터 파일을 만드는 스크립트 |
| `test/` | 가짜 Realtime으로 3인 대전을 자동 진행하는 테스트 |

- **서버가 없다.** GitHub Pages(정적 호스팅)와 Supabase Realtime(broadcast/presence 채널)만 쓴다. DB 테이블은 쓰지 않는다.
- **방장 브라우저**가 공개 상태(참가자, 점수, 힌트 기록)를 들고 모두에게 방송한다.
- **출제자 브라우저**만 정답을 갖고 힌트 검증과 채점을 한다. 정답은 라운드가 끝날 때까지 네트워크로 나가지 않는다.
- 방장이 나가면 그다음에 들어온 사람이 마지막으로 받은 상태로 이어받는다.

## 로컬 실행

```bash
python3 -m http.server 8000   # http://localhost:8000
```

## 테스트

```bash
pip install playwright && playwright install chromium
python3 -m http.server 8766 &
python3 test/playtest.py http://localhost:8766/ /tmp/shots
```

라운드 3개(정답·전원 실패·정답)를 진행하고, 점수 계산, 정답 비공개, 폰 화면 폭을 확인한다.
실제 Supabase 연결은 배포 주소에서 탭 여러 개로 확인한다.

## 데이터 다시 만들기

`tools/` 스크립트를 순서대로 실행한다(read_dict → pick_vocab → merge_koo → extract_vectors → rank_space).
원본 fastText `cc.ko.300` 바이너리(약 7GB)가 필요하고, 이 저장소에는 넣지 않는다.

## 출처와 라이선스

- 단어 벡터: [fastText cc.ko.300](https://fasttext.cc/docs/en/crawl-vectors.html) (Facebook AI Research, CC BY-SA 3.0)
- 정답 후보 단어 목록(빈도 단어·비속어 필터 결과)과 구조 참고: [꼬오맨틀 semantle-koo](https://github.com/jhleekr/semantle-koo) (GPL-3.0)
  ← [꼬맨틀](https://github.com/NewsJelly/semantle-ko) ← [Semantlich](https://github.com/gaetjen/semantle-de) ← [Semantle](https://gitlab.com/novalis_dt/semantle)
- 이 프로젝트도 **GPL-3.0**으로 공개한다. 전문은 `LICENSE` 참고.
