//+------------------------------------------------------------------+
//|  JUED_RSI_Scalper.mq5                                             |
//|  Backtestable version of the TikTok "RSI extreme" M1 technique,  |
//|  WITH the risk controls the videos do not show.                  |
//|                                                                  |
//|  Entry  : RSI(7) reaches Sell/Buy zone (88.63 / 12) on a closed   |
//|           bar, confirmed by the MACD(7,26,9) histogram turning   |
//|           (rule shared with indicator JUED_RSI_Extreme)          |
//|  Layers : up to N entries, each Layer_Step points further away   |
//|  Exit   : partial closes when live RSI returns to Tp1 / Tp2,     |
//|           rest at Tp3; SL to breakeven after Tp1                  |
//|  Risk   : hard SL (ATR or points), risk-% lot sizing, max total  |
//|           lot, time stop, daily loss limit, ADX / spread /       |
//|           session filters                                        |
//+------------------------------------------------------------------+
#property copyright "JUED"
#property link      "JUED_Core"
#property version   "1.00"

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <JUED\Dashboard.mqh>
#include <JUED\RsiExtreme.mqh>

//=== Inputs =========================================================
input string Grp_Signal         = "=== SIGNAL ===";
input ENUM_TIMEFRAMES Signal_TF = PERIOD_M1;
input int    RSI_Period         = 7;
input int    MACD_Fast          = 7;
input int    MACD_Slow          = 26;
input int    MACD_Signal        = 9;
input ENUM_RSIX_CONFIRM Confirm = RSIX_MACD_TURN;
input double Sell_Level         = 88.63;
input double Buy_Level          = 12.0;
input bool   Trade_Buy          = true;
input bool   Trade_Sell         = true;

input string Grp_TP             = "=== TAKE PROFIT (RSI levels, live bar) ===";
input double Sell_TP1           = 78.0;
input double Sell_TP2           = 68.0;
input double Sell_TP3           = 57.0;
input double Buy_TP1            = 18.0;
input double Buy_TP2            = 27.0;
input double Buy_TP3            = 38.0;
input double TP1_Close_Pct      = 34;     // % of basket closed at Tp1
input double TP2_Close_Pct      = 33;     // % of basket closed at Tp2 (rest at Tp3)
input bool   BE_After_TP1       = true;   // Move SL to average price after Tp1

input string Grp_Layers         = "=== LAYERS ===";
input int    Layers             = 3;      // Max entries per signal (1 = single entry)
input int    Layer_Step_Points  = 80;     // Next layer when price moves this far against entry 1

input string Grp_Risk           = "=== RISK ===";
input double SL_ATR             = 4.0;    // SL distance from entry 1 = x ATR(14) (0 = use SL_Points)
input int    SL_Points          = 0;      // Fixed SL in points (used when SL_ATR = 0; 0 = NO SL)
input double Risk_Percent       = 1.0;    // Risk per basket (% balance) if every layer hits SL
input double Fixed_Lot          = 0;      // >0 = fixed lot per layer (ignores Risk_Percent)
input double Max_Total_Lot      = 1.0;    // Cap for the whole basket
input int    Max_Hold_Minutes   = 60;     // Close basket after this time (0 = off)
input double Daily_Loss_Pct     = 3.0;    // Stop for the day at -x% (0 = off)
input int    Max_Baskets_Day    = 0;      // 0 = unlimited

input string Grp_Filter         = "=== FILTERS ===";
input int    ADX_Period         = 14;
input double ADX_Max            = 0;      // Skip when ADX above this (strong trend). 0 = off
input int    Max_Spread_Points  = 300;    // 0 = off
input int    Cooldown_Bars      = 3;      // Bars to wait after a basket closes
input int    Start_Hour         = 1;      // Server time
input int    End_Hour           = 23;

input string Grp_System         = "=== SYSTEM ===";
input long   Magic              = 260707;
input int    Slippage_Points    = 30;
input bool   Show_Dashboard     = true;
input int    Dashboard_X        = 10;
input int    Dashboard_Y        = 20;

//=== Globals ========================================================
CTrade         g_trade;
CPositionInfo  g_pos;
CJuedDashboard g_dash;
bool           g_dashOn = false;

int      hRsi = INVALID_HANDLE, hMacd = INVALID_HANDLE, hAtr = INVALID_HANDLE, hAdx = INVALID_HANDLE;
datetime g_lastBar = 0, g_lastCloseBar = 0;
datetime g_dayStart = 0;
double   g_dayBalance = 0;
bool     g_dayStopped = false;
int      g_basketsToday = 0;

