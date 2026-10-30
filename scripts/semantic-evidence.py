"""Rank already-authorised evidence locally. Model downloads are deliberately disabled."""
import json
import sys
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer, logging

logging.set_verbosity_error()
request = json.load(sys.stdin)
model_id = 'intfloat/multilingual-e5-small'
tokenizer = AutoTokenizer.from_pretrained(model_id, local_files_only=True)
model = AutoModel.from_pretrained(model_id, local_files_only=True).eval()


def encode(texts):
    inputs = tokenizer(texts, max_length=512, padding=True, truncation=True, return_tensors='pt')
    with torch.inference_mode():
        hidden = model(**inputs).last_hidden_state
    mask = inputs['attention_mask'].unsqueeze(-1)
    return F.normalize((hidden * mask).sum(1) / mask.sum(1), p=2, dim=1)


rows = request['rows']
vectors = torch.cat([encode(['passage: ' + row['text'] for row in rows[i:i + 16]])
                     for i in range(0, len(rows), 16)])
scores = (encode(['query: ' + request['query']]) @ vectors.T)[0]
print(json.dumps([{'id': rows[i]['id'], 'score': scores[i].item()}
                  for i in torch.argsort(scores, descending=True)[:8].tolist()]))
