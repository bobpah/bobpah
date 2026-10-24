//+------------------------------------------------------------------+
//|  JUED_Core_Dashboard.mq5                                          |
//|  Standalone dashboard EA (does not trade). Attach next to any EA |
//|  and set InpMagic to that EA's magic number (0 = all trades).    |
//|  Drawing code lives in Include\JUED\Dashboard.mqh               |
//+------------------------------------------------------------------+
#property copyright "JUED"
#property link      "JUED_Core"
#property version   "1.10"

#include <JUED\Dashboard.mqh>

input string InpTitle      = "JUED CORE";   // Dashboard title
input string InpVersion    = "V1.10";       // Version label
input long   InpMagic      = 0;             // Magic filter (0 = all)
input bool   InpThisSymbol = true;          // Only count this symbol
input int    InpX          = 10;            // Panel X
input int    InpY          = 20;            // Panel Y
input int    InpAnimMs     = 100;           // Animation refresh (ms)

CJuedDashboard g_dash;

int OnInit()
{
   if(!g_dash.Init(InpTitle, InpVersion, InpMagic, InpThisSymbol, InpX, InpY)) return(INIT_FAILED);
   EventSetMillisecondTimer(MathMax(50, InpAnimMs));
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   g_dash.Deinit();
}

void OnTick() { }
void OnTimer() { g_dash.OnTimer(); }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &req, const MqlTradeResult &res)
{
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD) g_dash.MarkDirty();
}

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   g_dash.OnChartEvent(id, lparam, dparam, sparam);
}
//+------------------------------------------------------------------+
