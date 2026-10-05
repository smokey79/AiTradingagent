"""Extract only research structure, never credential literals or project text."""
import ast,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
path=Path(r'F:\Prodjects\projects\019cbd04-ddb7-76ce-a913-c2decae3aab3.json')
d=json.loads(path.read_text(encoding='utf-8'));rows=[]
for doc in d.get('docs',[]):
    text=doc.get('content','');name=doc.get('filename','')
    names=[];imports=[]
    if name.endswith('.py'):
        try:
            tree=ast.parse(text)
            names=[n.name for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))]
            imports=[n.module for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)]
        except SyntaxError:pass
    concepts=[x for x in ['arbitrage','slippage','gas','bridge','liquidity','backtest','stop_loss','take_profit','drawdown','funding','risk','profit','orderbook','momentum','EMA','VWAP'] if re.search(re.escape(x),text,re.I)]
    rows.append({'filename':name,'characters':len(text),'symbols':names,'concepts':concepts,'research_only':True})
(ROOT/'prior_project_review.json').write_text(json.dumps({'path':str(path),'documents_reviewed':len(rows),'documents':rows,'conclusion':'Project contains multichain/arbitrage, DEX-feed, gas-optimizer and LLM-router code. No validated portfolio backtest or out-of-sample qualification evidence is established by these documents.'},indent=2))
print(json.dumps({'documents_reviewed':len(rows),'python_documents':sum(r['filename'].endswith('.py') for r in rows)}))
