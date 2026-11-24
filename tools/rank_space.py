"""순위 계산 범위(r): wordfreq 한국어 목록 ∪ 꼬오맨틀 빈도 목록에 있는 단어만.
(꼬오맨틀이 국어사전 단어끼리만 순위를 매기는 것과 같은 취지) — words.json에 "r" 추가"""
import json, sys, unicodedata
from wordfreq import get_frequency_dict
p, koo = sys.argv[1], sys.argv[2]
m = json.load(open(p))
fd = get_frequency_dict('ko')
fw = {unicodedata.normalize('NFC', l.strip()) for l in open(koo, encoding='utf-8') if not l.startswith('#')}
m['r'] = [i for i, w in enumerate(m['w']) if (w in fd or w in fw)]
json.dump(m, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))
print('rank space', len(m['r']), '/', len(m['w']))
