//+------------------------------------------------------------------+
//|  JUED/Dashboard.mqh                                               |
//|  Reusable dark performance dashboard (CCanvas) for MT5 EAs.      |
//|                                                                  |
//|  Usage inside an EA:                                             |
//|     #include <JUED\Dashboard.mqh>                                |
//|     CJuedDashboard dash;                                         |
//|     OnInit:   dash.Init("JUED CORE", "V1.00", magic, true, 10,20);|
//|     OnDeinit: dash.Deinit();                                     |
//|     OnTimer:  dash.OnTimer();          (EventSetMillisecondTimer)|
//|     OnChartEvent: dash.OnChartEvent(id, lparam, dparam, sparam); |
//|     OnTradeTransaction: dash.MarkDirty();                        |
//|     Trading gate: if(!dash.AutoOn()) -> skip new entries         |
//|     Status line:  dash.SetStatus("WAITING SIGNAL");              |
//+------------------------------------------------------------------+
#ifndef JUED_DASHBOARD_MQH
#define JUED_DASHBOARD_MQH

#include <Canvas\Canvas.mqh>
#include <Trade\Trade.mqh>

#define JD_W   720
#define JD_H   444
#define JD_PAD 8

#define JD_BG      0x0B1220
#define JD_CARD    0x111A2E
#define JD_BORDER  0x1E3A5F
#define JD_TEXT    0xCBD5E1
#define JD_DIM     0x64748B
#define JD_CYAN    0x22D3EE
#define JD_PURPLE  0xA78BFA
#define JD_GREEN   0x34D399
#define JD_RED     0xF87171
#define JD_GOLD    0xFBBF24

struct JuedButton { int x, y, w, h; string text; };

//+------------------------------------------------------------------+
class CJuedDashboard
{
private:
   CCanvas  m_cv;
   CTrade   m_trade;
   string   m_name, m_title, m_version, m_autoGV, m_status;
   long     m_magic;
   bool     m_thisSymbol, m_ready;
   int      m_x, m_y;

   double   m_deposits, m_netProfit, m_grossWin, m_grossLoss;
   int      m_closed, m_wins;
   double   m_pToday, m_pYesterday, m_pWeek, m_pMonth;
   double   m_balCurve[];
   double   m_eqCurve[];
   double   m_peakEquity, m_maxDD, m_angle;
   bool     m_dirty;
   datetime m_lastHistory, m_lastSample;
   JuedButton m_btnAuto, m_btnClose, m_btnReset;

   uint     Clr(const uint rgb, const uchar a = 255) { return ((uint)a << 24) | (rgb & 0xFFFFFF); }
   bool     DealMatches(const ulong t);
   datetime PeriodStart(const int which);
   void     LoadHistory();
   void     AddPoint(double &arr[], const double v);
   void     SampleEquity();
   void     PositionSummary(int &buyN, double &buyLot, int &sellN, double &sellLot, double &floating);
   void     Card(int x, int y, int w, int h);
   void     Text(int x, int y, string s, uint rgb, int size = -80, string font = "Segoe UI", uint align = TA_LEFT | TA_TOP);
   void     Kpi(int x, int y, int w, int h, string label, string value, uint rgb);
   void     MiniChart(int x, int y, int w, int h, const double &data[], uint rgb, string label);
   void     Sphere(int cx, int cy, int r);
   void     DrawButton(JuedButton &b, uint rgb, bool active);
   bool     Hit(const JuedButton &b, int x, int y) { return (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); }
   string   Money(double v)  { return DoubleToString(v, 2); }
   string   Signed(double v) { return (v >= 0 ? "+" : "") + DoubleToString(v, 2); }

public:
            CJuedDashboard();
   bool     Init(string title, string version, long magic, bool thisSymbol, int x, int y);
   void     Deinit();
   void     OnTimer();
   void     OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam);
   void     MarkDirty()                { m_dirty = true; }
   void     SetStatus(const string s)  { m_status = s; }
   bool     AutoOn()                   { return GlobalVariableGet(m_autoGV) > 0.5; }
   void     CloseBasket();
   void     Draw();
};

