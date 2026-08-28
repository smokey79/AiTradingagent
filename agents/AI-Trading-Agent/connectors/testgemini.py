import os

# Prevent SDK from falling back to Vertex AI / Google Cloud backend
os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)
os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
os.environ.pop("GOOGLE_CLOUD_PROJECT", None)

from google import genai
from google.genai import types

# Fetch API key
api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

if not api_key:
    raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY environment variable is not set.")

# Explicitly initialize with vertexai=False
client = genai.Client(api_key=api_key, vertexai=False)

# Define trading tool functions
def get_crypto_ticker(symbol: str) -> dict:
    """Fetches the latest ticker price and 24h volume for a given pair."""
    return {
        "symbol": symbol,
        "price": 64250.00,
        "change_24h": "+2.4%",
        "volume_24h_usd": 1850000000
    }

def get_order_book_depth(symbol: str, depth: int = 5) -> dict:
    """Fetches current bid/ask spread and order book depth."""
    return {
        "symbol": symbol,
        "bids": [[64245.0, 1.5], [64240.0, 3.2]],
        "asks": [[64255.0, 2.1], [64260.0, 4.0]],
        "spread": 10.0
    }

tools_list = [get_crypto_ticker, get_order_book_depth]

config = types.GenerateContentConfig(
    tools=tools_list,
    temperature=0.2,
    system_instruction="You are an autonomous crypto market signal agent. Fetch necessary market data and output a structured trade signal (BUY/SELL/HOLD, entry, stop-loss, take-profit)."
)

# Chat session handles automatic function calling cleanly
chat = client.chats.create(
    model="gemini-2.5-pro",
    config=config
)

prompt = "Analyze BTC/USDT market signal using current price and order book depth."
response = chat.send_message(prompt)

print(response.text)