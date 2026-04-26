import json
import os
import time
import warnings
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, db
from sklearn.ensemble import RandomForestClassifier

try:
    import pandas as pd
    import yfinance as yf
except ImportError:  # pragma: no cover
    yf = None

warnings.filterwarnings('ignore')

DATABASE_URL = os.getenv(
    "FIREBASE_DATABASE_URL",
    "https://stockscene-560d7-default-rtdb.asia-southeast1.firebasedatabase.app",
)
import os
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT", os.path.join(BASE_DIR, "serviceAccountKey.json"))
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "10"))

FALLBACK_SECTORS = {
    # Financials
    "HDFCBANK.NS": "Financials", "ICICIBANK.NS": "Financials", "SBIN.NS": "Financials", "AXISBANK.NS": "Financials", 
    "KOTAKBANK.NS": "Financials", "INDUSINDBK.NS": "Financials", "BAJFINANCE.NS": "Financials", "BAJAJFINSV.NS": "Financials", 
    "SBILIFE.NS": "Financials", "HDFCLIFE.NS": "Financials", "CHOLAFIN.NS": "Financials", "MUTHOOTFIN.NS": "Financials",
    "PNB.NS": "Financials", "BANKBARODA.NS": "Financials", "CANBK.NS": "Financials", "IDFCFIRSTB.NS": "Financials",
    # Technology
    "TCS.NS": "Technology", "INFY.NS": "Technology", "HCLTECH.NS": "Technology", "WIPRO.NS": "Technology", 
    "TECHM.NS": "Technology", "LTIM.NS": "Technology", "COFORGE.NS": "Technology", "PERSISTENT.NS": "Technology",
    "MPHASIS.NS": "Technology", "KPITTECH.NS": "Technology", "TATAELXSI.NS": "Technology", "CYIENT.NS": "Technology",
    # Automobiles
    "TATAMOTORS.NS": "Automobiles", "M&M.NS": "Automobiles", "MARUTI.NS": "Automobiles", "EICHERMOT.NS": "Automobiles", 
    "HEROMOTOCO.NS": "Automobiles", "BAJAJ-AUTO.NS": "Automobiles", "TVSMOTOR.NS": "Automobiles", "ASHOKLEY.NS": "Automobiles",
    "BOSCHLTD.NS": "Automobiles", "MRF.NS": "Automobiles", "BALKRISIND.NS": "Automobiles", "MOTHERSON.NS": "Automobiles",
    # Consumer Goods
    "ITC.NS": "Consumer Goods", "HINDUNILVR.NS": "Consumer Goods", "ASIANPAINT.NS": "Consumer Goods", "TITAN.NS": "Consumer Goods", 
    "NESTLEIND.NS": "Consumer Goods", "TATACONSUM.NS": "Consumer Goods", "BRITANNIA.NS": "Consumer Goods", "DABUR.NS": "Consumer Goods",
    "GODREJCP.NS": "Consumer Goods", "MARICO.NS": "Consumer Goods", "COLPAL.NS": "Consumer Goods", "UBL.NS": "Consumer Goods",
    "MCDOWELL-N.NS": "Consumer Goods", "RADICO.NS": "Consumer Goods", "PIDILITIND.NS": "Consumer Goods", "PAGEIND.NS": "Consumer Goods",
    # Pharma
    "SUNPHARMA.NS": "Pharma", "DIVISLAB.NS": "Pharma", "CIPLA.NS": "Pharma", "DRREDDY.NS": "Pharma", "APOLLOHOSP.NS": "Pharma",
    "LUPIN.NS": "Pharma", "AUROPHARMA.NS": "Pharma", "TORNTPHARM.NS": "Pharma", "ZYDUSLIFE.NS": "Pharma", "BIOCON.NS": "Pharma",
    "ALKEM.NS": "Pharma", "SYNGENE.NS": "Pharma", "GLENMARK.NS": "Pharma", "IPCALAB.NS": "Pharma", "LAURUSLABS.NS": "Pharma",
    # Energy
    "RELIANCE.NS": "Energy", "NTPC.NS": "Energy", "POWERGRID.NS": "Energy", "ONGC.NS": "Energy", "COALINDIA.NS": "Energy",
    "TATAPOWER.NS": "Energy", "ADANIGREEN.NS": "Energy", "ADANIPOWER.NS": "Energy", "BPCL.NS": "Energy", "IOC.NS": "Energy",
    # Metal
    "TATASTEEL.NS": "Metal", "JSWSTEEL.NS": "Metal", "HINDALCO.NS": "Metal", "VEDL.NS": "Metal", "JINDALSTEL.NS": "Metal",
    "SAIL.NS": "Metal", "NMDC.NS": "Metal", "NATIONALUM.NS": "Metal", "HINDZINC.NS": "Metal",
    # Infrastructure & Industrials
    "LT.NS": "Industrials", "ADANIPORTS.NS": "Industrials", "ADANIENT.NS": "Industrials", "GRASIM.NS": "Industrials", 
    "ULTRACEMCO.NS": "Industrials", "AMBUJACEM.NS": "Industrials", "SHREECEM.NS": "Industrials", "ACC.NS": "Industrials",
    "BHEL.NS": "Industrials", "HAL.NS": "Industrials", "BEL.NS": "Industrials", "IRCTC.NS": "Industrials",
    "RVNL.NS": "Industrials", "IRCON.NS": "Industrials", "PFC.NS": "Industrials", "RECLTD.NS": "Industrials",
    # Telecom
    "BHARTIARTL.NS": "Telecom", "IDEA.NS": "Telecom", "INDUSTOWER.NS": "Telecom", "TATACOMM.NS": "Telecom"
}

