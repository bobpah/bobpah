//+------------------------------------------------------------------+
//|  JUED_Core_EA.mq5                                                 |
//|  Trend-line breakout EA for XAUUSD M15 with ATR risk and up to   |
//|  3 entries per signal. Built as a tunable framework while the    |
//|  DNA CORE behaviour is being reverse-engineered from backtests.  |
//|                                                                  |
//|  Signal (all on CLOSED bars of Signal_TF):                       |
//|   - Trend   : Close vs EMA(Trend_MA_Period)        (red line)    |
//|   - Pivots  : swing highs / lows (Pivot_Left / Pivot_Right)      |
//|   - Lines   : descending line through last 2 lower pivot highs,  |
//|               ascending line through last 2 higher pivot lows    |
//|               (fallback: horizontal last pivot) (white lines)    |
//|   - Entry 1 : candle closes through the line in trend direction  |
//|   - Entry 2/3: added every Add_Step_ATR x ATR (pullback or       |
//|               momentum, selectable)                              |
//|   - Exit    : basket TP = avg price +/- TP_ATR x ATR,            |
//|               basket SL = first entry -/+ SL_ATR x ATR,          |
//|               optional breakeven, money target, daily limits     |
//|   - Lot     : Lot_Per_Step per Capital_Step of balance (auto)    |
//+------------------------------------------------------------------+
#property copyright "JUED"
#property link      "JUED_Core"
#property version   "1.00"

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <JUED\Dashboard.mqh>

enum ENUM_ADD_MODE
{
   ADD_PULLBACK = 0,   // Add when price moves against basket (better average)
   ADD_MOMENTUM = 1    // Add when price moves in favour (pyramid)
};

//=== Inputs =========================================================
input string Grp_Signal          = "=== SIGNAL ===";
input ENUM_TIMEFRAMES Signal_TF  = PERIOD_M15;
input int    Trend_MA_Period     = 200;        // EMA trend filter (0 = off)
input int    Pivot_Left          = 5;          // Bars left of a pivot
input int    Pivot_Right         = 3;          // Bars right of a pivot (confirmation)
input int    Pivot_Lookback      = 150;        // Bars scanned for pivots
input bool   Horizontal_Fallback = true;       // Use last pivot level if no sloped line
input int    ATR_Period          = 14;
input double Min_ATR_Points      = 0;          // Skip signals when ATR is below this (0 = off)

input string Grp_Entries         = "=== ENTRIES 1-3 ===";
input int    Max_Entries         = 3;          // Entries per signal (1..3 = "Entry 1-3")
input ENUM_ADD_MODE Add_Mode     = ADD_PULLBACK;
input double Add_Step_ATR        = 1.0;        // Distance between entries (x ATR at entry 1)
input double Add_Lot_Multiplier  = 1.0;        // Lot multiplier for entries 2-3

input string Grp_Exit            = "=== EXIT ===";
input double TP_ATR              = 1.5;        // Basket TP from average price (x ATR)
input double SL_ATR              = 3.0;        // Basket SL from entry 1 (x ATR, 0 = none)
input double BE_Trigger_ATR      = 1.0;        // Move SL to average + lock when profit >= x ATR (0 = off)
input double BE_Lock_ATR         = 0.1;        // Locked distance beyond average (x ATR)
input double Basket_TP_Money     = 0;          // Close basket at this profit (0 = off)

input string Grp_Money           = "=== MONEY ===";
input double Lot_Per_Step        = 0.01;       // Lot per capital step
input double Capital_Step        = 10000;      // "Preset auto 10K" (cent account)
input double Fixed_Lot           = 0;          // >0 overrides auto lot
input double Daily_Target_Pct    = 0;          // Stop for the day at +x% (0 = off)
input double Daily_Loss_Pct      = 0;          // Stop for the day at -x% (0 = off)

input string Grp_Filter          = "=== FILTERS ===";
input int    Max_Spread_Points   = 250;        // Skip entries above this spread (0 = off)
input int    Start_Hour          = 1;          // Server hour to start new signals
input int    End_Hour            = 23;         // Server hour to stop new signals
input bool   Draw_Lines          = true;

