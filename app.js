/**
 * StockSense · app.js
 *
 * KEY RULES:
 *  - ALL Firebase calls happen ONLY inside or after "firebase-ready"
 *  - db / rtRef / rtOnValue are module-level, set once in firebase-ready
 *  - No duplicate listeners, no DB calls at module load time
 */

// ── Firebase refs (set inside firebase-ready) ──────────────
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

import { ref, set } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, signInAnonymously } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
let db        = null;
let rtRef     = null;
let rtSet     = null;
let rtOnValue = null;

// ── App state ──────────────────────────────────────────────
let stocks      = [];
let livePrices  = {};
let allNews     = [];
let mlParams    = { threshold:3, horizon:5, mlW:50, fundW:30 };
let picksFilter = "all";
let picksSort   = "comp";
let liveFilter  = "";

// ── Seed/demo data (shown if Firebase offline) ─────────────
const DEMO = [
  {ticker:"RELIANCE",  sector:"Energy",   price:2847, ret1w:2.1,  ml:0.78,fund:0.72,sent:0.18,comp:0.735,signals:["EMA cross","Vol spike","MACD bull"]},
  {ticker:"TCS",       sector:"IT",       price:3921, ret1w:1.4,  ml:0.74,fund:0.81,sent:0.22,comp:0.713,signals:["RSI bounce","OBV rise","EMA trend"]},
  {ticker:"HDFCBANK",  sector:"Banking",  price:1712, ret1w:3.2,  ml:0.71,fund:0.76,sent:0.14,comp:0.693,signals:["BB squeeze","Vol break","MACD cross"]},
  {ticker:"BAJFINANCE",sector:"Finance",  price:6840, ret1w:1.8,  ml:0.69,fund:0.74,sent:0.11,comp:0.673,signals:["RSI climb","Fund growth","OBV bull"]},
  {ticker:"BHARTIARTL",sector:"Telecom",  price:1285, ret1w:2.9,  ml:0.67,fund:0.68,sent:0.26,comp:0.658,signals:["Gap up","Stoch cross","Vol surge"]},
  {ticker:"INFY",      sector:"IT",       price:1564, ret1w:0.8,  ml:0.63,fund:0.79,sent:0.09,comp:0.633,signals:["High ROE","Rev growth","EMA bull"]},
  {ticker:"MARUTI",    sector:"Auto",     price:10420,ret1w:1.2,  ml:0.61,fund:0.65,sent:0.07,comp:0.613,signals:["RSI 52","MACD flat","Low PE"]},
  {ticker:"SUNPHARMA", sector:"Pharma",   price:1632, ret1w:2.4,  ml:0.59,fund:0.62,sent:0.17,comp:0.593,signals:["BB upper","Vol avg","Sent pos"]},
  {ticker:"TITAN",     sector:"Consumer", price:3340, ret1w:-0.6, ml:0.54,fund:0.70,sent:0.04,comp:0.553,signals:["RSI 48","Low mom","Watchlist"]},
  {ticker:"TATAMOTORS",sector:"Auto",     price:768,  ret1w:3.8,  ml:0.51,fund:0.48,sent:0.21,comp:0.523,signals:["High beta","Sent bull","RSI 58"]},
];

const DEMO_NEWS = [
  {title:"Sensex gains 200 pts; IT stocks lead rally",         source:"Economic Times",   sent:0.32},
  {title:"Nifty Bank outperforms; HDFC, ICICI in focus",       source:"Mint",             sent:0.18},
  {title:"FII inflows continue for fifth consecutive session", source:"Business Standard",sent:0.25},
  {title:"RBI holds repo rate; signals neutral stance",        source:"BloombergQuint",   sent:0.08},
  {title:"Auto sector under pressure on global headwinds",     source:"CNBC-TV18",        sent:-0.14},
];

