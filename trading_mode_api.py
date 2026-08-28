"""
Trading Mode Controller - REST API for switching between AUTO and MANUAL modes
Runs on port 3005 alongside main dashboard
"""

from flask import Flask, jsonify, request
import json
import os
from datetime import datetime

app = Flask(__name__)
STATE_FILE = os.getenv('STATE_FILE', './data/.trading_state')
os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)

def load_state():
    """Load trading state from file"""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {
        'status': 'RUNNING',
        'mode': 'MANUAL',
        'start_time': datetime.now().isoformat(),
        'trade_count': 0,
        'last_toggle': None
    }

def save_state(state):
    """Save trading state to file"""
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    state = load_state()
    return jsonify({
        'status': 'healthy',
        'trading_mode': state.get('mode', 'MANUAL'),
        'services': {
            'dashboard': 'http://localhost:3002',
            'risk_gate': 'http://localhost:3001',
            'signal_engine': 'http://localhost:3003',
            'portfolio': 'http://localhost:3004'
        }
    })

@app.route('/state', methods=['GET'])
def get_state():
    """Get current trading state"""
    state = load_state()
    return jsonify(state)

@app.route('/mode/trade', methods=['POST'])
def enable_auto_trading():
    """
    Switch to AUTO mode (autonomous trading)
    - Consensus engine executes trades automatically
    - Risk gates enforce position limits
    - All LLM signals used for execution
    """
    state = load_state()
    state['mode'] = 'AUTO'
    state['status'] = 'TRADING'
    state['last_toggle'] = datetime.now().isoformat()
    state['last_action'] = 'TRADE button pushed'
    save_state(state)
    
    return jsonify({
        'success': True,
        'mode': 'AUTO',
        'message': 'Switched to AUTO mode - autonomous trading enabled',
        'timestamp': datetime.now().isoformat(),
        'active_services': [
            'Consensus Engine (executes trades)',
            'Risk Gate (enforces limits)',
            'All LLMs (providing signals)',
            'Portfolio Manager (tracking positions)'
        ]
    }), 200

@app.route('/mode/stop', methods=['POST'])
def enable_manual_mode():
    """
    Switch to MANUAL mode (manual + AI input)
    - All LLMs remain active for analysis
    - Risk gates still evaluate proposals
    - No automatic execution
    - You manually approve/reject trades via dashboard
    """
    state = load_state()
    state['mode'] = 'MANUAL'
    state['status'] = 'MONITORING'
    state['last_toggle'] = datetime.now().isoformat()
    state['last_action'] = 'STOP button pushed'
    save_state(state)
    
    return jsonify({
        'success': True,
        'mode': 'MANUAL',
        'message': 'Switched to MANUAL mode - AI provides input, you execute trades',
        'timestamp': datetime.now().isoformat(),
        'active_services': [
            'All LLMs (providing analysis)',
            'Risk Gate (evaluating proposals)',
            'Signal Engine (generating signals)',
            'Dashboard (awaiting your approval)'
        ],
        'what_you_can_do': [
            'View multi-LLM consensus on each trade',
            'See risk assessment from risk gate',
            'Click to manually execute recommended trades',
            'Override AI recommendations if desired'
        ]
    }), 200

@app.route('/mode/toggle', methods=['POST'])
def toggle_mode():
    """Toggle between AUTO and MANUAL modes"""
    state = load_state()
    current_mode = state.get('mode', 'MANUAL')
    new_mode = 'MANUAL' if current_mode == 'AUTO' else 'AUTO'
    
    if new_mode == 'AUTO':
        return enable_auto_trading()
    else:
        return enable_manual_mode()

@app.route('/consensus/status', methods=['GET'])
def consensus_status():
    """Get consensus engine status"""
    state = load_state()
    return jsonify({
        'consensus_engine': 'active',
        'mode': state.get('mode', 'MANUAL'),
        'min_consensus_agents': int(os.getenv('MIN_CONSENSUS_AGENTS', 4)),
        'min_confidence': float(os.getenv('MIN_CONFIDENCE', 0.70)),
        'active_llms': [
            'Anthropic Claude',
            'OpenAI GPT-4o',
            'Google Gemini',
            'OpenRouter (multi-model)',
            'Azure OpenAI'
        ]
    })

@app.route('/risk/gates', methods=['GET'])
def risk_gates_status():
    """Risk gate enforcement status"""
    return jsonify({
        'risk_gate_active': True,
        'config': {
            'max_position_size': float(os.getenv('MAX_POSITION_SIZE', 10000)),
            'max_portfolio_risk': float(os.getenv('MAX_PORTFOLIO_RISK', 0.02)),
            'max_leverage': int(os.getenv('MAX_LEVERAGE', 5)),
            'max_open_trades': int(os.getenv('MAX_OPEN_TRADES', 5)),
            'stop_loss_pct': float(os.getenv('STOP_LOSS_PERCENT', 5)),
            'take_profit_pct': float(os.getenv('TAKE_PROFIT_PERCENT', 15))
        },
        'win_rate_gate': float(os.getenv('WIN_RATE_GATE', 0.70))
    })

@app.route('/trading/summary', methods=['GET'])
def trading_summary():
    """Get trading session summary"""
    state = load_state()
    return jsonify({
        'session_start': state.get('start_time'),
        'current_mode': state.get('mode', 'MANUAL'),
        'trading_status': state.get('status', 'RUNNING'),
        'trades_executed': state.get('trade_count', 0),
        'uptime_hours': 'use dashboard for details',
        'manual_approvals_waiting': 'check dashboard',
        'multi_llm_consensus': 'enabled',
        'all_services_operational': True
    })

if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=3005,
        debug=False,
        threaded=True
    )
