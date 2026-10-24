//+------------------------------------------------------------------+
//|  MoneyHeist_Clone_v4.mq5                                          |
//|  Clone draft rebuilt from the original Money Heist input set     |
//|  (bb.set). Input names/values mirror the original so the same    |
//|  .set file can be loaded into both EAs for side-by-side testing. |
//|                                                                  |
//|  Logic (draft - to be verified against Money Heist backtests):   |
//|   1. Zone   = highest high / lowest low of last N closed candles |
//|   2. Entry  = pending Buy/Sell orders placed Offset points       |
//|               outside the zone (Stop or Limit, selectable)       |
//|   3. Trend  = MA(Input_1) vs MA(Input_2) filter (optional)       |
//|   4. Grid   = add a new order every Distance points             |
//|               (against / with / both directions)                 |
//|   5. Exit   = close basket at Profit_Follow (1 order) or          |
//|               Profit_Grid (2+ orders), daily stop, time window   |
//|  No hard SL - basket profit target manages all exits.            |
//+------------------------------------------------------------------+
#property copyright "JUED"
#property link      "MoneyHeist_Clone"
#property version   "4.10"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>
#include <JUED\Dashboard.mqh>

enum ENUM_PENDING_MODE
{
   PENDING_STOP  = 0,   // Stop orders (breakout of zone)
   PENDING_LIMIT = 1    // Limit orders (rejection from zone)
};

enum ENUM_GRID_MODE
{
   GRID_AGAINST = 0,    // Add orders when price moves against basket
   GRID_WITH    = 1,    // Add orders when price moves in favour
   GRID_BOTH    = 2     // Both
};

enum ENUM_TREND_MODE
{
   TREND_OFF        = 0, // Ignore MA - place both sides
   TREND_FAST_SLOW  = 1, // Buy only if MA1 > MA2, Sell only if MA1 < MA2
   TREND_PRICE_SLOW = 2  // Buy only if Close > MA2, Sell only if Close < MA2
};

//=== Inputs (names match the original Money Heist .set) ==============
input string EA_Name                 = "Money Heist";
input string Zone_1                  = "Set BackGround";
input color  Title_Color             = (color)3937500;
input string Title_Font              = "Arial Black";
input color  Label_Color             = (color)65280;
input string Label_Font              = "Arial Black";
input color  Value_Color             = (color)16777215;
input string Value_Font              = "Verdana";

input string Zone_2                  = "Set Indicator";
input int    Indicator_Input_1       = 20;      // MA fast period
input int    Indicator_Input_2       = 100;     // MA slow period

input string Zone_3                  = "Set System Mode";
input double Lot                     = 0.02;
input int    Distance                = 200;     // Grid distance (points)
input int    Candle_ID_Zone          = 15;      // Candles used to build the zone
input int    Pending_Price_Offset    = 80;      // Pending offset from zone (points)
input double Profit_Grid_Close_All   = 80;      // Close all when basket (2+ orders) profit >= X
input double Profit_Follow_Close_All = 80;      // Close all when single order profit >= X
input double Start_up_Capital        = 1000000; // Base capital (used only if Lot_By_Capital=true)
input double Profit_Daily_Stop_EA    = 100;     // Stop EA for the day when daily profit >= X

input string Zone_4                  = "Set Open EA";
input bool   Monday                  = true;
input string Start_Time_Monday       = "01.30";
input string End_Time_Monday         = "23.00";
input bool   Tuesday                 = true;
input string Start_Time_Tuesday      = "01.30";
input string End_Time_Tuesday        = "23:00";
input bool   Wednesday               = true;
input string Start_Time_Wednesday    = "01.30";
input string End_Time_Wednesday      = "23:00";
input bool   Thursday                = true;
input string Start_Time_Thursday     = "01.30";
input string End_Time_Thursday       = "23:00";
input bool   Friday                  = true;
input string Start_Time_Friday       = "01.30";
input string End_Time_Friday         = "23:00";
input bool   Saturday                = true;
input string Start_Time_Saturday     = "01.30";
input string End_Time_Saturday       = "23:00";
input bool   Sunday                  = true;
input string Start_Time_Sunday       = "01.30";
input string End_Time_Sunday         = "23:00";
input int    MagicStart              = 1851;

