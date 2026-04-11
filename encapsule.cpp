/**
 * StockSense · stock_model.cpp
 * ─────────────────────────────────────────────
 * Encapsulates all stock prediction data using
 * OOP with proper encapsulation (private members,
 * getters/setters, validation).
 *
 * Purpose:
 *   - Run your Python ML model → output JSON
 *   - Feed that JSON into this C++ program
 *   - It validates, normalises, and re-exports
 *     clean JSON ready to POST to Firestore REST API
 *
 * Build:
 *   g++ -std=c++17 -o stock_model stock_model.cpp
 *
 * Run:
 *   ./stock_model input_picks.json > firestore_payload.json
 *
 * Dependencies: none (stdlib only, C++17)
 */

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <stdexcept>
#include <iomanip>
#include <cmath>

// ═══════════════════════════════════════════════
// CLASS: StockSignal
// ═══════════════════════════════════════════════
class StockSignal {
private:
    std::string name_;
    std::string type_;   // "bull" | "bear" | "neutral"
    double      strength_; // 0.0 – 1.0

public:
    StockSignal(const std::string& name,
                const std::string& type,
                double strength)
        : name_(name), type_(type)
    {
        if (strength < 0.0 || strength > 1.0)
            throw std::invalid_argument("Signal strength must be 0–1");
        strength_ = strength;
    }

    // Getters
    const std::string& name()     const { return name_; }
    const std::string& type()     const { return type_; }
    double             strength() const { return strength_; }

    // Serialise to JSON fragment
    std::string toJson() const {
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(3);
        ss << "{\"name\":\"" << name_ << "\","
           << "\"type\":\"" << type_ << "\","
           << "\"strength\":" << strength_ << "}";
        return ss.str();
    }
};


// ═══════════════════════════════════════════════
// CLASS: FundamentalData
// ═══════════════════════════════════════════════
class FundamentalData {
private:
    double pe_ratio_;
    double pb_ratio_;
    double roe_;
    double debt_to_equity_;
    double revenue_growth_;
    double profit_margin_;
    double score_;  // computed 0–1
    bool has_pe_, has_pb_, has_roe_, has_de_, has_rg_, has_pm_;

    void computeScore() {
        double s = 0.0; int n = 0;
        if (has_pe_ && pe_ratio_ > 0) {
            s += std::max(0.0, 1.0 - pe_ratio_ / 50.0); n++;
        }
        if (has_roe_) {
            s += std::min(1.0, std::max(0.0, roe_ / 0.25)); n++;
        }
        if (has_rg_) {
            s += std::min(1.0, std::max(0.0, (revenue_growth_ + 0.1) / 0.4)); n++;
        }
        if (has_pm_) {
            s += std::min(1.0, std::max(0.0, profit_margin_ / 0.25)); n++;
        }
        if (has_de_) {
            s += (debt_to_equity_ >= 0) ? std::max(0.0, 1.0 - debt_to_equity_ / 200.0) : 0.5; n++;
        }
        score_ = (n > 0) ? s / n : 0.5;
    }

public:
    FundamentalData() : score_(0.5), has_pe_(false), has_pb_(false), has_roe_(false),
                        has_de_(false), has_rg_(false), has_pm_(false) {}

    void setPE(double v)             { pe_ratio_       = v; has_pe_ = true; computeScore(); }
    void setPB(double v)             { pb_ratio_       = v; has_pb_ = true; }
    void setROE(double v)            { roe_             = v; has_roe_ = true; computeScore(); }
    void setDebtToEquity(double v)   { debt_to_equity_ = v; has_de_ = true; computeScore(); }
    void setRevenueGrowth(double v)  { revenue_growth_ = v; has_rg_ = true; computeScore(); }
    void setProfitMargin(double v)   { profit_margin_  = v; has_pm_ = true; computeScore(); }

    double score() const { return score_; }

