"""fastText .bin 헤더와 단어 사전을 읽어 pickle로 저장한다.
행렬(벡터) 시작 오프셋도 함께 기록해 두면 나중에 mmap으로 필요한 행만 읽을 수 있다."""
import struct, sys, pickle

path, out = sys.argv[1], sys.argv[2]
f = open(path, 'rb')
magic, version = struct.unpack('<ii', f.read(8))
assert magic == 793712314, magic
(dim, ws, epoch, min_count, neg, word_ngrams, loss, model, bucket,
 minn, maxn, lr_update) = struct.unpack('<12i', f.read(48))
(t,) = struct.unpack('<d', f.read(8))
size, nwords, nlabels = struct.unpack('<3i', f.read(12))
ntokens, prune_size = struct.unpack('<qq', f.read(16))
print(dict(dim=dim, bucket=bucket, minn=minn, maxn=maxn, size=size, nwords=nwords))

data = f.read(200_000_000)  # 사전은 앞쪽 수십 MB 안에 있음
pos = 0
words, counts = [], []
for _ in range(size):
    end = data.index(b'\x00', pos)
    w = data[pos:end]
    cnt, typ = struct.unpack_from('<qb', data, end + 1)
    pos = end + 1 + 9
    words.append(w.decode('utf-8', 'replace'))
    counts.append(cnt)
pos += prune_size * 8 if prune_size > 0 else 0
quant = data[pos]; pos += 1
assert quant == 0
m, n = struct.unpack_from('<qq', data, pos); pos += 16
header_len = 8 + 48 + 8 + 12 + 16
matrix_offset = header_len + pos
print('matrix', m, n, 'offset', matrix_offset)
assert n == dim and m == nwords + bucket
pickle.dump(dict(words=words, counts=counts, dim=dim, bucket=bucket, minn=minn,
                 maxn=maxn, nwords=nwords, offset=matrix_offset), open(out, 'wb'))
