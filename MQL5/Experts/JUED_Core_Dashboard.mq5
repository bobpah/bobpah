//+------------------------------------------------------------------+
//|  JUED_Core_Dashboard.mq5                                          |
//|  Dark performance dashboard (canvas based) for MT5.              |
//|  - Growth / Balance / Equity / Drawdown / Win rate / PF cards    |
//|  - System overview + animated core sphere                        |
//|  - Growth trajectory + equity curve mini charts                  |
//|  - Today / Yesterday / Week / Month profit                       |
//|  - Market status + AUTO / CLOSE BASKET / RESET buttons           |
//|  Does not open trades. Attach next to any EA (filter by magic).  |
//+------------------------------------------------------------------+
#property copyright "JUED"
#property link      "JUED_Core"
#property version   "1.00"

#include <Canvas\Canvas.mqh>
#include <Trade\Trade.mqh>

//=== Inputs =========================================================
input string InpTitle        = "JUED CORE";   // Dashboard title
input string InpVersion      = "V1.00";       // Version label
input long   InpMagic        = 0;             // Magic filter (0 = all)
input bool   InpThisSymbol   = true;          // Only count this symbol
input int    InpX            = 10;            // Panel X
input int    InpY            = 20;            // Panel Y
input int    InpAnimMs       = 100;           // Animation refresh (ms)

//=== Layout / colours ===============================================
#define PANEL_W 720
#define PANEL_H 430
#define PAD     8

#define C_BG      0x0B1220
#define C_CARD    0x111A2E
#define C_BORDER  0x1E3A5F
#define C_TEXT    0xCBD5E1
#define C_DIM     0x64748B
#define C_CYAN    0x22D3EE
#define C_PURPLE  0xA78BFA
#define C_GREEN   0x34D399
#define C_RED     0xF87171
#define C_GOLD    0xFBBF24

//=== Globals ========================================================
CCanvas g_cv;
CTrade  g_trade;
string  g_name = "JUED_CORE_DASH";
string  g_autoGV;

double  g_deposits = 0, g_netProfit = 0, g_grossWin = 0, g_grossLoss = 0;
int     g_closed = 0, g_wins = 0;
double  g_pToday = 0, g_pYesterday = 0, g_pWeek = 0, g_pMonth = 0;
double  g_balCurve[];
double  g_eqCurve[];
double  g_peakEquity = 0, g_maxDD = 0;
double  g_angle = 0;
bool    g_dirty = true;
datetime g_lastHistory = 0;

struct Button { int x, y, w, h; string text; };
Button g_btnAuto, g_btnClose, g_btnReset;

//+------------------------------------------------------------------+
uint Clr(const uint rgb, const uchar a = 255)
{
   // rgb given as 0xRRGGBB
   return ((uint)a << 24) | (rgb & 0xFFFFFF);
}

//+------------------------------------------------------------------+
int OnInit()
{
   g_autoGV = StringFormat("JUED_AUTO_%I64d", InpMagic);
   if(!GlobalVariableCheck(g_autoGV)) GlobalVariableSet(g_autoGV, 1.0);

   if(!g_cv.CreateBitmapLabel(0, 0, g_name, InpX, InpY, PANEL_W, PANEL_H, COLOR_FORMAT_ARGB_NORMALIZE))
   {
      Print("Canvas create failed: ", GetLastError());
      return(INIT_FAILED);
   }
   ChartSetInteger(0, CHART_EVENT_MOUSE_MOVE, false);
   g_peakEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   ArrayResize(g_eqCurve, 0);
   EventSetMillisecondTimer(MathMax(50, InpAnimMs));
   LoadHistory();
   Draw();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   g_cv.Destroy();
   ChartRedraw();
}

void OnTick() { }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &req, const MqlTradeResult &res)
{
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD) g_dirty = true;
}

