//+------------------------------------------------------------------+
//|  Pending_Martingale_Clone.mq5                                     |
//|  Clone framework for "Pending_Matingle_V15_LT" (BT Trader).      |
//|  The original .ex5 is encrypted, so the logic is rebuilt from    |
//|  its name and must be tuned against backtests of the original.   |
//|                                                                  |
//|  Two common "pending martingale" designs, selectable:            |
//|                                                                  |
//|  PM_ZONE_RECOVERY (default)                                      |
//|   1. Buy Stop + Sell Stop placed Entry_Distance from price (OCO) |
//|   2. First fill defines a zone [Zone_Low .. Zone_High]           |
//|   3. Opposite pending order is placed at the other zone edge     |
//|      with a bigger lot; this alternates every time price crosses |
//|   4. Whole basket closes when price runs TP_Points beyond either |
//|      zone edge (or at a money target)                            |
//|                                                                  |
//|  PM_STRADDLE                                                     |
//|   Buy Stop + Sell Stop each with own SL/TP. After a loss the     |
//|   next straddle uses lot x Multiplier, after a win it resets.    |
//|                                                                  |
//|  Safety: Max_Level, Max_Lot, equity stop, spread & time filter.  |
//+------------------------------------------------------------------+
#property copyright "JUED"
#property link      "JUED_Core"
#property version   "1.00"

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>
#include <JUED\Dashboard.mqh>

enum ENUM_PM_MODE
{
   PM_ZONE_RECOVERY = 0, // Alternate buy/sell stops at the zone edges
   PM_STRADDLE      = 1  // Straddle with SL/TP, martingale after a loss
};

enum ENUM_PM_LOT
{
   LOT_MULTIPLY = 0,     // Lot x Multiplier per level
   LOT_RECOVERY = 1      // Zone mode: lot sized so either TP closes in profit
};

//=== Inputs =========================================================
input string Grp_Mode           = "=== MODE ===";
input ENUM_PM_MODE Mode         = PM_ZONE_RECOVERY;
input int    Entry_Distance     = 200;    // Pending distance from price at start (points)
input int    Zone_Points        = 300;    // Zone width between buy and sell levels (points)
input int    TP_Points          = 600;    // Target beyond zone edge / per-order TP (points)
input int    SL_Points          = 300;    // Straddle mode only: SL per order (points)
input bool   Refresh_Start_Pending = true;// Re-centre start pendings every new bar while flat

input string Grp_Lot            = "=== LOT / MARTINGALE ===";
input double Base_Lot           = 0.01;
input ENUM_PM_LOT Lot_Mode      = LOT_MULTIPLY;
input double Multiplier         = 2.0;
input int    Max_Level          = 7;      // Max orders in a zone basket / straddle losses in a row
input double Max_Lot            = 1.0;    // Cap for a single order
input double Basket_TP_Money    = 0;      // Zone mode: close basket at this profit too (0 = off)

input string Grp_Risk           = "=== RISK ===";
input double Equity_Stop_Pct    = 30;     // Close everything if floating loss >= x% of balance (0 = off)
input int    Max_Spread_Points  = 300;    // 0 = off
input int    Start_Hour         = 1;      // New cycles only inside these server hours
input int    End_Hour           = 23;

input string Grp_System         = "=== SYSTEM ===";
input long   Magic              = 150015;
input int    Slippage_Points    = 30;
input bool   Show_Dashboard     = true;
input string Dashboard_Title    = "PENDING MARTINGALE";
input int    Dashboard_X        = 10;
input int    Dashboard_Y        = 20;

//=== Globals ========================================================
CTrade         g_trade;
CPositionInfo  g_pos;
COrderInfo     g_ord;
CJuedDashboard g_dash;
bool           g_dashOn = false;

