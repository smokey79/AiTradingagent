$PythonCode = @"
import os

# Load .env file from the F:\AI-Trading-Agent\ directory
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    load_dotenv(env_path)
    print(f'[+] Loaded environment from: {env_path}')
except ImportError:
    print('[-] Note: python-dotenv not installed, relying on system environment variables.')

from google import genai
from google.genai import types

# 1. Force the environment to forget any Vertex/Cloud variables
os.environ.pop('GOOGLE_GENAI_USE_VERTEXAI', None)
os.environ.pop('GOOGLE_APPLICATION_CREDENTIALS', None)
os.environ.pop('GOOGLE_CLOUD_PROJECT', None)
os.environ.pop('GOOGLE_CLOUD_LOCATION', None)

# Fetch the keys that were just loaded
api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')

if not api_key:
    print('[-] Error: No API key found in environment variables.')
    exit()
else:
    print(f'[+] API Key detected!')

# 2. Initialize strictly in Developer API mode
client = genai.Client(api_key=api_key, vertexai=False)

def get_crypto_ticker(symbol: str) -> dict:
    return {'symbol': symbol, 'price': 64250.00}

config = types.GenerateContentConfig(
    tools=[get_crypto_ticker],
    temperature=0.2,
    system_instruction='You are an autonomous crypto market signal agent.'
)

try:
    print('[+] Initializing stateful Chat session...')
    chat = client.chats.create(model='gemini-2.5-pro', config=config)
    
    print('[+] Sending market analysis request...')
    response = chat.send_message('Analyze BTC/USDT market signal using current price.')
    
    print('\n=== RESPONSE ===')
    print(response.text)
except Exception as e:
    print('[-] Python Error:')
    print(e)
"@

Set-Content -Path "F:\AI-Trading-Agent\test_chat.py" -Value $PythonCode -Encoding UTF8
python F:\AI-Trading-Agent\test_chat.py