input string Grp_System          = "=== SYSTEM ===";
input long   Magic               = 260195;
input int    Slippage_Points     = 30;
input bool   Show_Dashboard      = true;
input int    Dashboard_X         = 10;
input int    Dashboard_Y         = 20;

//=== Globals ========================================================
CTrade         g_trade;
CPositionInfo  g_pos;
CJuedDashboard g_dash;
bool           g_dashOn = false;

int      g_hATR = INVALID_HANDLE, g_hMA = INVALID_HANDLE;
datetime g_lastBar = 0;
datetime g_dayStart = 0;
double   g_dayStartBalance = 0;
bool     g_dayStopped = false;

// basket state (rebuilt from open positions on restart)
int      g_dir = 0;            // 1 buy, -1 sell, 0 flat
double   g_entry1 = 0;         // price of entry 1
double   g_atrAtEntry = 0;     // ATR used for this basket

//+------------------------------------------------------------------+
int OnInit()
{
   g_trade.SetExpertMagicNumber(Magic);
   g_trade.SetDeviationInPoints(Slippage_Points);
   g_trade.SetTypeFillingBySymbol(_Symbol);

   g_hATR = iATR(_Symbol, Signal_TF, ATR_Period);
   if(Trend_MA_Period > 0) g_hMA = iMA(_Symbol, Signal_TF, Trend_MA_Period, 0, MODE_EMA, PRICE_CLOSE);
   if(g_hATR == INVALID_HANDLE || (Trend_MA_Period > 0 && g_hMA == INVALID_HANDLE))
   {
      Print("Indicator handle error: ", GetLastError());
      return(INIT_FAILED);
   }
   if(Max_Entries < 1 || Pivot_Left < 1 || Pivot_Right < 1) return(INIT_PARAMETERS_INCORRECT);

   ResetDay();
   RestoreBasket();

   // canvas redraw on a 200 ms timer makes non-visual backtests ~50x slower
   bool fastTest = MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE);
   if(Show_Dashboard && !fastTest)
   {
      g_dashOn = g_dash.Init("JUED CORE", "V1.00", Magic, true, Dashboard_X, Dashboard_Y);
      EventSetMillisecondTimer(200);
   }
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_dashOn) g_dash.Deinit();
   if(g_hATR != INVALID_HANDLE) IndicatorRelease(g_hATR);
   if(g_hMA  != INVALID_HANDLE) IndicatorRelease(g_hMA);
   ObjectsDeleteAll(0, "JC_");
}

void OnTimer() { if(g_dashOn) g_dash.OnTimer(); }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(g_dashOn) g_dash.OnChartEvent(id, lparam, dparam, sparam);
}

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &req, const MqlTradeResult &res)
{
   if(g_dashOn && trans.type == TRADE_TRANSACTION_DEAL_ADD) g_dash.MarkDirty();
}

void Status(const string s) { if(g_dashOn) g_dash.SetStatus(s); }

//+------------------------------------------------------------------+
void OnTick()
{
   //--- daily limits
   if(DayStart(TimeCurrent()) != g_dayStart) ResetDay();
   double dayPnL = AccountInfoDouble(ACCOUNT_EQUITY) - g_dayStartBalance;
   if(g_dayStartBalance > 0)
   {
      if(Daily_Target_Pct > 0 && dayPnL >=  g_dayStartBalance * Daily_Target_Pct / 100.0) g_dayStopped = true;
      if(Daily_Loss_Pct   > 0 && dayPnL <= -g_dayStartBalance * Daily_Loss_Pct   / 100.0) g_dayStopped = true;
   }
   if(g_dayStopped)
   {
      if(CountPositions() > 0) CloseBasket("daily limit");
      Status("DAILY LIMIT REACHED - STOPPED");
      return;
   }

   //--- manage open basket every tick
   int n = CountPositions();
   if(n == 0 && g_dir != 0) { g_dir = 0; g_entry1 = 0; g_atrAtEntry = 0; }
   if(n > 0)
   {
      ManageBasket(n);
      return;
   }

   //--- new signals only on a new closed bar
   datetime bar = iTime(_Symbol, Signal_TF, 0);
   if(bar == g_lastBar) return;
   g_lastBar = bar;

   if(g_dashOn && !g_dash.AutoOn()) { Status("PAUSED (AUTO OFF)"); return; }
   if(!InSession())                 { Status("OUTSIDE SESSION");   return; }

   double atr = Buffer(g_hATR, 1);
   if(atr <= 0) return;
   if(Min_ATR_Points > 0 && atr < Min_ATR_Points * _Point) { Status("ATR TOO LOW"); return; }

   int sig = Signal();
   if(sig == 0) { Status("WAITING BREAKOUT"); return; }
   if(!SpreadOK()) { Status("SPREAD TOO HIGH"); return; }

   OpenEntry(sig, 1, atr);
}

