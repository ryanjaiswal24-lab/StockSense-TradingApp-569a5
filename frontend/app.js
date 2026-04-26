import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Replace these placeholders with your real Firebase project values.
const firebaseConfig = {
  apiKey: "AIzaSyCbObdFKQlKp_5RsbnEw93oAFBYL3Cpp7c",
  authDomain: "stockscene-560d7.firebaseapp.com",
  databaseURL: "https://stockscene-560d7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "stockscene-560d7",
  storageBucket: "stockscene-560d7.firebasestorage.app",
  messagingSenderId: "432599841369",
  appId: "1:432599841369:web:54534225513a62859a0f48",
  measurementId: "G-BK3LQEX87Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getDatabase(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const state = {
  user: null,
  stocks: {},
  livePrices: {},
  news: [],
  marketStatus: null,
  aiPicks: {},
  listenersStarted: false,
  newsLimit: 5
};

const authGate = document.getElementById("authGate");
const appShell = document.getElementById("appShell");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");
const picksGrid = document.getElementById("picksGrid");
const liveGrid = document.getElementById("liveGrid");
const newsGrid = document.getElementById("newsGrid");
const marketPhase = document.getElementById("marketPhase");
const marketSummary = document.getElementById("marketSummary");
const trackedCount = document.getElementById("trackedCount");
const lastRefresh = document.getElementById("lastRefresh");
const profilePic = document.getElementById("profile-pic");
const profileName = document.getElementById("profile-name");
const profileEmail = document.getElementById("profile-email");
const headerProfilePic = document.getElementById("profile-card-pic");
const headerProfileName = document.getElementById("profile-card-name");
const headerProfileEmail = document.getElementById("profile-card-email");
const profilePill = document.getElementById("profile-pill");
const displayNameInput = document.getElementById("displayNameInput");
const themeAccentInput = document.getElementById("themeAccentInput");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const profileSaveStatus = document.getElementById("profileSaveStatus");
const portTicker = document.getElementById("port-ticker");
const portQty = document.getElementById("port-qty");
const portBuyPrice = document.getElementById("port-buy-price");
const btnPortAdd = document.getElementById("btn-port-add");
const portTbody = document.getElementById("port-tbody");
const pmInvested = document.getElementById("pm-invested");
const pmCurrent = document.getElementById("pm-current");
const indexBar = document.getElementById("index-bar");
const liveSearch = document.getElementById("live-search");
const btnLiveSearch = document.getElementById("btn-live-search");
const liveCount = document.getElementById("live-count");
const liveTablesContainer = document.getElementById("live-tables-container");
const aiGrid = document.getElementById("aiGrid");
const newsInput = document.getElementById("news-input");
const btnNewsClear = document.getElementById("btn-news-clear");
const topGainers = document.getElementById("top-gainers");
const topLosers = document.getElementById("top-losers");
const sectorGrid = document.getElementById("sector-grid");
const statGainers = document.getElementById("stat-gainers");
const statLosers = document.getElementById("stat-losers");
const statAvg = document.getElementById("stat-avg");

loginBtn?.addEventListener("click", async () => {
  if (authStatus) authStatus.textContent = "Opening Google sign-in...";
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (authStatus) authStatus.textContent = error.message;
    console.error("Login error:", error);
  }
});

logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
});

saveProfileBtn?.addEventListener("click", async () => {
  if (!state.user) {
    if (profileSaveStatus) profileSaveStatus.textContent = "Log in first to save profile settings.";
    return;
  }

  const customName = displayNameInput.value.trim();
  const accent = themeAccentInput.value;

  try {
    await update(ref(db, `users/${state.user.uid}/profile`), {
      customName,
      themeAccent: accent,
      updatedAt: Date.now()
    });
    applyAccent(accent);
    profileSaveStatus.textContent = "Profile settings saved.";
  } catch (error) {
    profileSaveStatus.textContent = "Failed to save profile settings.";
    console.error("Profile save error:", error);
  }
});