//=== Clone tuning (not in the original - adjust while matching backtests)
input string Zone_5                  = "Clone Tuning";
input ENUM_TIMEFRAMES   Signal_TF          = PERIOD_CURRENT;
input ENUM_MA_METHOD    MA_Method          = MODE_EMA;
input ENUM_APPLIED_PRICE MA_Price          = PRICE_CLOSE;
input ENUM_TREND_MODE   Trend_Mode         = TREND_OFF;
input ENUM_PENDING_MODE Pending_Mode       = PENDING_STOP;
input ENUM_GRID_MODE    Grid_Mode          = GRID_AGAINST;
input bool   Delete_Opposite_On_Fill       = true;   // Remove other pending when one side fills
input bool   Refresh_Pending_Every_Bar     = true;   // Move pending orders to the new zone each bar
input double Lot_Multiplier                = 1.0;    // 1.0 = fixed lot (original has no multiplier input)
input bool   Lot_By_Capital                = false;  // Lot = Lot * Balance / Start_up_Capital
input int    Max_Orders                    = 50;     // Safety cap per basket
input bool   Grid_Outside_Time             = true;   // Keep adding grid orders outside trading hours
input int    Max_Spread_Points             = 0;      // 0 = no spread filter
input int    Slippage_Points               = 30;
input bool   Close_In_Points               = false;  // Profit_*_Close_All = distance (input units) past basket average, not money
input bool   Lot_Linear                    = false;  // add #n lot = Lot x n (0.02,0.02,0.04,0.06...) instead of Lot_Multiplier
input bool   Grid_One_Per_Bar              = false;  // at most one grid add per Signal_TF bar
input bool   Zone_With_Forming_Bar         = false;  // zone also includes the forming bar
input bool   Cancel_Pending_On_Flip        = false;  // delete a pending order whose side no longer matches the trend
input bool   Wait_Inside_Zone              = false;  // place a pending only when price is back inside the previous tick's zone
input bool   Use_Daily_Stop                = true;   // apply Profit_Daily_Stop_EA (the original never stopped on it in tests)

input string Zone_6                  = "Dashboard";
input bool   Show_Dashboard                = true;   // JUED panel (AUTO button pauses new orders)
input int    Dashboard_X                   = 10;
input int    Dashboard_Y                   = 20;

//=== Globals =========================================================
CTrade        m_trade;
CPositionInfo m_pos;
COrderInfo    m_ord;

int      g_maFast = INVALID_HANDLE;
int      g_maSlow = INVALID_HANDLE;
datetime g_lastBar = 0;
datetime g_dayStart = 0;
bool     g_dailyStopped = false;
string   g_state = "INIT";
CJuedDashboard g_dash;
bool     g_dashOn = false;
datetime g_lastGridBar = 0;
double   g_prevZoneHi = 0, g_prevZoneLo = 0;

// input unit -> price: 10 points on 3/5-digit quotes (2.00 per 200 on XAUUSD both 2 and 3 digits)
double Unit() { return (_Digits == 3 || _Digits == 5) ? _Point * 10.0 : _Point; }

//+------------------------------------------------------------------+
int OnInit()
{
   m_trade.SetExpertMagicNumber(MagicStart);
   m_trade.SetDeviationInPoints(Slippage_Points);
   m_trade.SetTypeFillingBySymbol(_Symbol);

   g_maFast = iMA(_Symbol, Signal_TF, Indicator_Input_1, 0, MA_Method, MA_Price);
   g_maSlow = iMA(_Symbol, Signal_TF, Indicator_Input_2, 0, MA_Method, MA_Price);
   if(g_maFast == INVALID_HANDLE || g_maSlow == INVALID_HANDLE)
   {
      Print("Failed to create MA handles. Error: ", GetLastError());
      return(INIT_FAILED);
   }
   if(Candle_ID_Zone < 1 || Distance <= 0)
   {
      Print("Invalid inputs: Candle_ID_Zone must be >= 1 and Distance > 0");
      return(INIT_PARAMETERS_INCORRECT);
   }
   g_dayStart = DayStart(TimeCurrent());
   // canvas redraw on a 200 ms timer makes non-visual backtests ~50x slower
   bool fastTest = MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE);
   if(Show_Dashboard && !fastTest)
   {
      g_dashOn = g_dash.Init(EA_Name + " CLONE", "V4.10", MagicStart, true, Dashboard_X, Dashboard_Y);
      EventSetMillisecondTimer(200);
   }
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   if(g_maFast != INVALID_HANDLE) IndicatorRelease(g_maFast);
   if(g_maSlow != INVALID_HANDLE) IndicatorRelease(g_maSlow);
   ObjectDelete(0, "MH_ZONE_HI");
   ObjectDelete(0, "MH_ZONE_LO");
   Comment("");
   EventKillTimer();
   if(g_dashOn) g_dash.Deinit();
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