//+------------------------------------------------------------------+
CJuedDashboard::CJuedDashboard()
{
   m_ready = false; m_status = "";
   m_deposits = 0; m_netProfit = 0; m_grossWin = 0; m_grossLoss = 0;
   m_closed = 0; m_wins = 0;
   m_pToday = 0; m_pYesterday = 0; m_pWeek = 0; m_pMonth = 0;
   m_peakEquity = 0; m_maxDD = 0; m_angle = 0;
   m_dirty = true; m_lastHistory = 0; m_lastSample = 0;
}

bool CJuedDashboard::Init(string title, string version, long magic, bool thisSymbol, int x, int y)
{
   m_title = title; m_version = version; m_magic = magic; m_thisSymbol = thisSymbol;
   m_x = x; m_y = y;
   m_name   = StringFormat("JUED_DASH_%I64d", magic);
   m_autoGV = StringFormat("JUED_AUTO_%I64d", magic);
   if(!GlobalVariableCheck(m_autoGV)) GlobalVariableSet(m_autoGV, 1.0);

   if(!m_cv.CreateBitmapLabel(0, 0, m_name, m_x, m_y, JD_W, JD_H, COLOR_FORMAT_ARGB_NORMALIZE))
   {
      Print("JUED dashboard: canvas create failed: ", GetLastError());
      return false;
   }
   m_peakEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   ArrayResize(m_eqCurve, 0);
   m_ready = true;
   LoadHistory();
   Draw();
   return true;
}

void CJuedDashboard::Deinit()
{
   if(m_ready) m_cv.Destroy();
   m_ready = false;
   ChartRedraw();
}

void CJuedDashboard::OnTimer()
{
   if(!m_ready) return;
   m_angle += 0.04;
   if(m_angle > 2 * M_PI) m_angle -= 2 * M_PI;
   if(m_dirty || TimeCurrent() - m_lastHistory > 10) LoadHistory();
   SampleEquity();
   Draw();
}

//+------------------------------------------------------------------+
//| Data                                                              |
//+------------------------------------------------------------------+
bool CJuedDashboard::DealMatches(const ulong t)
{
   if(m_magic != 0 && HistoryDealGetInteger(t, DEAL_MAGIC) != m_magic) return false;
   if(m_thisSymbol && HistoryDealGetString(t, DEAL_SYMBOL) != _Symbol) return false;
   return true;
}

datetime CJuedDashboard::PeriodStart(const int which)   // 0 today, 1 week (Mon), 2 month
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime day = StructToTime(dt);
   if(which == 0) return day;
   if(which == 1) return day - ((dt.day_of_week + 6) % 7) * 86400;
   dt.day = 1;
   return StructToTime(dt);
}

void CJuedDashboard::LoadHistory()
{
   m_dirty = false;
   m_lastHistory = TimeCurrent();
   m_deposits = 0; m_netProfit = 0; m_grossWin = 0; m_grossLoss = 0;
   m_closed = 0; m_wins = 0;
   m_pToday = 0; m_pYesterday = 0; m_pWeek = 0; m_pMonth = 0;
   ArrayResize(m_balCurve, 0);

   if(!HistorySelect(0, TimeCurrent() + 86400)) return;

   datetime tToday = PeriodStart(0), tYest = tToday - 86400;
   datetime tWeek  = PeriodStart(1), tMonth = PeriodStart(2);
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
         if(amt > 0) m_deposits += amt;
         running += amt;
         AddPoint(m_balCurve, running);
         continue;
      }
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      if(!DealMatches(t)) continue;

      double res = HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP)
                 + HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_FEE);
      long     entry = HistoryDealGetInteger(t, DEAL_ENTRY);
      datetime when  = (datetime)HistoryDealGetInteger(t, DEAL_TIME);

      m_netProfit += res;
      running     += res;
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY)
      {
         m_closed++;
         if(res > 0) { m_wins++; m_grossWin += res; }
         else          m_grossLoss += -res;
         AddPoint(m_balCurve, running);
      }
      if(when >= tToday)     m_pToday     += res;
      else if(when >= tYest) m_pYesterday += res;
      if(when >= tWeek)      m_pWeek      += res;
      if(when >= tMonth)     m_pMonth     += res;
   }
}