void OnTimer()
{
   g_angle += 0.04;
   if(g_angle > 2 * M_PI) g_angle -= 2 * M_PI;

   if(g_dirty || TimeCurrent() - g_lastHistory > 10) LoadHistory();
   SampleEquity();
   Draw();
}

//+------------------------------------------------------------------+
//| Data                                                              |
//+------------------------------------------------------------------+
bool DealMatches(const ulong t)
{
   if(InpMagic != 0 && HistoryDealGetInteger(t, DEAL_MAGIC) != InpMagic) return false;
   if(InpThisSymbol && HistoryDealGetString(t, DEAL_SYMBOL) != _Symbol) return false;
   return true;
}

datetime PeriodStart(int which)   // 0 = today, 1 = week (Mon), 2 = month
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime day = StructToTime(dt);
   if(which == 0) return day;
   if(which == 1)
   {
      int back = (dt.day_of_week + 6) % 7;   // Monday = 0
      return day - back * 86400;
   }
   dt.day = 1;
   return StructToTime(dt);
}

void LoadHistory()
{
   g_dirty = false;
   g_lastHistory = TimeCurrent();
   g_deposits = 0; g_netProfit = 0; g_grossWin = 0; g_grossLoss = 0;
   g_closed = 0; g_wins = 0;
   g_pToday = 0; g_pYesterday = 0; g_pWeek = 0; g_pMonth = 0;
   ArrayResize(g_balCurve, 0);

   if(!HistorySelect(0, TimeCurrent() + 86400)) return;

   datetime tToday = PeriodStart(0);
   datetime tYest  = tToday - 86400;
   datetime tWeek  = PeriodStart(1);
   datetime tMonth = PeriodStart(2);
   double   running = 0;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      long type = HistoryDealGetInteger(t, DEAL_TYPE);

      if(type == DEAL_TYPE_BALANCE || type == DEAL_TYPE_CREDIT)
      {
         double amt = HistoryDealGetDouble(t, DEAL_PROFIT);
         if(amt > 0) g_deposits += amt;
         running += amt;
         AddPoint(g_balCurve, running);
         continue;
      }
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      if(!DealMatches(t)) continue;

      double res = HistoryDealGetDouble(t, DEAL_PROFIT)
                 + HistoryDealGetDouble(t, DEAL_SWAP)
                 + HistoryDealGetDouble(t, DEAL_COMMISSION)
                 + HistoryDealGetDouble(t, DEAL_FEE);
      long entry = HistoryDealGetInteger(t, DEAL_ENTRY);
      datetime when = (datetime)HistoryDealGetInteger(t, DEAL_TIME);

      g_netProfit += res;
      running     += res;

      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY)
      {
         g_closed++;
         if(res > 0) { g_wins++; g_grossWin += res; }
         else          g_grossLoss += -res;
         AddPoint(g_balCurve, running);
      }

      if(when >= tToday)                   g_pToday     += res;
      else if(when >= tYest)               g_pYesterday += res;
      if(when >= tWeek)                    g_pWeek      += res;
      if(when >= tMonth)                   g_pMonth     += res;
   }
}

void AddPoint(double &arr[], double v)
{
   int n = ArraySize(arr);
   ArrayResize(arr, n + 1, 256);
   arr[n] = v;
}

void SampleEquity()
{
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(eq > g_peakEquity) g_peakEquity = eq;
   if(g_peakEquity > 0)
   {
      double dd = (g_peakEquity - eq) / g_peakEquity * 100.0;
      if(dd > g_maxDD) g_maxDD = dd;
   }
   static datetime last = 0;
   datetime now = TimeCurrent();
   if(now == last) return;            // one sample per server second
   last = now;
   int n = ArraySize(g_eqCurve);
   if(n >= 300) { ArrayCopy(g_eqCurve, g_eqCurve, 0, 1, n - 1); n--; ArrayResize(g_eqCurve, n); }
   ArrayResize(g_eqCurve, n + 1);
   g_eqCurve[n] = eq;
}

