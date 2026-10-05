Set-Location F:\aitradingagent
node -e "const tk=require('./src/data/tradingKitFeed'); console.log('ENABLED', tk.ENABLED); tk.fetchSignal('BTC/USDT').then(r=>console.log('BTC result:', JSON.stringify(r))).catch(e=>console.log('ERR',e.message));"