//+------------------------------------------------------------------+
//| Signal                                                            |
//+------------------------------------------------------------------+
int Signal()
{
   int need = Pivot_Lookback + Pivot_Left + Pivot_Right + 5;
   double h[], l[], c[];
   ArraySetAsSeries(h, true); ArraySetAsSeries(l, true); ArraySetAsSeries(c, true);
   if(CopyHigh (_Symbol, Signal_TF, 0, need, h) < need) return 0;
   if(CopyLow  (_Symbol, Signal_TF, 0, need, l) < need) return 0;
   if(CopyClose(_Symbol, Signal_TF, 0, need, c) < need) return 0;

   int trend = 0;
   if(Trend_MA_Period > 0)
   {
      double ma = Buffer(g_hMA, 1);
      if(ma <= 0) return 0;
      trend = (c[1] > ma) ? 1 : (c[1] < ma ? -1 : 0);
   }

   // --- resistance line from pivot highs -> buy breakout
   int a = -1, b = -1;
   FindPivots(h, true, a, b);
   double res1 = 0, res2 = 0;
   if(LineValues(h, a, b, true, res1, res2))
   {
      DrawTrend("JC_RES", h, a, b, res1);
      if(trend >= 0 && c[1] > res1 && c[2] <= res2) return 1;
   }

   // --- support line from pivot lows -> sell breakout
   a = -1; b = -1;
   FindPivots(l, false, a, b);
   double sup1 = 0, sup2 = 0;
   if(LineValues(l, a, b, false, sup1, sup2))
   {
      DrawTrend("JC_SUP", l, a, b, sup1);
      if(trend <= 0 && c[1] < sup1 && c[2] >= sup2) return -1;
   }
   return 0;
}

// newest pivot -> a, previous pivot -> b (series indexing, 0 = current bar)
void FindPivots(const double &p[], bool isHigh, int &a, int &b)
{
   a = -1; b = -1;
   int last = Pivot_Lookback + Pivot_Right;
   for(int i = Pivot_Right + 1; i <= last; i++)
   {
      bool piv = true;
      for(int k = 1; k <= Pivot_Left && piv; k++)
         if(isHigh ? p[i + k] >= p[i] : p[i + k] <= p[i]) piv = false;
      for(int k = 1; k <= Pivot_Right && piv; k++)
         if(isHigh ? p[i - k] > p[i] : p[i - k] < p[i]) piv = false;
      if(!piv) continue;
      if(a < 0) a = i;
      else { b = i; return; }
   }
}

// value of the line at bar 1 (v1) and bar 2 (v2)
bool LineValues(const double &p[], int a, int b, bool isHigh, double &v1, double &v2)
{
   if(a < 0) return false;
   bool sloped = (b > a) && (isHigh ? p[a] < p[b] : p[a] > p[b]);   // descending highs / ascending lows
   if(sloped)
   {
      double slope = (p[a] - p[b]) / (double)(b - a);   // price change per bar towards the present
      v1 = p[a] + slope * (a - 1);
      v2 = p[a] + slope * (a - 2);
      return true;
   }
   if(!Horizontal_Fallback) return false;
   v1 = p[a]; v2 = p[a];
   return true;
}

