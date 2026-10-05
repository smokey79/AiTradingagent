import requests,json,re
from pathlib import Path
r=requests.get('https://coinmarketcap.com/historical/20240204/',timeout=25)
Path('cmc_probe.html').write_text(r.text,encoding='utf-8')
m=re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>',r.text,re.S)
print(json.dumps({'status':r.status_code,'bytes':len(r.content),'next_data':bool(m)}))
if m:
    data=json.loads(m.group(1));Path('cmc_probe.json').write_text(json.dumps(data));print(json.dumps({'keys':list(data),'props_keys':list(data.get('props',{}))}))
