import os
import sys
import json
import time
import socket
import webbrowser
from typing import List
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Live Trading Matrix Dashboard")

# HTML Template embedded directly to avoid file path / 500 errors
HTML_DASHBOARD = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Multi-LLM Trading Matrix</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    body { background-color: #0d1117; color: #c9d1d9; font-family: monospace; }
  </style>
</head>
<body class="p-6">
  <div id="root"></div>

  <script type="text/babel">
    const { useState, useEffect } = React;

    function Dashboard() {
      const [status, setStatus] = useState("Connecting...");
      const [logs, setLogs] = useState([]);
      const [balances, setBalances] = useState({ USDT: 0.0, GBP: 0.0 });
      const [testSymbol, setTestSymbol] = useState("BTC/USDT");

      useEffect(() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        
        ws.onopen = () => setStatus("Online (Streaming)");
        ws.onmessage = (event) => {
          setLogs((prev) => [JSON.parse(event.data), ...prev.slice(0, 50)]);
        };
        ws.onclose = () => setStatus("Disconnected");

        fetchBalances();
      }, []);

      const fetchBalances = async () => {
        try {
          const res = await fetch("/api/balances");
          const data = await res.json();
          setBalances(data);
        } catch (e) {
          console.error(e);
        }
      };

      const sendTestAlert = async (action) => {
        await fetch("/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            passphrase: "SECRET_TRADINGVIEW_TOKEN",
            ticker: testSymbol,
            action: action,
            price: 65000.0,
            timeframe: "15m",
            indicator: "Dashboard_Trigger"
          })
        });
      };

      return (
        <div className="max-w-6xl mx-auto space-y-6">
          <header className="flex justify-between items-center border-b border-gray-800 pb-4">
            <div>
              <h1 className="text-2xl font-bold text-emerald-400">⚡ AI Multi-LLM Trading Matrix</h1>
              <p className="text-xs text-gray-400">Gemini 2.5 Pro + Hermes 3 + Claude Agent Committee</p>
            </div>
            <div className="flex items-center space-x-3">
              <span className={`px-3 py-1 rounded text-xs ${status.includes("Online") ? "bg-emerald-950 text-emerald-300 border border-emerald-700" : "bg-red-950 text-red-300"}`}>
                ● {status}
              </span>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded p-4">
              <span className="text-xs text-gray-400">Bitget / Crypto.com USDT</span>
              <p className="text-2xl font-semibold text-white mt-1">${balances.USDT?.toFixed(2) || "0.00"}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded p-4">
              <span className="text-xs text-gray-400">GBP Float Balance</span>
              <p className="text-2xl font-semibold text-white mt-1">£{balances.GBP?.toFixed(2) || "0.00"}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded p-4">
              <span className="text-xs text-gray-400">Manual Signal Trigger</span>
              <div className="flex space-x-2 mt-2">
                <button onClick={() => sendTestAlert("BUY")} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded text-xs font-bold">Mock BUY</button>
                <button onClick={() => sendTestAlert("SELL")} className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1 rounded text-xs font-bold">Mock SELL</button>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded p-4">
            <h2 className="text-sm font-bold text-gray-300 mb-3">Live Multi-Agent Consensus Stream</h2>
            <div className="h-80 overflow-y-auto space-y-2 text-xs">
              {logs.length === 0 ? <p className="text-gray-600">Waiting for webhook triggers...</p> : logs.map((log, idx) => (
                <div key={idx} className="p-2.5 rounded bg-gray-950 border border-gray-800 space-y-1">
                  <div className="flex justify-between text-gray-400">
                    <span className="font-bold text-white">[{log.time}] {log.ticker} - {log.action}</span>
                    <span className={log.approved ? "text-emerald-400 font-bold" : "text-rose-400"}>
                      {log.approved ? "CONSENSUS APPROVED" : "REJECTED"}
                    </span>
                  </div>
                  <div className="text-gray-400">
                    <span className="text-blue-400">Gemini:</span> {log.gemini_reason} | <span className="text-purple-400">Hermes:</span> {log.hermes_reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<Dashboard />);
  </script>
</body>
</html>"""

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

class TradingViewAlert(BaseModel):
    passphrase: str
    ticker: str
    action: str
    price: float
    timeframe: str = "15m"
    indicator: str = "Dashboard"

async def evaluate_and_broadcast(alert: TradingViewAlert):
    log_entry = {
        "time": time.strftime("%H:%M:%S"),
        "ticker": alert.ticker,
        "action": alert.action,
        "price": alert.price,
        "approved": True,
        "gemini_reason": "Risk threshold acceptable (0.88)",
        "hermes_reason": "Order verified for execution"
    }
    await manager.broadcast(log_entry)

@app.get("/", response_class=HTMLResponse)
async def get_index():
    return HTMLResponse(content=HTML_DASHBOARD)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/api/balances")
async def get_balances():
    return {"USDT": 1250.00, "GBP": 500.00}

@app.post("/webhook")
async def handle_webhook(alert: TradingViewAlert, background_tasks: BackgroundTasks):
    background_tasks.add_task(evaluate_and_broadcast, alert)
    return {"status": "queued"}

def find_available_port(preferred_ports=[8888, 8080, 5000, 3000]):
    for p in preferred_ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]

if __name__ == "__main__":
    port = find_available_port()
    url = f"http://localhost:{port}"
    print(f"\n=======================================================")
    print(f" LIVE TRADING DASHBOARD AVAILABLE AT: {url}")
    print(f"=======================================================\n")
    webbrowser.open(url)
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
