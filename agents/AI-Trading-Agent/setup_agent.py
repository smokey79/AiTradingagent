import os
import subprocess
import time

PROJECT_DIR = r"F:\AI-Trading-Agent"
os.makedirs(PROJECT_DIR, exist_ok=True)

def write_file(filename: str, content: str):
    path = os.path.join(PROJECT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Created file: {path}")

print("Project folder initialized at:", PROJECT_DIR)
