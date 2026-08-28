
import google.generativeai as genai
import os
import subprocess
import time

# --- CONFIGURATION ---
# I have put your key here for you
genai.configure(api_key="AQ.Ab8RN6Ja7AfcY4J4R_C8aO-336OBaxGWZaJTls7k5Ty20QmTIg")
PROJECT_DIR = "F:\\AI-Trading-Agent"

# Ensure directory exists
if not os.path.exists(PROJECT_DIR):
    os.makedirs(PROJECT_DIR)

def write_file(filename: str, content: str):
    """Writes code to the F:\AI-Trading-Agent folder."""
    path = os.path.join(PROJECT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return f"Successfully wrote to {filename}"

def execute_command(command: str):
    """Executes a shell command and returns the output."""
    try:
        result = subprocess.run(
            f"cmd /c {command}", shell=True, cwd=PROJECT_DIR, 
            capture_output=True, text=True, timeout=120
        )
        return f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}"
    except Exception as e:
        return f"Error: {str(e)}"

def read_file(filename: str):
    """Reads a file from the project directory."""
    try:
        with open(os.path.join(PROJECT_DIR, filename), "r") as f:
            return f.read()
    except Exception as e:
        return f"Error: {str(e)}"

# Initialize Gemini with Tools
tools = [write_file, execute_command, read_file]
model = genai.GenerativeModel(model_name='gemini-1.5-pro', tools=tools)
chat = model.start_chat(enable_automatic_function_calling=True)

def run_automation(prompt):
    print(f"🚀 Executing: {prompt}")
    response = chat.send_message(prompt)
    print(f"🤖 Gemini: {response.text}")

if __name__ == "__main__":
    goal = """
    1. Create a 'requirements.txt' with pandas and ccxt.
    2. Install those requirements using pip.
    3. Create a 'main.py' that prints 'Trading Agent Active' and fetches the current BTC price using ccxt (Binance).
    4. Execute 'main.py' to verify it works.
    """
    run_automation(goal)