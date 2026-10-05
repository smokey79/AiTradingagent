# check_signals_2026-10-03.ps1 -- READ-ONLY. Freshness of the Node->Freqtrade signal file and the meta-evaluator code at the reported error line.
$p = 'F:\aitradingagent\data\freqtrade_signals.json'
"signals file: modified " + (Get-Item $p).LastWriteTime + "  size " + (Get-Item $p).Length
$j = Get-Content $p -Raw | ConvertFrom-Json
"updatedAt in file: " + $j.updatedAt + " | pairs: " + ($j.signals.PSObject.Properties.Name.Count)
"first 5 pairs:"; $j.signals.PSObject.Properties | Select-Object -First 5 | ForEach-Object { "  {0}: {1} conf={2} approved={3}" -f $_.Name, $_.Value.signal, $_.Value.confidence, $_.Value.approved }
"now: " + (Get-Date)
"--- metaEvaluatorAgent.js lines 96-110"
$i = 0; Get-Content F:\aitradingagent\src\agents\metaEvaluatorAgent.js | ForEach-Object { $i++; if ($i -ge 96 -and $i -le 110) { "{0,4}: {1}" -f $i, $_ } }
"--- consensus.js lines 392-402"
$i = 0; Get-Content F:\aitradingagent\src\orchestrator\consensus.js | ForEach-Object { $i++; if ($i -ge 392 -and $i -le 402) { "{0,4}: {1}" -f $i, $_ } }
