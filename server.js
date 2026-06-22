const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Serve static front-end files
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Central State (Held in memory 24/7)
let state = {
  balance: 120192307.00, // Starting baseline ($120.19M USD / ~1000 Crore INR)
  currentPrice: 124.0204,
  activeTrades: [],
  candleHistory: []
};

// Initialize candle history
const EPOCH = 1704067200000;
const CANDLE_MS = 2000;
const VISIBLE_CANDLES = 48;

function initCandles() {
  let tempPrice = state.currentPrice;
  for (let i = 0; i < VISIBLE_CANDLES; i++) {
    const change = (Math.random() - 0.5) * 0.25;
    const open = tempPrice;
    const close = tempPrice + change;
    state.candleHistory.push({
      o: open,
      h: Math.max(open, close) + Math.random() * 0.05,
      l: Math.min(open, close) - Math.random() * 0.05,
      c: close,
      v: 0.5 + Math.random() * 3,
      t: Date.now() - (VISIBLE_CANDLES - i) * CANDLE_MS
    });
    tempPrice = close;
  }
}
initCandles();

// Central High-Frequency Trading Simulation Loop (Every 150ms)
setInterval(() => {
  const now = Date.now();

  // 1. Walk base price
  const priceChange = (Math.random() - 0.5) * 0.04;
  state.currentPrice = Math.max(10, state.currentPrice + priceChange);

  // 2. Update existing active arbitrage positions
  state.activeTrades.forEach((t) => {
    const elapsed = now - t.start;
    const progress = Math.min(1, elapsed / t.duration);
    
    // Wave calculations to simulate live price fluctuations
    const ratio = (progress * 1.05) - Math.sin(progress * Math.PI * 2.5) * 0.15;
    let profit = t.targetProfit * (t.type === 'BUY' ? ratio : -ratio);
    if (t.isLoss) {
      profit = Math.abs(t.targetProfit) * (t.type === 'BUY' ? -ratio : ratio);
    }
    t.currentProfit = Math.round(profit / 0.15) * 0.15; // Jumps by steps
  });

  // 3. Process completed trades & add/subtract directly from central balance
  const completed = state.activeTrades.filter(t => (now - t.start) >= t.duration);
  completed.forEach(t => {
    state.balance += t.currentProfit;
  });

  // Keep only non-expired trades in memory
  state.activeTrades = state.activeTrades.filter(t => (now - t.start) < t.duration);

  // 4. Spawn new trades if slots are open (keeps 3-6 trades active at all times)
  const assets = ["Coin-39", "Coin-49", "Coin-5", "Coin-12", "Coin-74"];
  if (state.activeTrades.length < 5) {
    if (Math.random() < 0.3) {
      const isLoss = Math.random() < 0.33; // ~33% chance of trade loss
      const targetProfit = isLoss 
        ? -parseFloat((Math.random() * 5.00 + 1.00).toFixed(2))
        : parseFloat((Math.random() * 5.50 + 0.50).toFixed(2));

      state.activeTrades.push({
        id: "ARB-" + Math.floor(Math.random() * 9000 + 1000),
        asset: assets[Math.floor(Math.random() * assets.length)],
        entry: parseFloat((state.currentPrice + (Math.random() - 0.5) * 1.5).toFixed(4)),
        type: Math.random() < 0.5 ? "BUY" : "SELL",
        size: (Math.random() * 12 + 1).toFixed(1),
        targetProfit: targetProfit,
        currentProfit: 0,
        isLoss: isLoss,
        start: now,
        duration: Math.floor(Math.random() * 8000) + 7000 // Lasts 7 to 15 seconds
      });
    }
  }

  // 5. Manage candles
  const lastCandle = state.candleHistory[state.candleHistory.length - 1];
  if (now - lastCandle.t >= CANDLE_MS) {
    // Push new candle
    state.candleHistory.push({
      o: lastCandle.c,
      h: lastCandle.c,
      l: lastCandle.c,
      c: lastCandle.c,
      v: 0.5 + Math.random() * 3,
      t: Math.floor(now / CANDLE_MS) * CANDLE_MS
    });
    if (state.candleHistory.length > VISIBLE_CANDLES) {
      state.candleHistory.shift();
    }
  } else {
    // Update existing candle
    lastCandle.c = state.currentPrice;
    if (state.currentPrice > lastCandle.h) lastCandle.h = state.currentPrice;
    if (state.currentPrice < lastCandle.l) lastCandle.l = state.currentPrice;
  }

  // 6. Broadcast updated state to all connected visitors
  const payload = JSON.stringify({
    type: "TICK",
    balance: state.balance,
    currentPrice: state.currentPrice,
    activeTrades: state.activeTrades,
    candleHistory: state.candleHistory
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });

}, 150);

// WebSocket client connection handling
wss.on('connection', (ws) => {
  // Send current state immediately on connection
  ws.send(JSON.stringify({
    type: "INIT",
    balance: state.balance,
    currentPrice: state.currentPrice,
    activeTrades: state.activeTrades,
    candleHistory: state.candleHistory
  }));
});

server.listen(port, () => {
  console.log(`Continuous Arbitrage Server listening on port ${port}`);
});
