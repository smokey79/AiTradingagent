import os
import subprocess
import sys
from pathlib import Path

def create_shortcuts():
    project_root = Path("F:/aitradingagent").resolve()
    start_bat = project_root / "START_DASHBOARD_AND_AGENTS.bat"
    stop_bat = project_root / "STOP_DASHBOARD_AND_AGENTS.bat"
    icon_file = project_root / "icon.ico"
    
    # Identify Desktop directories (OneDrive and Standard Desktop and Environment desktop)
    user_home = Path(os.environ.get("USERPROFILE", "C:/Users/barcl"))
    desktop_candidates = [
        user_home / "OneDrive" / "Desktop",
        user_home / "Desktop",
        Path(os.environ.get("PUBLIC", "C:/Users/Public")) / "Desktop"
    ]
    
    # Filter only existing directories
    target_desktops = [d for d in desktop_candidates if d.exists()]
    
    if not target_desktops:
        target_desktops = [user_home / "Desktop"]
        target_desktops[0].mkdir(parents=True, exist_ok=True)
        
    print(f"Creating shortcuts on {len(target_desktops)} desktop locations:")
    for d in target_desktops:
        print(f" - {d}")
        
    vbs_lines = ['Set WshShell = CreateObject("WScript.Shell")\n']
    
    for d in target_desktops:
        # 1. Start AiTradingAgent.lnk
        vbs_lines.append(f'''
Set sc1 = WshShell.CreateShortcut("{str(d / 'Start AiTradingAgent.lnk')}")
sc1.TargetPath = "{str(start_bat)}"
sc1.WorkingDirectory = "{str(project_root)}"
sc1.Description = "Start AiTradingAgent Live Dashboard and Multi-Agent Trading Engine"
sc1.WindowStyle = 1
sc1.IconLocation = "{str(icon_file)},0"
sc1.Save
''')
        # 2. AiTradingAgent.lnk
        vbs_lines.append(f'''
Set sc2 = WshShell.CreateShortcut("{str(d / 'AiTradingAgent.lnk')}")
sc2.TargetPath = "{str(start_bat)}"
sc2.WorkingDirectory = "{str(project_root)}"
sc2.Description = "Start AiTradingAgent Live Dashboard and Multi-Agent Trading Engine"
sc2.WindowStyle = 1
sc2.IconLocation = "{str(icon_file)},0"
sc2.Save
''')
        # 3. AiTradingAgent - Dashboard & Agents.lnk
        vbs_lines.append(f'''
Set sc3 = WshShell.CreateShortcut("{str(d / 'AiTradingAgent - Dashboard & Agents.lnk')}")
sc3.TargetPath = "{str(start_bat)}"
sc3.WorkingDirectory = "{str(project_root)}"
sc3.Description = "Start AiTradingAgent Live Dashboard and Multi-Agent Trading Engine"
sc3.WindowStyle = 1
sc3.IconLocation = "{str(icon_file)},0"
sc3.Save
''')
        # 4. Stop AiTradingAgent.lnk
        vbs_lines.append(f'''
Set sc4 = WshShell.CreateShortcut("{str(d / 'Stop AiTradingAgent.lnk')}")
sc4.TargetPath = "{str(stop_bat)}"
sc4.WorkingDirectory = "{str(project_root)}"
sc4.Description = "Stop all AiTradingAgent Dashboard and Agent processes"
sc4.WindowStyle = 1
sc4.IconLocation = "shell32.dll,27"
sc4.Save
''')
        
    vbs_script = "".join(vbs_lines)
    vbs_path = project_root / "temp_create_shortcut.vbs"
    with open(vbs_path, "w", encoding="utf-8") as f:
        f.write(vbs_script)
        
    res = subprocess.run(["cscript.exe", "//nologo", str(vbs_path)], capture_output=True, text=True)
    
    if vbs_path.exists():
        vbs_path.unlink()
        
    print("VBS output:", res.stdout)
    if res.returncode == 0:
        print("[OK] All Desktop shortcuts successfully created & updated!")
    else:
        print("[ERROR] Error creating shortcuts:", res.stderr)
        
if __name__ == "__main__":
    create_shortcuts()