bool AutoAllowed() { return !g_dashOn || g_dash.AutoOn(); }

//+------------------------------------------------------------------+
void OnTick()
{
   //--- Daily reset
   datetime today = DayStart(TimeCurrent());
   if(today != g_dayStart)
   {
      g_dayStart     = today;
      g_dailyStopped = false;
   }

   //--- Collect basket state
   int    buyCount = 0, sellCount = 0;
   double floating = 0;
   double lowBuy = 0, highBuy = 0, lowSell = 0, highSell = 0;
   ScanPositions(buyCount, sellCount, floating, lowBuy, highBuy, lowSell, highSell);
   int total = buyCount + sellCount;

   //--- Daily stop
   double dailyProfit = GetClosedProfitToday() + floating;
   if(Use_Daily_Stop && Profit_Daily_Stop_EA > 0 && dailyProfit >= Profit_Daily_Stop_EA) g_dailyStopped = true;
   if(g_dailyStopped)
   {
      if(total > 0) CloseAll();
      DeleteAllPending();
      g_state = "DAILY TARGET HIT - STOPPED";
      ShowDashboard(dailyProfit, floating, 0, 0, 0);
      return;
   }

   //--- Basket profit targets
   double target = (total <= 1) ? Profit_Follow_Close_All : Profit_Grid_Close_All;
   bool hitTarget = (floating >= target);
   if(Close_In_Points && total > 0) hitTarget = (BasketDistance() >= target * Unit());
   if(total > 0 && target > 0 && hitTarget)
   {
      PrintFormat("Basket close: %d orders, profit %.2f >= %.2f", total, floating, target);
      CloseAll();
      DeleteAllPending();
      g_lastBar = 0;   // allow new zone/pending immediately
      return;
   }

   bool inTime = IsTradingTime(TimeCurrent());

   //--- Grid management while a basket is open
   if(total > 0)
   {
      if(Delete_Opposite_On_Fill) DeleteAllPending();
      if((inTime || Grid_Outside_Time) && AutoAllowed()) ManageGrid(buyCount, sellCount, lowBuy, highBuy, lowSell, highSell);
      g_state = StringFormat("BASKET OPEN  B:%d  S:%d", buyCount, sellCount);
      ShowDashboard(dailyProfit, floating, 0, 0, 0);
      return;
   }

   //--- No positions: build zone and place pending orders
   if(!AutoAllowed())
   {
      DeleteAllPending();
      g_state = "PAUSED (AUTO OFF)";
      ShowDashboard(dailyProfit, floating, 0, 0, 0);
      return;
   }
   if(!inTime)
   {
      DeleteAllPending();
      g_state = "OUTSIDE TRADING TIME";
      ShowDashboard(dailyProfit, floating, 0, 0, 0);
      return;
   }

   datetime barTime = iTime(_Symbol, Signal_TF, 0);
   bool newBar = (barTime != g_lastBar);

   double zoneHi = 0, zoneLo = 0;
   if(!GetZone(zoneHi, zoneLo)) return;

   double prevHi = g_prevZoneHi, prevLo = g_prevZoneLo;
   g_prevZoneHi = zoneHi; g_prevZoneLo = zoneLo;

   int trend = GetTrend();   // 1 = buy only, -1 = sell only, 0 = both
   DrawLine("MH_ZONE_HI", zoneHi, clrOrange);
   DrawLine("MH_ZONE_LO", zoneLo, clrOrange);

   int pendBuy = 0, pendSell = 0;
   CountPending(pendBuy, pendSell);

   if(newBar && Refresh_Pending_Every_Bar && (pendBuy + pendSell) > 0)
   {
      DeleteAllPending();
      pendBuy = 0; pendSell = 0;
   }

   if(Cancel_Pending_On_Flip && newBar && ((trend > 0 && pendSell > 0) || (trend < 0 && pendBuy > 0)))
   {
      DeleteAllPending();
      pendBuy = 0; pendSell = 0;
   }

   double bidNow = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   bool buyInside  = !Wait_Inside_Zone || (prevHi > 0 && bidNow < prevHi);
   bool sellInside = !Wait_Inside_Zone || (prevLo > 0 && bidNow > prevLo);
   if(pendBuy == 0 && trend >= 0 && buyInside)   PlacePending(true,  zoneHi, zoneLo);
   if(pendSell == 0 && trend <= 0 && sellInside) PlacePending(false, zoneHi, zoneLo);

   g_lastBar = barTime;
   g_state = "WAITING PENDING FILL";
   ShowDashboard(dailyProfit, floating, zoneHi, zoneLo, trend);
}

