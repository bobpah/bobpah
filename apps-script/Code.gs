/**
 * EA Finance Bot — LINE OA บันทึกรายรับรายจ่ายจากสลิป → Google Sheet
 *
 * จุดเข้า:
 *   doPost  : webhook จาก LINE (ต้องมี ?key=WEBHOOK_KEY ต่อท้าย URL)
 *   doGet   : แดชบอร์ด (ต้องมี ?key=DASHBOARD_KEY)
 *   onOpen  : เมนู "EA Finance" ใน Google Sheet
 */

function doPost(e) {
  try {
    var cfg = getConfig();
    if (!e || !e.parameter || e.parameter.key !== cfg.WEBHOOK_KEY) {
      return text_('forbidden');
    }
    var body = JSON.parse(e.postData.contents || '{}');
    var events = body.events || [];
    events.forEach(function (ev) {
      try {
        if (isDuplicateEvent_(ev)) return;
        handleEvent_(ev);
      } catch (err) {
        logError_('event', err, ev);
      }
    });
  } catch (err) {
    logError_('doPost', err);
  }
  return text_('ok');
}

function doGet(e) {
  var cfg = getConfig();
  if (!e || !e.parameter || e.parameter.key !== cfg.DASHBOARD_KEY) {
    return HtmlService.createHtmlOutput('<h3 style="font-family:sans-serif">ไม่มีสิทธิ์เข้าถึง</h3>');
  }
  return renderDashboard_(e.parameter.m);
}

function handleEvent_(ev) {
  var src = ev.source || {};

  // LINE ระบุว่า standby event เป็นของโมดูลอื่น ห้ามบอทตอบหรือแก้ข้อมูลซ้ำ
  if (ev.mode === 'standby') return;

  rememberGroup_(src);

  if (ev.type === 'join') {
    reply(ev.replyToken, [{ type: 'text', text: welcomeText_() }]);
    return;
  }
  if (ev.type === 'follow') {
    touchUser_(src);
    reply(ev.replyToken, [{ type: 'text', text: welcomeText_() }]);
    return;
  }
  if (ev.type === 'postback') {
    handlePostback_(ev);
    return;
  }
  if (ev.type !== 'message') return;

  var msg = ev.message;
  if (msg.type === 'image' || (msg.type === 'file' && /\.(png|jpe?g|webp|pdf)$/i.test(msg.fileName || ''))) {
    handleSlip_(ev);
  } else if (msg.type === 'text') {
    handleText_(ev);
  }
}

/** กัน LINE ส่ง event ซ้ำ (redelivery) */
function isDuplicateEvent_(ev) {
  var id = ev.webhookEventId;
  if (!id) return false;
  var cache = CacheService.getScriptCache();
  if (cache.get('ev_' + id)) return true;
  cache.put('ev_' + id, '1', 21600);
  return false;
}

/** จำ groupId ของห้องทีมไว้ใช้ส่งสรุปอัตโนมัติ (ครั้งแรกที่บอทเห็นกลุ่ม) */
function rememberGroup_(src) {
  if (src.type !== 'group') return;
  var cfg = getConfig();
  if (!cfg.GROUP_ID) setConfig('GROUP_ID', src.groupId);
}

function text_(s) {
  return ContentService.createTextOutput(s);
}

function logError_(where, err, data) {
  console.error(where, err && err.stack ? err.stack : err, data ? JSON.stringify(data) : '');
  try {
    var sh = sheet_(SHEET.LOG);
    sh.appendRow([new Date(), where, String(err && err.message || err), data ? JSON.stringify(data).slice(0, 2000) : '']);
  } catch (ignore) {}
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EA Finance')
    .addItem('1) ติดตั้ง / ซ่อมชีต', 'setup')
    .addItem('2) ทดสอบการเชื่อมต่อ LINE + Gemini', 'testConnections')
    .addItem('3) ตั้งเวลาสรุปอัตโนมัติ', 'setupTriggers')
    .addItem('4) สร้าง Rich Menu', 'setupRichMenu')
    .addSeparator()
    .addItem('แสดงลิงก์ Webhook / Dashboard', 'showLinks')
    .addToUi();
}
