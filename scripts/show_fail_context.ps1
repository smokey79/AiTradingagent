# show_fail_context.ps1 -- READ-ONLY. Prints lines around each FAIL in a test log. Usage: -Log path [-Before 8]
param([string]$Log = 'F:\aitradingagent\logs\tests_sandbox_latest.txt', [int]$Before = 8)
Select-String -Path $Log -Pattern 'FAIL:' -CaseSensitive -Context $Before,2 | Where-Object { $_.Line -notmatch 'CategoryInfo' -and $_.Line -notmatch 'node :' } | ForEach-Object {
  "-----"
  $_.Context.PreContext | ForEach-Object { $t = $_; if ($t.Length -gt 200) { $t = $t.Substring(0,200) }; "  | $t" }
  "  >> " + $_.Line
  $_.Context.PostContext | ForEach-Object { $t = $_; if ($t.Length -gt 200) { $t = $t.Substring(0,200) }; "  | $t" }
}
