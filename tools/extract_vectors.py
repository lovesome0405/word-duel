"""고른 단어들의 fastText 벡터를 계산해 int8로 양자화한다.
fastText get_word_vector = (단어 행 + 문자 n-gram 행들)의 평균. n-gram 해시는 FNV-1a(바이트를 int8로 부호확장).
출력:
  words.json  : {"w": [...단어], "p": "nnv..."(품사), "c": [랜덤출제 후보 인덱스]}
  vectors.bin : 단어마다 300바이트 int8 (L2 정규화 후 127배)"""
import pickle, json, sys
import numpy as np

d = pickle.load(open(sys.argv[1], 'rb'))
vocab = json.load(open(sys.argv[2]))
out_dir = sys.argv[3]
dim, nwords, bucket, minn, maxn, off = d['dim'], d['nwords'], d['bucket'], d['minn'], d['maxn'], d['offset']
mat = np.memmap(sys.argv[4], dtype='<f4', mode='r', offset=off, shape=(nwords + bucket, dim))


def fnv(b: bytes) -> int:
    h = 2166136261
    for c in b:
        if c >= 128:
            c = (c - 256) & 0xFFFFFFFF  # int8 부호확장 후 uint32
        h = ((h ^ c) * 16777619) & 0xFFFFFFFF
    return h


def ngram_ids(word: str):
    b = ('<' + word + '>').encode('utf-8')
    ids = []
    for i in range(len(b)):
        if (b[i] & 0xC0) == 0x80:
            continue
        j, n, g = i, 1, bytearray()
        while j < len(b) and n <= maxn:
            g.append(b[j]); j += 1
            while j < len(b) and (b[j] & 0xC0) == 0x80:
                g.append(b[j]); j += 1
            if n >= minn and not (n == 1 and (i == 0 or j == len(b))):
                ids.append(nwords + fnv(bytes(g)) % bucket)
            n += 1
    return ids


vecs = np.zeros((len(vocab), dim), dtype=np.float32)
for k, row in enumerate(vocab):
    w, idx = row[0], row[1]
    rows = [idx] + ngram_ids(w)
    vecs[k] = np.asarray(mat[rows]).mean(axis=0)
vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
np.save(out_dir + '/vecs_f32.npy', vecs)
q = np.clip(np.round(vecs * 127), -127, 127).astype(np.int8)
q.tofile(out_dir + '/vectors.bin')
meta = {"w": [v[0] for v in vocab], "p": ''.join(v[2] for v in vocab),
        "c": [k for k, v in enumerate(vocab) if v[3] and v[2] == 'n'],
        "e": [k for k, v in enumerate(vocab) if len(v) > 4 and v[4]]}
json.dump(meta, open(out_dir + '/words.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('saved', q.shape, 'common', len(meta['c']))
