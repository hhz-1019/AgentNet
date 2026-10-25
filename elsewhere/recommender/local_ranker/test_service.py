import concurrent.futures
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
import numpy as np
from service import Ranker, fingerprint, lexical_scores, reciprocal_ranks, serve


class FakeEncoder:
    def __init__(self):
        self.calls = []

    def __call__(self, texts):
        self.calls.extend(texts)
        rows = []
        for text in texts:
            row = np.zeros(512, dtype=np.float32)
            row[int(fingerprint(text)[:4], 16) % 512] = 1
            rows.append(row)
        return np.asarray(rows)


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'cache.db')
        self.encoder = FakeEncoder()
        self.now = [2000000000]
        self.ranker = Ranker(self.path, self.encoder, lambda: self.now[0])
        self.request = dict(query='机器人交互', documents=['机器人研究', '校园散步', '开源代码'])

    def tearDown(self):
        self.ranker.db.close()
        self.tmp.cleanup()

    def test_restart_and_incremental_text_query_and_order(self):
        result = self.ranker.rank(self.request)
        self.assertEqual(len(self.encoder.calls), 4)
        self.assertEqual(self.ranker.rank(self.request), result)
        self.ranker.db.close()
        self.ranker = Ranker(self.path, self.encoder, lambda: self.now[0])
        self.assertEqual(self.ranker.rank(self.request), result)
        self.assertEqual(len(self.encoder.calls), 4)
        edited = {**self.request, 'documents': ['机器人研究', '校园散步修改', '开源代码']}
        self.ranker.rank(edited)
        self.assertEqual(len(self.encoder.calls), 5, 'only changed document is encoded')
        self.ranker.rank({**edited, 'query': '新的兴趣'})
        self.assertEqual(len(self.encoder.calls), 6)
        self.ranker.rank({**edited, 'documents': list(reversed(edited['documents']))})
        self.assertEqual(len(self.encoder.calls), 6, 'changed Gorse prior invalidates results, not embeddings')
        self.now[0] += 21601
        self.ranker.rank(edited)
        self.assertEqual(len(self.encoder.calls), 6, 'expired results reuse persisted vectors')

    def test_concurrent_duplicate_misses_encode_once(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.ranker.rank(self.request), range(16)))
        self.assertEqual(len(self.encoder.calls), 4)
        self.assertTrue(all(result == results[0] for result in results))

    def test_bad_model_is_not_cached_as_success(self):
        self.ranker.encoder = lambda texts: np.zeros((len(texts), 1))
        with self.assertRaises(ValueError):
            self.ranker.rank(self.request)
        self.assertEqual(self.ranker.db.execute('SELECT count(*) FROM results').fetchone()[0], 0)
        self.ranker.encoder = self.encoder
        self.assertEqual(len(self.ranker.rank(self.request)['results']), 3)

    def test_limits_empty_profile_and_duplicate_content(self):
        result = self.ranker.rank(dict(query='', documents=['a', 'b']))
        self.assertEqual([x['index'] for x in result['results']], [0, 1])
        self.assertEqual(self.encoder.calls, [])
        self.ranker.rank(dict(query='q', documents=['same', 'same']))
        self.assertEqual(len(self.encoder.calls), 2)
        for request in [dict(query='q', documents=['x'] * 501), dict(query='q', documents=['x' * 4001]), dict(query='x' * 12001, documents=['x']), dict(query='q', documents=['x'], top_n=-1)]:
            with self.assertRaises(ValueError):
                self.ranker.rank(request)

    def test_lexical_terms_and_equal_signal(self):
        scores = lexical_scores('Caddy反向代理', ['校园聊天', 'Caddy反向代理配置'])
        self.assertGreater(scores[1], scores[0])
        self.assertTrue(np.all(reciprocal_ranks([.5, .5]) == reciprocal_ranks([.5, .5])[0]))

    def test_http_readiness_and_validation(self):
        server = serve(self.ranker, ('127.0.0.1', 0))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            with urllib.request.urlopen(base + '/health') as response:
                self.assertEqual(json.load(response)['status'], 'ready')
            request = urllib.request.Request(base + '/v1/rerank', data=json.dumps(self.request).encode(), headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(len(json.load(response)['results']), 3)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(base + '/v1/rerank', data=b'[]'))
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