datetime g_lastBar = 0;
double   g_zoneHigh = 0, g_zoneLow = 0;   // zone mode levels (0 = no active zone)
int      g_straddleLevel = 0;              // straddle mode loss streak
int      g_lastPosCount = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   g_trade.SetExpertMagicNumber(Magic);
   g_trade.SetDeviationInPoints(Slippage_Points);
   g_trade.SetTypeFillingBySymbol(_Symbol);
   if(Zone_Points <= 0 || TP_Points <= 0 || Entry_Distance <= 0 || Max_Level < 1) return(INIT_PARAMETERS_INCORRECT);

   // restore state after restart
   if(GlobalVariableCheck(GV("ZH"))) g_zoneHigh = GlobalVariableGet(GV("ZH"));
   if(GlobalVariableCheck(GV("ZL"))) g_zoneLow  = GlobalVariableGet(GV("ZL"));
   if(GlobalVariableCheck(GV("LV"))) g_straddleLevel = (int)GlobalVariableGet(GV("LV"));
   if(CountPositions() == 0) { g_zoneHigh = 0; g_zoneLow = 0; }
   g_lastPosCount = CountPositions();

   bool fastTest = MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE);
   if(Show_Dashboard && !fastTest)
   {
      g_dashOn = g_dash.Init(Dashboard_Title, "V1.00", Magic, true, Dashboard_X, Dashboard_Y);
      EventSetMillisecondTimer(200);
   }
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_dashOn) g_dash.Deinit();
   ObjectsDeleteAll(0, "PM_");
}

void OnTimer() { if(g_dashOn) g_dash.OnTimer(); }
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{ if(g_dashOn) g_dash.OnChartEvent(id, lparam, dparam, sparam); }
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &req, const MqlTradeResult &res)
{ if(g_dashOn && trans.type == TRADE_TRANSACTION_DEAL_ADD) g_dash.MarkDirty(); }

void Status(string s) { if(g_dashOn) g_dash.SetStatus(s); }

//+------------------------------------------------------------------+
void OnTick()
{
   int n = CountPositions();

   //--- equity stop
   if(n > 0 && Equity_Stop_Pct > 0)
   {
      double fl = Floating();
      if(fl <= -AccountInfoDouble(ACCOUNT_BALANCE) * Equity_Stop_Pct / 100.0)
      {
         PrintFormat("Equity stop: floating %.2f", fl);
         CloseAllAndReset();
         Status("EQUITY STOP HIT");
         return;
      }
   }

   if(Mode == PM_ZONE_RECOVERY) TickZone(n);
   else                         TickStraddle(n);
   g_lastPosCount = n;
}

//+------------------------------------------------------------------+
//| Zone recovery                                                     |
//+------------------------------------------------------------------+
void TickZone(int n)
{
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   if(n == 0)
   {
      if(g_zoneHigh != 0) { DeleteAllPending(); SetZone(0, 0); }   // basket closed (SL/manual/stop-out)
      StartPendings(0, 0);
      return;
   }

   //--- first fill: build the zone from it
   if(g_zoneHigh == 0)
   {
      DeleteAllPending();
      int dir; double price;
      FirstPosition(dir, price);
      if(dir > 0) SetZone(price, price - Zone_Points * _Point);
      else        SetZone(price + Zone_Points * _Point, price);
   }

   //--- exits
   double tpUp = g_zoneHigh + TP_Points * _Point;
   double tpDn = g_zoneLow  - TP_Points * _Point;
   if(bid >= tpUp || ask <= tpDn || (Basket_TP_Money > 0 && Floating() >= Basket_TP_Money))
   {
      PrintFormat("Zone basket closed: %d orders, profit %.2f", n, Floating());
      CloseAllAndReset();
      return;
   }

   //--- keep exactly one opposite pending order at the other zone edge
   int buys, sells; double buyVol, sellVol;
   Exposure(buys, sells, buyVol, sellVol);
   int lastDir = LastPositionDir();
   int pb, ps; CountPending(pb, ps);
   if(n >= Max_Level) { if(pb + ps > 0) DeleteAllPending(); Status(StringFormat("MAX LEVEL %d - WAITING TP", n)); return; }

   if(lastDir > 0 && ps == 0)
   {
      if(pb > 0) DeleteAllPending();
      double lot = ZoneLot(-1, n);
      if(lot > 0) PlacePending(ORDER_TYPE_SELL_STOP, g_zoneLow, lot, 0, 0, StringFormat("PM Z%d", n + 1));
   }
   else if(lastDir < 0 && pb == 0)
   {
      if(ps > 0) DeleteAllPending();
      double lot = ZoneLot(1, n);
      if(lot > 0) PlacePending(ORDER_TYPE_BUY_STOP, g_zoneHigh, lot, 0, 0, StringFormat("PM Z%d", n + 1));
   }
   Status(StringFormat("ZONE L%d  B %.2f / S %.2f  FLOAT %.2f", n, buyVol, sellVol, Floating()));
}