btnPortAdd?.addEventListener("click", async () => {
  if (!state.user) {
    alert("Log in first to save portfolio data.");
    return;
  }

  const ticker = portTicker?.value.trim().toUpperCase();
  const qty = Number(portQty?.value || 0);
  const buyPrice = Number(portBuyPrice?.value || 0);

  if (!ticker || qty <= 0 || buyPrice <= 0) {
    alert("Enter a valid ticker, quantity and buy price.");
    return;
  }

  const holding = {
    ticker,
    qty,
    buyPrice,
    addedAt: Date.now()
  };

  try {
    await set(ref(db, `users/${state.user.uid}/portfolio/${ticker}`), holding);
    loadPortfolio();
    if (portTicker) portTicker.value = "";
    if (portQty) portQty.value = "";
    if (portBuyPrice) portBuyPrice.value = "";
  } catch (error) {
    console.error("Portfolio save error:", error);
    alert("Failed to save portfolio item.");
  }
});

window.quickAddToPortfolio = async function(ticker, price) {
  if (!state.user) {
    alert("Log in first to save portfolio data.");
    return;
  }
  const safeTicker = ticker.replace(/[^a-zA-Z0-9]/g, '_');
  const qtyInput = document.getElementById(`qty-${safeTicker}`);
  const qty = Number(qtyInput ? qtyInput.value : 1);
  if (isNaN(qty) || qty <= 0) {
    alert("Invalid quantity.");
    return;
  }

  const holding = {
    ticker,
    qty,
    buyPrice: Number(price),
    addedAt: Date.now()
  };

  try {
    await set(ref(db, `users/${state.user.uid}/portfolio/${safeTicker}`), holding);
    loadPortfolio();
    alert(`Successfully added ${qty} shares of ${ticker} to your portfolio!`);
  } catch (error) {
    console.error("Portfolio save error:", error);
    alert("Failed to save portfolio item.");
  }
};