// ════════════════════════════════════════════════════════════
// FIREBASE READY
// ════════════════════════════════════════════════════════════
window.addEventListener("firebase-ready", () => {
  db        = window._rtdb;
  rtRef     = window._rtRef;
  rtSet     = window._rtSet;
  rtOnValue = window._rtOnValue;

  console.log("✅ Firebase ready — starting listeners");

  listenStocks();
  listenLivePrices();
  listenMarketStatus();
  listenMLParams();
  listenNews();
});

// Fallback demo if Firebase doesn't respond in 4 s
setTimeout(() => {
  if (!stocks.length) {
    console.warn("Firebase timeout — running demo mode");
    stocks  = DEMO;
    allNews = DEMO_NEWS;
    renderPicks();
    renderTape();
    renderNewsFeed(DEMO_NEWS);
    updateMoodMeter(DEMO_NEWS);
    showToast("Demo mode — start realtime_prices.py to get live data", "err");
  }
}, 4000);

// ════════════════════════════════════════════════════════════
// LISTENER: /stocks  (ML picks seed data)
// ════════════════════════════════════════════════════════════
function listenStocks() {
  rtOnValue(rtRef(db, "stocks"), snap => {
    const val = snap.val();
    if (val) {
      stocks = Object.values(val);
      console.log(`📊 /stocks: ${stocks.length} picks`);
    } else {
      // Seed on first run
      DEMO.forEach(s => rtSet(rtRef(db, "stocks/" + s.ticker), s));
      stocks = DEMO;
    }
    renderPicks();
    renderTape();
  });
}

// ════════════════════════════════════════════════════════════
// LISTENER: /live_prices  (real-time NSE prices)
// ════════════════════════════════════════════════════════════
function listenLivePrices() {
  rtOnValue(rtRef(db, "live_prices"), snap => {
    const val = snap.val();
    if (!val) return;
    livePrices = val;
    console.log(`💹 /live_prices: ${Object.keys(val).length} stocks`);

    updateLastSync();
    renderLiveTable();
    patchPickPrices();
    patchTapePrices();
    updateHeroStats();
    updateSidebar();
  });
}

// ════════════════════════════════════════════════════════════
// LISTENER: /market_status
// ════════════════════════════════════════════════════════════
function listenMarketStatus() {
  rtOnValue(rtRef(db, "market_status"), snap => {
    const val = snap.val();
    if (!val) return;
    console.log("🏦 /market_status:", val);

    const pill = document.getElementById("market-pill");
    const text = document.getElementById("market-text");
    const open = !!val.is_market_open;

    pill.className   = "market-pill " + (open ? "open" : "closed");
    text.textContent = open
      ? `Open · ▲${val.gainers || 0} ▼${val.losers || 0}`
      : `Closed · ▲${val.gainers || 0} ▼${val.losers || 0}`;
  });
}

// ════════════════════════════════════════════════════════════
// LISTENER: /ml_params  (synced slider state)
// ════════════════════════════════════════════════════════════
function listenMLParams() {
  rtOnValue(rtRef(db, "ml_params"), snap => {
    const val = snap.val();
    if (val) {
      mlParams = { ...mlParams, ...val };
      syncSliders();
    }
  });
}

// ════════════════════════════════════════════════════════════
// LISTENER: /news_cache  (headlines from Python feed)
// ════════════════════════════════════════════════════════════
function listenNews() {
  rtOnValue(rtRef(db, "news_cache"), snap => {
    const raw = snap.val();
    console.log("📰 /news_cache raw:", raw);

    if (!raw) {
      // Show demo news while feed warms up
      renderNewsFeed(DEMO_NEWS);
      updateMoodMeter(DEMO_NEWS);
      return;
    }

    // news_cache can be array or object from Firebase
    allNews = Array.isArray(raw) ? raw : Object.values(raw);
    console.log(`📰 ${allNews.length} headlines`);
    renderNewsFeed(allNews);
    updateMoodMeter(allNews);
  });
}

