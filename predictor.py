"""
StockSense · realtime_prices.py  (FULLY FIXED)
=================================================
CRITICAL FIX: init_firebase() had broken indentation.
`cred` was inside the if-block but initialize_app() was OUTSIDE it
→ NameError on every run. Now both lines are correctly indented.

Install:
    pip install yfinance firebase-admin newsapi-python --break-system-packages

Run:
    python realtime_prices.py
"""

import os
import json
import yfinance as yf
import firebase_admin
from firebase_admin import credentials, db as rtdb
import time
from datetime import datetime

SERVICE_ACCOUNT_PATH = "serviceAccountKey.json"
DATABASE_URL         = "https://stockscene-560d7-default-rtdb.asia-southeast1.firebasedatabase.app/"
POLL_INTERVAL        = 10

WATCHLIST = [
    "RELIANCE.NS","TCS.NS","HDFCBANK.NS","INFY.NS","ICICIBANK.NS",
    "HINDUNILVR.NS","SBIN.NS","BHARTIARTL.NS","KOTAKBANK.NS","ITC.NS",
    "LT.NS","AXISBANK.NS","WIPRO.NS","ASIANPAINT.NS","MARUTI.NS",
    "BAJFINANCE.NS","HCLTECH.NS","TITAN.NS","SUNPHARMA.NS","ULTRACEMCO.NS",
    "TATAMOTORS.NS","ADANIPORTS.NS","POWERGRID.NS","NTPC.NS","ONGC.NS",
    "JSWSTEEL.NS","TATASTEEL.NS","BAJAJFINSV.NS","TECHM.NS","DRREDDY.NS",
]

# ✅ FIXED: initialize_app() is now INSIDE the if-block with cred
def init_firebase():
    if not firebase_admin._apps:
        def get_firebase_cred():
            try:
                # ✅ For Render (production)
                firebase_key = json.loads(os.environ["FIREBASE_KEY"])
                return credentials.Certificate(firebase_key)
            except KeyError:
                # ✅ For local development
                print("⚠️ Using local serviceAccountKey.json")
                return credentials.Certificate(SERVICE_ACCOUNT_PATH)

        cred = get_firebase_cred()
        firebase_admin.initialize_app(cred, {
            "databaseURL": "https://stockscene-560d7-default-rtdb.asia-southeast1.firebasedatabase.app/"
        })
        print("✅ Firebase connected")

def fetch_single(ticker):
    try:
        fi     = yf.Ticker(ticker).fast_info
        price  = getattr(fi,"last_price",None)
        prev   = getattr(fi,"previous_close",None)
        high   = getattr(fi,"day_high",None)
        low    = getattr(fi,"day_low",None)
        volume = getattr(fi,"last_volume",0)
        if not price: return None
        chg = ((price-prev)/prev*100) if prev else 0
        now = datetime.now()
        is_open = (
            now.replace(hour=9,minute=15,second=0,microsecond=0) <= now <=
            now.replace(hour=15,minute=30,second=0,microsecond=0)
            and now.weekday() < 5
        )
        clean = ticker.replace(".NS","").replace(".BO","")
        return {
            "ticker":clean,"price":round(float(price),2),
            "change_pct":round(float(chg),2),
            "change_abs":round(float(price-(prev or price)),2),
            "prev_close":round(float(prev or price),2),
            "day_high":round(float(high or price),2),
            "day_low":round(float(low or price),2),
            "volume":int(volume or 0),
            "is_market_open":is_open,
            "updated_at":now.isoformat(),
            "updated_ts":int(now.timestamp()),
        }
    except Exception as e:
        print(f"  [!] {ticker}: {e}"); return None

def push_prices(prices):
    if not prices: return
    rtdb.reference("live_prices").update({p["ticker"]:p for p in prices})
    print(f"  ✓ {len(prices)} prices → /live_prices")

def push_market_status(prices):
    if not prices: return
    avg = sum(p["change_pct"] for p in prices)/len(prices)
    rtdb.reference("market_status").set({
        "avg_change_pct":round(avg,2),
        "gainers":sum(1 for p in prices if p["change_pct"]>0),
        "losers": sum(1 for p in prices if p["change_pct"]<0),
        "total":  len(prices),
        "is_market_open":any(p.get("is_market_open") for p in prices),
        "updated_at":datetime.now().isoformat(),
    })
    print("  ✓ market_status updated")