void DrawTrend(string name, const double &p[], int a, int b, double v1)
{
   if(!Draw_Lines) return;
   datetime t1 = iTime(_Symbol, Signal_TF, (b > a ? b : a));
   double   y1 = p[(b > a ? b : a)];
   datetime t2 = iTime(_Symbol, Signal_TF, 1);
   if(b <= a || (name == "JC_RES" ? p[a] >= p[b] : p[a] <= p[b])) { t1 = iTime(_Symbol, Signal_TF, a); y1 = v1; }
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_TREND, 0, t1, y1, t2, v1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clrWhite);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
      ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, true);
   }
   else
   {
      ObjectMove(0, name, 0, t1, y1);
      ObjectMove(0, name, 1, t2, v1);
   }
}

//+------------------------------------------------------------------+
//| Orders / basket                                                   |
//+------------------------------------------------------------------+
void OpenEntry(int dir, int index, double atr)
{
   double lot = EntryLot(index);
   string cmt = StringFormat("JC Entry %d", index);
   bool ok = (dir > 0) ? g_trade.Buy(lot, _Symbol, 0, 0, 0, cmt)
                       : g_trade.Sell(lot, _Symbol, 0, 0, 0, cmt);
   if(!ok)
   {
      PrintFormat("Entry %d failed: %u %s", index, g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
      return;
   }
   if(index == 1)
   {
      g_dir = dir;
      g_entry1 = g_trade.ResultPrice() > 0 ? g_trade.ResultPrice()
                                           : SymbolInfoDouble(_Symbol, dir > 0 ? SYMBOL_ASK : SYMBOL_BID);
      g_atrAtEntry = atr;
      // remember basket context across restarts
      GlobalVariableSet(GVName("E1"), g_entry1);
      GlobalVariableSet(GVName("ATR"), g_atrAtEntry);
   }
   Status(StringFormat("%s ENTRY %d OPENED", dir > 0 ? "BUY" : "SELL", index));
   UpdateStops();
}

void ManageBasket(int n)
{
   if(g_dir == 0) RestoreBasket();
   if(g_dir == 0 || g_atrAtEntry <= 0) return;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double px  = (g_dir > 0) ? bid : ask;

   //--- money target
   double fl = Floating();
   if(Basket_TP_Money > 0 && fl >= Basket_TP_Money) { CloseBasket("money target"); return; }

   //--- add entries 2..Max_Entries
   if(n < Max_Entries && (!g_dashOn || g_dash.AutoOn()) && SpreadOK())
   {
      double step = Add_Step_ATR * g_atrAtEntry * n;   // entry k at (k-1) steps from entry 1
      bool add = false;
      if(Add_Mode == ADD_PULLBACK) add = (g_dir > 0) ? (ask <= g_entry1 - step) : (bid >= g_entry1 + step);
      else                         add = (g_dir > 0) ? (ask >= g_entry1 + step) : (bid <= g_entry1 - step);
      if(add) { OpenEntry(g_dir, n + 1, g_atrAtEntry); return; }
   }

   //--- breakeven on the basket
   if(BE_Trigger_ATR > 0)
   {
      double avg = AvgPrice();
      double gain = (g_dir > 0) ? px - avg : avg - px;
      if(gain >= BE_Trigger_ATR * g_atrAtEntry)
      {
         double be = (g_dir > 0) ? avg + BE_Lock_ATR * g_atrAtEntry : avg - BE_Lock_ATR * g_atrAtEntry;
         SetBasketSL(be, true);
      }
   }
   Status(StringFormat("%s BASKET %d/%d  FLOAT %.2f", g_dir > 0 ? "BUY" : "SELL", n, Max_Entries, fl));
}

// TP from average price, SL from entry 1 - applied to every position in the basket
void UpdateStops()
{
   double avg = AvgPrice();
   if(avg <= 0 || g_atrAtEntry <= 0) return;
   double tp = (TP_ATR > 0) ? (g_dir > 0 ? avg + TP_ATR * g_atrAtEntry : avg - TP_ATR * g_atrAtEntry) : 0;
   double sl = (SL_ATR > 0) ? (g_dir > 0 ? g_entry1 - SL_ATR * g_atrAtEntry : g_entry1 + SL_ATR * g_atrAtEntry) : 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      double nsl = NormalizeDouble(sl, _Digits), ntp = NormalizeDouble(tp, _Digits);
      if(MathAbs(g_pos.StopLoss() - nsl) < _Point && MathAbs(g_pos.TakeProfit() - ntp) < _Point) continue;
      if(!g_trade.PositionModify(g_pos.Ticket(), nsl, ntp))
         PrintFormat("Modify %I64u failed: %u", g_pos.Ticket(), g_trade.ResultRetcode());
   }
}