//+------------------------------------------------------------------+
//| Zone = highest high / lowest low of last Candle_ID_Zone closed bars
//+------------------------------------------------------------------+
bool GetZone(double &hi, double &lo)
{
   double h[], l[];
   ArraySetAsSeries(h, true);
   ArraySetAsSeries(l, true);
   if(CopyHigh(_Symbol, Signal_TF, 1, Candle_ID_Zone, h) < Candle_ID_Zone) return false;
   if(CopyLow (_Symbol, Signal_TF, 1, Candle_ID_Zone, l) < Candle_ID_Zone) return false;
   hi = h[ArrayMaximum(h)];
   lo = l[ArrayMinimum(l)];
   if(Zone_With_Forming_Bar)
   {
      hi = MathMax(hi, iHigh(_Symbol, Signal_TF, 0));
      lo = MathMin(lo, iLow(_Symbol, Signal_TF, 0));
   }
   return (hi > lo);
}

int GetTrend()
{
   if(Trend_Mode == TREND_OFF) return 0;
   double f[], s[];
   ArraySetAsSeries(f, true);
   ArraySetAsSeries(s, true);
   if(CopyBuffer(g_maFast, 0, 1, 1, f) < 1) return 0;
   if(CopyBuffer(g_maSlow, 0, 1, 1, s) < 1) return 0;
   if(Trend_Mode == TREND_FAST_SLOW)
      return (f[0] > s[0]) ? 1 : (f[0] < s[0] ? -1 : 0);
   double c = iClose(_Symbol, Signal_TF, 1);
   return (c > s[0]) ? 1 : (c < s[0] ? -1 : 0);
}

//+------------------------------------------------------------------+
//| Pending orders                                                    |
//+------------------------------------------------------------------+
void PlacePending(bool isBuy, double zoneHi, double zoneLo)
{
   if(!IsSpreadOK()) return;

   double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double offset = Pending_Price_Offset * Unit();
   double minGap = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double lot    = CalcLot(0);
   string cmt    = isBuy ? "MH Pend Buy" : "MH Pend Sell";
   bool   ok     = false;

   if(Pending_Mode == PENDING_STOP)
   {
      if(isBuy)
      {
         double price = NormalizeDouble(zoneHi + offset, _Digits);
         if(price - ask > minGap) ok = m_trade.BuyStop(lot, price, _Symbol, 0, 0, ORDER_TIME_GTC, 0, cmt);
      }
      else
      {
         double price = NormalizeDouble(zoneLo - offset, _Digits);
         if(bid - price > minGap) ok = m_trade.SellStop(lot, price, _Symbol, 0, 0, ORDER_TIME_GTC, 0, cmt);
      }
   }
   else
   {
      if(isBuy)
      {
         double price = NormalizeDouble(zoneLo - offset, _Digits);
         if(ask - price > minGap) ok = m_trade.BuyLimit(lot, price, _Symbol, 0, 0, ORDER_TIME_GTC, 0, cmt);
      }
      else
      {
         double price = NormalizeDouble(zoneHi + offset, _Digits);
         if(price - bid > minGap) ok = m_trade.SellLimit(lot, price, _Symbol, 0, 0, ORDER_TIME_GTC, 0, cmt);
      }
   }
   if(!ok && m_trade.ResultRetcode() != 0 && m_trade.ResultRetcode() != TRADE_RETCODE_DONE)
      PrintFormat("Pending %s failed: retcode %u %s", isBuy ? "BUY" : "SELL",
                  m_trade.ResultRetcode(), m_trade.ResultRetcodeDescription());
}

void CountPending(int &buys, int &sells)
{
   buys = 0; sells = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!m_ord.SelectByIndex(i)) continue;
      if(m_ord.Symbol() != _Symbol || m_ord.Magic() != MagicStart) continue;
      ENUM_ORDER_TYPE t = m_ord.OrderType();
      if(t == ORDER_TYPE_BUY_STOP  || t == ORDER_TYPE_BUY_LIMIT)  buys++;
      if(t == ORDER_TYPE_SELL_STOP || t == ORDER_TYPE_SELL_LIMIT) sells++;
   }
}