void CJuedDashboard::AddPoint(double &arr[], const double v)
{
   int n = ArraySize(arr);
   ArrayResize(arr, n + 1, 256);
   arr[n] = v;
}

void CJuedDashboard::SampleEquity()
{
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(eq > m_peakEquity) m_peakEquity = eq;
   if(m_peakEquity > 0)
   {
      double dd = (m_peakEquity - eq) / m_peakEquity * 100.0;
      if(dd > m_maxDD) m_maxDD = dd;
   }
   datetime now = TimeCurrent();
   if(now == m_lastSample) return;
   m_lastSample = now;
   int n = ArraySize(m_eqCurve);
   if(n >= 300) { ArrayCopy(m_eqCurve, m_eqCurve, 0, 1, n - 1); n--; ArrayResize(m_eqCurve, n); }
   ArrayResize(m_eqCurve, n + 1);
   m_eqCurve[n] = eq;
}

void CJuedDashboard::PositionSummary(int &buyN, double &buyLot, int &sellN, double &sellLot, double &floating)
{
   buyN = 0; sellN = 0; buyLot = 0; sellLot = 0; floating = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(m_magic != 0 && PositionGetInteger(POSITION_MAGIC) != m_magic) continue;
      if(m_thisSymbol && PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      double vol = PositionGetDouble(POSITION_VOLUME);
      floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) { buyN++; buyLot += vol; }
      else                                                       { sellN++; sellLot += vol; }
   }
}

void CJuedDashboard::CloseBasket()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(m_magic != 0 && PositionGetInteger(POSITION_MAGIC) != m_magic) continue;
      if(m_thisSymbol && PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!m_trade.PositionClose(tk))
         PrintFormat("JUED dashboard: close %I64u failed: %u", tk, m_trade.ResultRetcode());
   }
   m_dirty = true;
}

//+------------------------------------------------------------------+
//| Drawing                                                           |
//+------------------------------------------------------------------+
void CJuedDashboard::Card(int x, int y, int w, int h)
{
   m_cv.FillRectangle(x, y, x + w, y + h, Clr(JD_CARD));
   m_cv.Rectangle(x, y, x + w, y + h, Clr(JD_BORDER));
   m_cv.Line(x, y, x + 24, y, Clr(JD_CYAN));
}

void CJuedDashboard::Text(int x, int y, string s, uint rgb, int size, string font, uint align)
{
   m_cv.FontSet(font, size);
   m_cv.TextOut(x, y, s, Clr(rgb), align);
}

void CJuedDashboard::Kpi(int x, int y, int w, int h, string label, string value, uint rgb)
{
   Card(x, y, w, h);
   Text(x + 8, y + 5,  label, JD_DIM, -70);
   Text(x + 8, y + 18, value, rgb, -110, "Consolas");
}

void CJuedDashboard::MiniChart(int x, int y, int w, int h, const double &data[], uint rgb, string label)
{
   Card(x, y, w, h);
   Text(x + 8, y + 5, label, JD_DIM, -70);
   int n = ArraySize(data);
   int cx = x + 8, cy = y + 22, cw = w - 16, ch = h - 30;
   m_cv.Line(cx, cy + ch, cx + cw, cy + ch, Clr(JD_BORDER));
   if(n < 2) { Text(cx + cw / 2, cy + ch / 2, "waiting data", JD_DIM, -70, "Segoe UI", TA_CENTER | TA_VCENTER); return; }

   double mn = data[ArrayMinimum(data)], mx = data[ArrayMaximum(data)];
   if(mx - mn < 1e-9) { mx += 1; mn -= 1; }
   int px = 0, py = 0;
   for(int i = 0; i < cw; i++)
   {
      int idx = (int)MathRound((double)i / (cw - 1) * (n - 1));
      int vx = cx + i;
      int vy = cy + ch - (int)MathRound((data[idx] - mn) / (mx - mn) * ch);
      m_cv.Line(vx, vy, vx, cy + ch, Clr(rgb, 40));
      if(i > 0) m_cv.LineAA(px, py, vx, vy, Clr(rgb));
      px = vx; py = vy;
   }
   Text(x + w - 8, y + 5, Money(data[n - 1]), rgb, -70, "Consolas", TA_RIGHT | TA_TOP);
}

