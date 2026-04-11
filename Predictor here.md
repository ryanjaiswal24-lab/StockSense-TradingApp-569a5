# StockSense — Firebase Hosting Deploy Guide

## Your project file structure
```
stock-dashboard/
├── index.html          ← Frontend (HTML)
├── style.css           ← Styles
├── app.js              ← JavaScript logic + Firestore integration
├── stock_model.cpp     ← C++ data encapsulation model
├── firebase.json       ← Firebase hosting config
├── firestore.rules     ← Firestore security rules
└── DEPLOY.md           ← This file
```

---

## Step 1 — Create a Firebase project

1. Go to https://console.firebase.google.com
2. Click **Add project** → name it (e.g. `stocksense-nse`)
3. Disable Google Analytics (optional) → **Create project**
4. In the left sidebar: **Build → Firestore Database → Create database**
   - Choose **Start in test mode** for now
   - Select `asia-south1` (Mumbai) region

---

## Step 2 — Get your Firebase config

1. In Firebase console → **Project settings** (gear icon)
2. Scroll to **Your apps** → click **Web** icon (`</>`)
3. Register app name → **Register app**
4. Copy the `firebaseConfig` object — it looks like:

```javascript
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "stocksense-nse.firebaseapp.com",
  projectId:         "stocksense-nse",
  storageBucket:     "stocksense-nse.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

5. **Paste this into `index.html`** — replace the placeholder `YOUR_API_KEY` etc.

---

## Step 3 — Install Firebase CLI (in VS Code terminal)

```bash
npm install -g firebase-tools
```

Verify:
```bash
firebase --version
```

---

## Step 4 — Login and initialise

```bash
firebase login
```
A browser window will open — sign in with your Google account.

Then in your project folder:
```bash
cd C:\predictor\stock-dashboard
firebase init
```

When prompted:
- **Which features?** → select `Hosting` and `Firestore` (spacebar to select, Enter)
- **Project?** → Use an existing project → select `stocksense-nse`
- **Public directory?** → type `.` (just a dot — current folder)
- **Single-page app?** → `Y`
- **Overwrite index.html?** → `N` (important!)

---

## Step 5 — Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

---

## Step 6 — Deploy to Firebase Hosting

```bash
firebase deploy --only hosting
```

Your site will be live at:
```
https://stocksense-nse.web.app
```

---

## Step 7 — Build and use the C++ model (optional)

The C++ model encapsulates your ML output and exports clean JSON for Firestore.

**In VS Code terminal (requires g++):**
```bash
# Install g++ if needed (Windows)
winget install GnuWin32.Make

# Build
g++ -std=c++17 -O2 -o stock_model stock_model.cpp

# Run — prints ranked picks + exports JSON
./stock_model picks_output.json
```

**Connect C++ → Python → Firestore pipeline:**
```python
import subprocess, json
from google.cloud import firestore

# 1. Run C++ model to get validated JSON
result = subprocess.run(["./stock_model"], capture_output=True, text=True)
raw    = result.stdout.split("── JSON OUTPUT ──\n")[1]
data   = json.loads(raw)

# 2. Push each pick to Firestore
db = firestore.Client(project="stocksense-nse")
for pick in data["picks"]:
    db.collection("stocks").document(pick["ticker"]).set(pick)
print("Uploaded", len(data["picks"]), "picks to Firestore")
```

---

## Re-deploy after changes

Every time you update `index.html`, `style.css`, or `app.js`:
```bash
firebase deploy --only hosting
```

---

## Useful Firebase commands

| Command | What it does |
|---|---|
| `firebase serve` | Local preview at localhost:5000 |
| `firebase deploy` | Deploy everything |
| `firebase deploy --only hosting` | Deploy frontend only |
| `firebase deploy --only firestore:rules` | Deploy rules only |
| `firebase open hosting:site` | Open live site in browser |
| `firebase emulators:start` | Local Firestore emulator |