void PositionSummary(int &buyN, double &buyLot, int &sellN, double &sellLot, double &floating)
{
   buyN = 0; sellN = 0; buyLot = 0; sellLot = 0; floating = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(InpMagic != 0 && PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(InpThisSymbol && PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      double vol = PositionGetDouble(POSITION_VOLUME);
      floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) { buyN++; buyLot += vol; }
      else                                                       { sellN++; sellLot += vol; }
   }
}

//+------------------------------------------------------------------+
//| Drawing helpers                                                   |
//+------------------------------------------------------------------+
void Card(int x, int y, int w, int h)
{
   g_cv.FillRectangle(x, y, x + w, y + h, Clr(C_CARD));
   g_cv.Rectangle(x, y, x + w, y + h, Clr(C_BORDER));
   g_cv.Line(x, y, x + 24, y, Clr(C_CYAN));            // small accent
}

void Text(int x, int y, string s, uint rgb, int size = -80, string font = "Segoe UI", uint align = TA_LEFT | TA_TOP)
{
   g_cv.FontSet(font, size);
   g_cv.TextOut(x, y, s, Clr(rgb), align);
}

void Kpi(int x, int y, int w, int h, string label, string value, uint rgb)
{
   Card(x, y, w, h);
   Text(x + 8, y + 5,  label, C_DIM, -70);
   Text(x + 8, y + 18, value, rgb, -110, "Consolas");
}

string Money(double v) { return DoubleToString(v, 2); }
string Signed(double v) { return (v >= 0 ? "+" : "") + DoubleToString(v, 2); }

void MiniChart(int x, int y, int w, int h, const double &data[], uint rgb, string label)
{
   Card(x, y, w, h);
   Text(x + 8, y + 5, label, C_DIM, -70);
   int n = ArraySize(data);
   int cx = x + 8, cy = y + 22, cw = w - 16, ch = h - 30;
   g_cv.Line(cx, cy + ch, cx + cw, cy + ch, Clr(C_BORDER));
   if(n < 2) { Text(cx + cw / 2, cy + ch / 2, "waiting data", C_DIM, -70, "Segoe UI", TA_CENTER | TA_VCENTER); return; }

   double mn = data[ArrayMinimum(data)], mx = data[ArrayMaximum(data)];
   if(mx - mn < 1e-9) { mx += 1; mn -= 1; }
   int px = 0, py = 0;
   for(int i = 0; i < cw; i++)
   {
      int idx = (int)MathRound((double)i / (cw - 1) * (n - 1));
      int vx = cx + i;
      int vy = cy + ch - (int)MathRound((data[idx] - mn) / (mx - mn) * ch);
      g_cv.Line(vx, vy, vx, cy + ch, Clr(rgb, 40));     // soft fill
      if(i > 0) g_cv.LineAA(px, py, vx, vy, Clr(rgb));
      px = vx; py = vy;
   }
   Text(x + w - 8, y + 5, Money(data[n - 1]), rgb, -70, "Consolas", TA_RIGHT | TA_TOP);
}

void Sphere(int cx, int cy, int r)
{
   g_cv.CircleAA(cx, cy, r, Clr(C_CYAN, 160));
   // rotating orbits
   for(int k = 0; k < 3; k++)
   {
      double rot = g_angle + k * M_PI / 3.0;
      double cr = MathCos(rot), sr = MathSin(rot);
      double a = r * 1.0, b = r * 0.32;
      int px = 0, py = 0;
      for(int i = 0; i <= 48; i++)
      {
         double th = 2 * M_PI * i / 48.0;
         double ex = a * MathCos(th), ey = b * MathSin(th);
         int vx = cx + (int)MathRound(ex * cr - ey * sr);
         int vy = cy + (int)MathRound(ex * sr + ey * cr);
         if(i > 0) g_cv.LineAA(px, py, vx, vy, Clr(k == 1 ? C_PURPLE : C_CYAN, 140));
         px = vx; py = vy;
      }
   }
   // rotating surface points
   for(int lat = -60; lat <= 60; lat += 30)
      for(int lon = 0; lon < 360; lon += 30)
      {
         double la = lat * M_PI / 180.0, lo = lon * M_PI / 180.0 + g_angle;
         double z = MathCos(la) * MathCos(lo);
         int vx = cx + (int)MathRound(r * MathCos(la) * MathSin(lo));
         int vy = cy - (int)MathRound(r * MathSin(la));
         uchar alpha = (uchar)(z > 0 ? 230 : 70);
         g_cv.FillCircle(vx, vy, z > 0 ? 2 : 1, Clr(0xFFFFFF, alpha));
      }
}