// lot for the next zone order in direction dir (n orders already open)
double ZoneLot(int dir, int n)
{
   double lot = Base_Lot * MathPow(Multiplier, n);
   if(Lot_Mode == LOT_RECOVERY)
   {
      // choose lot so the basket ends with >= Base_Lot*TP profit at the TP in direction dir
      double target = (dir > 0) ? g_zoneHigh + TP_Points * _Point : g_zoneLow - TP_Points * _Point;
      double entry  = (dir > 0) ? g_zoneHigh : g_zoneLow;
      double pnl = 0;   // price-units x lots of existing positions at target
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
         double d = (g_pos.PositionType() == POSITION_TYPE_BUY) ? target - g_pos.PriceOpen() : g_pos.PriceOpen() - target;
         pnl += d * g_pos.Volume();
      }
      double want = Base_Lot * TP_Points * _Point;
      double gainPerLot = MathAbs(target - entry);
      lot = (want - pnl) / gainPerLot;
   }
   return NormLot(lot);
}

void SetZone(double hi, double lo)
{
   g_zoneHigh = hi; g_zoneLow = lo;
   GlobalVariableSet(GV("ZH"), hi);
   GlobalVariableSet(GV("ZL"), lo);
   DrawLevel("PM_ZH", hi, clrDodgerBlue);
   DrawLevel("PM_ZL", lo, clrOrangeRed);
   DrawLevel("PM_TPU", hi > 0 ? hi + TP_Points * _Point : 0, clrLime);
   DrawLevel("PM_TPD", lo > 0 ? lo - TP_Points * _Point : 0, clrLime);
}

//+------------------------------------------------------------------+
//| Straddle                                                          |
//+------------------------------------------------------------------+
void TickStraddle(int n)
{
   // a position just closed -> update the martingale level from its result
   if(n == 0 && g_lastPosCount > 0)
   {
      double r = LastClosedResult();
      g_straddleLevel = (r < 0) ? g_straddleLevel + 1 : 0;
      if(g_straddleLevel >= Max_Level) { PrintFormat("Max level %d reached - reset", Max_Level); g_straddleLevel = 0; }
      GlobalVariableSet(GV("LV"), g_straddleLevel);
      DeleteAllPending();
   }
   if(n > 0)
   {
      int pb, ps; CountPending(pb, ps);
      if(pb + ps > 0) DeleteAllPending();      // OCO
      Status(StringFormat("STRADDLE L%d  FLOAT %.2f", g_straddleLevel, Floating()));
      return;
   }
   double lot = NormLot(Base_Lot * MathPow(Multiplier, g_straddleLevel));
   StartPendings(lot, 1);
}

//+------------------------------------------------------------------+
//| Shared                                                            |
//+------------------------------------------------------------------+
// place (or re-centre) the opening buy stop / sell stop pair while flat
void StartPendings(double lot, int withStops)
{
   int pb, ps; CountPending(pb, ps);
   datetime bar = iTime(_Symbol, PERIOD_CURRENT, 0);
   bool newBar = (bar != g_lastBar);
   g_lastBar = bar;

   if(pb + ps > 0)
   {
      if(newBar && Refresh_Start_Pending) DeleteAllPending();
      else { Status("WAITING PENDING FILL"); return; }
   }
   if(g_dashOn && !g_dash.AutoOn()) { Status("PAUSED (AUTO OFF)"); return; }
   if(!InSession())                 { Status("OUTSIDE SESSION");   return; }
   if(!SpreadOK())                  { Status("SPREAD TOO HIGH");   return; }

   if(lot <= 0) lot = NormLot(Base_Lot);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double buyP  = NormalizeDouble(ask + Entry_Distance * _Point, _Digits);
   double sellP = NormalizeDouble(bid - Entry_Distance * _Point, _Digits);
   double bsl = 0, btp = 0, ssl = 0, stp = 0;
   if(withStops)
   {
      bsl = NormalizeDouble(buyP  - SL_Points * _Point, _Digits);
      btp = NormalizeDouble(buyP  + TP_Points * _Point, _Digits);
      ssl = NormalizeDouble(sellP + SL_Points * _Point, _Digits);
      stp = NormalizeDouble(sellP - TP_Points * _Point, _Digits);
   }
   PlacePending(ORDER_TYPE_BUY_STOP,  buyP,  lot, bsl, btp, "PM Start");
   PlacePending(ORDER_TYPE_SELL_STOP, sellP, lot, ssl, stp, "PM Start");
   Status("START PENDINGS PLACED");
}

