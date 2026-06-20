const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

let globalBalance = 120192307.45; 
let currentPrice = 124.0204;
let candleHistory = [];
let activePositions = [];
let lastCandleTime = Math.floor(Date.now() / 2000) * 2000;

// Initialize candles
for (let i = 0; i < 48; i++) {
  candleHistory.push({
    o: 124.0204,
    h: 124.05,
    l: 123.99,
    c: 124.0204,
    v: 1.5,
    t: Date.now() - (48 - i) * 2000
  });
}

// Generate shared depth book
function generateSharedBook(px) {
  const t = Date.now() * 0.025;
  const asks = [], bids = [];
  const macroShift = Math.sin(t * 0.9) * px * 0.00008;
  const spreadMultiplier = 0.00008 + Math.abs(Math.sin(t * 0.5)) * 0.00018;
  
  let aP = px + macroShift + px * spreadMultiplier;
  let bP = px + macroShift - px * spreadMultiplier;
  let aT = 0, bT = 0;
  
  for (let i = 0; i < 10; i++) {
    const jitterAsk = Math.sin(t + i * 1.8) * 1.2 + Math.cos(t * 2.5 - i) * 0.6;
    const jitterBid = Math.cos(t - i * 1.8) * 1.2 + Math.sin(t * 2.5 + i) * 0.6;
    const szAsk = Math.max(0.05, 2.5 + jitterAsk * 6.5 + (i * 0.3));
    const szBid = Math.max(0.05, 2.5 + jitterBid * 6.5 + (i * 0.3));
    
    aT += szAsk;
    asks.push({ p: aP + (i * px * 0.00007), s: szAsk, t: aT });
    
    bT += szBid;
    bids.push({ p: bP - (i * px * 0.00007), s: szBid, t: bT });
  }
  return { asks, bids };
}

// 24/7 Server Game Loop
setInterval(() => {
  const now = Date.now();
  const currentCandleTime = Math.floor(now / 2000) * 2000;

  let balanceJump = 0;
  
  // Track active positions with static entry prices
  activePositions = activePositions.filter(t => {
    const elapsed = now - t.start;
    if (elapsed >= t.duration) {
      balanceJump += t.targetProfit; 
      return false;
    }
    return true;
  });

  if (balanceJump !== 0) {
    globalBalance += balanceJump;
  }

  // Spawn positions with locked entry prices
  if (activePositions.length < 5 && Math.random() < 0.12) {
    const coins = ['Coin-39', 'Coin-49', 'Coin-5', 'Coin-12', 'Coin-74', 'Asset-8'];
    const assetSelected = coins[Math.floor(Math.random() * coins.length)];
    const duration = Math.random() * 1000 + 1500;
    const isLoss = Math.random() < 0.35;
    const targetProfit = isLoss 
      ? -parseFloat((Math.random() * 5.00 + 1.00).toFixed(2)) 
      : parseFloat((Math.random() * 5.50 + 0.50).toFixed(2));

    activePositions.push({
      id: 'ARB-' + Math.floor(Math.random() * 9000 + 1000),
      asset: assetSelected,
      entry: currentPrice, // Lock the entry price right here
      type: Math.random() < 0.5 ? 'BUY' : 'SELL',
      duration: duration,
      start: now,
      size: (Math.random() * 12 + 1).toFixed(1),
      targetProfit: targetProfit,
      isLoss: isLoss
    });
  }

  // Price ticks relative to the locked entry price
  let targetDrift = 0;
  if (activePositions.length > 0) {
    const mainPos = activePositions[0];
    const pct = Math.min(1, (now - mainPos.start) / mainPos.duration);
    const progression = (pct * 1.05) - Math.sin(pct * Math.PI * 2.5) * 0.15;
    let drift = progression * (mainPos.entry * 0.0001);
    if (mainPos.isLoss) drift = -drift;
    targetDrift = mainPos.type === 'BUY' ? drift : -drift;
  } else {
    targetDrift = (Math.random() - 0.5) * 0.014;
  }
  
  currentPrice += targetDrift;

  // Manage candles
  if (currentCandleTime > lastCandleTime) {
    const prevClose = candleHistory.length > 0 ? candleHistory[candleHistory.length - 1].c : currentPrice;
    candleHistory.push({
      o: prevClose, h: prevClose, l: prevClose, c: prevClose,
      v: 0.4 + Math.random() * 3.2,
      t: currentCandleTime
    });
    if (candleHistory.length > 48) {
      candleHistory.shift();
    }
    lastCandleTime = currentCandleTime;
  }

  if (candleHistory.length > 0) {
    const lastCandle = candleHistory[candleHistory.length - 1];
    lastCandle.c = currentPrice;
    if (currentPrice > lastCandle.h) lastCandle.h = currentPrice;
    if (currentPrice < lastCandle.l) lastCandle.l = currentPrice;
  }

  const book = generateSharedBook(currentPrice);

  io.emit('market_update', {
    price: currentPrice,
    balance: globalBalance,
    positions: activePositions,
    candles: candleHistory,
    book: book
  });

}, 200);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
