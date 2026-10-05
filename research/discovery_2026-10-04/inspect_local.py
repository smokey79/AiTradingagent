"""Read research metadata and summaries without revealing private conversation data."""
import csv
import datetime as dt
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
CACHE = pathlib.Path('F:/aitradingagent/data/ohlcv')
inventory = []
for p in sorted(CACHE.glob('pyb_*_15m.csv')):
    with p.open(newline='') as handle:
        rows = list(csv.DictReader(handle))
    if not rows: continue
    inventory.append({'file':str(p),'rows':len(rows),'start':dt.datetime.fromtimestamp(int(rows[0]['timestamp'])/1000,dt.timezone.utc).isoformat(),'end':dt.datetime.fromtimestamp(int(rows[-1]['timestamp'])/1000,dt.timezone.utc).isoformat()})
(ROOT/'cache_inventory.json').write_text(json.dumps(inventory,indent=2),encoding='utf-8')
print(json.dumps(inventory,indent=2))
p = pathlib.Path('F:/Prodjects/projects/019cbd04-ddb7-76ce-a913-c2decae3aab3.json')
project = json.loads(p.read_text(encoding='utf-8-sig'))
docs = project.get('docs',[])
print('project_doc_type',type(docs).__name__,'project_doc_count',len(docs))
safe = []
def visit(value):
    if isinstance(value,dict):
        for key,item in value.items():
            if isinstance(item,str) and key.lower() in ('title','name','filename') and re.search(r'(?i)(strategy|backtest|research|trade|indicator|ema)',item):
                safe.append(re.sub(r'(sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+)', '[private]',item)[:160])
            elif isinstance(item,(dict,list)):visit(item)
    elif isinstance(value,list):
        for item in value:visit(item)
visit(docs)
(ROOT/'project_research_titles.json').write_text(json.dumps(safe,indent=2),encoding='utf-8')
print('project_research_titles',json.dumps(safe[:25]))
