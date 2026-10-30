"""Offline synthetic benchmark; downloads the public model on first use.

This is an evaluation only, not the production retrieval implementation.
"""
import json
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
data = json.loads((ROOT / 'docs/retrieval-evaluation/keyword-baseline.json').read_text())
model_id = 'intfloat/multilingual-e5-small'
started = time.perf_counter()
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModel.from_pretrained(model_id).eval()
load_ms = (time.perf_counter() - started) * 1000


def encode(texts):
    inputs = tokenizer(texts, max_length=512, padding=True, truncation=True, return_tensors='pt')
    with torch.inference_mode():
        hidden = model(**inputs).last_hidden_state
    mask = inputs['attention_mask'].unsqueeze(-1)
    return F.normalize((hidden * mask).sum(1) / mask.sum(1), p=2, dim=1)


records = data['records']
start = time.perf_counter()
vectors = encode(['passage: ' + record['text'] for record in records])
index_ms = (time.perf_counter() - start) * 1000
results = []
for case in data['results']:
    start = time.perf_counter()
    query = encode(['query: ' + case['query']])
    scores = (query @ vectors.T)[0]
    elapsed = (time.perf_counter() - start) * 1000
    top = torch.argsort(scores, descending=True)[:5].tolist()
    hits = [records[i]['id'] for i in top]
    relevant = case['relevant']
    results.append({'category': case['category'], 'query': case['query'], 'relevant': relevant,
                    'hits': hits, 'scores': [round(scores[i].item(), 5) for i in top],
                    'recall': sum(i in hits for i in relevant) / len(relevant) if relevant else None,
                    'unlabelled': [i for i in hits if i not in relevant], 'elapsedMs': elapsed})

categories = {}
for category in dict.fromkeys(item['category'] for item in results):
    group = [item for item in results if item['category'] == category]
    recalls = [item['recall'] for item in group if item['recall'] is not None]
    categories[category] = {'cases': len(group), 'meanRecallAt5': sum(recalls) / len(recalls) if recalls else None,
                            'returnedUnlabelled': sum(len(item['unlabelled']) for item in group)}
out = {'model': model_id, 'description': 'Synthetic benchmark, raw top 5 without a relevance threshold; unlabelled results require human review. CPU timings exclude database/network and include model warm-up. No personal data or paid API used.',
       'loadMs': load_ms, 'indexMs': index_ms, 'categories': categories, 'results': results}
path = ROOT / 'docs/retrieval-evaluation/vector-baseline.json'
path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'loadMs': load_ms, 'indexMs': index_ms, 'categories': categories}, indent=2))