// basket state
int      g_dir = 0;           // 1 buy, -1 sell
int      g_stage = 0;         // 0 none, 1 after Tp1, 2 after Tp2
int      g_layers = 0;        // layers opened
double   g_entry1 = 0, g_slPrice = 0, g_baseVol = 0, g_layerLot = 0;
datetime g_openTime = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   g_trade.SetExpertMagicNumber(Magic);
   g_trade.SetDeviationInPoints(Slippage_Points);
   g_trade.SetTypeFillingBySymbol(_Symbol);

   hRsi  = iRSI(_Symbol, Signal_TF, RSI_Period, PRICE_CLOSE);
   hMacd = iMACD(_Symbol, Signal_TF, MACD_Fast, MACD_Slow, MACD_Signal, PRICE_CLOSE);
   hAtr  = iATR(_Symbol, Signal_TF, 14);
   hAdx  = iADX(_Symbol, Signal_TF, ADX_Period);
   if(hRsi == INVALID_HANDLE || hMacd == INVALID_HANDLE || hAtr == INVALID_HANDLE || hAdx == INVALID_HANDLE)
      return(INIT_FAILED);
   if(Layers < 1 || TP1_Close_Pct + TP2_Close_Pct > 100) return(INIT_PARAMETERS_INCORRECT);
   if(SL_ATR <= 0 && SL_Points <= 0)
      Print("WARNING: running WITHOUT stop loss (SL_ATR = 0 and SL_Points = 0)");

   ResetDay();
   if(Show_Dashboard)
   {
      g_dashOn = g_dash.Init("JUED RSI SCALPER", "V1.00", Magic, true, Dashboard_X, Dashboard_Y);
      EventSetMillisecondTimer(200);
   }
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_dashOn) g_dash.Deinit();
   IndicatorRelease(hRsi); IndicatorRelease(hMacd); IndicatorRelease(hAtr); IndicatorRelease(hAdx);
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
   //--- day handling
   if(DayStart(TimeCurrent()) != g_dayStart) ResetDay();
   if(Daily_Loss_Pct > 0 && g_dayBalance > 0 &&
      AccountInfoDouble(ACCOUNT_EQUITY) - g_dayBalance <= -g_dayBalance * Daily_Loss_Pct / 100.0)
   {
      if(!g_dayStopped) PrintFormat("Daily loss limit %.1f%% hit - stop for today", Daily_Loss_Pct);
      g_dayStopped = true;
   }

   //--- basket bookkeeping
   int n = CountPositions();
   if(n == 0 && g_dir != 0) { ResetBasket(); g_lastCloseBar = iTime(_Symbol, Signal_TF, 0); }
   if(n > 0 && g_dir == 0) RestoreBasket();

   if(n > 0)
   {
      if(g_dayStopped) { CloseVolume(TotalVolume()); Status("DAILY LOSS LIMIT - CLOSED"); return; }
      ManageBasket();
      return;
   }

   //--- look for a new signal once per closed bar
   datetime bar = iTime(_Symbol, Signal_TF, 0);
   if(bar == g_lastBar) return;
   g_lastBar = bar;

   if(g_dayStopped)                                            { Status("DAILY LOSS LIMIT - STOPPED"); return; }
   if(g_dashOn && !g_dash.AutoOn())                            { Status("PAUSED (AUTO OFF)");          return; }
   if(Max_Baskets_Day > 0 && g_basketsToday >= Max_Baskets_Day) { Status("MAX BASKETS TODAY");          return; }
   if(!InSession())                                            { Status("OUTSIDE SESSION");            return; }
   if(g_lastCloseBar > 0 && Bars(_Symbol, Signal_TF, g_lastCloseBar, bar) <= Cooldown_Bars)
                                                               { Status("COOLDOWN");                   return; }

   double rsi[2], hist[2];
   if(!ReadSignalBars(rsi, hist)) return;
   int sig = RsiExtremeSignal(rsi[0], rsi[1], hist[0], hist[1], Sell_Level, Buy_Level, Confirm);
   if((sig > 0 && !Trade_Buy) || (sig < 0 && !Trade_Sell)) sig = 0;
   if(sig == 0) { Status(StringFormat("WAITING  RSI %.1f", rsi[0])); return; }

   if(ADX_Max > 0)
   {
      double adx = Buf(hAdx, 0, 1);
      if(adx > ADX_Max) { Status(StringFormat("ADX %.1f > %.1f - TREND, SKIP", adx, ADX_Max)); return; }
   }
   if(!SpreadOK()) { Status("SPREAD TOO HIGH"); return; }

   StartBasket(sig);
}