// ════════════════════════════════════════════════════════════
// RENDER: TOP PICKS
// ════════════════════════════════════════════════════════════
function getVisibleStocks() {
  let list = [...stocks];
  if (picksFilter === "high") list = list.filter(s => s.comp >= 0.65);
  if (picksFilter === "bull") list = list.filter(s =>
    s.comp >= 0.60 && (livePrices[s.ticker]?.change_pct ?? s.ret1w) >= 0
  );
  list.sort((a, b) => {
    if (picksSort === "comp")  return b.comp - a.comp;
    if (picksSort === "ml")    return b.ml   - a.ml;
    if (picksSort === "fund")  return b.fund - a.fund;
    if (picksSort === "ret1w") {
      const av = livePrices[a.ticker]?.change_pct ?? a.ret1w;
      const bv = livePrices[b.ticker]?.change_pct ?? b.ret1w;
      return bv - av;
    }
    return 0;
  });
  return list;
}

function renderPicks() {
  const grid = document.getElementById("picks-grid");
  const list = getVisibleStocks();
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = '<p style="color:var(--text3);padding:24px 0">No stocks match filter.</p>';
    return;
  }
  list.forEach((s, i) => {
    const card = buildPickCard(s, i);
    card.style.animationDelay = i * 0.04 + "s";
    grid.appendChild(card);
  });
}

function buildPickCard(s, rank) {
  const lp    = livePrices[s.ticker] || {};
  const price = lp.price      !== undefined ? lp.price      : s.price;
  const chg   = lp.change_pct !== undefined ? lp.change_pct : s.ret1w;
  const pct   = Math.round(s.comp * 100);
  const bc    = pct >= 70 ? "#00e5a0" : pct >= 60 ? "#f0c040" : "#6b7f96";
  const sign  = chg >= 0 ? "+" : "";

  const card = document.createElement("div");
  card.className       = "pick-card" + (rank === 0 ? " rank-1" : "");
  card.dataset.pticker = s.ticker;

  const sigs = (s.signals || []).map((sg, i) =>
    `<span class="sig ${["sig-g","sig-b","sig-y"][i] || "sig-y"}">${sg}</span>`
  ).join("");

  card.innerHTML = `
    <div class="pc-top">
      <div class="pc-rank">${rank + 1}</div>
      <div class="pc-info">
        <div class="pc-ticker">${s.ticker}</div>
        <div class="pc-sector">${s.sector}</div>
      </div>
      <div class="pc-bar-zone">
        <div class="pc-bar-row">
          <div class="pc-bar-bg"><div class="pc-bar-fill" style="width:${pct}%;background:${bc}"></div></div>
          <span class="pc-score" style="color:${bc}">${pct}%</span>
        </div>
        <div class="pc-sigs">${sigs}</div>
      </div>
      <div class="pc-price">
        <span class="pc-pval" data-prev="${price}">₹${price.toLocaleString("en-IN")}</span>
        <span class="pc-ret ${chg>=0?"pos":"neg"}">${sign}${chg.toFixed(2)}%</span>
      </div>
    </div>`;
  return card;
}

function patchPickPrices() {
  Object.entries(livePrices).forEach(([ticker, lp]) => {
    const pEl = document.querySelector(`[data-pticker="${ticker}"] .pc-pval`);
    const rEl = document.querySelector(`[data-pticker="${ticker}"] .pc-ret`);
    if (pEl && lp.price) {
      const prev = parseFloat(pEl.dataset.prev || lp.price);
      const dir  = lp.price > prev ? "pos" : lp.price < prev ? "neg" : "";
      pEl.textContent  = "₹" + lp.price.toLocaleString("en-IN");
      pEl.dataset.prev = lp.price;
      if (dir) {
        pEl.classList.remove("flash-pos","flash-neg");
        void pEl.offsetWidth;
        pEl.classList.add("flash-" + dir);
      }
    }
    if (rEl && lp.change_pct !== undefined) {
      rEl.textContent = (lp.change_pct >= 0 ? "+" : "") + lp.change_pct.toFixed(2) + "%";
      rEl.className   = "pc-ret " + (lp.change_pct >= 0 ? "pos" : "neg");
    }
  });
}

