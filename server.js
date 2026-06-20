const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve your index.html file to visitors
app.use(express.static(path.join(__dirname)));

// --- SHARED DATA STATE ---
let globalBalance = 120192307.45; // Approx $120M starting balance
let currentPrice = 124.0204;
let candleHistory = [];
let activePositions = [];
let lastCandleTime = Math.floor(Date.now() / 2000) * 2000;

// Initialize starting candles (48 candles)
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

// Math generator helper (mulberry32 algorithm)
function serverSeed(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Generate a synchronized L3 order book based on the current price
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

// --- CENTRAL EMULATION LOOP ---
// Runs 5 times per second to update all connected users smoothly
setInterval(() => {
  const now = Date.now();
  const currentCandleTime = Math.floor(now / 2000) * 2000;

  // 1. Manage active positions and balance jumps
  let balanceJump = 0;
  
  // Track active real-time positions
  activePositions = activePositions.filter(t => {
    const elapsed = now - t.start;
    if (elapsed >= t.duration) {
      balanceJump += t.targetProfit; // Add or subtract profit globally on completion
      return false;
    }
    return true;
  });

  // Accumulate balance changes
  if (balanceJump !== 0) {
    globalBalance += balanceJump;
  }

  // 2. Spawn simulated active positions if empty or randomly (Max 6 active cards)
  if (activePositions.length < 6 && Math.random() < 0.15) {
    const coins = ['Coin-39', 'Coin-49', 'Coin-5', 'Coin-12', 'Coin-74', 'Asset-8'];
    const assetSelected = coins[Math.floor(Math.random() * coins.length)];
    const duration = Math.random() * 900 + 1100;
    const isLoss = Math.random() < 0.35;
    const targetProfit = isLoss 
      ? -parseFloat((Math.random() * 5.00 + 1.00).toFixed(2)) 
      : parseFloat((Math.random() * 5.50 + 0.50).toFixed(2));

    activePositions.push({
      id: 'ARB-' + Math.floor(Math.random() * 9000 + 1000),
      asset: assetSelected,
      entry: currentPrice,
      type: Math.random() < 0.5 ? 'BUY' : 'SELL',
      duration: duration,
      start: now,
      size: (Math.random() * 12 + 1).toFixed(1),
      targetProfit: targetProfit,
      isLoss: isLoss
    });
  }

  // 3. Update active price ticks based on active positions
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

  // 4. Update the moving candle chart arrays
  if (currentCandleTime > lastCandleTime) {
    const prevClose = candleHistory.length > 0 ? candleHistory[candleHistory.length - 1].c : currentPrice;
    candleHistory.push({
      o: prevClose,
      h: prevClose,
      l: prevClose,
      c: prevClose,
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

  // 5. Generate matching Order Book
  const book = generateSharedBook(currentPrice);

  // 6. Broadcast the combined updates to every single user
  io.emit('market_update', {
    price: currentPrice,
    balance: globalBalance,
    positions: activePositions,
    candles: candleHistory,
    book: book
  });

}, 200);

// Run on standard Port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Synchronization Server running on port ${PORT}`);
});