void CJuedDashboard::Sphere(int cx, int cy, int r)
{
   m_cv.CircleAA(cx, cy, r, Clr(JD_CYAN, 160));
   for(int k = 0; k < 3; k++)
   {
      double rot = m_angle + k * M_PI / 3.0;
      double cr = MathCos(rot), sr = MathSin(rot);
      double a = r * 1.0, b = r * 0.32;
      int px = 0, py = 0;
      for(int i = 0; i <= 48; i++)
      {
         double th = 2 * M_PI * i / 48.0;
         double ex = a * MathCos(th), ey = b * MathSin(th);
         int vx = cx + (int)MathRound(ex * cr - ey * sr);
         int vy = cy + (int)MathRound(ex * sr + ey * cr);
         if(i > 0) m_cv.LineAA(px, py, vx, vy, Clr(k == 1 ? JD_PURPLE : JD_CYAN, 140));
         px = vx; py = vy;
      }
   }
   for(int lat = -60; lat <= 60; lat += 30)
      for(int lon = 0; lon < 360; lon += 30)
      {
         double la = lat * M_PI / 180.0, lo = lon * M_PI / 180.0 + m_angle;
         double z = MathCos(la) * MathCos(lo);
         int vx = cx + (int)MathRound(r * MathCos(la) * MathSin(lo));
         int vy = cy - (int)MathRound(r * MathSin(la));
         m_cv.FillCircle(vx, vy, z > 0 ? 2 : 1, Clr(0xFFFFFF, (uchar)(z > 0 ? 230 : 70)));
      }
}

void CJuedDashboard::DrawButton(JuedButton &b, uint rgb, bool active)
{
   m_cv.FillRectangle(b.x, b.y, b.x + b.w, b.y + b.h, Clr(rgb, (uchar)(active ? 90 : 35)));
   m_cv.Rectangle(b.x, b.y, b.x + b.w, b.y + b.h, Clr(rgb));
   Text(b.x + b.w / 2, b.y + b.h / 2, b.text, rgb, -75, "Segoe UI", TA_CENTER | TA_VCENTER);
}