window.requestAITrain = async function(ticker) {
  if (!state.user) {
    alert("Log in first to request AI training.");
    return;
  }
  try {
    const btnId = `btn-train-${ticker.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const btn = document.getElementById(btnId);
    if (btn) btn.textContent = "Training...";
    
    const safeTicker = ticker.replace(/[^a-zA-Z0-9]/g, '_');
    await set(ref(db, `commands/train_model/${safeTicker}`), {
      ticker: ticker,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("Train request error:", error);
    alert("Failed to request AI training.");
  }
};

window.removeFromPortfolio = async function(ticker) {
  if (!state.user || !confirm(`Remove ${ticker} from portfolio?`)) return;
  try {
    const safeTicker = ticker.replace(/[^a-zA-Z0-9]/g, '_');
    await update(ref(db, `users/${state.user.uid}/portfolio`), {
      [safeTicker]: null
    });
    loadPortfolio();
  } catch (err) {
    console.error("Remove error:", err);
    alert("Failed to remove item.");
  }
};


document.querySelectorAll(".nav-pill").forEach((button) => {
  button.addEventListener("click", (e) => {
    e.preventDefault();
    activateTab(button.dataset.tab);
  });
});

liveSearch?.addEventListener("input", renderDashboard);
btnLiveSearch?.addEventListener("click", renderDashboard);
newsInput?.addEventListener("input", renderNews);
btnNewsClear?.addEventListener("click", () => {
  if (newsInput) newsInput.value = "";
  renderNews();
});

onAuthStateChanged(auth, async (user) => {
  state.user = user;

  if (!user) {
    if (authGate) {
      authGate.classList.remove("hidden");
      appShell?.classList.add("hidden");
    } else {
      appShell?.classList.remove("hidden");
    }
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (profilePill) profilePill.style.display = "none";
    if (authStatus) authStatus.textContent = "";
    setUserUI(null, null);
    startListeners();
    return;
  }

  if (authGate) {
    authGate.classList.add("hidden");
  }
  appShell?.classList.remove("hidden");
  if (loginBtn) loginBtn.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "inline-flex";
  if (profilePill) profilePill.style.display = "flex";
  await upsertUser(user);
  const profilePrefs = await getUserProfile(user.uid);
  setUserUI(user, profilePrefs);
  startListeners();
});

function activateTab(tabName) {
  document.querySelectorAll(".nav-pill").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  document.querySelectorAll(".page-section").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `section-${tabName}`);
  });
}

function startListeners() {
  if (state.listenersStarted) {
    return;
  }

  state.listenersStarted = true;

  onValue(ref(db, "stocks"), (snapshot) => {
    state.stocks = snapshot.val() || {};
    renderDashboard();
  });

  onValue(ref(db, "live_prices"), (snapshot) => {
    state.livePrices = snapshot.val() || {};
    renderDashboard();
  });

  onValue(ref(db, "news_cache"), (snapshot) => {
    state.news = snapshot.val() || [];
    renderNews();
  });

  onValue(ref(db, "market_status"), (snapshot) => {
    state.marketStatus = snapshot.val() || null;
    renderMarketStatus();
  });

  onValue(ref(db, "ai_picks"), (snapshot) => {
    state.aiPicks = snapshot.val() || {};
    renderAIPicks();
  });

  onValue(ref(db, "market_indices"), (snapshot) => {
    const indices = snapshot.val() || {};
    renderIndexBar(indices);
  });

  if (state.user) {
    loadPortfolio();
  }
}

async function upsertUser(user) {
  await update(ref(db, `users/${user.uid}`), {
    email: user.email || "",
    photoURL: user.photoURL || "",
    displayName: user.displayName || "",
    lastLoginAt: Date.now()
  });
}

async function getUserProfile(uid) {
  try {
    const snapshot = await get(ref(db, `users/${uid}/profile`));
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Profile fetch error:", error);
    return {};
  }
}

async function loadPortfolio() {
  if (!state.user || !portTbody) {
    return;
  }

  try {
    const snapshot = await get(ref(db, `users/${state.user.uid}/portfolio`));
    const portfolio = snapshot.exists() ? snapshot.val() : {};
    state.portfolio = portfolio;
    renderPortfolio(portfolio);
  } catch (error) {
    console.error("Portfolio load error:", error);
  }
}

function renderPortfolio(portfolio) {
  if (!portTbody) return;

  const rows = Object.values(portfolio || {}).map((item) => {
    const currentValue = Number(item.qty || 0) * Number(item.buyPrice || 0);
    return `
      <tr>
        <td>${item.ticker}</td>
        <td>${item.qty}</td>
        <td>${formatCurrency(item.buyPrice)}</td>
        <td>${formatCurrency(currentValue)}</td>
        <td>${formatCurrency(Number(item.qty || 0) * Number(item.buyPrice || 0))}</td>
        <td>${formatCurrency(currentValue)}</td>
        <td>—</td>
        <td>${formatCurrency(currentValue)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="window.removeFromPortfolio('${item.ticker}')" style="color: var(--negative);">🗑 Remove</button></td>
      </tr>
    `;
  });

  portTbody.innerHTML = rows.join("");
}

function setUserUI(user, profilePrefs) {
  if (!user) {
    if (profileName) profileName.textContent = "Guest";
    if (profileEmail) profileEmail.textContent = "Not logged in";
    if (headerProfileName) headerProfileName.textContent = "Guest";
    if (headerProfileEmail) headerProfileEmail.textContent = "Not logged in";
    profilePic?.removeAttribute("src");
    headerProfilePic?.removeAttribute("src");
    if (displayNameInput) displayNameInput.value = "";
    if (themeAccentInput) themeAccentInput.value = "emerald";
    applyAccent("emerald");
    return;
  }

  const preferredName = profilePrefs?.customName || user.displayName || "User";
  const accent = profilePrefs?.themeAccent || "emerald";
  const photo = user.photoURL || "";

  if (profileName) profileName.textContent = preferredName;
  if (profileEmail) profileEmail.textContent = user.email || "";
  if (headerProfileName) headerProfileName.textContent = preferredName;
  if (headerProfileEmail) headerProfileEmail.textContent = user.email || "";
  if (displayNameInput) displayNameInput.value = profilePrefs?.customName || "";
  if (themeAccentInput) themeAccentInput.value = accent;
  if (profilePic) profilePic.src = photo;
  if (headerProfilePic) headerProfilePic.src = photo;
  applyAccent(accent);
}

function applyAccent(accent) {
  document.body.dataset.accent = accent;
}

function renderDashboard() {
  const merged = Object.keys(state.stocks).map((ticker) => ({
    ticker,
    ...state.stocks[ticker],
    ...(state.livePrices[ticker.replace(".", "_")] || {})
  }));

  if (trackedCount) trackedCount.textContent = String(merged.length);
  
  const gainersCount = merged.filter(s => (s.change_pct || 0) > 0).length;
  const losersCount = merged.filter(s => (s.change_pct || 0) < 0).length;
  const totalChange = merged.reduce((acc, s) => acc + (s.change_pct || 0), 0);
  const avgMove = merged.length > 0 ? totalChange / merged.length : 0;

  if (statGainers) statGainers.textContent = String(gainersCount);
  if (statLosers) statLosers.textContent = String(losersCount);
  if (statAvg) statAvg.textContent = `${avgMove.toFixed(2)}%`;

  // Render Sidebar Widgets
  renderSidebar(merged);

  // Render Live
  let liveMerged = [...merged];
  const query = liveSearch?.value.toLowerCase().trim() || "";
  if (query) {
    liveMerged = liveMerged.filter(s => s.ticker.toLowerCase().includes(query));
  }
  if (liveCount) liveCount.textContent = `${liveMerged.length} stocks`;
  renderLive(liveMerged);
}

function renderSidebar(stocks) {
  const sortedByChange = [...stocks].sort((a, b) => (Number(b.change_pct) || 0) - (Number(a.change_pct) || 0));
  
  if (topGainers) {
    const gainers = sortedByChange.slice(0, 3).filter(s => (Number(s.change_pct) || 0) > 0);
    topGainers.innerHTML = gainers.map(s => `<div class="mover-row"><span>${s.ticker}</span><span class="positive">+${Number(s.change_pct).toFixed(2)}%</span></div>`).join("") || emptyState("No gainers");
  }
  
  if (topLosers) {
    const losers = sortedByChange.slice(-3).reverse().filter(s => (Number(s.change_pct) || 0) < 0);
    topLosers.innerHTML = losers.map(s => `<div class="mover-row"><span>${s.ticker}</span><span class="negative">${Number(s.change_pct).toFixed(2)}%</span></div>`).join("") || emptyState("No losers");
  }
  
  if (sectorGrid) {
    const sectors = {};
    stocks.forEach(s => {
      const sec = s.sector || "Other";
      if (!sectors[sec]) sectors[sec] = { count: 0, change: 0 };
      sectors[sec].count++;
      sectors[sec].change += (Number(s.change_pct) || 0);
    });
    const html = Object.entries(sectors).map(([sec, data]) => {
      const avg = data.change / data.count;
      const cls = avg >= 0 ? "positive" : "negative";
      return `<div class="sector-cell"><span>${sec}</span><span class="${cls}">${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%</span></div>`;
    }).join("");
    sectorGrid.innerHTML = html || emptyState("No sectors");
  }
}

function renderLive(stocks) {
  if (!liveTablesContainer) return;

  if (!stocks.length) {
    liveTablesContainer.innerHTML = emptyState("No stocks match the criteria.");
    return;
  }

  // Save open states
  const openDetails = new Set();
  document.querySelectorAll('.scrip-accordion[open]').forEach(el => {
    if (el.id) openDetails.add(el.id);
  });
  const focusedInput = document.activeElement;
  const focusedInputId = focusedInput && focusedInput.tagName === "INPUT" ? focusedInput.id : null;
  const focusedInputValue = focusedInputId ? focusedInput.value : null;

  // Group stocks by sector
  const bySector = {};
  stocks.forEach(stock => {
    const sec = stock.sector || "Uncategorized";
    if (!bySector[sec]) bySector[sec] = [];
    bySector[sec].push(stock);
  });

  // Sort sectors alphabetically
  const sortedSectors = Object.keys(bySector).sort();

  liveTablesContainer.innerHTML = sortedSectors.map(sector => {
    const sectorStocks = bySector[sector];
    
    // Sort stocks within sector by change_pct
    sectorStocks.sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0));

    const rows = sectorStocks.map(stock => {
      const change = Number(stock.change_pct || 0);
      const cls = change >= 0 ? "positive" : "negative";
      const icon = change >= 0 ? "▲" : "▼";
      const aiScore = stock.ml ? formatScore(stock.ml) : "N/A";
      const signals = Array.isArray(stock.signals) ? stock.signals.join(", ") : "N/A";
      const safeTicker = stock.ticker.replace(/[^a-zA-Z0-9]/g, '_');
      
      return `
        <details class="scrip-accordion" id="details-${safeTicker}">
          <summary class="scrip-summary">
            <div class="scrip-grid">
              <span class="td-ticker">${stock.ticker}</span>
              <strong class="price-value ${cls}">${formatCurrency(stock.price)}</strong>
              <span class="${cls}">${icon} ${change.toFixed(2)}%</span>
              <span class="muted">${formatVolume(stock.volume)}</span>
            </div>
          </summary>
          <div class="scrip-details">
            <div class="scrip-detail-section">
              <h5 class="eyebrow" style="margin: 0 0 8px 0; color: var(--accent);">Market Data</h5>
              <div class="scrip-stat"><span class="muted">Open:</span> <strong>${stock.open ? formatCurrency(stock.open) : "N/A"}</strong></div>
              <div class="scrip-stat"><span class="muted">High:</span> <strong>${stock.high ? formatCurrency(stock.high) : "N/A"}</strong></div>
              <div class="scrip-stat"><span class="muted">Low:</span> <strong>${stock.low ? formatCurrency(stock.low) : "N/A"}</strong></div>
            </div>
            <div class="scrip-detail-section">
              <h5 class="eyebrow" style="margin: 0 0 8px 0; color: var(--accent);">Technicals</h5>
              <div class="scrip-stat"><span class="muted">Volatility (20d):</span> <strong>${stock.volatility ? stock.volatility.toFixed(2) + '%' : "N/A"}</strong></div>
              <div class="scrip-stat"><span class="muted">52W High:</span> <strong>${stock.w52_high ? formatCurrency(stock.w52_high) : "N/A"}</strong></div>
              <div class="scrip-stat"><span class="muted">52W Low:</span> <strong>${stock.w52_low ? formatCurrency(stock.w52_low) : "N/A"}</strong></div>
            </div>
            <div class="scrip-detail-section">
              <h5 class="eyebrow" style="margin: 0 0 8px 0; color: var(--accent);">AI Insights</h5>
              <div class="scrip-stat"><span class="muted">AI Score:</span> <strong>${aiScore}</strong></div>
              <div class="scrip-stat"><span class="muted">Signal:</span> <strong style="color: var(--accent);">${signals}</strong></div>
              <div class="scrip-stat"><span class="muted">Sector:</span> <strong>${stock.sector || "N/A"}</strong></div>
            </div>
            <div class="scrip-actions" style="width: 100%; margin-top: 12px; display: flex; justify-content: flex-end; align-items: center; gap: 12px; border-top: 1px solid var(--line); padding-top: 12px;">
              <button class="btn btn-ghost btn-sm" id="btn-train-${safeTicker}" onclick="window.requestAITrain('${stock.ticker}')">Train AI</button>
              <div style="display: flex; align-items: center; gap: 4px;">
                <span class="muted" style="font-size: 0.8rem;">Qty:</span>
                <input type="number" id="qty-${safeTicker}" value="1" min="1" class="input" style="width: 70px; padding: 4px 8px; height: 32px; font-size: 0.9rem;">
              </div>
              <button class="btn btn-primary btn-sm" onclick="window.quickAddToPortfolio('${stock.ticker}', ${stock.price})">+ Add</button>
            </div>
          </div>
        </details>
      `;
    }).join("");

    return `
      <details class="sector-accordion" onmouseenter="this.setAttribute('open', '')" onmouseleave="this.removeAttribute('open')">
        <summary class="sector-summary">
          <h3 class="accordion-title">
            <span class="accordion-icon">▶</span> ${sector}
          </h3>
          <span class="muted" style="font-size: 0.9em;">${sectorStocks.length} symbols</span>
        </summary>
        <div class="scrip-list-container">
          <div class="scrip-grid scrip-header">
            <span>Ticker</span><span>Price</span><span>Change</span><span>Volume</span>
          </div>
          <div class="scrip-list">
            ${rows}
          </div>
        </div>
      </details>
    `;
  }).join("");

  // Restore open states and focus
  document.querySelectorAll('.scrip-accordion').forEach(el => {
    if (el.id && openDetails.has(el.id)) el.setAttribute('open', '');
  });
  if (focusedInputId) {
    const inputToFocus = document.getElementById(focusedInputId);
    if (inputToFocus) {
      inputToFocus.focus();
      if (focusedInputValue !== null) {
        inputToFocus.value = focusedInputValue;
      }
    }
  }
}

function renderNews() {
  if (!newsGrid) return;
  
  const query = newsInput?.value.toLowerCase().trim() || "";
  let filtered = state.news || [];
  if (query) {
    filtered = filtered.filter(item => (item.title || "").toLowerCase().includes(query) || (item.source || "").toLowerCase().includes(query));
  }

  if (!filtered.length) {
    newsGrid.innerHTML = emptyState("No news found.");
    return;
  }

  const visibleNews = filtered.slice(0, state.newsLimit);
  
  const newsHtml = visibleNews
    .map((item) => {
      return `
        <details class="news-accordion" onmouseenter="this.setAttribute('open', '')" onmouseleave="this.removeAttribute('open')">
          <summary class="news-summary">
            <h4>${item.title || "Untitled story"}</h4>
            <div class="news-meta">
              <span>${item.source || "Yahoo Finance"}</span>
              <span>•</span>
              <span>${formatTimestamp(item.updated_at)}</span>
            </div>
          </summary>
          <div class="news-details">
            <a href="${item.link || '#'}" target="_blank" class="btn btn-primary" style="display: inline-block; margin-top: 8px;">Read Full Article</a>
          </div>
        </details>
      `;
    })
    .join("");

  let loadMoreHtml = "";
  if (filtered.length > state.newsLimit) {
    loadMoreHtml = `<button id="btn-load-more-news" class="btn btn-ghost" style="width: 100%; margin-top: 12px;">Load More News</button>`;
  }

  newsGrid.innerHTML = newsHtml + loadMoreHtml;

  const loadMoreBtn = document.getElementById("btn-load-more-news");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      state.newsLimit += 10;
      renderNews();
    });
  }
}

function renderAIPicks() {
  if (!aiGrid) return;
  const picks = Object.values(state.aiPicks);
  
  if (!picks.length) {
    aiGrid.innerHTML = emptyState("AI Model is currently analyzing the market. Check back soon.");
    return;
  }

  aiGrid.innerHTML = picks
    .map((stock) => {
      const signal = Array.isArray(stock.signals) ? stock.signals.join(", ") : "Bullish";
      return `
        <article class="price-card" style="border-left: 4px solid var(--accent);">
          <h4>${stock.ticker}</h4>
          <p class="price-value positive">${formatCurrency(stock.price)}</p>
          <div class="price-row"><span>Sector</span><span>${stock.sector || "N/A"}</span></div>
          <div class="price-row"><span>Signal</span><span style="color: var(--accent); font-weight: bold;">${signal}</span></div>
          <div class="price-row"><span>AI Score</span><span>${formatScore(stock.ml)}</span></div>
        </article>
      `;
    })
    .join("");
}

function renderIndexBar(indices) {
  if (!indexBar) return;
  const items = Object.values(indices);
  if (!items.length) {
    indexBar.innerHTML = `<span class="muted" style="font-size: 0.8rem;">Loading indices...</span>`;
    return;
  }

  indexBar.innerHTML = items.map(idx => {
    const cls = idx.change >= 0 ? "pos" : "neg";
    const arrow = idx.change >= 0 ? "▲" : "▼";
    return `
      <div class="index-item">
        <span class="index-name">${idx.name}</span>
        <span class="index-price">${idx.price.toLocaleString("en-IN")}</span>
        <span class="index-change ${cls}">${arrow} ${Math.abs(idx.change_pct).toFixed(2)}%</span>
      </div>
    `;
  }).join("");
}

function renderMarketStatus() {
  if (!state.marketStatus) {
    if (marketPhase) marketPhase.textContent = "Waiting...";
    if (marketSummary) marketSummary.textContent = "No market status available.";
    if (lastRefresh) lastRefresh.textContent = "Waiting...";
    return;
  }

  if (marketPhase) marketPhase.textContent = state.marketStatus.label || "Unknown";
  if (marketSummary) marketSummary.textContent =
    state.marketStatus.summary ||
    `Market open: ${Boolean(state.marketStatus.is_market_open)}`;
  if (lastRefresh) lastRefresh.textContent = formatTimestamp(state.marketStatus.updated_at);
}

function emptyState(message) {
  return `<div class="empty-state">${message}</div>`;
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(number);
}

function formatScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function formatVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(number);
}

function formatTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "N/A";
  }
  return new Date(number).toLocaleString("en-IN");
}

// Optional example write helper if you later want to save watchlists/preferences.
async function saveUserPreference(path, value) {
  if (!state.user) {
    return;
  }
  await set(ref(db, `users/${state.user.uid}/${path}`), value);
}

window.saveUserPreference = saveUserPreference;

// Chat logic
const chatToggle = document.getElementById("btn-chat-toggle");
const chatClose = document.getElementById("btn-chat-close");
const chatWindow = document.getElementById("ai-chat-window");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("btn-chat-send");
const chatMessages = document.getElementById("chat-messages");

if (chatToggle && chatClose && chatWindow) {
  chatToggle.addEventListener("click", () => {
    chatWindow.classList.remove("hidden");
    chatToggle.style.display = "none";
    chatInput.focus();
  });
  chatClose.addEventListener("click", () => {
    chatWindow.classList.add("hidden");
    chatToggle.style.display = "flex";
  });
}

function addChatMessage(sender, text) {
  if (!chatMessages) return;
  const div = document.createElement("div");
  div.style.padding = "8px 12px";
  div.style.borderRadius = "8px";
  div.style.maxWidth = "85%";
  div.style.wordWrap = "break-word";
  
  if (sender === "user") {
    div.style.alignSelf = "flex-end";
    div.style.background = "var(--accent)";
    div.style.color = "#fff";
  } else {
    div.style.alignSelf = "flex-start";
    div.style.background = "var(--bg)";
    div.style.border = "1px solid var(--line)";
    div.style.color = "var(--text)";
  }
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function processChatCommand(msg) {
  const text = msg.toLowerCase();
  
  if (text.includes("portfolio")) {
    if (!state.user || !state.portfolio) return "Please log in and ensure your portfolio is loaded.";
    const items = Object.values(state.portfolio);
    if (items.length === 0) return "Your portfolio is currently empty.";
    const totalVal = items.reduce((acc, item) => acc + (Number(item.qty)*Number(item.buyPrice)), 0);
    return `You have ${items.length} stocks in your portfolio. Your invested value is roughly ${formatCurrency(totalVal)}. Check the Portfolio tab for live P&L updates!`;
  }
  
  if (text.includes("top") || text.includes("pick") || text.includes("buy")) {
    const picks = Object.values(state.aiPicks || {});
    if (picks.length === 0) return "The AI is currently analyzing the market. No picks yet.";
    const top3 = picks.sort((a,b)=> (b.ml||0) - (a.ml||0)).slice(0, 3).map(p => `${p.ticker} (Score: ${formatScore(p.ml)})`).join(", ");
    return `The strongest buy signals right now are: ${top3}`;
  }
  
  if (text.includes("sector") || text.includes("crashing")) {
    return "Check the Sector Heatmap on the right sidebar to see which sectors are doing the best or worst today!";
  }
  
  if (text.includes("hello") || text.includes("hi")) {
    return "Hello! I am your StockSense AI. I can tell you about the top AI picks or your portfolio. What do you want to know?";
  }
  
  return "I'm a simple local AI bot. Try asking me for 'top picks' or about your 'portfolio'.";
}

if (chatSend && chatInput) {
  chatSend.addEventListener("click", () => {
    const text = chatInput.value.trim();
    if (!text) return;
    addChatMessage("user", text);
    chatInput.value = "";
    
    setTimeout(() => {
      const response = processChatCommand(text);
      addChatMessage("bot", response);
    }, 500);
  });
  
  chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") chatSend.click();
  });
}