// only tightens: never moves an SL further away
void SetBasketSL(double sl, bool onlyTighten)
{
   sl = NormalizeDouble(sl, _Digits);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      double cur = g_pos.StopLoss();
      bool better = (cur == 0) || (g_dir > 0 ? sl > cur + _Point : sl < cur - _Point);
      if(onlyTighten && !better) continue;
      g_trade.PositionModify(g_pos.Ticket(), sl, g_pos.TakeProfit());
   }
}

void CloseBasket(string why)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      g_trade.PositionClose(g_pos.Ticket());
   }
   PrintFormat("Basket closed (%s)", why);
   g_dir = 0; g_entry1 = 0; g_atrAtEntry = 0;
}

void RestoreBasket()
{
   g_dir = 0;
   datetime first = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      if(first == 0 || g_pos.Time() < first)
      {
         first   = g_pos.Time();
         g_dir   = (g_pos.PositionType() == POSITION_TYPE_BUY) ? 1 : -1;
         g_entry1 = g_pos.PriceOpen();
      }
   }
   if(g_dir == 0) return;
   g_atrAtEntry = GlobalVariableCheck(GVName("ATR")) ? GlobalVariableGet(GVName("ATR")) : Buffer(g_hATR, 1);
}

//+------------------------------------------------------------------+
//| Helpers                                                           |
//+------------------------------------------------------------------+
string GVName(string key) { return StringFormat("JC_%I64d_%s_%s", Magic, _Symbol, key); }

double Buffer(int handle, int shift)
{
   double v[];
   if(CopyBuffer(handle, 0, shift, 1, v) < 1) return 0;
   return v[0];
}

int CountPositions()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(g_pos.SelectByIndex(i) && g_pos.Magic() == Magic && g_pos.Symbol() == _Symbol) n++;
   return n;
}

double Floating()
{
   double s = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(g_pos.SelectByIndex(i) && g_pos.Magic() == Magic && g_pos.Symbol() == _Symbol)
         s += g_pos.Profit() + g_pos.Swap();
   return s;
}

double AvgPrice()
{
   double v = 0, pv = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(g_pos.SelectByIndex(i) && g_pos.Magic() == Magic && g_pos.Symbol() == _Symbol)
      { v += g_pos.Volume(); pv += g_pos.Volume() * g_pos.PriceOpen(); }
   return (v > 0) ? pv / v : 0;
}

double EntryLot(int index)
{
   double lot = Fixed_Lot;
   if(lot <= 0)
   {
      double steps = MathFloor(AccountInfoDouble(ACCOUNT_BALANCE) / MathMax(1.0, Capital_Step));
      lot = MathMax(1.0, steps) * Lot_Per_Step;
   }
   if(index > 1 && Add_Lot_Multiplier > 0) lot *= MathPow(Add_Lot_Multiplier, index - 1);

   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   lot = MathFloor(lot / step + 0.5) * step;
   return NormalizeDouble(MathMax(vmin, MathMin(vmax, lot)), 2);
}

bool SpreadOK()
{
   return (Max_Spread_Points <= 0) || (SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) <= Max_Spread_Points);
}

bool InSession()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(Start_Hour <= End_Hour) return (dt.hour >= Start_Hour && dt.hour < End_Hour);
   return (dt.hour >= Start_Hour || dt.hour < End_Hour);
}

datetime DayStart(datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   return StructToTime(dt);
}

void ResetDay()
{
   g_dayStart = DayStart(TimeCurrent());
   g_dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   g_dayStopped = false;
}
//+------------------------------------------------------------------+
