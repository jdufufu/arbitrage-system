// server.js (PartyKit Server for Cloudflare)
const EPOCH = 1704067200000;
const CANDLE_MS = 2000;
const VISIBLE_CANDLES = 48;

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
function seedFor(i) { return ((i * 2654435761) >>> 0) ^ 0x9E3779B9; }

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

export default class ArbitrageServer {
  constructor(room) {
    this.room = room;
    this.currentPrice = 124.0204;
    this.globalBalance = 120192307.45;
    this.candleHistory = [];
    this.activePosition = null;
    this.cooldownUntil = 0;
    this.bgTrades = [];
    this.lastCandleTime = 0;

    this.initCandles();
    this.startLoop();
  }

  initCandles() {
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

  updateLivePrice() {
    const now = Date.now();
    if (this.activePosition) {
      const elapsed = now - this.activePosition.start;
      const pct = Math.min(1, elapsed / this.activePosition.duration);
      const progression = (pct * 1.05) - Math.sin(pct * Math.PI * 2.5) * 0.15;
      let drift = progression * this.activePosition.driftTarget;
      if (this.activePosition.isLoss) {
        drift = -drift; 
      }
      const noise = (Math.random() - 0.5) * (this.activePosition.entry * 0.00004);
      if (this.activePosition.type === 'BUY') {
        this.currentPrice = this.activePosition.entry + drift + noise;
      } else {
        this.currentPrice = this.activePosition.entry - drift - noise;
      }
    } else {
      const change = (Math.random() - 0.5) * 0.014;
      this.currentPrice += change;
    }
    return this.currentPrice;
  }

  startLoop() {
    setInterval(() => {
      const now = Date.now();
      const currentCandleTime = Math.floor(now / CANDLE_MS) * CANDLE_MS;

      if (currentCandleTime > this.lastCandleTime) {
        const prevClose = this.candleHistory.length > 0 ? this.candleHistory[this.candleHistory.length - 1].c : this.currentPrice;
        this.candleHistory.push(getSampledCandle(Math.floor(currentCandleTime / CANDLE_MS)));
        if (this.candleHistory.length > VISIBLE_CANDLES) {
          this.candleHistory.shift();
        }
        this.lastCandleTime = currentCandleTime;
      }

      const px = this.updateLivePrice();

      if (this.candleHistory.length > 0) {
        const lastCandle = this.candleHistory[this.candleHistory.length - 1];
        lastCandle.c = px;
        if (px > lastCandle.h) lastCandle.h = px;
        if (px < lastCandle.l) lastCandle.l = px;
      }

      let balanceJump = 0;

      if (this.activePosition) {
        const elapsed = now - this.activePosition.start;
        if (elapsed >= this.activePosition.duration) {
          balanceJump += this.activePosition.profitTarget;
          this.activePosition = null;
          const silentIntervals = [5000, 10000, 15000, 20000];
          this.cooldownUntil = now + silentIntervals[Math.floor(Math.random() * silentIntervals.length)];
        }
      } else {
        if (now > this.cooldownUntil) {
          const tradeType = Math.random() < 0.5 ? 'BUY' : 'SELL';
          const tradeDuration = Math.random() * 800 + 1200;
          const driftTarget = this.currentPrice * (Math.random() * 0.00015 + 0.00006);
          const isLoss = Math.random() < 0.35;
          const profitTarget = isLoss 
            ? -parseFloat((Math.random() * 6.00 + 1.00).toFixed(2)) 
            : parseFloat((Math.random() * 7.00 + 0.50).toFixed(2));
          this.activePosition = {
            entry: this.currentPrice,
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
      this.bgTrades.forEach(t => {
        const elapsed = now - t.start;
        if (elapsed >= t.duration) {
          balanceJump += t.targetProfit;
        } else {
          activeBg.push(t);
        }
      });
      this.bgTrades = activeBg;

      if (this.bgTrades.length < 15) {
        let spawnChance = 0.12;
        if (this.bgTrades.length < 2) spawnChance = 0.45;
        else if (this.bgTrades.length > 6) spawnChance = 0.04;
        if (Math.random() < spawnChance) {
          const coins = ['Coin-39', 'Coin-49', 'Coin-5', 'Coin-12', 'Coin-74', 'Asset-8', 'Asset-22', 'Asset-16'];
          const assetSelected = coins[Math.floor(Math.random() * coins.length)];
          const duration = Math.random() * 900 + 1100;
          const basePrice = Math.random() * 60 + 15;
          const isLoss = Math.random() < 0.35;
          const targetProfit = isLoss 
            ? -parseFloat((Math.random() * 5.00 + 1.00).toFixed(2)) 
            : parseFloat((Math.random() * 5.50 + 0.50).toFixed(2));
          this.bgTrades.push({
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
        this.globalBalance += balanceJump;
      }

      const book = genBook(px);

      this.room.broadcast(JSON.stringify({
        price: px,
        balance: this.globalBalance,
        candles: this.candleHistory,
        activePosition: this.activePosition,
        bgTrades: this.bgTrades,
        book: book
      }));

    }, 250);
  }

  onConnect(connection, ctx) {
    connection.send(JSON.stringify({
      price: this.currentPrice,
      balance: this.globalBalance,
      candles: this.candleHistory,
      activePosition: this.activePosition,
      bgTrades: this.bgTrades,
      book: genBook(this.currentPrice)
    }));
  }
      }