def load_nifty500():
    try:
        import pandas as pd
        print("Fetching NIFTY 500 list from NSE...")
        df = pd.read_csv('https://archives.nseindia.com/content/indices/ind_nifty500list.csv')
        sectors = {}
        for _, row in df.iterrows():
            sym = str(row['Symbol']) + ".NS"
            ind = str(row['Industry'])
            sectors[sym] = ind
        print(f"Loaded {len(sectors)} stocks from NIFTY 500.")
        return sectors
    except Exception as e:
        print("Failed to load NIFTY 500, using fallback:", e)
        return FALLBACK_SECTORS

SECTORS = load_nifty500()

WATCHLIST = list(SECTORS.keys())

INDEX_WATCHLIST = [
    ("^NSEI", "NIFTY 50"),
    ("^NSEI", "GIFT Nifty (Proxy)"),
    ("^NSEBANK", "BANK NIFTY"),
    ("^BSESN", "SENSEX"),
    ("^INDIAVIX", "INDIA VIX")
]

def now_ms():
    return int(time.time() * 1000)

def firebase_credential():
    raw_env = os.getenv("FIREBASE_KEY")
    if raw_env:
        return credentials.Certificate(json.loads(raw_env))
    return credentials.Certificate(SERVICE_ACCOUNT_PATH)

def init_firebase():
    if firebase_admin._apps:
        return
    cred = firebase_credential()
    firebase_admin.initialize_app(cred, {"databaseURL": DATABASE_URL})
    print("Firebase connected")

def seed_stocks():
    print("Seeding massive stock catalog to Firebase...")
    payload = {}
    for symbol, sector in SECTORS.items():
        payload[symbol.replace(".", "_")] = {
            "ticker": symbol,
            "sector": sector,
            "comp": 0,
            "ml": 0
        }
    db.reference("stocks").set(payload)
    print(f"Seeded {len(payload)} stocks.")

def market_label():
    now = datetime.now(timezone.utc)
    hour = now.hour
    if 3 <= hour <= 10:
        return True, "Open", f"Live {len(WATCHLIST)}-stock market snapshot."
    return False, "Closed", "Market is closed; caching latest close prices."

fifty_two_week_stats = {}

