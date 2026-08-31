import sys
try:
    from PIL import Image
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

try:
    img = Image.open(r"C:\Users\barcl\.gemini\antigravity-ide\brain\c05076cd-2586-4365-9bfe-9610f900b98b\trading_agent_icon_1788129817647.jpg")
    img.save(r"f:\aitradingagent\trading_agent_icon.ico", format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {str(e)}")