// ════════════════════════════════════════════════════════════
// RENDER: LIVE PRICES TABLE
// ════════════════════════════════════════════════════════════
function renderLiveTable() {
  const tbody   = document.getElementById("live-tbody");
  const entries = Object.entries(livePrices)
    .filter(([t]) => t.toLowerCase().includes(liveFilter))
    .sort((a, b) => (b[1].change_pct || 0) - (a[1].change_pct || 0));

  document.getElementById("live-count").textContent = Object.keys(livePrices).length + " stocks";

  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="tbl-empty">No matching stocks</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(([ticker, lp]) => {
    const chg  = lp.change_pct || 0;
    const cls  = chg >= 0 ? "pos" : "neg";
    const sign = chg >= 0 ? "+" : "";
    const vol  = lp.volume ? (lp.volume / 1e6).toFixed(1) + "M" : "—";
    const high = lp.day_high ? "₹" + lp.day_high.toLocaleString("en-IN") : "—";
    const low  = lp.day_low  ? "₹" + lp.day_low.toLocaleString("en-IN")  : "—";
    const open = lp.is_market_open;
    return `<tr>
      <td class="td-ticker">${ticker}</td>
      <td class="td-price">₹${(lp.price||0).toLocaleString("en-IN")}</td>
      <td class="td-chg ${cls}">${sign}${chg.toFixed(2)}%</td>
      <td>${high}</td><td>${low}</td><td>${vol}</td>
      <td class="td-mkt ${open?"open":"closed"}">${open?"● Open":"○ Closed"}</td>
    </tr>`;
  }).join("");
}

// ════════════════════════════════════════════════════════════
// TICKER TAPE
// ════════════════════════════════════════════════════════════
function renderTape() {
  const tape  = document.getElementById("ticker-tape");
  const items = [...stocks, ...stocks];
  tape.innerHTML = items.map(s => {
    const lp  = livePrices[s.ticker] || {};
    const p   = lp.price      !== undefined ? lp.price      : s.price;
    const c   = lp.change_pct !== undefined ? lp.change_pct : s.ret1w;
    return `<span class="tape-item" data-tticker="${s.ticker}">
      <span class="tape-name">${s.ticker}</span>
      <span class="tape-price">₹${p.toLocaleString("en-IN")}</span>
      <span class="tape-chg ${c>=0?"pos":"neg"}">${c>=0?"+":""}${c.toFixed(2)}%</span>
    </span>`;
  }).join("");
}

function patchTapePrices() {
  Object.entries(livePrices).forEach(([ticker, lp]) => {
    const tEl  = document.querySelector(`.tape-item[data-tticker="${ticker}"] .tape-price`);
    const tcEl = document.querySelector(`.tape-item[data-tticker="${ticker}"] .tape-chg`);
    if (tEl)  tEl.textContent  = "₹" + lp.price.toLocaleString("en-IN");
    if (tcEl) {
      tcEl.textContent = (lp.change_pct>=0?"+":"") + lp.change_pct.toFixed(2) + "%";
      tcEl.className   = "tape-chg " + (lp.change_pct>=0?"pos":"neg");
    }
  });
}

// ════════════════════════════════════════════════════════════
// HERO STATS + SIDEBAR
// ════════════════════════════════════════════════════════════
function updateHeroStats() {
  const prices = Object.values(livePrices);
  if (!prices.length) return;
  const gainers = prices.filter(p => p.change_pct > 0).length;
  const losers  = prices.filter(p => p.change_pct < 0).length;
  const avg     = prices.reduce((s, p) => s + (p.change_pct||0), 0) / prices.length;

  document.getElementById("stat-gainers").textContent = gainers;
  document.getElementById("stat-losers").textContent  = losers;
  document.getElementById("stat-total").textContent   = prices.length;

  const avgEl = document.getElementById("stat-avg");
  avgEl.textContent = (avg>=0?"+":"") + avg.toFixed(2) + "%";
  avgEl.className   = "hstat-val " + (avg>=0?"pos":"neg");
}