    std::string toJson() const {
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(4);
        ss << "{";
        ss << "\"fund_score\":" << score_;
        if (has_pe_)  ss << ",\"pe_ratio\":"       << pe_ratio_;
        if (has_pb_)  ss << ",\"pb_ratio\":"       << pb_ratio_;
        if (has_roe_) ss << ",\"roe\":"            << roe_;
        if (has_de_)  ss << ",\"debt_to_equity\":" << debt_to_equity_;
        if (has_rg_)  ss << ",\"revenue_growth\":" << revenue_growth_;
        if (has_pm_)  ss << ",\"profit_margin\":"  << profit_margin_;
        ss << "}";
        return ss.str();
    }
};


// ═══════════════════════════════════════════════
// CLASS: StockPrediction  (main encapsulation unit)
// ═══════════════════════════════════════════════
class StockPrediction {
private:
    // ── Identity
    std::string ticker_;
    std::string sector_;
    double      price_;

    // ── ML output
    double ml_probability_;  // 0–1  (bullish move probability)
    double sentiment_;       // -1 to +1

    // ── Fundamentals
    FundamentalData fundamentals_;

    // ── Signals
    std::vector<StockSignal> signals_;

    // ── Returns
    double ret_1w_;
    double ret_1m_;

    // ── Derived
    double composite_;
    int    rank_;

    // ── Validation helpers
    static double clamp01(double v) { return std::max(0.0, std::min(1.0, v)); }

    static bool validTicker(const std::string& t) {
        return !t.empty() && t.size() <= 20 &&
               std::all_of(t.begin(), t.end(), [](char c){
                   return std::isalnum(c) || c == '.' || c == '_';
               });
    }

    void recalcComposite() {
        double sentNorm = (sentiment_ + 1.0) / 2.0;  // map [-1,1] → [0,1]
        composite_ = 0.50 * ml_probability_
                   + 0.30 * fundamentals_.score()
                   + 0.20 * sentNorm;
    }

public:
    // ── Constructor
    StockPrediction(const std::string& ticker,
                    const std::string& sector,
                    double price)
    {
        if (!validTicker(ticker))
            throw std::invalid_argument("Invalid ticker: " + ticker);
        if (price <= 0)
            throw std::invalid_argument("Price must be positive");

        ticker_         = ticker;
        sector_         = sector;
        price_          = price;
        ml_probability_ = 0.5;
        sentiment_      = 0.0;
        ret_1w_         = 0.0;
        ret_1m_         = 0.0;
        composite_      = 0.5;
        rank_           = 0;
    }

    // ── Setters (with validation)
    void setMLProbability(double v) {
        ml_probability_ = clamp01(v);
        recalcComposite();
    }
    void setSentiment(double v) {
        if (v < -1.0 || v > 1.0)
            throw std::invalid_argument("Sentiment must be -1 to +1");
        sentiment_ = v;
        recalcComposite();
    }
    void setReturns(double ret1w, double ret1m) {
        ret_1w_ = ret1w;
        ret_1m_ = ret1m;
    }
    void setRank(int r) { rank_ = r; }

    FundamentalData& fundamentals() { return fundamentals_; }

    void addSignal(const std::string& name,
                   const std::string& type,
                   double strength = 0.8)
    {
        if (signals_.size() >= 5)
            signals_.erase(signals_.begin());  // keep max 5
        signals_.emplace_back(name, type, strength);
    }

    // ── Getters
    const std::string& ticker()     const { return ticker_; }
    const std::string& sector()     const { return sector_; }
    double             price()      const { return price_; }
    double             mlProb()     const { return ml_probability_; }
    double             sentiment()  const { return sentiment_; }
    double             composite()  const { return composite_; }
    int                rank()       const { return rank_; }
    double             ret1w()      const { return ret_1w_; }
    double             ret1m()      const { return ret_1m_; }

    // ── Convenience
    bool isBullish()    const { return composite_ >= 0.60; }
    bool isHighConviction() const { return composite_ >= 0.70; }

    std::string conviction() const {
        if (composite_ >= 0.75) return "STRONG BUY";
        if (composite_ >= 0.65) return "BUY";
        if (composite_ >= 0.55) return "WATCH";
        return "NEUTRAL";
    }

