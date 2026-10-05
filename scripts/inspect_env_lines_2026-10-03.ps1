# inspect_env_lines_2026-10-03.ps1 -- READ-ONLY. Shows how given names appear in .env with every value MASKED (length only), plus where the code reads them.
param([string[]]$Names = @('CLAUDE_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY'))
$i = 0
Get-Content F:\aitradingagent\.env | ForEach-Object {
  $i++
  foreach ($n in $Names) {
    if ($_ -match "^(\s*#?\s*(export\s+)?)$n(\s*=\s*)(.*)$") { "{0,4}: {1}{2}{3}<value len {4}{5}>" -f $i, $Matches[1], $n, $Matches[3], $Matches[4].Length, $(if ($Matches[4] -match '^\s*#') { ', comment' } else { '' }) }
  }
}
"--- code reads:"
foreach ($n in $Names) {
  Get-ChildItem F:\aitradingagent\src, F:\aitradingagent\agents, F:\aitradingagent\core -Recurse -Include *.js, *.py -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules|assets' } |
    Select-String -Pattern $n -SimpleMatch | Select-Object -First 4 | ForEach-Object { "{0}: {1}:{2}  {3}" -f $n, $_.Path.Replace('F:\aitradingagent\', ''), $_.LineNumber, ($_.Line.Trim().Substring(0, [Math]::Min(110, $_.Line.Trim().Length))) }
}
