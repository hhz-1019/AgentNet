"""Offline BGE + lexical + Gorse prior fusion. No provider credentials or API calls."""
import os
os.environ.update(OMP_NUM_THREADS="1", MKL_NUM_THREADS="1", TOKENIZERS_PARALLELISM="false",
                  HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
import hashlib
import json
import re
import sqlite3
import threading
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np

MODEL_REVISION = "7999e1d3359715c523056ef9478215996d62a620"
VERSION = "bge-" + MODEL_REVISION + "-hybrid-v1"
INSTRUCTION = "为这个句子生成表示以用于检索相关文章："
MAX_DOCUMENTS = 500


class Encoder:
    def __init__(self, path):
        import torch
        from transformers import AutoModel, AutoTokenizer
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
        self.model = AutoModel.from_pretrained(path, local_files_only=True, use_safetensors=True).eval()

    def __call__(self, texts):
        output = []
        with self.torch.inference_mode():
            for start in range(0, len(texts), 8):
                batch = self.tokenizer(texts[start:start + 8], padding=True, truncation=True,
                                       max_length=512, return_tensors="pt")
                vectors = self.model(**batch).last_hidden_state[:, 0]
                output.extend(self.torch.nn.functional.normalize(vectors, p=2, dim=1).numpy())
        return np.asarray(output, dtype=np.float32)


def fingerprint(value):
    return hashlib.sha256(json.dumps([VERSION, value], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def terms(text):
    text = re.sub(r"\s+", "", text.lower())
    return Counter(list(text) + [text[i:i + 2] for i in range(len(text) - 1)])


def lexical_scores(query, documents):
    counts = [terms(text) for text in documents]
    df = Counter(term for count in counts for term in count)
    idf = {term: np.log((1 + len(documents)) / (1 + n)) + 1 for term, n in df.items()}
    q = {term: n * idf.get(term, 0) for term, n in terms(query).items()}
    qnorm = sum(v * v for v in q.values()) ** .5
    scores = []
    for count in counts:
        d = {term: n * idf[term] for term, n in count.items()}
        denom = qnorm * sum(v * v for v in d.values()) ** .5
        scores.append(sum(v * q.get(term, 0) for term, v in d.items()) / denom if denom else 0)
    return np.asarray(scores)


def reciprocal_ranks(scores):
    # Equal signals get equal contributions; original order only breaks final ties.
    values = sorted(set(float(x) for x in scores), reverse=True)
    ranks = {v: 1 + sum(float(x) > v for x in scores) for v in values}
    return np.asarray([1 / (60 + ranks[float(x)]) for x in scores])


class Ranker:
    def __init__(self, path, encoder, clock=time.time):
        self.encoder, self.clock = encoder, clock
        self.lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False, timeout=5)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, value BLOB NOT NULL, used REAL NOT NULL);"
                             "CREATE TABLE IF NOT EXISTS results (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires REAL NOT NULL);")
        self.metrics = dict(requests=0, result_hits=0, vector_hits=0, encoded_texts=0, failures=0)
        self.last_cleanup = 0

    def vectors(self, texts):
        keys = [fingerprint(text) for text in texts]
        unique = dict(zip(keys, texts))
        found = {}
        for key in unique:
            row = self.db.execute("SELECT value FROM vectors WHERE key=?", (key,)).fetchone()
            if row:
                v = np.frombuffer(row[0], dtype=np.float32)
                if v.shape == (512,) and np.isfinite(v).all():
                    found[key] = v
                    self.metrics['vector_hits'] += 1
        missing = [key for key in unique if key not in found]
        if missing:
            encoded = self.encoder([unique[key] for key in missing])
            if encoded.shape != (len(missing), 512) or not np.isfinite(encoded).all():
                raise ValueError("invalid embedding output")
            for key, vector in zip(missing, encoded):
                found[key] = vector
                self.db.execute("INSERT OR REPLACE INTO vectors VALUES (?,?,?)",
                                (key, vector.astype(np.float32).tobytes(), self.clock()))
            self.metrics['encoded_texts'] += len(missing)
        self.db.executemany("UPDATE vectors SET used=? WHERE key=?", [(self.clock(), key) for key in unique])
        return np.asarray([found[key] for key in keys])

    def rank(self, request):
        query, documents = request.get('query'), request.get('documents')
        if not isinstance(query, str) or len(query.encode()) > 12000 or not isinstance(documents, list) or not 1 <= len(documents) <= MAX_DOCUMENTS:
            raise ValueError("invalid request")
        if any(not isinstance(d, str) or len(d.encode()) > 4000 for d in documents) or sum(len(d.encode()) for d in documents) > 2000000:
            raise ValueError("invalid documents")
        top = request.get('top_n', len(documents))
        if type(top) is not int or top < 0:
            raise ValueError("invalid top_n")
        top = min(top or len(documents), len(documents))
        key = fingerprint([query, documents, top])
        # Serialize claims across requests, so concurrent cache misses encode only once.
        with self.lock, self.db:
            self.metrics['requests'] += 1
            row = self.db.execute("SELECT value FROM results WHERE key=? AND expires>?", (key, self.clock())).fetchone()
            if row:
                self.metrics['result_hits'] += 1
                return json.loads(row[0])
            prior = np.asarray([1 / (60 + i + 1) for i in range(len(documents))])
            if query.strip():
                # Full bounded excerpts retain useful details; content cache amortizes encoding.
                matrix = self.vectors(documents)
                qvec = self.vectors([INSTRUCTION + query])[0]
                semantic = reciprocal_ranks(matrix @ qvec)
                lexical_raw = lexical_scores(query, documents)
                lexical = reciprocal_ranks(lexical_raw) if np.max(lexical_raw) > 0 else 0
                scores = prior + semantic + lexical
            else:
                scores = prior
            order = sorted(range(len(documents)), key=lambda i: (-scores[i], i))[:top]
            response = {'model': VERSION, 'usage': {'total_tokens': 0}, 'results': [
                {'index': i, 'relevance_score': float(scores[i])} for i in order]}
            self.db.execute("INSERT OR REPLACE INTO results VALUES (?,?,?)", (key, json.dumps(response), self.clock() + 21600))
            if self.clock() - self.last_cleanup > 3600:
                self.db.execute("DELETE FROM results WHERE expires<?", (self.clock(),))
                self.db.execute("DELETE FROM vectors WHERE used<?", (self.clock() - 30 * 86400,))
                self.db.execute("DELETE FROM results WHERE key IN (SELECT key FROM results ORDER BY expires DESC LIMIT -1 OFFSET 10000)")
                self.db.execute("DELETE FROM vectors WHERE key IN (SELECT key FROM vectors ORDER BY used DESC LIMIT -1 OFFSET 100000)")
                self.last_cleanup = self.clock()
            return response