    // ── JSON serialisation (for Firestore REST API)
    std::string toJson() const {
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(4);

        // signals array
        std::ostringstream sigArr;
        sigArr << "[";
        for (size_t i = 0; i < signals_.size(); ++i) {
            if (i) sigArr << ",";
            sigArr << "\"" << signals_[i].name() << "\"";
        }
        sigArr << "]";

        ss << "{"
           << "\"ticker\":\""     << ticker_         << "\","
           << "\"sector\":\""     << sector_         << "\","
           << "\"price\":"        << std::setprecision(2) << price_ << ","
           << "\"ml\":"           << std::setprecision(4) << ml_probability_ << ","
           << "\"fund\":"         << fundamentals_.score() << ","
           << "\"sent\":"         << sentiment_      << ","
           << "\"comp\":"         << composite_      << ","
           << "\"ret1w\":"        << std::setprecision(2) << ret_1w_ << ","
           << "\"ret1m\":"        << ret_1m_         << ","
           << "\"rank\":"         << rank_           << ","
           << "\"conviction\":\""  << conviction()   << "\","
           << "\"signals\":"      << sigArr.str()
           << "}";
        return ss.str();
    }

    // ── Console display
    void print() const {
        std::cout << "\n  #" << rank_ << "  " << ticker_
                  << "  ₹" << std::fixed << std::setprecision(2) << price_ << "\n"
                  << "       Composite: " << std::setprecision(1) << composite_ * 100 << "%"
                  << "  |  ML: "         << ml_probability_  * 100 << "%"
                  << "  |  Conviction: " << conviction()           << "\n"
                  << "       Sentiment: " << std::setprecision(3) << sentiment_
                  << "  |  1W: " << std::setprecision(2) << ret_1w_ << "%\n";
    }
};


// ═══════════════════════════════════════════════
// CLASS: StockPortfolio  (collection manager)
// ═══════════════════════════════════════════════
class StockPortfolio {
private:
    std::vector<StockPrediction> picks_;
    std::string                  scan_date_;

public:
    explicit StockPortfolio(const std::string& scan_date)
        : scan_date_(scan_date) {}

    void add(StockPrediction&& p) {
        picks_.push_back(std::move(p));
    }

    // Sort by composite and assign ranks
    void rank() {
        std::sort(picks_.begin(), picks_.end(), [](const StockPrediction& a, const StockPrediction& b){
            return a.composite() > b.composite();
        });
        for (int i = 0; i < static_cast<int>(picks_.size()); ++i)
            picks_[i].setRank(i + 1);
    }

    // Export full portfolio as JSON array (ready for Firestore batch import)
    std::string toJson(int topN = 10) const {
        std::ostringstream ss;
        ss << "{\n"
           << "  \"scan_date\": \"" << scan_date_ << "\",\n"
           << "  \"total\": " << picks_.size() << ",\n"
           << "  \"picks\": [\n";

        int n = std::min(topN, static_cast<int>(picks_.size()));
        for (int i = 0; i < n; ++i) {
            ss << "    " << picks_[i].toJson();
            if (i < n - 1) ss << ",";
            ss << "\n";
        }
        ss << "  ]\n}";
        return ss.str();
    }

    // Print summary to console
    void printSummary(int topN = 10) const {
        std::cout << "\n" << std::string(60, '=') << "\n";
        std::cout << "  STOCKSENSE · C++ DATA MODEL\n";
        std::cout << "  Scan date: " << scan_date_ << "\n";
        std::cout << "  Total picks: " << picks_.size() << "\n";
        std::cout << std::string(60, '=');

        int n = std::min(topN, static_cast<int>(picks_.size()));
        for (int i = 0; i < n; ++i) picks_[i].print();
        std::cout << "\n" << std::string(60, '=') << "\n";
    }

    size_t size()            const { return picks_.size(); }
    int    bullishCount()    const {
        return static_cast<int>(
            std::count_if(picks_.begin(), picks_.end(),
                          [](const StockPrediction& p){ return p.isBullish(); }));
    }
};