void CJuedDashboard::Draw()
{
   if(!m_ready) return;
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   double growth  = (m_deposits > 0) ? m_netProfit / m_deposits * 100.0 : 0;
   double winRate = (m_closed > 0) ? 100.0 * m_wins / m_closed : 0;
   double pf      = (m_grossLoss > 0) ? m_grossWin / m_grossLoss : (m_grossWin > 0 ? 99.99 : 0);
   double curDD   = (m_peakEquity > 0) ? (m_peakEquity - eq) / m_peakEquity * 100.0 : 0;
   bool   autoOn  = AutoOn();

   m_cv.Erase(Clr(JD_BG, 235));
   m_cv.Rectangle(0, 0, JD_W - 1, JD_H - 1, Clr(JD_BORDER));

   //--- Header
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)_Period), 7);
   Text(JD_PAD, 6, "EA PERFORMANCE / " + _Symbol, JD_DIM, -65);
   Text(JD_PAD, 16, m_title + " " + m_version, JD_TEXT, -105, "Segoe UI Semibold");
   Text(JD_W - JD_PAD, 6, StringFormat("PING %.1f ms   %s %s", TerminalInfoInteger(TERMINAL_PING_LAST) / 1000.0, _Symbol, tf),
        JD_DIM, -65, "Segoe UI", TA_RIGHT | TA_TOP);
   Text(JD_W - JD_PAD, 18, autoOn ? "AUTO ON" : "PAUSED", autoOn ? JD_GREEN : JD_GOLD, -80, "Segoe UI Semibold", TA_RIGHT | TA_TOP);

   //--- KPI cards
   int cw = (JD_W - 4 * JD_PAD) / 3, ch = 40;
   int y1 = 38, y2 = y1 + ch + 6;
   Kpi(JD_PAD,                 y1, cw, ch, "GROWTH / HISTORY",  StringFormat("%+.2f%%", growth), growth >= 0 ? JD_CYAN : JD_RED);
   Kpi(JD_PAD * 2 + cw,        y1, cw, ch, "BALANCE / ACCOUNT", Money(bal), JD_PURPLE);
   Kpi(JD_PAD * 3 + cw * 2,    y1, cw, ch, "EQUITY / ACCOUNT",  Money(eq),  JD_PURPLE);
   Kpi(JD_PAD,                 y2, cw, ch, "DRAWDOWN / MAX",    StringFormat("%.2f%% / %.2f%%", curDD, m_maxDD), curDD > 5 ? JD_RED : JD_CYAN);
   Kpi(JD_PAD * 2 + cw,        y2, cw, ch, "WIN RATE / CLOSED", StringFormat("%.1f%%  (%d)", winRate, m_closed), JD_PURPLE);
   Kpi(JD_PAD * 3 + cw * 2,    y2, cw, ch, "PROFIT FACTOR",     DoubleToString(pf, 2), JD_GREEN);

   //--- System overview
   int ym = y2 + ch + 8, hm = 140, wl = 210;
   Card(JD_PAD, ym, wl, hm);
   Text(JD_PAD + 8, ym + 5, "SYSTEM OVERVIEW", JD_DIM, -70);
   m_cv.CircleAA(JD_PAD + 40, ym + 52, 22, Clr(JD_CYAN));
   Text(JD_PAD + 40, ym + 52, "JC", JD_CYAN, -100, "Segoe UI Semibold", TA_CENTER | TA_VCENTER);
   Text(JD_PAD + 72, ym + 42, m_title, JD_TEXT, -90, "Segoe UI Semibold");
   int ly = ym + 82;
   Text(JD_PAD + 8, ly,      "ACCOUNT  " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)), JD_DIM, -70, "Consolas");
   Text(JD_PAD + 8, ly + 12, "BROKER   " + StringSubstr(AccountInfoString(ACCOUNT_COMPANY), 0, 20), JD_DIM, -70, "Consolas");
   Text(JD_PAD + 8, ly + 24, "LEVERAGE 1:" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)), JD_DIM, -70, "Consolas");
   Text(JD_PAD + 8, ly + 36, "CURRENCY " + AccountInfoString(ACCOUNT_CURRENCY) + "   CLOSED " + IntegerToString(m_closed), JD_DIM, -70, "Consolas");

   int xr = JD_PAD * 2 + wl, wr = JD_W - xr - JD_PAD;
   Card(xr, ym, wr, hm);
   Text(xr + 8, ym + 5, "PERFORMANCE / PERIOD_" + tf, JD_DIM, -70);
   int tx = xr + 10, ty = ym + 22;
   Text(tx, ty,      "GROWTH",        JD_DIM, -65);  Text(tx, ty + 10, StringFormat("%+.2f%%", growth), JD_CYAN, -90, "Consolas");
   Text(tx, ty + 28, "EQUITY",        JD_DIM, -65);  Text(tx, ty + 38, Money(eq), JD_PURPLE, -90, "Consolas");
   Text(tx, ty + 56, "DRAWDOWN",      JD_DIM, -65);  Text(tx, ty + 66, StringFormat("%.2f%%", curDD), curDD > 5 ? JD_RED : JD_PURPLE, -90, "Consolas");
   Text(tx, ty + 84, "WIN RATE / PF", JD_DIM, -65);  Text(tx, ty + 94, StringFormat("%.1f%% / %.2f", winRate, pf), JD_PURPLE, -90, "Consolas");
   Sphere(xr + wr - 110, ym + hm / 2 + 4, 52);
   Text(xr + wr - 8, ym + hm - 16, m_title, JD_TEXT, -70, "Segoe UI Semibold", TA_RIGHT | TA_TOP);

   //--- Charts + activity
   int yb = ym + hm + 8, hb = 104;
   int wb = (JD_W - 4 * JD_PAD) / 3;
   MiniChart(JD_PAD,          yb, wb, hb, m_balCurve, JD_PURPLE, "GROWTH TRAJECTORY (BALANCE)");
   MiniChart(JD_PAD * 2 + wb, yb, wb, hb, m_eqCurve,  JD_CYAN,   "EQUITY CURVE (SESSION)");
   int xa = JD_PAD * 3 + wb * 2;
   Card(xa, yb, wb, hb);
   Text(xa + 8, yb + 5, "TRADING ACTIVITY / SERVER TIME", JD_DIM, -70);
   Text(xa + 10,     yb + 24, "TODAY",      JD_DIM, -65); Text(xa + 10,     yb + 35, Signed(m_pToday),     m_pToday     >= 0 ? JD_GREEN : JD_RED, -90, "Consolas");
   Text(xa + wb / 2, yb + 24, "YESTERDAY",  JD_DIM, -65); Text(xa + wb / 2, yb + 35, Signed(m_pYesterday), m_pYesterday >= 0 ? JD_GREEN : JD_RED, -90, "Consolas");
   Text(xa + 10,     yb + 60, "THIS WEEK",  JD_DIM, -65); Text(xa + 10,     yb + 71, Signed(m_pWeek),      m_pWeek      >= 0 ? JD_GREEN : JD_RED, -90, "Consolas");
   Text(xa + wb / 2, yb + 60, "THIS MONTH", JD_DIM, -65); Text(xa + wb / 2, yb + 71, Signed(m_pMonth),     m_pMonth     >= 0 ? JD_GREEN : JD_RED, -90, "Consolas");

   //--- Market status + EA status + buttons
   int yf = yb + hb + 8, hf = JD_H - yf - JD_PAD;
   Card(JD_PAD, yf, JD_W - 2 * JD_PAD, hf);
   int bN, sN; double bL, sL, fl;
   PositionSummary(bN, bL, sN, sL, fl);
   Text(JD_PAD + 8, yf + 5, "MARKET STATUS / " + _Symbol, JD_DIM, -65);
   Text(JD_PAD + 8, yf + 17, StringFormat("BUY %.2f | %d   SELL %.2f | %d   FLOAT %s", bL, bN, sL, sN, Signed(fl)),
        fl >= 0 ? JD_TEXT : JD_RED, -75, "Consolas");
   if(m_status != "") Text(JD_PAD + 8, yf + 31, "STATUS: " + m_status, JD_GOLD, -70, "Consolas");

   int bw = 92, bh = 20, by = yf + (hf - bh) / 2, bx = JD_W - JD_PAD - 8 - bw;
   m_btnReset.x = bx;                 m_btnReset.y = by; m_btnReset.w = bw; m_btnReset.h = bh; m_btnReset.text = "RESET SESSION";
   m_btnClose.x = bx - bw - 6;        m_btnClose.y = by; m_btnClose.w = bw; m_btnClose.h = bh; m_btnClose.text = "CLOSE BASKET";
   m_btnAuto.x  = bx - 2 * (bw + 6);  m_btnAuto.y  = by; m_btnAuto.w  = bw; m_btnAuto.h  = bh; m_btnAuto.text  = autoOn ? "AUTO ON" : "AUTO OFF";
   DrawButton(m_btnAuto,  autoOn ? JD_GREEN : JD_GOLD, autoOn);
   DrawButton(m_btnClose, JD_RED,  false);
   DrawButton(m_btnReset, JD_CYAN, false);

   m_cv.Update(true);
}

//+------------------------------------------------------------------+
void CJuedDashboard::OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(!m_ready || id != CHARTEVENT_CLICK) return;
   int x = (int)lparam - m_x, y = (int)dparam - m_y;
   if(x < 0 || y < 0 || x > JD_W || y > JD_H) return;

   if(Hit(m_btnAuto, x, y))
   {
      bool on = AutoOn();
      GlobalVariableSet(m_autoGV, on ? 0.0 : 1.0);
      PrintFormat("%s: AUTO %s", m_title, on ? "OFF" : "ON");
   }
   else if(Hit(m_btnClose, x, y))
   {
      bool tester = (bool)MQLInfoInteger(MQL_TESTER);
      if(tester || MessageBox("Close all positions in this basket?", m_title, MB_YESNO | MB_ICONWARNING) == IDYES)
         CloseBasket();
   }
   else if(Hit(m_btnReset, x, y))
   {
      m_peakEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      m_maxDD = 0;
      ArrayResize(m_eqCurve, 0);
   }
   Draw();
}

#endif // JUED_DASHBOARD_MQH
//+------------------------------------------------------------------+
