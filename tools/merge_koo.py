"""꼬오맨틀(semantle-koo, GPL-3.0)의 빈도 단어 목록을 게임 사전에 합친다.
- frequent_words.txt(국립국어원 기반 빈도순 5,800단어) 중 fastText 사전에 있는 한글 단어를 추측 가능 단어로 추가
- 쉬운 출제 후보(easy): 빈도 상위 3,000위 안 + 꼬오맨틀 secrets.txt(비속어 필터 통과) + 일반명사(NNG) + 2~4글자
출력: [[word, fasttext_index, pos, common, easy], ...]"""
import json, pickle, re, sys, unicodedata
from kiwipiepy import Kiwi

dict_pkl, vocab_in, koo_dir, out = sys.argv[1:5]
d = pickle.load(open(dict_pkl, 'rb'))
first = {}
for i, w in enumerate(d['words']):
    first.setdefault(w, i)
vocab = json.load(open(vocab_in))
have = {v[0]: v for v in vocab}
nfc = lambda s: unicodedata.normalize('NFC', s.strip())
fw = [nfc(l) for l in open(f'{koo_dir}/data/frequent_words.txt', encoding='utf-8') if not l.startswith('#')]
fw = [w for w in fw if re.fullmatch(r'[가-힣]+', w)]
secrets = {nfc(l) for l in open(f'{koo_dir}/data/secrets.txt', encoding='utf-8')}
NO_SECRET = set('그다음 그동안 이날 당시 때문 경우 정도 그것 이것 무엇 자신 사이 가운데 이후 이상 이하 이전 이번 다음 하나 퍼센트 오늘 내일 어제'.split())

kiwi = Kiwi()
added = 0
for rank, w in enumerate(fw):
    if w not in have and w in first:
        have[w] = [w, first[w], 'x', 0]
        added += 1
easy = set()
for rank, w in enumerate(fw[:3000]):
    if w in secrets and w in have and 2 <= len(w) <= 4 and w not in NO_SECRET:
        # 분석 1순위가 일반명사 한 덩어리인 단어만 (예: '명의'는 '명+의'로 읽혀 제외)
        top1 = [(t.form, t.tag) for t in kiwi.analyze(w, top_n=1)[0][0]]
        if top1 == [(w, 'NNG')]:
            easy.add(w)
rows = sorted(have.values(), key=lambda v: v[1])
rows = [v[:4] + [int(v[0] in easy)] for v in rows]
json.dump(rows, open(out, 'w'), ensure_ascii=False)
print('added', added, 'total', len(rows), 'easy', len(easy))
import random
random.seed(1)
print(random.sample(sorted(easy), 60))