// ═══════════════════════════════════════════════
// DEMO MAIN — builds sample portfolio and exports JSON
// ═══════════════════════════════════════════════
int main(int argc, char* argv[]) {
    try {
        StockPortfolio portfolio("2026-03-29");

        // ── Create picks (normally parsed from Python ML output JSON)
        auto addPick = [&](const std::string& ticker,
                           const std::string& sector,
                           double price, double ml, double roe,
                           double pe, double sent,
                           double ret1w, double ret1m,
                           const std::vector<std::string>& sigs)
        {
            StockPrediction p(ticker, sector, price);
            p.setMLProbability(ml);
            p.setSentiment(sent);
            p.setReturns(ret1w, ret1m);
            p.fundamentals().setROE(roe);
            p.fundamentals().setPE(pe);
            for (const auto& s : sigs)
                p.addSignal(s, ml > 0.65 ? "bull" : "neutral", ml);
            portfolio.add(std::move(p));
        };

        addPick("RELIANCE",  "Energy",  2847, 0.78, 0.18, 20.1, 0.18, 2.1, 5.4,  {"EMA crossover","Vol spike","MACD bull"});
        addPick("TCS",       "IT",      3921, 0.74, 0.35, 28.4, 0.22, 1.4, 3.2,  {"RSI bounce","OBV rising","EMA 50>200"});
        addPick("HDFCBANK",  "Banking", 1712, 0.71, 0.16, 17.8, 0.14, 3.2, 6.1,  {"BB squeeze","Vol breakout","MACD cross"});
        addPick("BAJFINANCE","Finance", 6840, 0.69, 0.22, 32.1, 0.11, 1.8, 4.7,  {"RSI 45→60","Fund growth","OBV bull"});
        addPick("BHARTIARTL","Telecom", 1285, 0.67, 0.12, 22.5, 0.26, 2.9, 7.3,  {"Gap up","Stoch cross","Vol surge"});
        addPick("INFY",      "IT",      1564, 0.63, 0.31, 24.7, 0.09, 0.8, 2.9,  {"High ROE","Rev growth","EMA 21>50"});
        addPick("MARUTI",    "Auto",    10420,0.61, 0.14, 24.2, 0.07, 1.2, 3.8,  {"RSI 52","MACD flat","Low PE"});
        addPick("SUNPHARMA", "Pharma",  1632, 0.59, 0.19, 29.8, 0.17, 2.4, 5.9,  {"BB upper","Vol avg","Sent pos"});
        addPick("TITAN",     "Consumer",3340, 0.54, 0.25, 70.1, 0.04, -0.6,1.4,  {"RSI 48","Low momentum","Watchlist"});
        addPick("TATAMOTORS","Auto",    768,  0.51, 0.08, 8.9,  0.21, 3.8, 9.2,  {"High beta","Sent bull","RSI 58"});

        // Rank all picks
        portfolio.rank();

        // Print to console
        portfolio.printSummary();
        std::cout << "\nBullish picks (composite ≥ 60%): " << portfolio.bullishCount() << "\n";

        // Export JSON
        std::string json = portfolio.toJson(10);

        if (argc > 1) {
            // Write to file if output path given
            std::ofstream out(argv[1]);
            if (!out.is_open())
                throw std::runtime_error("Cannot open output file: " + std::string(argv[1]));
            out << json;
            std::cout << "\nJSON exported to: " << argv[1] << "\n";
        } else {
            // Print JSON to stdout (pipe to curl for Firestore)
            std::cout << "\n── JSON OUTPUT ──\n" << json << "\n";
        }

    } catch (const std::exception& ex) {
        std::cerr << "[ERROR] " << ex.what() << "\n";
        return 1;
    }
    return 0;
}

/*
── HOW TO USE WITH FIRESTORE REST API ──────────────────

1. Build:
   g++ -std=c++17 -O2 -o stock_model stock_model.cpp

2. Generate JSON payload:
   ./stock_model picks.json

3. Upload to Firestore via REST:
   curl -X POST \
     "https://firestore.googleapis.com/v1/projects/YOUR_PROJECT/databases/(default)/documents/stocks" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json" \
     -d @picks.json

4. Or integrate with Python:
   import subprocess, json
   result = subprocess.run(["./stock_model"], capture_output=True, text=True)
   picks  = json.loads(result.stdout.split("── JSON OUTPUT ──\n")[1])
   # then push picks["picks"] to Firestore via firebase-admin SDK
*/