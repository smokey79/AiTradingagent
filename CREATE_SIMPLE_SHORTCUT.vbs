' Create second shortcut for simple launcher
Set objShell = CreateObject("WScript.Shell")
Set objShortcut = objShell.CreateShortcut("C:\Users\barcl\OneDrive\Desktop\AiTradingAgent-Simple.lnk")

objShortcut.TargetPath = "cmd.exe"
objShortcut.Arguments = "/k F:\aitradingagent\LAUNCH_SIMPLE.bat"
objShortcut.WorkingDirectory = "F:\aitradingagent"
objShortcut.Description = "Launch AiTradingAgent (Simple Mode)"
objShortcut.IconLocation = "C:\Windows\System32\cmd.exe, 0"

objShortcut.Save()

WScript.Echo "Shortcut created: AiTradingAgent-Simple.lnk"
