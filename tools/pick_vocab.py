"""fastText 사전에서 게임용 단어(기본형)만 골라낸다.
- 명사: kiwi 분석 결과가 일반명사(NNG) 한 개 그대로인 단어 → 빈도 상위 N_NOUN개
- 동사/형용사: '~다' 기본형이며 VV/VA + EF('다')로 분석되는 단어 → 상위 SCAN 범위 전체
- wordfreq 한국어 목록에 있는 단어는 순위와 무관하게 포함(흔한 단어 누락 방지)
출력: [[word, fasttext_index, pos, common(0/1)], ...]  (common=랜덤 출제 후보)"""
import pickle, re, sys, json
from kiwipiepy import Kiwi
from wordfreq import get_frequency_dict

d = pickle.load(open(sys.argv[1], 'rb'))
N_NOUN, SCAN = int(sys.argv[3]), 800_000
fd = get_frequency_dict('ko')
kiwi = Kiwi()
JOSA = set('의 은 는 을 를 이 가 에 와 과 로 도 만 라 란 걸 여 서 께 요 며 고 나 랑 야'.split())
ALLOW = {'별'}
# 랜덤 출제에서만 제외(추측은 가능)
NO_SECRET = set('콜걸 변태 섹스 성인 야동 포르노 창녀 매춘 강간 자살 살인 마약 오마이 시터 민회 장지 분전 불후 해금'.split())
hangul = re.compile(r'^[가-힣]{1,5}$')
nouns, verbs = [], []
for idx, w in enumerate(d['words'][:SCAN]):
    if not hangul.match(w):
        continue
    is_wf = w in fd
    if w in JOSA:
        continue
    if w in ALLOW:
        nouns.append([w, idx, 'n', 0]); continue
    if len(nouns) >= N_NOUN and not w.endswith('다') and not is_wf:
        continue
    tags = [(t.form, t.tag) for t in kiwi.tokenize(w)]
    noun_ok = len(tags) == 1 and tags[0][0] == w and (
        (tags[0][1] == 'NNG' and (len(w) > 1 or is_wf)) or (tags[0][1] == 'NNP' and is_wf and len(w) > 1))
    if not noun_ok and is_wf and not w.endswith('다'):
        # 단어 하나만 보면 kiwi가 '파도'를 '파+도'로 자르기도 함 → 상위 후보 중 명사 한 덩어리가 있으면 인정
        cands = [[(t.form, t.tag) for t in r[0]] for r in kiwi.analyze(w, top_n=3)]
        noun_ok = any(c == [(w, 'NNG')] for c in cands)
    hada = (len(tags) == 3 and tags[0][1] == 'NNG' and tags[1][0] == '하' and tags[1][1] in ('XSA', 'XSV')
            and tags[2][0] == '다' and w == tags[0][0] + '하다')
    if noun_ok:
        if len(nouns) < N_NOUN or is_wf:
            # 랜덤 출제 후보: 일반명사, 2글자 이상, 일상 빈도 상위
            common = int(tags[0][1] == 'NNG' and len(w) > 1 and fd.get(w, 0) >= 5e-6 and w not in NO_SECRET)
            nouns.append([w, idx, 'n', common])
    elif (len(tags) == 2 and tags[0][1][:2] in ('VV', 'VA') and tags[1][0] == '다' and tags[1][1] in ('EF', 'EC')
          and w.endswith('다') and tags[0][0] == w[:-1]) or hada:
        verbs.append([w, idx, 'v', int(is_wf)])
picked = sorted(nouns + verbs, key=lambda x: x[1])
print('nouns', len(nouns), 'verbs', len(verbs), 'total', len(picked))
print('common nouns', sum(1 for x in nouns if x[3]))
json.dump(picked, open(sys.argv[2], 'w'), ensure_ascii=False)