void DrawButton(Button &b, uint rgb, bool active)
{
   g_cv.FillRectangle(b.x, b.y, b.x + b.w, b.y + b.h, Clr(rgb, active ? 90 : 35));
   g_cv.Rectangle(b.x, b.y, b.x + b.w, b.y + b.h, Clr(rgb));
   Text(b.x + b.w / 2, b.y + b.h / 2, b.text, rgb, -75, "Segoe UI", TA_CENTER | TA_VCENTER);
}

bool Hit(const Button &b, int x, int y)
{
   return (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
}

//+------------------------------------------------------------------+
//| Main draw                                                         |
//+------------------------------------------------------------------+
void Draw()
{
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   double growth  = (g_deposits > 0) ? g_netProfit / g_deposits * 100.0 : 0;
   double winRate = (g_closed > 0) ? 100.0 * g_wins / g_closed : 0;
   double pf      = (g_grossLoss > 0) ? g_grossWin / g_grossLoss : (g_grossWin > 0 ? 99.99 : 0);
   double curDD   = (g_peakEquity > 0) ? (g_peakEquity - eq) / g_peakEquity * 100.0 : 0;
   bool   autoOn  = GlobalVariableGet(g_autoGV) > 0.5;

   g_cv.Erase(Clr(C_BG, 235));
   g_cv.Rectangle(0, 0, PANEL_W - 1, PANEL_H - 1, Clr(C_BORDER));

   //--- Header
   Text(PAD, 6, "EA PERFORMANCE / " + _Symbol, C_DIM, -65);
   Text(PAD, 16, InpTitle + " " + InpVersion, C_TEXT, -105, "Segoe UI Semibold");
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)_Period), 7);
   long   ping = TerminalInfoInteger(TERMINAL_PING_LAST);
   Text(PANEL_W - PAD, 6,  StringFormat("PING %.1f ms   %s %s", ping / 1000.0, _Symbol, tf), C_DIM, -65, "Segoe UI", TA_RIGHT | TA_TOP);
   Text(PANEL_W - PAD, 18, autoOn ? "AUTO ON" : "PAUSED", autoOn ? C_GREEN : C_GOLD, -80, "Segoe UI Semibold", TA_RIGHT | TA_TOP);

   //--- KPI cards (3 x 2)
   int cw = (PANEL_W - 4 * PAD) / 3, ch = 40;
   int y1 = 38, y2 = y1 + ch + 6;
   Kpi(PAD,               y1, cw, ch, "GROWTH / HISTORY",     StringFormat("%+.2f%%", growth), growth >= 0 ? C_CYAN : C_RED);
   Kpi(PAD * 2 + cw,      y1, cw, ch, "BALANCE / ACCOUNT",    Money(bal), C_PURPLE);
   Kpi(PAD * 3 + cw * 2,  y1, cw, ch, "EQUITY / ACCOUNT",     Money(eq),  C_PURPLE);
   Kpi(PAD,               y2, cw, ch, "DRAWDOWN / MAX",       StringFormat("%.2f%% / %.2f%%", curDD, g_maxDD), curDD > 5 ? C_RED : C_CYAN);
   Kpi(PAD * 2 + cw,      y2, cw, ch, "WIN RATE / CLOSED",    StringFormat("%.1f%%  (%d)", winRate, g_closed), C_PURPLE);
   Kpi(PAD * 3 + cw * 2,  y2, cw, ch, "PROFIT FACTOR",        DoubleToString(pf, 2), C_GREEN);

   //--- System overview
   int ym = y2 + ch + 8, hm = 140;
   int wl = 210;
   Card(PAD, ym, wl, hm);
   Text(PAD + 8, ym + 5, "SYSTEM OVERVIEW", C_DIM, -70);
   g_cv.CircleAA(PAD + 40, ym + 52, 22, Clr(C_CYAN));
   Text(PAD + 40, ym + 52, "JC", C_CYAN, -100, "Segoe UI Semibold", TA_CENTER | TA_VCENTER);
   Text(PAD + 72, ym + 42, InpTitle, C_TEXT, -90, "Segoe UI Semibold");
   int ly = ym + 82;
   Text(PAD + 8, ly,      "ACCOUNT  " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)), C_DIM, -70, "Consolas");
   Text(PAD + 8, ly + 12, "BROKER   " + StringSubstr(AccountInfoString(ACCOUNT_COMPANY), 0, 20), C_DIM, -70, "Consolas");
   Text(PAD + 8, ly + 24, "LEVERAGE 1:" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)), C_DIM, -70, "Consolas");
   Text(PAD + 8, ly + 36, "CURRENCY " + AccountInfoString(ACCOUNT_CURRENCY) + "   CLOSED " + IntegerToString(g_closed), C_DIM, -70, "Consolas");

   int xr = PAD * 2 + wl, wr = PANEL_W - xr - PAD;
   Card(xr, ym, wr, hm);
   Text(xr + 8, ym + 5, "PERFORMANCE / PERIOD_" + tf, C_DIM, -70);
   int tx = xr + 10, ty = ym + 22;
   Text(tx, ty,      "GROWTH",        C_DIM, -65);  Text(tx, ty + 10,  StringFormat("%+.2f%%", growth), C_CYAN, -90, "Consolas");
   Text(tx, ty + 28, "EQUITY",        C_DIM, -65);  Text(tx, ty + 38,  Money(eq), C_PURPLE, -90, "Consolas");
   Text(tx, ty + 56, "DRAWDOWN",      C_DIM, -65);  Text(tx, ty + 66,  StringFormat("%.2f%%", curDD), curDD > 5 ? C_RED : C_PURPLE, -90, "Consolas");
   Text(tx, ty + 84, "WIN RATE / PF", C_DIM, -65);  Text(tx, ty + 94,  StringFormat("%.1f%% / %.2f", winRate, pf), C_PURPLE, -90, "Consolas");
   Sphere(xr + wr - 110, ym + hm / 2 + 4, 52);
   Text(xr + wr - 8, ym + hm - 16, InpTitle, C_TEXT, -70, "Segoe UI Semibold", TA_RIGHT | TA_TOP);

   //--- Charts + activity
   int yb = ym + hm + 8, hb = 104;
   int wb = (PANEL_W - 4 * PAD) / 3;
   MiniChart(PAD,              yb, wb, hb, g_balCurve, C_PURPLE, "GROWTH TRAJECTORY (BALANCE)");
   MiniChart(PAD * 2 + wb,     yb, wb, hb, g_eqCurve,  C_CYAN,   "EQUITY CURVE (SESSION)");
   int xa = PAD * 3 + wb * 2;
   Card(xa, yb, wb, hb);
   Text(xa + 8, yb + 5, "TRADING ACTIVITY / SERVER TIME", C_DIM, -70);
   Text(xa + 10, yb + 24, "TODAY",      C_DIM, -65);  Text(xa + 10, yb + 35, Signed(g_pToday),     g_pToday >= 0 ? C_GREEN : C_RED, -90, "Consolas");
   Text(xa + wb / 2, yb + 24, "YESTERDAY", C_DIM, -65); Text(xa + wb / 2, yb + 35, Signed(g_pYesterday), g_pYesterday >= 0 ? C_GREEN : C_RED, -90, "Consolas");
   Text(xa + 10, yb + 60, "THIS WEEK",  C_DIM, -65);  Text(xa + 10, yb + 71, Signed(g_pWeek),      g_pWeek >= 0 ? C_GREEN : C_RED, -90, "Consolas");
   Text(xa + wb / 2, yb + 60, "THIS MONTH", C_DIM, -65); Text(xa + wb / 2, yb + 71, Signed(g_pMonth), g_pMonth >= 0 ? C_GREEN : C_RED, -90, "Consolas");

   //--- Market status + buttons
   int yf = yb + hb + 8, hf = PANEL_H - yf - PAD;
   Card(PAD, yf, PANEL_W - 2 * PAD, hf);
   int bN, sN; double bL, sL, fl;
   PositionSummary(bN, bL, sN, sL, fl);
   Text(PAD + 8, yf + 5, "MARKET STATUS / " + _Symbol, C_DIM, -65);
   Text(PAD + 8, yf + 17, StringFormat("BUY %.2f lots | %d orders     SELL %.2f lots | %d orders     FLOAT %s",
                                       bL, bN, sL, sN, Signed(fl)), fl >= 0 ? C_TEXT : C_RED, -75, "Consolas");

   int bw = 92, bh = 20, by = yf + (hf - bh) / 2, bx = PANEL_W - PAD - 8 - bw;
   g_btnReset.x = bx;               g_btnReset.y = by; g_btnReset.w = bw; g_btnReset.h = bh; g_btnReset.text = "RESET SESSION";
   g_btnClose.x = bx - bw - 6;      g_btnClose.y = by; g_btnClose.w = bw; g_btnClose.h = bh; g_btnClose.text = "CLOSE BASKET";
   g_btnAuto.x  = bx - 2 * (bw + 6); g_btnAuto.y = by; g_btnAuto.w = bw; g_btnAuto.h = bh; g_btnAuto.text = autoOn ? "AUTO ON" : "AUTO OFF";
   DrawButton(g_btnAuto,  autoOn ? C_GREEN : C_GOLD, autoOn);
   DrawButton(g_btnClose, C_RED, false);
   DrawButton(g_btnReset, C_CYAN, false);

   g_cv.Update(true);
}