//+------------------------------------------------------------------+
//| Basket                                                            |
//+------------------------------------------------------------------+
void StartBasket(int dir)
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double px  = (dir > 0) ? ask : bid;

   double slDist = 0;
   if(SL_ATR > 0)         slDist = Buf(hAtr, 0, 1) * SL_ATR;
   else if(SL_Points > 0) slDist = SL_Points * _Point;
   double sl = (slDist > 0) ? NormalizeDouble(dir > 0 ? px - slDist : px + slDist, _Digits) : 0;

   g_layerLot = LayerLot(slDist);
   if(g_layerLot <= 0) return;

   if(!OpenLayer(dir, 1, sl)) return;
   g_dir = dir; g_stage = 0; g_layers = 1;
   g_entry1 = g_trade.ResultPrice() > 0 ? g_trade.ResultPrice() : px;
   g_slPrice = sl;
   g_openTime = TimeCurrent();
   g_baseVol = g_layerLot;
   g_basketsToday++;
}

void ManageBasket()
{
   double rsiNow = Buf(hRsi, 0, 0);    // live bar: TP reacts immediately like manual trading
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   //--- time stop
   if(Max_Hold_Minutes > 0 && TimeCurrent() - g_openTime >= Max_Hold_Minutes * 60)
   {
      CloseVolume(TotalVolume());
      Status("TIME STOP - BASKET CLOSED");
      return;
   }

   //--- RSI take-profit stages
   double tp1 = (g_dir < 0) ? Sell_TP1 : Buy_TP1;
   double tp2 = (g_dir < 0) ? Sell_TP2 : Buy_TP2;
   double tp3 = (g_dir < 0) ? Sell_TP3 : Buy_TP3;
   bool hit1 = (g_dir < 0) ? rsiNow <= tp1 : rsiNow >= tp1;
   bool hit2 = (g_dir < 0) ? rsiNow <= tp2 : rsiNow >= tp2;
   bool hit3 = (g_dir < 0) ? rsiNow <= tp3 : rsiNow >= tp3;

   if(hit3)
   {
      CloseVolume(TotalVolume());
      Status("TP3 - BASKET CLOSED");
      return;
   }
   if(hit2 && g_stage < 2)
   {
      double v = g_baseVol * (TP1_Close_Pct + TP2_Close_Pct) / 100.0 - (g_baseVol - TotalVolume());
      CloseVolume(v);
      g_stage = 2;
      if(BE_After_TP1) MoveSLToBreakeven();
      Status("TP2 HIT");
      return;
   }
   if(hit1 && g_stage < 1)
   {
      CloseVolume(g_baseVol * TP1_Close_Pct / 100.0);
      g_stage = 1;
      if(BE_After_TP1) MoveSLToBreakeven();
      Status("TP1 HIT - SL TO BREAKEVEN");
      return;
   }

   //--- extra layers (only before any TP)
   if(g_stage == 0 && g_layers < Layers && SpreadOK() && (!g_dashOn || g_dash.AutoOn()))
   {
      double step = Layer_Step_Points * _Point * g_layers;
      bool add = (g_dir > 0) ? (ask <= g_entry1 - step) : (bid >= g_entry1 + step);
      // never add a layer beyond the stop loss
      if(add && g_slPrice > 0) add = (g_dir > 0) ? (ask > g_slPrice) : (bid < g_slPrice);
      if(add && OpenLayer(g_dir, g_layers + 1, g_slPrice))
      {
         g_layers++;
         g_baseVol += g_layerLot;
      }
   }
   Status(StringFormat("%s x%d  RSI %.1f  STAGE %d", g_dir > 0 ? "BUY" : "SELL", g_layers, rsiNow, g_stage));
}

bool OpenLayer(int dir, int index, double sl)
{
   string cmt = StringFormat("JRS L%d", index);
   bool ok = (dir > 0) ? g_trade.Buy(g_layerLot, _Symbol, 0, sl, 0, cmt)
                       : g_trade.Sell(g_layerLot, _Symbol, 0, sl, 0, cmt);
   if(!ok) PrintFormat("Layer %d failed: %u %s", index, g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
   return ok;
}

// close a volume across the basket, best (most profitable) positions first
void CloseVolume(double vol)
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   if(step <= 0) step = 0.01;
   if(vol <= 0) return;
   vol = MathFloor(vol / step + 1e-9) * step;
   if(vol < vmin - 1e-9) vol = vmin;   // always close at least the minimum

   for(int guard = 0; guard < 50 && vol >= vmin - 1e-9; guard++)
   {
      ulong best = 0; double bestProfit = -DBL_MAX, bestVol = 0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
         if(g_pos.Profit() > bestProfit) { bestProfit = g_pos.Profit(); best = g_pos.Ticket(); bestVol = g_pos.Volume(); }
      }
      if(best == 0) break;
      double v = MathMin(vol, bestVol);
      // a leftover smaller than the minimum lot cannot stay open: close the whole position
      if(bestVol - v > 0 && bestVol - v < vmin - 1e-9) v = bestVol;
      bool ok = (v >= bestVol - 1e-9) ? g_trade.PositionClose(best) : g_trade.PositionClosePartial(best, v);
      if(!ok) { PrintFormat("Close %I64u failed: %u", best, g_trade.ResultRetcode()); break; }
      vol -= v;
   }
}

