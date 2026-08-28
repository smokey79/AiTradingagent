import os
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv(r"F:\AI-Trading-Agent\.env")

api_key = os.getenv("GEMINI_API_KEY")
print(f"Loaded GEMINI_API_KEY: {bool(api_key)}")

# Initialize official Google GenAI Client
client = genai.Client(api_key=api_key)

try:
    print("Testing Gemini 2.5 Pro market signal analysis...")
    response = client.models.generate_content(
        model="gemini-2.5-pro",
        contents="You are a crypto scalper. In strict JSON, return {\"action\": \"BUY\", \"confidence\": 0.88, \"reason\": \"test ok\"} for BTC/USDT.",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2
        )
    )
    print("\n[+] Gemini API Response:")
    print(response.text)
except Exception as e:
    print(f"\n[-] Gemini API Error: {e}")