def fetch_52_week_stats():
    global fifty_two_week_stats
    if yf is None: return
    print("Fetching 52-week stats for all stocks (in chunks to avoid rate limits)...")
    try:
        chunk_size = 50
        for i in range(0, len(WATCHLIST), chunk_size):
            chunk = WATCHLIST[i:i+chunk_size]
            try:
                data = yf.download(chunk, period="1y", interval="1d", group_by="ticker", threads=True, progress=False)
                for symbol in chunk:
                    try:
                        hist = data[symbol] if len(chunk) > 1 and isinstance(data.columns, pd.MultiIndex) else data
                        hist = hist.dropna()
                        if not hist.empty:
                            fifty_two_week_stats[symbol] = {
                                "high": round(float(hist["High"].max()), 2),
                                "low": round(float(hist["Low"].min()), 2)
                            }
                    except: pass
                time.sleep(2)
            except Exception as e:
                print(f"Chunk failed: {e}")
                time.sleep(5)
        print("52-week stats loaded successfully.")
    except Exception as e:
        print("Failed 52-week fetch:", e)

def fetch_bulk():
    if yf is None:
        return []
    try:
        data = yf.download(WATCHLIST, period="1mo", interval="1d", group_by="ticker", threads=True, progress=False)
        rows = []
        for symbol in WATCHLIST:
            try:
                if len(WATCHLIST) > 1:
                    if isinstance(data.columns, pd.MultiIndex):
                        if symbol not in data.columns.get_level_values(0):
                            continue
                        hist = data[symbol]
                    else:
                        continue
                else:
                    hist = data
                
                hist = hist.dropna()
                if hist.empty:
                    continue
                last_row = hist.iloc[-1]
                prev_row = hist.iloc[-2] if len(hist) > 1 else last_row
                
                close_price = float(last_row["Close"])
                prev_close = float(prev_row["Close"])
                change_pct = ((close_price - prev_close) / prev_close) * 100 if prev_close else 0
                
                open_price = float(last_row["Open"])
                high_price = float(last_row["High"])
                low_price = float(last_row["Low"])
                
                volatility = 0.0
                if len(hist) >= 20:
                    returns = hist["Close"].pct_change()
                    vol = returns.rolling(20).std().iloc[-1] * 100
                    volatility = float(vol) if not pd.isna(vol) else 0.0
                
                w52_high = fifty_two_week_stats.get(symbol, {}).get("high", 0)
                w52_low = fifty_two_week_stats.get(symbol, {}).get("low", 0)
                
                rows.append({
                    "ticker": symbol,
                    "price": round(close_price, 2),
                    "change_pct": round(change_pct, 2),
                    "volume": int(last_row["Volume"]),
                    "open": round(open_price, 2),
                    "high": round(high_price, 2),
                    "low": round(low_price, 2),
                    "volatility": round(volatility, 2),
                    "w52_high": w52_high,
                    "w52_low": w52_low
                })
            except Exception as e:
                pass
        return rows
    except Exception as e:
        print(f"Bulk fetch failed: {e}")
        return []

def fetch_indices():
    if yf is None:
        return
    try:
        symbols = list(set([item[0] for item in INDEX_WATCHLIST]))
        data = yf.download(symbols, period="2d", interval="1d", group_by="ticker", threads=True, progress=False)
        
        payload = {}
        for sym, name in INDEX_WATCHLIST:
            try:
                if len(symbols) > 1:
                    hist = data[sym]
                else:
                    hist = data
                hist = hist.dropna()
                if hist.empty: continue
                
                last_row = hist.iloc[-1]
                prev_row = hist.iloc[-2] if len(hist) > 1 else last_row
                
                price = float(last_row["Close"])
                prev_close = float(prev_row["Close"])
                change = price - prev_close
                change_pct = (change / prev_close) * 100 if prev_close else 0
                
                safe_key = name.replace(" ", "_").replace("(", "").replace(")", "").upper()
                payload[safe_key] = {
                    "name": name,
                    "price": round(price, 2),
                    "change": round(change, 2),
                    "change_pct": round(change_pct, 2)
                }
            except Exception as e:
                pass
        
        if payload:
            db.reference("market_indices").set(payload)
            print(f"Pushed {len(payload)} market indices")
    except Exception as e:
        print(f"Failed to fetch indices: {e}")