void DeleteAllPending()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!m_ord.SelectByIndex(i)) continue;
      if(m_ord.Symbol() != _Symbol || m_ord.Magic() != MagicStart) continue;
      if(!m_trade.OrderDelete(m_ord.Ticket()))
         PrintFormat("OrderDelete %I64u failed: %u", m_ord.Ticket(), m_trade.ResultRetcode());
   }
}

//+------------------------------------------------------------------+
//| Grid                                                              |
//+------------------------------------------------------------------+
void ManageGrid(int buyCount, int sellCount,
                double lowBuy, double highBuy, double lowSell, double highSell)
{
   double ask  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double dist = Distance * Unit();
   if(Grid_One_Per_Bar && iTime(_Symbol, Signal_TF, 0) == g_lastGridBar) return;

   if(buyCount > 0 && buyCount < Max_Orders)
   {
      bool against = (Grid_Mode != GRID_WITH)    && ask < lowBuy  - dist;
      bool inFavour = (Grid_Mode != GRID_AGAINST) && ask >= highBuy + dist;
      if((against || inFavour) && IsSpreadOK())
      {
         double lot = CalcLot(buyCount);
         if(m_trade.Buy(lot, _Symbol, ask, 0, 0, StringFormat("MH Grid Buy #%d", buyCount + 1)))
            g_lastGridBar = iTime(_Symbol, Signal_TF, 0);
         else
            PrintFormat("Grid BUY failed: %u %s", m_trade.ResultRetcode(), m_trade.ResultRetcodeDescription());
      }
   }
   if(sellCount > 0 && sellCount < Max_Orders)
   {
      bool against = (Grid_Mode != GRID_WITH)    && bid > highSell + dist;
      bool inFavour = (Grid_Mode != GRID_AGAINST) && bid <= lowSell  - dist;
      if((against || inFavour) && IsSpreadOK())
      {
         double lot = CalcLot(sellCount);
         if(m_trade.Sell(lot, _Symbol, bid, 0, 0, StringFormat("MH Grid Sell #%d", sellCount + 1)))
            g_lastGridBar = iTime(_Symbol, Signal_TF, 0);
         else
            PrintFormat("Grid SELL failed: %u %s", m_trade.ResultRetcode(), m_trade.ResultRetcodeDescription());
      }
   }
}

double CalcLot(int existingOrders)
{
   double lot = Lot;
   if(Lot_By_Capital && Start_up_Capital > 0)
      lot = Lot * AccountInfoDouble(ACCOUNT_BALANCE) / Start_up_Capital;
   if(Lot_Linear && existingOrders > 0)
      lot *= existingOrders;
   else if(Lot_Multiplier > 0 && existingOrders > 0)
      lot *= MathPow(Lot_Multiplier, existingOrders);

   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   lot = MathFloor(lot / step + 0.5) * step;
   lot = MathMax(vmin, MathMin(vmax, lot));
   return NormalizeDouble(lot, 2);
}

//+------------------------------------------------------------------+
//| Positions / profit                                                |
//+------------------------------------------------------------------+
void ScanPositions(int &buys, int &sells, double &floating,
                   double &lowBuy, double &highBuy, double &lowSell, double &highSell)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!m_pos.SelectByIndex(i)) continue;
      if(m_pos.Symbol() != _Symbol || m_pos.Magic() != MagicStart) continue;
      double p = m_pos.PriceOpen();
      floating += m_pos.Profit() + m_pos.Swap();
      if(m_pos.PositionType() == POSITION_TYPE_BUY)
      {
         if(buys == 0 || p < lowBuy)  lowBuy  = p;
         if(buys == 0 || p > highBuy) highBuy = p;
         buys++;
      }
      else
      {
         if(sells == 0 || p < lowSell)  lowSell  = p;
         if(sells == 0 || p > highSell) highSell = p;
         sells++;
      }
   }
}

// price distance of the basket average in profit direction (bid for buys, ask for sells)
double BasketDistance()
{
   double vol = 0, sum = 0; int side = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!m_pos.SelectByIndex(i)) continue;
      if(m_pos.Symbol() != _Symbol || m_pos.Magic() != MagicStart) continue;
      vol += m_pos.Volume(); sum += m_pos.Volume() * m_pos.PriceOpen();
      side = (m_pos.PositionType() == POSITION_TYPE_BUY) ? 1 : -1;
   }
   if(vol <= 0) return 0;
   double avg = sum / vol;
   return (side > 0) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) - avg : avg - SymbolInfoDouble(_Symbol, SYMBOL_ASK);
}