bool PlacePending(ENUM_ORDER_TYPE type, double price, double lot, double sl, double tp, string cmt)
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double minGap = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   price = NormalizeDouble(price, _Digits);
   bool ok;
   if(type == ORDER_TYPE_BUY_STOP)
   {
      // price already beyond the level -> enter at market instead of a rejected stop order
      if(price - ask <= minGap) ok = g_trade.Buy(lot, _Symbol, 0, sl, tp, cmt);
      else                      ok = g_trade.BuyStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, cmt);
   }
   else
   {
      if(bid - price <= minGap) ok = g_trade.Sell(lot, _Symbol, 0, sl, tp, cmt);
      else                      ok = g_trade.SellStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, cmt);
   }
   if(!ok) PrintFormat("Order %s failed: %u %s", EnumToString(type), g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
   return ok;
}

void CloseAllAndReset()
{
   for(int attempt = 0; attempt < 5; attempt++)
   {
      bool left = false;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
         if(!g_trade.PositionClose(g_pos.Ticket())) left = true;
      }
      if(!left) break;
      Sleep(200);
   }
   DeleteAllPending();
   SetZone(0, 0);
}

void DeleteAllPending()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!g_ord.SelectByIndex(i) || g_ord.Magic() != Magic || g_ord.Symbol() != _Symbol) continue;
      g_trade.OrderDelete(g_ord.Ticket());
   }
}

void CountPending(int &buys, int &sells)
{
   buys = 0; sells = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!g_ord.SelectByIndex(i) || g_ord.Magic() != Magic || g_ord.Symbol() != _Symbol) continue;
      ENUM_ORDER_TYPE t = g_ord.OrderType();
      if(t == ORDER_TYPE_BUY_STOP || t == ORDER_TYPE_BUY_LIMIT)   buys++;
      if(t == ORDER_TYPE_SELL_STOP || t == ORDER_TYPE_SELL_LIMIT) sells++;
   }
}

void Exposure(int &buys, int &sells, double &buyVol, double &sellVol)
{
   buys = 0; sells = 0; buyVol = 0; sellVol = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      if(g_pos.PositionType() == POSITION_TYPE_BUY) { buys++; buyVol += g_pos.Volume(); }
      else                                          { sells++; sellVol += g_pos.Volume(); }
   }
}

void FirstPosition(int &dir, double &price)
{
   datetime first = 0; dir = 0; price = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      if(first == 0 || g_pos.Time() < first)
      {
         first = g_pos.Time();
         dir = (g_pos.PositionType() == POSITION_TYPE_BUY) ? 1 : -1;
         price = g_pos.PriceOpen();
      }
   }
}

int LastPositionDir()
{
   long last = 0; int dir = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      long t = (long)g_pos.TimeMsc();
      if(t >= last) { last = t; dir = (g_pos.PositionType() == POSITION_TYPE_BUY) ? 1 : -1; }
   }
   return dir;
}

double LastClosedResult()
{
   if(!HistorySelect(TimeCurrent() - 7 * 86400, TimeCurrent() + 60)) return 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0 || HistoryDealGetInteger(t, DEAL_MAGIC) != Magic || HistoryDealGetString(t, DEAL_SYMBOL) != _Symbol) continue;
      long e = HistoryDealGetInteger(t, DEAL_ENTRY);
      if(e != DEAL_ENTRY_OUT && e != DEAL_ENTRY_OUT_BY) continue;
      return HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP) + HistoryDealGetDouble(t, DEAL_COMMISSION);
   }
   return 0;
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
      if(g_pos.SelectByIndex(i) && g_pos.Magic() == Magic && g_pos.Symbol() == _Symbol) s += g_pos.Profit() + g_pos.Swap();
   return s;
}

double NormLot(double lot)
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   if(Max_Lot > 0) lot = MathMin(lot, Max_Lot);
   lot = MathCeil(lot / step - 1e-9) * step;
   return NormalizeDouble(MathMax(vmin, MathMin(vmax, lot)), 2);
}

bool SpreadOK() { return (Max_Spread_Points <= 0) || (SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) <= Max_Spread_Points); }

bool InSession()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(Start_Hour <= End_Hour) return (dt.hour >= Start_Hour && dt.hour < End_Hour);
   return (dt.hour >= Start_Hour || dt.hour < End_Hour);
}

string GV(string k) { return StringFormat("PM_%I64d_%s_%s", Magic, _Symbol, k); }

void DrawLevel(string name, double price, color clr)
{
   if(price <= 0) { ObjectDelete(0, name); return; }
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
      ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DASH);
   }
   else ObjectSetDouble(0, name, OBJPROP_PRICE, price);
}
//+------------------------------------------------------------------+