//+------------------------------------------------------------------+
//| Buttons                                                           |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id != CHARTEVENT_CLICK) return;
   int x = (int)lparam - InpX, y = (int)dparam - InpY;
   if(x < 0 || y < 0 || x > PANEL_W || y > PANEL_H) return;

   if(Hit(g_btnAuto, x, y))
   {
      bool on = GlobalVariableGet(g_autoGV) > 0.5;
      GlobalVariableSet(g_autoGV, on ? 0.0 : 1.0);
      PrintFormat("%s: AUTO %s (GlobalVariable %s)", InpTitle, on ? "OFF" : "ON", g_autoGV);
   }
   else if(Hit(g_btnClose, x, y))
   {
      bool tester = (bool)MQLInfoInteger(MQL_TESTER);
      if(tester || MessageBox("Close all positions in this basket?", InpTitle, MB_YESNO | MB_ICONWARNING) == IDYES)
         CloseBasket();
   }
   else if(Hit(g_btnReset, x, y))
   {
      g_peakEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      g_maxDD = 0;
      ArrayResize(g_eqCurve, 0);
   }
   Draw();
}

void CloseBasket()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(InpMagic != 0 && PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(InpThisSymbol && PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!g_trade.PositionClose(tk))
         PrintFormat("Close %I64u failed: %u", tk, g_trade.ResultRetcode());
   }
   g_dirty = true;
}
//+------------------------------------------------------------------+
