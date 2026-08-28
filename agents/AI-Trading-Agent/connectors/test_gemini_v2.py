# Load master.env file from the F:\AI-Trading-Agent\ directory
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'master.env')
    # Specify the custom path instead of defaulting to .env
    load_dotenv(dotenv_path=env_path)
    print(f'[+] Loaded environment from: {env_path}')
except ImportError:
    print('[-] Note: python-dotenv not installed, relying on system environment variables.')# Load master.env file from the F:\AI-Trading-Agent\ directory
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'master.env')
    # Specify the custom path instead of defaulting to .env
    load_dotenv(dotenv_path=env_path)
    print(f'[+] Loaded environment from: {env_path}')
except ImportError:
    print('[-] Note: python-dotenv not installed, relying on system environment variables.')$Code = @"
import os
from google import genai
from google.genai import types

# Force standard developer API
os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)
os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
os.environ.pop("GOOGLE_CLOUD_LOCATION", None)

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

# Initialize client explicitly disabling Vertex
client = genai.Client(api_key=api_key, vertexai=False)

def get_crypto_ticker(symbol: str) -> dict:
    """Fetches the latest ticker price and 24h volume for a given pair."""
    return {"symbol": symbol, "price": 64250.00}

config = types.GenerateContentConfig(
    tools=[get_crypto_ticker],
    temperature=0.2,
    system_instruction="You are an autonomous crypto market signal agent."
)

try:
    chat = client.chats.create(model="gemini-2.5-pro", config=config)
    response = chat.send_message("Analyze BTC/USDT market signal using current price.")
    print("[+] Success!")
    print(response.text)
except Exception as e:
    print("[-] Error:")
    print(e)
"@

Set-Content -Path "F:\AI-Trading-Agent\test_gemini_v2.py" -Value $Code -Encoding UTF8
python F:\AI-Trading-Agent\test_gemini_v2.py
import time

def execute_trade_cycle():
    """Executes a single pass of market analysis and trading."""
    try:
        print(f"\n[+] Starting analysis cycle at {time.strftime('%H:%M:%S')}")
        chat = client.chats.create(model='gemini-2.5-pro', config=config)
        
        # In a real scenario, you can inject live Bitget/Crypto.com data here
        response = chat.send_message('Analyze BTC/USDT market signal using current price.')
        
        print('\n=== AGENT DECISION ===')
        print(response.text)
        
        # TODO: Parse response.text and send API execute orders to Bitget/Crypto.com
        
    except Exception as e:
        print(f"[-] Cycle Error: {e}")

# --- AUTOMATION LOOP ---
if __name__ == "__main__":
    INTERVAL_MINUTES = 15  # Adjust based on your strategy timeframe
    print(f"[+] Automation started. Agent running every {INTERVAL_MINUTES} minutes.")
    
    while True:
        execute_trade_cycle()
        print(f"[!] Waiting {INTERVAL_MINUTES} minutes until next cycle...")
        time.sleep(INTERVAL_MINUTES * 60)import ccxt

# Initialize public exchange instances (add API keys later for trading)
bitget = ccxt.bitget()
cryptocom = ccxt.cryptocom()

def get_crypto_ticker(symbol: str, exchange: str = 'bitget') -> dict:
    """Fetches the latest ticker price and 24h volume for a given pair."""
    try:
        ex = bitget if exchange.lower() == 'bitget' else cryptocom
        ticker = ex.fetch_ticker(symbol)
        
        return {
            "symbol": symbol,
            "exchange": exchange,
            "price": ticker.get('last'),
            "change_24h_percent": ticker.get('percentage'),
            "volume_24h": ticker.get('quoteVolume')
        }
    except Exception as e:
        return {"error": f"Failed to fetch ticker: {str(e)}"}

def get_order_book_depth(symbol: str, depth: int = 5, exchange: str = 'bitget') -> dict:
    """Fetches current bid/ask spread and order book depth."""
    try:
        ex = bitget if exchange.lower() == 'bitget' else cryptocom
        ob = ex.fetch_order_book(symbol, limit=depth)
        
        bids = ob.get('bids', [])[:depth]
        asks = ob.get('asks', [])[:depth]
        
        spread = round(asks[0][0] - bids[0][0], 4) if bids and asks else None
        
        return {
            "symbol": symbol,
            "exchange": exchange,
            "bids": bids,  # Format: [[price, size], [price, size]]
            "asks": asks,
            "spread": spread
        }
    except Exception as e:
        return {"error": f"Failed to fetch order book: {str(e)}"}

# 3. Update the tools list
tools_list = [get_crypto_ticker, get_order_book_depth]