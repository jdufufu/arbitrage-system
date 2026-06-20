const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname)));

// --- EXACT ORIGINAL VARIABLES ---
let balance = 120192307.45; // No commas
let currentPrice = 124.0204;
let candleHistory = [];
let activePosition = null;
let cooldownUntil = 0;
let bgTrades = [];
let lastCandleTime = Math.floor(Date.now() / 2000) * 2000;

// Initialize candles
for(let i = 0; i < 48; i++){
  candleHistory.push({
    o: 124.0204, h: 124.05, l: 123.99, c: 124.0204, v: 1.5,
    t: Date.now() - (48 - i) * 2000
  });
}

function genBook(px) {
  const t = Date.now() * 0.025;
  const asks=[], bids=[];
  const macroShift = Math.sin(t * 0.9) * px * 0.00008;
  const spreadMultiplier = 0.00008 + Math.abs(Math.sin(t * 0.5)) * 0.00018;
  let aP = px + macroShift + px * spreadMultiplier;
  let bP = px + macroShift - px * spreadMultiplier;
  let aT=0, bT=0;
  for(let i=0; i<10; i++){
    const jitterAsk = Math.sin(t + i * 1.8) * 1.2 + Math.cos(t * 2.5 - i) * 0.6;
    const jitterBid = Math.cos(t - i * 1.8) * 1.2 + Math.sin(t * 2.5 + i) * 0.6;
    const szAsk = Math.max(0.05, 2.5 + jitterAsk * 6.5 + (i * 0.3));
    const szBid = Math.max(0.05, 2.5 + jitterBid * 6.5 + (i * 0.3));
    aT += szAsk; asks.push({p: aP + (i * px * 0.00007), s: szAsk, t: aT});
    bT += szBid; bids.push({p: bP - (i * px * 0.00007), s: szBid, t: bT});
  }
  return {asks, bids};
}

// --- EXACT ORIGINAL LOGIC LOOP (Runs every 140ms) ---
setInterval(() => {
  const now = Date.now();
  let totalBalanceJump = 0;

  // 1. Process Main Chart Trades
  if (activePosition) {
    const elapsed = now - activePosition.start;
    if (elapsed >= activePosition.duration) {
      totalBalanceJump += activePosition.profitTarget;
      activePosition = null;
      const silentIntervals = [5000, 10000, 15000, 20000];
      cooldownUntil = now + silentIntervals[Math.floor(Math.random() * silentIntervals.length)];
    }
  } else {
    if (now > cooldownUntil) {
      const tradeType = Math.random() < 0.5 ? 'BUY' : 'SELL';
      const tradeDuration = Math.random() * 800 + 1200;
      const driftTarget = currentPrice * (Math.random() * 0.00015 + 0.00006);
      const isLoss = Math.random() < 0.35;
      const profitTarget = isLoss ? -parseFloat((Math.random() * 6.00 + 1.00).toFixed(2)) : parseFloat((Math.random() * 7.00 + 0.50).toFixed(2));

      activePosition = {
        entry: currentPrice, type: tradeType, driftTarget: driftTarget,
        size: (Math.random() * 2.8 + 0.4).toFixed(4), profitTarget: profitTarget,
        duration: tradeDuration, start: now, isLoss: isLoss
      };
    }
  }

  // 2. Process Background Trades
  const activeBg = [];
  bgTrades.forEach(t => {
    const elapsed = now - t.start;
    if (elapsed >= t.duration) totalBalanceJump += t.targetProfit;
    else activeBg.push(t);
  });
  bgTrades = activeBg;

  if (bgTrades.length < 15) {
    let spawnChance = bgTrades.length < 2 ? 0.45 : (bgTrades.length > 6 ? 0.04 : 0.12);
    if (Math.random() < spawnChance) {
      const coins = ['Coin-39', 'Coin-49', 'Coin-5', 'Coin-12', 'Coin-74', 'Asset-8', 'Asset-22', 'Asset-16'];
      const isLoss = Math.random() < 0.35;
      bgTrades.push({
        id: 'ARB-' + Math.floor(Math.random() * 9000 + 1000),
        asset: coins[Math.floor(Math.random() * coins.length)],
        entry: Math.random() * 60 + 15,
        type: Math.random() < 0.5 ? 'BUY' : 'SELL',
        duration: Math.random() * 900 + 1100,
        start: now, size: (Math.random() * 12 + 1).toFixed(1),
        targetProfit: isLoss ? -parseFloat((Math.random() * 5.00 + 1.00).toFixed(2)) : parseFloat((Math.random() * 5.50 + 0.50).toFixed(2)),
        isLoss: isLoss
      });
    }
  }

  // Update Balance
  if (totalBalanceJump !== 0) balance += totalBalanceJump;

  // 3. Live Price Calculation
  if (activePosition) {
    const elapsed = now - activePosition.start;
    const pct = Math.min(1, elapsed / activePosition.duration);
    const progression = (pct * 1.05) - Math.sin(pct * Math.PI * 2.5) * 0.15;
    let drift = progression * activePosition.driftTarget;
    if (activePosition.isLoss) drift = -drift;
    const noise = (Math.random() - 0.5) * (activePosition.entry * 0.00004);
    currentPrice = activePosition.type === 'BUY' ? activePosition.entry + drift + noise : activePosition.entry - drift - noise;
  } else {
    currentPrice += (Math.random() - 0.5) * 0.014;
  }

  // 4. Update Candles
  const currentCandleTime = Math.floor(now / 2000) * 2000;
  if (currentCandleTime > lastCandleTime) {
    const prevClose = candleHistory.length > 0 ? candleHistory[candleHistory.length - 1].c : currentPrice;
    candleHistory.push({ o: prevClose, h: prevClose, l: prevClose, c: prevClose, v: 0.4 + Math.random() * 3.2, t: currentCandleTime });
    if (candleHistory.length > 48) candleHistory.shift();
    lastCandleTime = currentCandleTime;
  }
  if (candleHistory.length > 0) {
    const lastCandle = candleHistory[candleHistory.length - 1];
    lastCandle.c = currentPrice;
    if (currentPrice > lastCandle.h) lastCandle.h = currentPrice;
    if (currentPrice < lastCandle.l) lastCandle.l = currentPrice;
  }

  // Broadcast to all users
  io.emit('market_update', {
    price: currentPrice, balance: balance, activePosition: activePosition,
    bgTrades: bgTrades, candles: candleHistory, book: genBook(currentPrice)
  });
}, 140);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