double GetClosedProfitToday()
{
   double sum = 0;
   if(!HistorySelect(g_dayStart, TimeCurrent() + 60)) return 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      if(HistoryDealGetInteger(t, DEAL_MAGIC) != MagicStart) continue;
      if(HistoryDealGetString(t, DEAL_SYMBOL) != _Symbol) continue;
      sum += HistoryDealGetDouble(t, DEAL_PROFIT)
           + HistoryDealGetDouble(t, DEAL_SWAP)
           + HistoryDealGetDouble(t, DEAL_COMMISSION);
   }
   return sum;
}

void CloseAll()
{
   for(int attempt = 0; attempt < 5; attempt++)
   {
      bool remaining = false;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         if(!m_pos.SelectByIndex(i)) continue;
         if(m_pos.Symbol() != _Symbol || m_pos.Magic() != MagicStart) continue;
         if(!m_trade.PositionClose(m_pos.Ticket())) remaining = true;
      }
      if(!remaining) return;
      Sleep(300);
   }
}

bool IsSpreadOK()
{
   if(Max_Spread_Points <= 0) return true;
   return SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) <= Max_Spread_Points;
}

//+------------------------------------------------------------------+
//| Trading hours (accepts "01.30" and "01:30")                       |
//+------------------------------------------------------------------+
int ParseMinutes(string s)
{
   StringReplace(s, ".", ":");
   StringTrimLeft(s);
   StringTrimRight(s);
   string parts[];
   if(StringSplit(s, ':', parts) < 1) return -1;
   int h = (int)StringToInteger(parts[0]);
   int m = (ArraySize(parts) > 1) ? (int)StringToInteger(parts[1]) : 0;
   return h * 60 + m;
}

bool InWindow(bool enabled, string startStr, string endStr, int nowMin)
{
   if(!enabled) return false;
   int st = ParseMinutes(startStr);
   int en = ParseMinutes(endStr);
   if(st < 0 || en < 0) return true;
   if(st <= en) return (nowMin >= st && nowMin < en);
   return (nowMin >= st || nowMin < en);   // window crosses midnight
}

bool IsTradingTime(datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   int nowMin = dt.hour * 60 + dt.min;
   switch(dt.day_of_week)
   {
      case 0: return InWindow(Sunday,    Start_Time_Sunday,    End_Time_Sunday,    nowMin);
      case 1: return InWindow(Monday,    Start_Time_Monday,    End_Time_Monday,    nowMin);
      case 2: return InWindow(Tuesday,   Start_Time_Tuesday,   End_Time_Tuesday,   nowMin);
      case 3: return InWindow(Wednesday, Start_Time_Wednesday, End_Time_Wednesday, nowMin);
      case 4: return InWindow(Thursday,  Start_Time_Thursday,  End_Time_Thursday,  nowMin);
      case 5: return InWindow(Friday,    Start_Time_Friday,    End_Time_Friday,    nowMin);
      case 6: return InWindow(Saturday,  Start_Time_Saturday,  End_Time_Saturday,  nowMin);
   }
   return false;
}

datetime DayStart(datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   return StructToTime(dt);
}

//+------------------------------------------------------------------+
//| Display                                                           |
//+------------------------------------------------------------------+
void DrawLine(string name, double price, color clr)
{
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
      ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DASH);
   }
   else ObjectSetDouble(0, name, OBJPROP_PRICE, price);
}

void ShowDashboard(double daily, double floating, double zoneHi, double zoneLo, int trend)
{
   if(g_dashOn) { g_dash.SetStatus(g_state); Comment(""); return; }
   string trendTxt = (Trend_Mode == TREND_OFF) ? "OFF (both sides)" : (trend > 0 ? "BUY" : (trend < 0 ? "SELL" : "FLAT"));
   Comment(StringFormat(
      "%s  (Clone v4)\n"
      "Balance: %.2f   Equity: %.2f\n"
      "Daily P/L: %+.2f / %.2f\n"
      "Floating: %+.2f   Target: Follow %.2f | Grid %.2f\n"
      "Zone(%d): %s - %s   Offset %d pts   Grid %d pts\n"
      "Trend: %s\n"
      "Status: %s",
      EA_Name,
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY),
      daily, Profit_Daily_Stop_EA,
      floating, Profit_Follow_Close_All, Profit_Grid_Close_All,
      Candle_ID_Zone, DoubleToString(zoneLo, _Digits), DoubleToString(zoneHi, _Digits), Pending_Price_Offset, Distance,
      trendTxt, g_state));
}
//+------------------------------------------------------------------+
