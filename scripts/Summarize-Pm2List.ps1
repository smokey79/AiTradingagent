$json = pm2 jlist | Out-String
$apps = $json | ConvertFrom-Json
$out = "F:\aitradingagent\logs\pm2-summary.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
foreach ($a in $apps) {
  "$($a.pm_id) | $($a.name) | restarts=$($a.pm2_env.restart_time) | script=$($a.pm2_env.pm_exec_path) | interpreter=$($a.pm2_env.exec_interpreter)" |
    Out-File $out -Append -Encoding utf8
}