function updateSidebar() {
  const prices = Object.values(livePrices);
  if (!prices.length) return;

  const sorted = [...prices].sort((a,b) => b.change_pct - a.change_pct);

  // Top gainers
  document.getElementById("top-gainers").innerHTML = sorted.slice(0,5).map(p =>
    `<div class="mover-row">
      <span class="mover-name">${p.ticker}</span>
      <span class="mover-chg pos">+${(p.change_pct||0).toFixed(2)}%</span>
    </div>`
  ).join("");

  // Top losers
  document.getElementById("top-losers").innerHTML = [...sorted].reverse().slice(0,5).map(p =>
    `<div class="mover-row">
      <span class="mover-name">${p.ticker}</span>
      <span class="mover-chg neg">${(p.change_pct||0).toFixed(2)}%</span>
    </div>`
  ).join("");

  // Sector heatmap using stocks for sector mapping
  const sectors = {};
  stocks.forEach(s => {
    const lp = livePrices[s.ticker];
    if (!lp) return;
    if (!sectors[s.sector]) sectors[s.sector] = {sum:0, count:0};
    sectors[s.sector].sum   += lp.change_pct || 0;
    sectors[s.sector].count += 1;
  });

  document.getElementById("sector-grid").innerHTML = Object.entries(sectors).map(([name, d]) => {
    const avg = d.sum / d.count;
    const bg  = avg>=0 ? `rgba(0,229,160,${0.08+Math.min(Math.abs(avg)/3,1)*0.2})`
                       : `rgba(255,77,109,${0.08+Math.min(Math.abs(avg)/3,1)*0.2})`;
    const col = avg>=0 ? "var(--accent)" : "var(--danger)";
    return `<div class="sector-cell" style="background:${bg}">
      <span class="sector-cell-name">${name}</span>
      <span class="sector-cell-val" style="color:${col}">${avg>=0?"+":""}${avg.toFixed(2)}%</span>
    </div>`;
  }).join("");
}

// ════════════════════════════════════════════════════════════
// NEWS FEED
// ════════════════════════════════════════════════════════════
function renderNewsFeed(items) {
  const feed = document.getElementById("news-feed");
  if (!items || !items.length) {
    feed.innerHTML = '<p class="news-empty">No headlines yet — run realtime_prices.py to populate.</p>';
    return;
  }
  feed.innerHTML = items.map((n, i) => {
    const s   = typeof n.sent === "number" ? n.sent : 0;
    const cls = s > 0.1 ? "sent-pos" : s < -0.1 ? "sent-neg" : "sent-neu";
    const lbl = s > 0.1 ? "+" + s.toFixed(2) : s.toFixed(2);
    return `<div class="news-item" style="animation-delay:${i*0.06}s">
      <div class="news-headline">${n.title || n.headline || "—"}</div>
      <div class="news-meta">
        <span class="news-source">${n.source || "Market News"}</span>
        ${n.ago ? `<span>${n.ago}</span>` : ""}
        <span class="sent-pill ${cls}">${lbl}</span>
      </div>
    </div>`;
  }).join("");
}

function updateMoodMeter(items) {
  if (!items.length) return;
  const avg = items.reduce((s, n) => s + (typeof n.sent==="number" ? n.sent : 0), 0) / items.length;
  const pct = Math.round(((avg + 1) / 2) * 100);
  document.getElementById("mood-fill").style.width  = pct + "%";
  const lbl = avg > 0.15 ? "Bullish" : avg < -0.15 ? "Bearish" : "Neutral";
  const col = avg > 0.15 ? "var(--accent)" : avg < -0.15 ? "var(--danger)" : "var(--text2)";
  document.getElementById("mood-score").textContent = lbl;
  document.getElementById("mood-score").style.color = col;
}

function filterNews() {
  const q = document.getElementById("news-input").value.trim().toLowerCase();
  if (!q) { renderNewsFeed(allNews); return; }
  const filtered = allNews.filter(n =>
    (n.title||n.headline||"").toLowerCase().includes(q) ||
    (n.source||"").toLowerCase().includes(q)
  );
  renderNewsFeed(filtered.length ? filtered : allNews);
}

