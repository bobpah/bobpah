//+------------------------------------------------------------------+
//|  JUED_RSI_Extreme.mq5                                             |
//|  One-window version of the TikTok "RSI extreme" setup:           |
//|   - RSI(7) red line                                              |
//|   - MACD(7,26,9) histogram + signal, scaled into 0..100 around 50 |
//|   - Labelled levels: Sell / Tp1-3 / 50 / Tp1-3 / Buy             |
//|   - Arrows (window + price chart) when the entry rule fires      |
//|  Entry rule is shared with the EA: Include\JUED\RsiExtreme.mqh  |
//+------------------------------------------------------------------+
#property copyright "JUED"
#property link      "JUED_Core"
#property version   "1.00"

#property indicator_separate_window
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_buffers 9
#property indicator_plots   5

#property indicator_label1  "MACD hist"
#property indicator_type1   DRAW_HISTOGRAM2
#property indicator_color1  clrSilver
#property indicator_width1  2

#property indicator_label2  "MACD signal"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrDimGray
#property indicator_style2  STYLE_DOT

#property indicator_label3  "RSI"
#property indicator_type3   DRAW_LINE
#property indicator_color3  clrRed
#property indicator_width3  2

#property indicator_label4  "SELL"
#property indicator_type4   DRAW_ARROW
#property indicator_color4  clrOrangeRed
#property indicator_width4  2

#property indicator_label5  "BUY"
#property indicator_type5   DRAW_ARROW
#property indicator_color5  clrDodgerBlue
#property indicator_width5  2

#include <JUED\RsiExtreme.mqh>

//=== Inputs =========================================================
input string Grp_Ind           = "=== INDICATORS ===";
input int    RSI_Period        = 7;
input int    MACD_Fast         = 7;
input int    MACD_Slow         = 26;
input int    MACD_Signal       = 9;
input int    MACD_Scale_Bars   = 200;     // Bars used to scale MACD into the 0..100 window

input string Grp_Levels        = "=== LEVELS ===";
input double Sell_Level        = 88.63;   // Sell zone
input double Sell_Level_2      = 91.0;    // Deeper sell zone (layer)
input double Sell_TP1          = 78.0;
input double Sell_TP2          = 68.0;
input double Sell_TP3          = 57.0;
input double Buy_Level         = 12.0;    // Buy zone
input double Buy_Level_2       = 8.46;    // Deeper buy zone (layer)
input double Buy_TP1           = 18.0;
input double Buy_TP2           = 27.0;
input double Buy_TP3           = 38.0;

input string Grp_Signal        = "=== SIGNAL ===";
input ENUM_RSIX_CONFIRM Confirm = RSIX_MACD_TURN;
input bool   Price_Arrows      = true;    // Also draw arrows on the price chart
input bool   Alert_On_Signal   = false;
input int    Max_Bars          = 5000;    // Bars to calculate (0 = all)

//=== Buffers ========================================================
double bHistBase[], bHist[], bSig[], bRsi[], bSell[], bBuy[];
double cMacd[], cMacdSig[], cRaw[];