def push_prices(rows):
    payload = {row["ticker"].replace(".", "_"): row for row in rows if row}
    db.reference("live_prices").update(payload)
    print(f"Pushed {len(payload)} live prices")

def push_market_status(rows):
    is_open, label, summary = market_label()
    positive = sum(1 for row in rows if row and row["change_pct"] >= 0)
    payload = {
        "is_market_open": is_open,
        "label": label,
        "summary": f"{summary} Positive symbols: {positive}/{len(rows)}.",
        "updated_at": now_ms(),
    }
    db.reference("market_status").set(payload)

def push_news():
    if yf is None:
        return
    try:
        sources = ["^NSEI", "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "TATAMOTORS.NS"]
        aggregated = []
        seen_titles = set()

        for src in sources:
            ticker = yf.Ticker(src)
            news_data = ticker.news
            if not news_data:
                continue
            
            for item in news_data:
                content = item.get("content", {})
                title = content.get("title") or item.get("title") or "Market Update"
                
                if title in seen_titles:
                    continue
                seen_titles.add(title)

                link_obj = content.get("clickThroughUrl", {})
                link = link_obj.get("url") or item.get("link") or "#"
                
                provider = content.get("provider", {})
                source = provider.get("displayName") or item.get("publisher") or "Financial News"
                
                pub_time = content.get("pubDate") or item.get("providerPublishTime")
                
                if isinstance(pub_time, str):
                    try:
                        dt = datetime.fromisoformat(pub_time.replace("Z", "+00:00"))
                        updated_at = int(dt.timestamp() * 1000)
                    except:
                        updated_at = now_ms()
                elif isinstance(pub_time, (int, float)):
                    updated_at = int(pub_time) * 1000
                else:
                    updated_at = now_ms()

                aggregated.append({
                    "title": title,
                    "source": source,
                    "link": link,
                    "sent": 0.0,
                    "updated_at": updated_at
                })
        
        aggregated.sort(key=lambda x: x["updated_at"], reverse=True)
        if aggregated:
            db.reference("news_cache").set(aggregated[:20])
    except Exception as e:
        print(f"Failed to fetch news: {e}")

def train_and_push_model():
    print("Training ML model for AI Suggestions...")
    if yf is None:
        return

    predictions = {}
    for symbol in WATCHLIST:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="1y")
            if hist.empty or len(hist) < 50:
                continue

            hist['SMA_20'] = hist['Close'].rolling(window=20).mean()
            hist['SMA_50'] = hist['Close'].rolling(window=50).mean()
            hist['Return'] = hist['Close'].pct_change()
            hist['Volatility'] = hist['Return'].rolling(window=20).std()
            
            hist['Target'] = (hist['Close'].shift(-5) > hist['Close']).astype(int)
            
            data = hist.dropna()
            if len(data) < 50:
                continue

            features = ['SMA_20', 'SMA_50', 'Return', 'Volatility']
            X = data[features]
            y = data['Target']

            model = RandomForestClassifier(n_estimators=50, random_state=42)
            model.fit(X, y)

            latest = hist.iloc[-1]
            latest_features = [[
                latest['SMA_20'] if not pd.isna(latest['SMA_20']) else latest['Close'],
                latest['SMA_50'] if not pd.isna(latest['SMA_50']) else latest['Close'],
                latest['Return'] if not pd.isna(latest['Return']) else 0,
                latest['Volatility'] if not pd.isna(latest['Volatility']) else 0.01
            ]]
            
            prob = model.predict_proba(latest_features)[0][1]
            ml_score = round(prob, 2)
            
            if ml_score < 0.55:
                continue

            signals = []
            if ml_score >= 0.7: signals.append("Strong Buy")
            elif ml_score >= 0.55: signals.append("Bullish Trend")
            
            if latest['Close'] > latest['SMA_20']: signals.append("Above 20-SMA")
            
            predictions[symbol.replace(".", "_")] = {
                "ticker": symbol,
                "sector": SECTORS.get(symbol, "Unknown"),
                "ml": ml_score,
                "signals": signals[:2],
                "price": round(float(latest['Close']), 2),
                "updated_at": now_ms()
            }
        except Exception as e:
            pass

    if predictions:
        sorted_preds = dict(sorted(predictions.items(), key=lambda item: item[1]['ml'], reverse=True)[:30])
        db.reference("ai_picks").set(sorted_preds)
        print(f"Pushed {len(sorted_preds)} AI Suggestions")