def serve(ranker, address=('0.0.0.0', 8090)):
    slots = threading.BoundedSemaphore(4)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log profiles, content, credentials, or request bodies.

        def setup(self):
            super().setup()
            self.connection.settimeout(65)

        def reply(self, status, body):
            encoded = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            if self.path == '/health':
                self.reply(200, {'status': 'ready', 'version': VERSION, **ranker.metrics})
            else:
                self.reply(404, {'error': 'not found'})

        def do_POST(self):
            if self.path != '/v1/rerank':
                self.reply(404, {'error': 'not found'})
                return
            if not slots.acquire(blocking=False):
                self.reply(503, {'error': 'busy'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 2200000:
                    raise ValueError('invalid size')
                request = json.loads(self.rfile.read(length))
                if not isinstance(request, dict):
                    raise ValueError('invalid object')
                self.reply(200, ranker.rank(request))
            except (ValueError, TypeError):
                self.reply(400, {'error': 'invalid request'})
            except Exception:
                ranker.metrics['failures'] += 1
                self.reply(503, {'error': 'local ranking unavailable'})
            finally:
                slots.release()

    return ThreadingHTTPServer(address, Handler)


if __name__ == '__main__':
    from pathlib import Path
    if Path('/model/REVISION').read_text().strip() != MODEL_REVISION:
        raise RuntimeError('model revision mismatch')
    ranker = Ranker('/cache/ranking.sqlite3', Encoder('/model'))
    serve(ranker).serve_forever()