// ════════════════════════════════════════════════════════════
// ML CONTROLS
// ════════════════════════════════════════════════════════════
function setupMLControls() {
  const sliders = [
    ["sl-threshold","val-threshold", v => { mlParams.threshold=+v; return v+"%"; }],
    ["sl-horizon",  "val-horizon",   v => { mlParams.horizon=+v;   return v+" days"; }],
    ["sl-ml-w",     "val-ml-w",      v => { mlParams.mlW=+v;       return v+"%"; }],
    ["sl-fund-w",   "val-fund-w",    v => { mlParams.fundW=+v;     return v+"%"; }],
  ];
  sliders.forEach(([id, valId, fn]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      document.getElementById(valId).textContent = fn(el.value);
      updateWeightViz();
    });
  });

  document.getElementById("btn-apply-params").addEventListener("click", () => {
    const sentW = Math.max(0, 100 - mlParams.mlW - mlParams.fundW);
    stocks = stocks.map(s => ({
      ...s,
      comp: Math.min(0.99, (mlParams.mlW/100)*s.ml + (mlParams.fundW/100)*s.fund + (sentW/100)*((s.sent+1)/2))
    }));
    renderPicks();
    if (db) rtSet(rtRef(db,"ml_params"), mlParams);
    document.getElementById("ml-status").textContent = "Rescored ✓";
    setTimeout(() => { document.getElementById("ml-status").textContent = ""; }, 2500);
    showToast("ML params applied — picks rescored");
  });

  document.getElementById("btn-reset-params").addEventListener("click", () => {
    mlParams = { threshold:3, horizon:5, mlW:50, fundW:30 };
    syncSliders();
    if (db) rtSet(rtRef(db,"ml_params"), mlParams);
    showToast("Params reset to defaults");
  });
}

function syncSliders() {
  document.getElementById("sl-threshold").value        = mlParams.threshold;
  document.getElementById("val-threshold").textContent = mlParams.threshold + "%";
  document.getElementById("sl-horizon").value          = mlParams.horizon;
  document.getElementById("val-horizon").textContent   = mlParams.horizon + " days";
  document.getElementById("sl-ml-w").value             = mlParams.mlW;
  document.getElementById("val-ml-w").textContent      = mlParams.mlW + "%";
  document.getElementById("sl-fund-w").value           = mlParams.fundW;
  document.getElementById("val-fund-w").textContent    = mlParams.fundW + "%";
  updateWeightViz();
}

function updateWeightViz() {
  const sentW = Math.max(0, 100 - mlParams.mlW - mlParams.fundW);
  const ml   = document.getElementById("wv-ml");
  const fund = document.getElementById("wv-fund");
  const sent = document.getElementById("wv-sent");
  if (!ml) return;
  ml.style.flex   = mlParams.mlW;
  fund.style.flex = mlParams.fundW;
  sent.style.flex = sentW;
  ml.textContent   = `ML ${mlParams.mlW}%`;
  fund.textContent = `Fund ${mlParams.fundW}%`;
  sent.textContent = `Sent ${sentW}%`;
}

// ════════════════════════════════════════════════════════════
// PICKS FILTER + SORT
// ════════════════════════════════════════════════════════════
function initPicksControls() {
  document.querySelectorAll(".fpill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fpill").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      picksFilter = btn.dataset.filter;
      renderPicks();
    });
  });
  document.getElementById("picks-sort").addEventListener("change", e => {
    picksSort = e.target.value;
    renderPicks();
  });
}

