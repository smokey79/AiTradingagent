
import google.generativeai as genai
import os
import subprocess
import time

# --- CONFIGURATION ---
genai.configure(api_key="YOUR_GEMINI_API_KEY")
PROJECT_DIR = "F:\\AI-Trading-Agent"
if not os.path.exists(PROJECT_DIR):
    os.makedirs(PROJECT_DIR)

# --- THE TOOLS (The "Hands" of Gemini) ---
def write_file(filename: str, content: str):
    """Writes or overwrites a file in the project directory."""
    path = os.path.join(PROJECT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return f"Successfully wrote to {filename}"

def execute_command(command: str):
    """Executes a shell command and returns the output."""
    try:
        result = subprocess.run(
            command, shell=True, cwd=PROJECT_DIR, 
            capture_output=True, text=True, timeout=60
        )
        return f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}"
    except Exception as e:
        return f"Error executing command: {str(e)}"

def read_file(filename: str):
    """Reads a file to analyze logs or existing code."""
    try:
        with open(os.path.join(PROJECT_DIR, filename), "r") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"

# --- THE BRAIN (Gemini) ---
tools = [write_file, execute_command, read_file]
model = genai.GenerativeModel(
    model_name='gemini-1.5-pro', # Use Pro for complex coding tasks
    tools=tools
)

# Enable automatic function calling (The "Automation" part)
chat = model.start_chat(enable_automatic_function_calling=True)

def run_automation(prompt):
    print(f"🚀 Starting Task: {prompt}")
    response = chat.send_message(prompt)
    print(f"🤖 Gemini: {response.text}")

# --- EXECUTION ---
if __name__ == "__main__":
    # This is where you give the "Master Command"
    master_goal = """
    1. Initialize a Python trading environment on F:\AI-Trading-Agent.
    2. Create a requirements.txt with 'ccxt' and 'pandas'.
    3. Run 'pip install -r requirements.txt'.
    4. Create a basic 'main.py' that fetches BTC/USDT price from Binance.
    5. Run 'main.py' and verify it works. If it fails, fix the code and try again.
    """
    run_automation(master_goal)