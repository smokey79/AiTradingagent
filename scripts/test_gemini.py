"""Find which OpenRouter free model actually responds for this account"""
import json, urllib.request, urllib.error
from pathlib import Path

env = {}
for line in Path(r'F:\aitradingagent\.env').read_text(errors='ignore').splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k,v = line.split('=',1); env[k.strip()] = v.strip()

k = env.get('OPENROUTER_API_KEY','')
PING = 'Reply only: OK'

free_models = [
    'liquid/lfm-2.5-2.6b:free',
    'nvidia/nemotron-3.5-lightning:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'thinkingmachines/inkling-small:free',
    'google/gemma-4-26b-a4b-it:free',
    'google/gemma-4-31b-it:free',
    'inclusionai/ling-3.0-flash-fin:free',
    'poolside/laguna-xs-2.1:free',
]

print("Testing OpenRouter free models (with data_collection allow)...")
print("="*60)
working = []
for mdl in free_models:
    try:
        req = urllib.request.Request(
            'https://openrouter.ai/api/v1/chat/completions',
            data=json.dumps({
                'model': mdl,
                'max_tokens': 10,
                'messages': [{'role':'user','content': PING}],
                'provider': {'data_collection': 'allow', 'allow_fallbacks': True}
            }).encode(),
            headers={'Authorization': f'Bearer {k}', 'Content-Type':'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read())
            txt = d.get('choices',[])[0].get('message',{}).get('content','(empty)')
            print(f'  PASS  {mdl}  -> {txt[:30]}')
            working.append(mdl)
            break  # Stop at first working one
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:120]
        print(f'  FAIL  {mdl}: HTTP {e.code} {body[:80]}')
    except Exception as e:
        print(f'  ERROR {mdl}: {e}')

if working:
    print(f'\n>>> Working model: {working[0]}')
    print(f'Set in .env: OPENROUTER_FREE_MODEL={working[0]}')
else:
    print('\nNo free models worked. May need to add credits.')
    print('Add $1 at https://openrouter.ai/credits')
