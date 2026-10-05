$out = "F:\aitradingagent\logs\bridge-syntax-check.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
& "F:\aitradingagent\venv\Scripts\python.exe" -m py_compile "F:\aitradingagent\bridge\python_to_node.py" 2>&1 | Out-File $out -Append -Encoding utf8
"exit code: $LASTEXITCODE" | Out-File $out -Append -Encoding utf8
"--- first 10 lines of the file now ---" | Out-File $out -Append -Encoding utf8
Get-Content "F:\aitradingagent\bridge\python_to_node.py" -TotalCount 10 | Out-File $out -Append -Encoding utf8
"--- file info ---" | Out-File $out -Append -Encoding utf8
Get-Item "F:\aitradingagent\bridge\python_to_node.py" | Select-Object FullName, Length, LastWriteTime | Out-File $out -Append -Encoding utf8
