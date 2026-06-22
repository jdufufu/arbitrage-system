const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

const EPOCH = 1704067200000;
const CANDLE_MS = 2000;
const VISIBLE_CANDLES = 48;

let candleHistory = [];
let currentPrice = 124.0204;
let lastCandleTime = 0;
let globalBalance = 120192307.45;

let activePosition = null;
let cooldownUntil = 0;
let bgTrades = [];

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
function seedFor(i) { return ((i * 2654435761) >>> 0) ^ 0x9E3779B9; }

// High-fidelity smooth price wave generator
function getPriceAtTime(ms) {
  const base = 124.0204;
  const t = ms / 1000;
  const wave1 = Math.sin(t * 0.015) * 1.8;
  const wave2 = Math.cos(t * 0.043) * 0.7;
  const wave3 = Math.sin(t * 0.117) * 0.25;
  const wave4 = Math.cos(t * 0.321) * 0.08;
  const index = Math.floor(ms / 250);
  const rng = mulberry32(seedFor(index));
  const jitter = (rng() - 0.5) * 0.02;
  return base + wave1 + wave2 + wave3 + wave4 + jitter;
}

// Generate organic candle data matching the current live price
function getSampledCandle(candleIdx) {
  const t_start = EPOCH + candleIdx * 2000;
  const p0 = getPriceAtTime(t_start);
  const p1 = getPriceAtTime(t_start + 500);
  const p2 = getPriceAtTime(t_start + 1000);
  const p3 = getPriceAtTime(t_start + 1500);
  const p4 = getPriceAtTime(t_start + 2000);
  const o = p0;
  const c = p4;
  const rawMax = Math.max(p0, p1, p2, p3, p4);
  const rawMin = Math.min(p0, p1, p2, p3, p4);
  const rng = mulberry32(seedFor(candleIdx));
  const h = rawMax + (rng() * 0.015);
  const l = rawMin - (rng() * 0.015);
  const v = 0.4 + rng() * 3.2;
  return { i: candleIdx, o, h, l, c, v, t: t_start };
}

function genBook(px) {
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

function initCandles() {
  const count = VISIBLE_CANDLES;
  const nowIdx = Math.floor((Date.now() - EPOCH) / CANDLE_MS);
  const startIdx = nowIdx - count;
  let p = 124.0204;
  for (let i = startIdx; i < nowIdx; i++) {
    const c = getSampledCandle(i);
    this.candleHistory.push(c);
    p = c.c;
  }
  this.currentPrice = p;
  this.lastCandleTime = Math.floor(Date.now() / CANDLE_MS) * CANDLE_MS;
}

initCandles();

setInterval(() => {
  const now = Date.now();
  const currentCandleTime = Math.floor(now / CANDLE_MS) * CANDLE_MS;

  if (currentCandleTime > lastCandleTime) {
    const prevClose = candleHistory.length > 0 ? candleHistory[candleHistory.length - 1].c : currentPrice;
    candleHistory.push(getSampledCandle(Math.floor(currentCandleTime / CANDLE_MS)));
    if (candleHistory.length > VISIBLE_CANDLES) {
      candleHistory.shift();
    }
    lastCandleTime = currentCandleTime;
  }

  // Calculate prices based on smooth sine waves (never blows up)
  const px = getPriceAtTime(now);
  currentPrice = px;

  if (candleHistory.length > 0) {
    const lastCandle = candleHistory[candleHistory.length - 1];
    lastCandle.c = px;
    if (px > lastCandle.h) lastCandle.h = px;
    if (px < lastCandle.l) lastCandle.l = px;
  }

  let balanceJump = 0;

  if (activePosition) {
    const elapsed = now - activePosition.start;
    if (elapsed >= activePosition.duration) {
      balanceJump += activePosition.profitTarget;
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
      const profitTarget = isLoss 
        ? -parseFloat((Math.random() * 6.00 + 1.00).toFixed(2)) 
        : parseFloat((Math.random() * 7.00 + 0.50).toFixed(2));
      activePosition = {
        entry: currentPrice,
        type: tradeType,
        driftTarget: driftTarget,
        profitTarget: profitTarget,
        duration: tradeDuration,
        start: now,
        isLoss: isLoss
      };
    }
  }

  const activeBg = [];
  bgTrades.forEach(t => {
    const elapsed = now - t.start;
    if (elapsed >= t.duration) {
      balanceJump += t.targetProfit;
    } else {
      activeBg.push(t);
    }
  });
  bgTrades = activeBg;

  if (bgTrades.length < 15) {
    let spawnChance = 0.12;
    if (bgTrades.length < 2) spawnChance = 0.45;
    else if (bgTrades.length > 6) spawnChance = 0.04;
    if (Math.random() < spawnChance) {
      const coins = ['Coin-39', 'Coin-49', 'Coin-5', 'Coin-12', 'Coin-74', 'Asset-8', 'Asset-22', 'Asset-16'];
      const assetSelected = coins[Math.floor(Math.random() * coins.length)];
      const duration = Math.random() * 900 + 1100;
      const basePrice = Math.random() * 60 + 15;
      const isLoss = Math.random() < 0.35;
      const targetProfit = isLoss 
        ? -parseFloat((Math.random() * 5.00 + 1.00).toFixed(2)) 
        : parseFloat((Math.random() * 5.50 + 0.50).toFixed(2));
      bgTrades.push({
        id: 'ARB-' + Math.floor(Math.random() * 9000 + 1000),
        asset: assetSelected,
        entry: basePrice,
        type: Math.random() < 0.5 ? 'BUY' : 'SELL',
        duration: duration,
        start: now,
        size: (Math.random() * 12 + 1).toFixed(1),
        targetProfit: targetProfit,
        isLoss: isLoss
      });
    }
  }

  if (balanceJump !== 0) {
    globalBalance += balanceJump;
  }

  const book = genBook(px);

  io.emit('market_update', {
    price: px,
    balance: globalBalance,
    candles: candleHistory,
    activePosition: activePosition,
    bgTrades: bgTrades,
    book: book
  });

}, 250);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
