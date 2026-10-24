# EA Lab (MT5)

รวม EA และเครื่องมือสำหรับ MT5 (XAUUSD)

## โครงสร้างไฟล์

| ไฟล์ | คืออะไร |
|---|---|
| `MQL5/Include/JUED/Dashboard.mqh` | แดชบอร์ด JUED CORE (คลาส `CJuedDashboard`) ใช้ร่วมกันทุก EA |
| `MQL5/Experts/JUED_Core_Dashboard.mq5` | แดชบอร์ดแบบแยกตัว ไม่เทรด วางคู่ EA ตัวไหนก็ได้ |
| `MQL5/Experts/JUED_Core_EA.mq5` | EA เบรกเส้นเทรนด์ + ATR + เข้าได้ 3 ไม้ (โครงสำหรับโคลน DNA CORE) |
| `MQL5/Experts/MoneyHeist_Clone_v4.mq5` | โคลน Money Heist (จาก `bb.set`) + แดชบอร์ด |
| `MQL5/Presets/MoneyHeist_original_bb.set` | ค่าตั้งของ Money Heist ตัวจริง |
| `MQL5/Presets/MoneyHeist_Clone_v4.set` | ค่าตั้งของ v4 |

## วิธีติดตั้ง

1. คัดลอกโฟลเดอร์ `MQL5/Include/JUED` → `<MT5 Data Folder>/MQL5/Include/JUED`
2. คัดลอกไฟล์ใน `MQL5/Experts` → `<MT5 Data Folder>/MQL5/Experts`
3. เปิด MetaEditor แล้ว Compile (F7) ทีละไฟล์
4. ทดสอบใน Strategy Tester / บัญชีเดโมก่อนเสมอ

> หา Data Folder: MT5 → File → Open Data Folder

## แดชบอร์ด JUED CORE

- การ์ด: Growth, Balance, Equity, Drawdown (ตอนนี้/สูงสุด), Win rate, Profit Factor
- ภาพรวมบัญชี + ลูกโลกเคลื่อนไหว, กราฟ Balance และ Equity
- กำไร วันนี้ / เมื่อวาน / สัปดาห์นี้ / เดือนนี้
- สถานะไม้ Buy/Sell + บรรทัดสถานะของ EA
- ปุ่ม **AUTO** (หยุด/เดินการเปิดไม้ใหม่ ผ่าน GlobalVariable `JUED_AUTO_<magic>`),
  **CLOSE BASKET** (ปิดทั้งตะกร้า ถามยืนยันก่อน), **RESET SESSION**

ใช้ในโค้ด EA:

```cpp
#include <JUED\Dashboard.mqh>
CJuedDashboard dash;
// OnInit:   dash.Init("JUED CORE", "V1.00", magic, true, 10, 20); EventSetMillisecondTimer(200);
// OnTimer:  dash.OnTimer();
// OnChartEvent: dash.OnChartEvent(id, lparam, dparam, sparam);
// OnTradeTransaction: dash.MarkDirty();
// ก่อนเปิดไม้ใหม่: if(!dash.AutoOn()) return;
```

## JUED Core EA (โครงสำหรับโคลน DNA CORE)

DNA CORE V1.95 (.ex5) ถูกเข้ารหัส อ่านโค้ดไม่ได้ สิ่งที่รู้: XAUUSD M15, ใช้ ATR, "Entry 1-3",
ล็อตอัตโนมัติต่อทุน 10K (บัญชี Cent), สเปรด 17–25, มีเส้นแดง (น่าจะ MA) และเส้นขาว (เส้นเทรนด์/กรอบเบรก),
หมดอายุ 31 ต.ค. 2026

โลจิกตั้งต้น (สมมติฐาน รอยืนยันด้วย Report ของตัวจริง):

1. **เทรนด์**: ราคาปิดเทียบ EMA 200 (เส้นแดง)
2. **เส้นขาว**: เส้นต้านลาดลงผ่าน 2 Pivot High ล่าสุด / เส้นรับลาดขึ้นผ่าน 2 Pivot Low ล่าสุด
   (ถ้าไม่มี ใช้ระดับ Pivot ล่าสุดแนวนอน)
3. **Entry 1**: แท่งปิดทะลุเส้นตามทิศเทรนด์
4. **Entry 2–3**: เพิ่มทุก `Add_Step_ATR` × ATR (แบบย่อตัว หรือแบบตามเทรนด์ เลือกได้)
5. **ออก**: TP ตะกร้า = ราคาเฉลี่ย ± `TP_ATR`×ATR, SL ตะกร้า = Entry 1 ∓ `SL_ATR`×ATR,
   Breakeven, เป้าเงินตะกร้า, ลิมิตกำไร/ขาดทุนรายวัน
6. **ล็อต**: `Lot_Per_Step` ต่อทุนทุก `Capital_Step` (ค่าเริ่ม 0.01 ต่อ 10,000)

ค่าที่ต้องจูนให้ตรงตัวจริง: `Trend_MA_Period`, `Pivot_Left/Right`, `Add_Mode`, `Add_Step_ATR`,
`TP_ATR`, `SL_ATR`, `BE_Trigger_ATR`

## Money Heist Clone v4

ดูรายละเอียดโลจิกในหัวไฟล์ `MoneyHeist_Clone_v4.mq5` — โซน 15 แท่ง + Pending ห่าง 80 จุด,
กริด 200 จุด, ปิดตะกร้า $80, หยุดรายวัน $100, เวลา 01:30–23:00
ค่าปรับจูนในกลุ่ม "Clone Tuning" และกด AUTO บนแดชบอร์ดเพื่อหยุดเปิดไม้ใหม่ได้

## ขั้นตอนเทสต์เทียบกับตัวจริง

1. Strategy Tester: XAUUSD, TF เดียวกัน, ช่วงเวลาเดียวกัน, **Every tick based on real ticks**
2. รันตัวจริงก่อน → Export Report (HTML) + แคปหน้า Inputs
3. รันตัวโคลน → Export Report
4. เทียบ: จำนวนไม้, เวลาเข้า, ระยะห่าง, ล็อต, จุดปิด, Drawdown
5. ปรับค่าจูนแล้วรันซ้ำ

> ⚠️ ทุกตัวยังไม่ได้ Compile/เทสต์จริงใน MT5 — เทสต์ในบัญชีเดโมก่อนใช้งานจริงเสมอ
> Money Heist clone ไม่มี Stop Loss และใช้กริด ความเสี่ยงสูง