def check_manual_training():
    try:
        cmds_ref = db.reference("commands/train_model")
        cmds = cmds_ref.get()
        if not cmds: return
        
        for cmd_id, data in cmds.items():
            symbol = data.get("ticker")
            if not symbol: continue
            
            print(f"Manual AI training triggered for {symbol}")
            if yf is None: continue
            
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="1y")
            if hist.empty or len(hist) < 50: continue

            hist['SMA_20'] = hist['Close'].rolling(window=20).mean()
            hist['SMA_50'] = hist['Close'].rolling(window=50).mean()
            hist['Return'] = hist['Close'].pct_change()
            hist['Volatility'] = hist['Return'].rolling(window=20).std()
            hist['Target'] = (hist['Close'].shift(-5) > hist['Close']).astype(int)
            
            data_df = hist.dropna()
            if len(data_df) < 50: continue

            features = ['SMA_20', 'SMA_50', 'Return', 'Volatility']
            X = data_df[features]
            y = data_df['Target']

            model = RandomForestClassifier(n_estimators=50, random_state=42)
            model.fit(X, y)

            latest = hist.iloc[-1]
            latest_features = [[
                latest['SMA_20'] if not pd.isna(latest['SMA_20']) else latest['Close'],
                latest['SMA_50'] if not pd.isna(latest['SMA_50']) else latest['Close'],
                latest['Return'] if not pd.isna(latest['Return']) else 0,
                latest['Volatility'] if not pd.isna(latest['Volatility']) else 0.01
            ]]
            
            prob = model.predict_proba(latest_features)[0][1]
            ml_score = round(prob, 2)
            
            signals = []
            if ml_score >= 0.7: signals.append("Strong Buy")
            elif ml_score >= 0.55: signals.append("Bullish Trend")
            elif ml_score <= 0.3: signals.append("Strong Sell")
            else: signals.append("Neutral")
            
            if latest['Close'] > latest['SMA_20']: signals.append("Above 20-SMA")
            
            safe_sym = symbol.replace(".", "_")
            
            db.reference(f"stocks/{safe_sym}/ml").set(ml_score)
            
            if ml_score >= 0.55:
                pred = {
                    "ticker": symbol,
                    "sector": SECTORS.get(symbol, "Unknown"),
                    "ml": ml_score,
                    "signals": signals[:2],
                    "price": round(float(latest['Close']), 2),
                    "updated_at": now_ms()
                }
                db.reference(f"ai_picks/{safe_sym}").set(pred)
                
        cmds_ref.delete()
    except Exception as e:
        print("Manual training check failed:", e)

def run_cycle():
    fetch_indices()
    push_news()
    rows = fetch_bulk()
    push_prices(rows)
    push_market_status(rows)
    check_manual_training()

def main():
    init_firebase()
    seed_stocks()
    fetch_52_week_stats()
    cycle_count = 0
    while True:
        try:
            run_cycle()
            if cycle_count % 30 == 0:
                train_and_push_model()
            cycle_count += 1
        except Exception as error:  # pragma: no cover
            print(f"Cycle failed: {error}")
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()