' ================================================================
' CREATE_DESKTOP_SHORTCUT.VBS
' Creates a Windows desktop shortcut for AiTradingAgent full stack
' Run: cscript.exe CREATE_DESKTOP_SHORTCUT.vbs
' ================================================================

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Define paths
strDesktopPath = objShell.SpecialFolders("Desktop")
strProjectRoot = "F:\aitradingagent"
strLaunchScript = strProjectRoot & "\launch-full-stack.bat"
strIconPath = strProjectRoot & "\icon.ico"

' Verify launch script exists
If Not objFSO.FileExists(strLaunchScript) Then
    WScript.Echo "ERROR: launch-full-stack.bat not found at " & strLaunchScript
    WScript.Quit(1)
End If

' Create shortcut
strShortcutPath = strDesktopPath & "\AiTradingAgent.lnk"
Set objShortcut = objShell.CreateShortcut(strShortcutPath)

objShortcut.TargetPath = "cmd.exe"
objShortcut.Arguments = "/k """ & strLaunchScript & """"
objShortcut.WorkingDirectory = strProjectRoot
objShortcut.WindowStyle = 1  ' Normal window
objShortcut.Description = "Launch AiTradingAgent Full Stack (MCP servers, dashboard, backtester, visualizers)"

' Set icon if it exists
If objFSO.FileExists(strIconPath) Then
    objShortcut.IconLocation = strIconPath & ", 0"
Else
    ' Use command prompt icon
    objShortcut.IconLocation = "C:\Windows\System32\cmd.exe, 0"
End If

objShortcut.Save

WScript.Echo "SUCCESS: Desktop shortcut created at " & strShortcutPath
WScript.Echo ""
WScript.Echo "Shortcut details:"
WScript.Echo "  Name: AiTradingAgent"
WScript.Echo "  Target: " & strLaunchScript
WScript.Echo "  Working Directory: " & strProjectRoot
WScript.Echo ""
WScript.Echo "You can now double-click the shortcut to launch the full stack!"