// ════════════════════════════════════════════════════════════
// RUN SCAN
// ════════════════════════════════════════════════════════════
function initRunScan() {
  document.getElementById("btn-run-scan").addEventListener("click", function() {
    this.textContent = "Scanning…";
    this.disabled    = true;
    setTimeout(() => {
      stocks = stocks.map(s => ({
        ...s,
        comp:  Math.min(0.99, Math.max(0.3, s.comp  + (Math.random()-.5)*.08)),
        ml:    Math.min(0.99, Math.max(0.3, s.ml    + (Math.random()-.5)*.08)),
        ret1w: +(s.ret1w + (Math.random()-.5)*.7).toFixed(2),
      }));
      renderPicks();
      renderTape();
      this.textContent = "⟳ Scan";
      this.disabled    = false;
      showToast("Scan complete — picks refreshed ✓");
    }, 1800);
  });
}

// ════════════════════════════════════════════════════════════
// SCROLL SPY — highlight active nav pill
// ════════════════════════════════════════════════════════════
function initScrollSpy() {
  const sections = document.querySelectorAll(".page-section");
  const pills    = document.querySelectorAll(".nav-pill");
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const id = "#" + e.target.id;
        pills.forEach(p => p.classList.toggle("active", p.getAttribute("href") === id));
      }
    });
  }, { rootMargin: "-30% 0px -65% 0px" });
  sections.forEach(s => obs.observe(s));
}

// ════════════════════════════════════════════════════════════
// PARTICLE CANVAS
// ════════════════════════════════════════════════════════════
function initCanvas() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;
  const pts = Array.from({length:35}, () => ({
    x: Math.random()*window.innerWidth,  y: Math.random()*window.innerHeight,
    vx:(Math.random()-.5)*.22,           vy:(Math.random()-.5)*.22,
    r: Math.random()*1.3+.3,             a: Math.random()*.3+.08,
  }));
  const resize = () => { W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; };
  resize();
  window.addEventListener("resize", resize);
  (function draw() {
    ctx.clearRect(0,0,W,H);
    pts.forEach(p => {
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=W; if(p.x>W)p.x=0;
      if(p.y<0)p.y=H; if(p.y>H)p.y=0;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(0,229,160,${p.a})`; ctx.fill();
    });
    requestAnimationFrame(draw);
  })();
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function updateLastSync() {
  const t = new Date().toLocaleTimeString("en-IN");
  ["last-sync","footer-sync"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  });
}

function showToast(msg, type="ok") {
  const stack = document.getElementById("toast-stack");
  const el    = document.createElement("div");
  el.className = "toast" + (type==="err"?" err":"");
  el.innerHTML = `<span style="color:${type==="err"?"#ff4d6d":"#00e5a0"}">${type==="err"?"✕":"✓"}</span> ${msg}`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.animation = "toast-out .3s forwards";
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  initCanvas();
  initPicksControls();
  setupMLControls();
  initRunScan();
  initScrollSpy();

  // Live table filter
  document.getElementById("live-search").addEventListener("input", e => {
    liveFilter = e.target.value.toLowerCase();
    renderLiveTable();
  });

  // News filter
  document.getElementById("news-input").addEventListener("input", filterNews);
  document.getElementById("btn-news-clear").addEventListener("click", () => {
    document.getElementById("news-input").value = "";
    renderNewsFeed(allNews);
  });
});
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

loginBtn.onclick = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    console.log("✅ Logged in:", user);

    // Save user profile in DB
    await set(ref(db, "users/" + user.uid), {
      name: user.displayName,
      email: user.email,
      photo: user.photoURL,
      last_login: Date.now()
    });

  } catch (error) {
    console.error("❌ Login error:", error);
  }
};
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("👤 Active user:", user.uid);

    loginBtn.style.display = "none";
    logoutBtn.style.display = "block";

    // 🔥 START FIREBASE LISTENERS HERE
    startApp(user);

  } else {
    loginBtn.style.display = "block";
    logoutBtn.style.display = "none";
  }
});
logoutBtn.onclick = () => {
  signOut(auth);
};
function startApp(user) {

  onValue(ref(db, "live_prices"), (snap) => {
    console.log("LIVE:", snap.val());
  });

  onValue(ref(db, "stocks"), (snap) => {
    console.log("STOCKS:", snap.val());
  });

  onValue(ref(db, "news_cache"), (snap) => {
    console.log("NEWS:", snap.val());
  });

}