# grep_log.ps1 -- READ-ONLY. Print lines of a log matching a regex, with optional context. Usage: -Pattern re [-Log path] [-Context 2] [-Max 30]
param([Parameter(Mandatory=$true)][string]$Pattern, [string]$Log = 'F:\aitradingagent\logs\tests_sandbox_latest.txt', [int]$Context = 2, [int]$Max = 30)
Select-String -Path $Log -Pattern $Pattern -Context $Context,$Context | Select-Object -First $Max | ForEach-Object {
  "-----"
  $_.Context.PreContext | ForEach-Object { $t = $_; if ($t.Length -gt 220) { $t = $t.Substring(0,220) }; "  | $t" }
  $m = $_.Line; if ($m.Length -gt 220) { $m = $m.Substring(0,220) }; "  >> $m"
  $_.Context.PostContext | ForEach-Object { $t = $_; if ($t.Length -gt 220) { $t = $t.Substring(0,220) }; "  | $t" }
}
