import os
import subprocess
from pathlib import Path

user_home = Path(os.environ.get('USERPROFILE', 'C:/Users/barcl'))
desktop_candidates = [
    user_home / 'OneDrive' / 'Desktop',
    user_home / 'Desktop',
]

target_desktops = [d for d in desktop_candidates if d.exists()]
if not target_desktops:
    target_desktops = [user_home / 'Desktop']
    target_desktops[0].mkdir(parents=True, exist_ok=True)

project_root = Path('F:/aitradingagent').resolve()
start_bat = project_root / 'START_DASHBOARD_AND_AGENTS.bat'
icon_file = project_root / 'icon.ico'

vbs_lines = ['Set WshShell = CreateObject("WScript.Shell")\n']
for d in target_desktops:
    vbs_lines.append(f'''
Set sc = WshShell.CreateShortcut("{str(d / 'demoAITMLLM.lnk')}")
sc.TargetPath = "{str(start_bat)}"
sc.WorkingDirectory = "{str(project_root)}"
sc.Description = "Start demoAITMLLM Live Trading"
sc.WindowStyle = 1
sc.IconLocation = "{str(icon_file)},0"
sc.Save
''')

vbs_file = project_root / 'create_demo_btn.vbs'
vbs_file.write_text('\n'.join(vbs_lines), encoding='utf-8')
subprocess.run(['cscript', '//nologo', str(vbs_file)], check=True)
os.remove(vbs_file)
print('Demo start button created successfully on Desktop(s).')