void MoveSLToBreakeven()
{
   double avg = AvgPrice();
   if(avg <= 0) return;
   double spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) * _Point;
   double be = NormalizeDouble(g_dir > 0 ? avg + spread : avg - spread, _Digits);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID), ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double minGap = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   // only if breakeven is on the safe side of the current price
   if(g_dir > 0 && be >= bid - minGap) return;
   if(g_dir < 0 && be <= ask + minGap) return;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      double cur = g_pos.StopLoss();
      bool better = (cur == 0) || (g_dir > 0 ? be > cur : be < cur);
      if(better) g_trade.PositionModify(g_pos.Ticket(), be, g_pos.TakeProfit());
   }
   g_slPrice = be;
}

void RestoreBasket()
{
   datetime first = 0;
   g_layers = 0; g_baseVol = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!g_pos.SelectByIndex(i) || g_pos.Magic() != Magic || g_pos.Symbol() != _Symbol) continue;
      g_layers++;
      g_baseVol += g_pos.Volume();
      if(first == 0 || g_pos.Time() < first)
      {
         first = g_pos.Time();
         g_dir = (g_pos.PositionType() == POSITION_TYPE_BUY) ? 1 : -1;
         g_entry1 = g_pos.PriceOpen();
         g_slPrice = g_pos.StopLoss();
         g_layerLot = g_pos.Volume();
      }
   }
   g_openTime = first;
   g_stage = 0;
}

void ResetBasket()
{
   g_dir = 0; g_stage = 0; g_layers = 0;
   g_entry1 = 0; g_slPrice = 0; g_baseVol = 0; g_openTime = 0;
}

//+------------------------------------------------------------------+
//| Helpers                                                           |
//+------------------------------------------------------------------+
bool ReadSignalBars(double &rsi[], double &hist[])
{
   // rsi[0]/hist[0] = last closed bar, rsi[1]/hist[1] = bar before it
   double r[], m[], s[];
   ArraySetAsSeries(r, true); ArraySetAsSeries(m, true); ArraySetAsSeries(s, true);
   if(CopyBuffer(hRsi,  0, 1, 2, r) < 2) return false;
   if(CopyBuffer(hMacd, 0, 1, 2, m) < 2) return false;
   if(CopyBuffer(hMacd, 1, 1, 2, s) < 2) return false;
   rsi[0] = r[0];  rsi[1] = r[1];
   hist[0] = m[0] - s[0]; hist[1] = m[1] - s[1];
   return true;
}

double Buf(int handle, int buffer, int shift)
{
   double v[];
   if(CopyBuffer(handle, buffer, shift, 1, v) < 1) return 0;
   return v[0];
}

double LayerLot(double slDist)
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;

   double lot = Fixed_Lot;
   if(lot <= 0)
   {
      double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(slDist > 0 && tickVal > 0 && tickSize > 0)
      {
         double riskMoney   = AccountInfoDouble(ACCOUNT_BALANCE) * Risk_Percent / 100.0;
         double lossPerLot  = slDist / tickSize * tickVal;      // one lot hitting the full SL distance
         lot = riskMoney / lossPerLot / Layers;                 // all layers together stay within risk
      }
      else lot = vmin;                                          // no SL: minimum lot only
   }
   if(Max_Total_Lot > 0) lot = MathMin(lot, Max_Total_Lot / Layers);
   lot = MathFloor(lot / step + 1e-9) * step;
   if(lot < vmin) lot = vmin;
   return NormalizeDouble(MathMin(lot, vmax), 2);
}

int CountPositions()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(g_pos.SelectByIndex(i) && g_pos.Magic() == Magic && g_pos.Symbol() == _Symbol) n++;
   return n;
}

double TotalVolume()
{
   double v = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(g_pos.SelectByIndex(i) && g_pos.Magic() == Magic && g_pos.Symbol() == _Symbol) v += g_pos.Volume();
   return v;
}

double AvgPrice()
{
   double v = 0, pv = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(g_pos.SelectByIndex(i) && g_pos.Magic() == Magic && g_pos.Symbol() == _Symbol)
      { v += g_pos.Volume(); pv += g_pos.Volume() * g_pos.PriceOpen(); }
   return (v > 0) ? pv / v : 0;
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
   g_dayBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   g_dayStopped = false;
   g_basketsToday = 0;
}
//+------------------------------------------------------------------+
