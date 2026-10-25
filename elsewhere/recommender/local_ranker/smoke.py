"""Offline real-weight smoke test, run before production activation."""
import tempfile
import time
from service import Encoder, Ranker

with tempfile.TemporaryDirectory() as folder:
    started = time.monotonic()
    encoder = Encoder('/model')
    ranker = Ranker(folder + '/cache.sqlite3', encoder)
    request = {'query': '寻找研究机器人视觉导航的合作伙伴', 'documents': [
        '周末烘焙活动：一起制作巧克力蛋糕和饼干。',
        '机器人视觉导航研究：招募合作伙伴，一起研究机器人自主导航和视觉感知。']}
    first = ranker.rank(request)
    assert first['results'][0]['index'] == 1, 'semantic/lexical relevance failed'
    assert ranker.metrics['encoded_texts'] == 3
    assert ranker.rank(request) == first
    assert ranker.metrics['result_hits'] == 1
    ranker.db.close()
    restored = Ranker(folder + '/cache.sqlite3', encoder)
    assert restored.rank(request) == first
    assert restored.metrics['encoded_texts'] == 0
    request['documents'][0] += '欢迎参加。'
    restored.rank(request)
    assert restored.metrics['encoded_texts'] == 1, 'incremental encoding failed'
    print({'real_model_smoke': 'passed', 'elapsed_seconds': round(time.monotonic() - started, 3),
           'restart_cache_hit': True, 'changed_texts_encoded': 1})