def push_news():
    FALLBACK = [
        {"title":"Sensex gains 200 pts; IT stocks lead rally","source":"Economic Times","sent":0.32},
        {"title":"Nifty Bank outperforms; HDFC, ICICI in focus","source":"Mint","sent":0.18},
        {"title":"FII inflows continue for fifth consecutive session","source":"Business Standard","sent":0.25},
        {"title":"RBI holds repo rate; signals neutral stance","source":"BloombergQuint","sent":0.08},
        {"title":"Auto sector under pressure on global headwinds","source":"CNBC-TV18","sent":-0.14},
    ]
    try:
        from newsapi import NewsApiClient
        newsapi = NewsApiClient(api_key="ab577083fd88449da5b507f583248749")
        res  = newsapi.get_top_headlines(q="India stock market NSE",language="en",page_size=8)
        data = [
            {"title":a["title"],"source":a.get("source",{}).get("name","News"),"sent":0.0}
            for a in res.get("articles",[])
            if a.get("title") and "[Removed]" not in a.get("title","")
        ]
        if not data: data = FALLBACK
    except Exception as e:
        print(f"  ⚠️ NewsAPI: {e} — fallback"); data = FALLBACK
    rtdb.reference("news_cache").set(data)
    print(f"  ✓ {len(data)} headlines → /news_cache")

def seed_stocks_if_empty():
    if rtdb.reference("stocks").get(): return
    DEMO = [
        {"ticker":"RELIANCE","sector":"Energy","price":2847,"ret1w":2.1,"ml":0.78,"fund":0.72,"sent":0.18,"comp":0.735,"signals":["EMA cross","Vol spike","MACD bull"]},
        {"ticker":"TCS","sector":"IT","price":3921,"ret1w":1.4,"ml":0.74,"fund":0.81,"sent":0.22,"comp":0.713,"signals":["RSI bounce","OBV rise","EMA trend"]},
        {"ticker":"HDFCBANK","sector":"Banking","price":1712,"ret1w":3.2,"ml":0.71,"fund":0.76,"sent":0.14,"comp":0.693,"signals":["BB squeeze","Vol break","MACD cross"]},
        {"ticker":"BAJFINANCE","sector":"Finance","price":6840,"ret1w":1.8,"ml":0.69,"fund":0.74,"sent":0.11,"comp":0.673,"signals":["RSI climb","Fund growth","OBV bull"]},
        {"ticker":"BHARTIARTL","sector":"Telecom","price":1285,"ret1w":2.9,"ml":0.67,"fund":0.68,"sent":0.26,"comp":0.658,"signals":["Gap up","Stoch cross","Vol surge"]},
        {"ticker":"INFY","sector":"IT","price":1564,"ret1w":0.8,"ml":0.63,"fund":0.79,"sent":0.09,"comp":0.633,"signals":["High ROE","Rev growth","EMA bull"]},
        {"ticker":"MARUTI","sector":"Auto","price":10420,"ret1w":1.2,"ml":0.61,"fund":0.65,"sent":0.07,"comp":0.613,"signals":["RSI 52","MACD flat","Low PE"]},
        {"ticker":"SUNPHARMA","sector":"Pharma","price":1632,"ret1w":2.4,"ml":0.59,"fund":0.62,"sent":0.17,"comp":0.593,"signals":["BB upper","Vol avg","Sent pos"]},
        {"ticker":"TITAN","sector":"Consumer","price":3340,"ret1w":-0.6,"ml":0.54,"fund":0.70,"sent":0.04,"comp":0.553,"signals":["RSI 48","Low mom","Watchlist"]},
        {"ticker":"TATAMOTORS","sector":"Auto","price":768,"ret1w":3.8,"ml":0.51,"fund":0.48,"sent":0.21,"comp":0.523,"signals":["High beta","Sent bull","RSI 58"]},
    ]
    for s in DEMO:
        rtdb.reference(f"stocks/{s['ticker']}").set(s)
    print(f"  ✓ Seeded {len(DEMO)} stocks")

def run():
    print("\n"+"═"*50)
    print("  STOCKSENSE · REALTIME PRICE FEED")
    print(f"  {len(WATCHLIST)} NSE stocks · every {POLL_INTERVAL}s")
    print("  Ctrl+C to stop")
    print("═"*50+"\n")
    init_firebase()
    seed_stocks_if_empty()
    push_news()     # immediate on startup so news window isn't empty
    cycle, news_freq = 1, 6
    while True:
        t0 = time.time()
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Cycle #{cycle}")
        prices = []
        for ticker in WATCHLIST:
            d = fetch_single(ticker)
            if d: prices.append(d)
            time.sleep(0.2)
        push_prices(prices)
        push_market_status(prices)
        if cycle % news_freq == 0:
            push_news()
        elapsed = time.time()-t0
        sleep_t = max(0, POLL_INTERVAL-elapsed)
        print(f"  ↻ {elapsed:.1f}s elapsed | sleeping {sleep_t:.1f}s\n")
        cycle += 1
        time.sleep(sleep_t)

if __name__ == "__main__":
    while True:
        try:
            run()
        except Exception as e:
            print("Restarting...", e)
            time.sleep(5)