int    hRsi = INVALID_HANDLE, hMacd = INVALID_HANDLE;
string g_prefix;
datetime g_lastAlert = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   SetIndexBuffer(0, bHistBase, INDICATOR_DATA);
   SetIndexBuffer(1, bHist,     INDICATOR_DATA);
   SetIndexBuffer(2, bSig,      INDICATOR_DATA);
   SetIndexBuffer(3, bRsi,      INDICATOR_DATA);
   SetIndexBuffer(4, bSell,     INDICATOR_DATA);
   SetIndexBuffer(5, bBuy,      INDICATOR_DATA);
   SetIndexBuffer(6, cMacd,     INDICATOR_CALCULATIONS);
   SetIndexBuffer(7, cMacdSig,  INDICATOR_CALCULATIONS);
   SetIndexBuffer(8, cRaw,      INDICATOR_CALCULATIONS);

   PlotIndexSetInteger(3, PLOT_ARROW, 234);   // down arrow
   PlotIndexSetInteger(4, PLOT_ARROW, 233);   // up arrow
   PlotIndexSetInteger(3, PLOT_ARROW_SHIFT, -10);
   PlotIndexSetInteger(4, PLOT_ARROW_SHIFT,  10);
   for(int p = 0; p < 5; p++) PlotIndexSetDouble(p, PLOT_EMPTY_VALUE, EMPTY_VALUE);

   hRsi  = iRSI(_Symbol, _Period, RSI_Period, PRICE_CLOSE);
   hMacd = iMACD(_Symbol, _Period, MACD_Fast, MACD_Slow, MACD_Signal, PRICE_CLOSE);
   if(hRsi == INVALID_HANDLE || hMacd == INVALID_HANDLE) return(INIT_FAILED);

   //--- labelled levels (same layout as the screenshots)
   double lv[11];
   lv[0] = Sell_Level_2; lv[1] = Sell_Level; lv[2] = Sell_TP1; lv[3] = Sell_TP2; lv[4] = Sell_TP3; lv[5] = 50.0;
   lv[6] = Buy_TP3;      lv[7] = Buy_TP2;    lv[8] = Buy_TP1;  lv[9] = Buy_Level; lv[10] = Buy_Level_2;
   string tx[] = {"Sell", "Sell", "Tp1", "Tp2", "Tp3", "Tp", "Tp3", "Tp2", "Tp1", "Buy", "Buy"};
   int n = ArraySize(lv);
   IndicatorSetInteger(INDICATOR_LEVELS, n);
   for(int i = 0; i < n; i++)
   {
      IndicatorSetDouble(INDICATOR_LEVELVALUE, i, lv[i]);
      IndicatorSetString(INDICATOR_LEVELTEXT, i, tx[i]);
      IndicatorSetInteger(INDICATOR_LEVELCOLOR, i, (i < 2 || i > 8) ? clrGoldenrod : clrDarkOliveGreen);
      IndicatorSetInteger(INDICATOR_LEVELSTYLE, i, STYLE_DOT);
   }
   IndicatorSetInteger(INDICATOR_DIGITS, 2);
   IndicatorSetString(INDICATOR_SHORTNAME, StringFormat("JUED RSI(%d) MACD(%d,%d,%d)", RSI_Period, MACD_Fast, MACD_Slow, MACD_Signal));

   g_prefix = StringFormat("JRX_%d_", ChartWindowFind());
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, "JRX_");
   if(hRsi  != INVALID_HANDLE) IndicatorRelease(hRsi);
   if(hMacd != INVALID_HANDLE) IndicatorRelease(hMacd);
}

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[], const double &high[],
                const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   if(rates_total < MACD_Slow + MACD_Signal + 2) return(0);
   if(BarsCalculated(hRsi) < rates_total || BarsCalculated(hMacd) < rates_total) return(prev_calculated);

   if(CopyBuffer(hRsi,  0, 0, rates_total, bRsi)     <= 0) return(prev_calculated);
   if(CopyBuffer(hMacd, 0, 0, rates_total, cMacd)    <= 0) return(prev_calculated);
   if(CopyBuffer(hMacd, 1, 0, rates_total, cMacdSig) <= 0) return(prev_calculated);

   // arrays here are NOT series: index 0 = oldest bar
   int first = MathMax(MACD_Slow + MACD_Signal, 1);
   if(Max_Bars > 0) first = MathMax(first, rates_total - Max_Bars);
   int start = (prev_calculated > 1) ? prev_calculated - 1 : first;
   if(prev_calculated <= 1)
      for(int k = 0; k < first; k++)
      {
         bHistBase[k] = EMPTY_VALUE; bHist[k] = EMPTY_VALUE; bSig[k] = EMPTY_VALUE;
         bSell[k] = EMPTY_VALUE; bBuy[k] = EMPTY_VALUE; cRaw[k] = 0;
      }

   for(int i = start; i < rates_total; i++)
   {
      //--- histogram (MACD - signal) scaled by the largest move in the last N bars
      cRaw[i] = cMacd[i] - cMacdSig[i];
      double mx = 1e-10;
      int from = MathMax(first, i - MACD_Scale_Bars + 1);
      for(int k = from; k <= i; k++)
      {
         double a = MathMax(MathAbs(cMacd[k] - cMacdSig[k]), MathAbs(cMacd[k]));
         if(a > mx) mx = a;
      }
      bHistBase[i] = 50.0;
      bHist[i]     = 50.0 + cRaw[i]   / mx * 45.0;
      bSig[i]      = 50.0 + cMacdSig[i] / mx * 45.0;

      //--- signal on CLOSED bars only (never repaints)
      bSell[i] = EMPTY_VALUE; bBuy[i] = EMPTY_VALUE;
      if(i >= rates_total - 1 || i < first + 1) continue;
      int sig = RsiExtremeSignal(bRsi[i], bRsi[i - 1], cRaw[i], cRaw[i - 1], Sell_Level, Buy_Level, Confirm);
      // one arrow per swing: skip if the previous bar already signalled the same way
      if(sig < 0 && bSell[i - 1] == EMPTY_VALUE) { bSell[i] = bRsi[i]; MarkPrice(time[i], high[i], false, i == rates_total - 2); }
      if(sig > 0 && bBuy[i - 1]  == EMPTY_VALUE) { bBuy[i]  = bRsi[i]; MarkPrice(time[i], low[i],  true,  i == rates_total - 2); }
   }
   return(rates_total);
}

void MarkPrice(datetime t, double price, bool isBuy, bool newest)
{
   if(Price_Arrows)
   {
      string name = g_prefix + (isBuy ? "B_" : "S_") + IntegerToString((long)t);
      if(ObjectFind(0, name) < 0)
      {
         ObjectCreate(0, name, isBuy ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, t, price);
         ObjectSetInteger(0, name, OBJPROP_COLOR, isBuy ? clrDodgerBlue : clrOrangeRed);
         ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
         ObjectSetInteger(0, name, OBJPROP_ANCHOR, isBuy ? ANCHOR_TOP : ANCHOR_BOTTOM);
      }
   }
   if(Alert_On_Signal && newest && t != g_lastAlert)
   {
      g_lastAlert = t;
      Alert(StringFormat("JUED RSI Extreme: %s signal on %s %s", isBuy ? "BUY" : "SELL", _Symbol,
                         StringSubstr(EnumToString((ENUM_TIMEFRAMES)_Period), 7)));
   }
}
//+------------------------------------------------------------------+
