// EA Finance Bot — ไฟล์รวม (สร้างจาก scripts/build.sh ห้ามแก้ไฟล์นี้โดยตรง)

// ===== Sheet.gs =====
/** ชั้นข้อมูล: Google Sheet (Transactions / Categories / Users / Config / Log) */

var SHEET = {
  TX: 'Transactions',
  CAT: 'Categories',
  USERS: 'Users',
  CONFIG: 'Config',
  LOG: 'Log'
};

var TX_HEADERS = ['ID', 'วันที่', 'ประเภท', 'จำนวนเงิน', 'สกุลเงิน', 'จำนวนเงิน(THB)', 'หมวด', 'บัญชี/กระเป๋า',
  'รายละเอียด', 'ผู้โอน', 'ผู้รับ', 'ธนาคาร', 'เลขอ้างอิง', 'ลิงก์สลิป', 'สถานะ', 'ส่งโดย', 'userId ผู้ส่ง',
  'อนุมัติโดย', 'เวลาส่ง', 'เวลาอนุมัติ', 'ที่มา'];
var TX_KEYS = ['id', 'date', 'type', 'amount', 'currency', 'thb', 'category', 'wallet',
  'note', 'sender', 'receiver', 'bank', 'ref', 'slipUrl', 'status', 'by', 'byId',
  'approvedBy', 'createdAt', 'approvedAt', 'source'];

var INCOME = 'รายรับ';
var EXPENSE = 'รายจ่าย';
var ST_PENDING = 'รออนุมัติ';
var ST_APPROVED = 'อนุมัติแล้ว';
var ST_REJECTED = 'ปฏิเสธ';

var TZ = 'Asia/Bangkok';

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// ---------- Config ----------

var CONFIG_CACHE_ = null;

function getConfig() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;
  var cfg = {};
  var sh = sheet_(SHEET.CONFIG);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0]) cfg[String(r[0]).trim()] = typeof r[1] === 'string' ? r[1].trim() : r[1];
    });
  }
  CONFIG_CACHE_ = cfg;
  return cfg;
}

function setConfig(key, value) {
  var sh = sheet_(SHEET.CONFIG);
  var last = sh.getLastRow();
  var keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) {
      sh.getRange(i + 2, 2).setValue(value);
      if (CONFIG_CACHE_) CONFIG_CACHE_[key] = value;
      return;
    }
  }
  sh.appendRow([key, value, '']);
  if (CONFIG_CACHE_) CONFIG_CACHE_[key] = value;
}

// ---------- Transactions ----------

function rowToTx_(row) {
  var o = {};
  TX_KEYS.forEach(function (k, i) { o[k] = row[i]; });
  o.amount = Number(o.amount) || 0;
  o.thb = Number(o.thb) || 0;
  return o;
}

function txToRow_(o) {
  return TX_KEYS.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; });
}

function readAllTx() {
  var sh = sheet_(SHEET.TX);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, TX_KEYS.length).getValues()
    .filter(function (r) { return r[0]; })
    .map(rowToTx_);
}

function toThb_(amount, currency) {
  currency = String(currency || 'THB').toUpperCase();
  if (currency === 'THB') return amount;
  var rate = Number(getConfig()['FX_' + currency]) || 0;
  return rate ? Math.round(amount * rate * 100) / 100 : amount;
}

function nextId_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('SEQ') || 0) + 1;
  props.setProperty('SEQ', String(n));
  return 'T' + ('0000' + n).slice(-Math.max(4, String(n).length));
}

function addTx(tx) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    tx.id = nextId_();
    tx.currency = (tx.currency || 'THB').toUpperCase();
    tx.thb = toThb_(tx.amount, tx.currency);
    tx.createdAt = new Date();
    sheet_(SHEET.TX).appendRow(txToRow_(tx));
    return tx;
  } finally {
    lock.releaseLock();
  }
}

function findTx(id) {
  id = String(id || '').trim().toUpperCase();
  var sh = sheet_(SHEET.TX);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]).toUpperCase() === id) {
      var tx = rowToTx_(sh.getRange(i + 2, 1, 1, TX_KEYS.length).getValues()[0]);
      tx._row = i + 2;
      return tx;
    }
  }
  return null;
}

function updateTx(id, patch) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var tx = findTx(id);
    if (!tx) return null;
    Object.keys(patch).forEach(function (k) { tx[k] = patch[k]; });
    tx.thb = toThb_(tx.amount, tx.currency);
    sheet_(SHEET.TX).getRange(tx._row, 1, 1, TX_KEYS.length).setValues([txToRow_(tx)]);
    return tx;
  } finally {
    lock.releaseLock();
  }
}

/** หาสลิปซ้ำ: เลขอ้างอิงตรงกัน หรือ ยอด+เวลา(นาที)+ประเภทตรงกัน */
function findDuplicate(tx) {
  var ref = String(tx.ref || '').replace(/\s/g, '');
  var key = dupKey_(tx);
  var all = readAllTx();
  for (var i = all.length - 1; i >= 0; i--) {
    var t = all[i];
    if (t.id === tx.id || t.status === ST_REJECTED) continue;
    if (ref && ref.length >= 6 && String(t.ref).replace(/\s/g, '') === ref) return t;
    if (tx.source === 'slip' && t.source === 'slip' && key && dupKey_(t) === key) return t;
  }
  return null;
}

function dupKey_(t) {
  if (!(t.date instanceof Date) || !t.amount) return '';
  return t.type + '|' + t.amount + '|' + Utilities.formatDate(t.date, TZ, 'yyyyMMddHHmm');
}

// ---------- Categories ----------

function getCategories(type) {
  var sh = sheet_(SHEET.CAT);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r, i) {
      return {
        name: String(r[0]).trim(),
        type: String(r[1]).trim(),
        keywords: String(r[2] || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(String),
        budget: Number(r[3]) || 0,
        row: i + 2
      };
    })
    .filter(function (c) { return !type || c.type === type; });
}

function findCategory(name, type) {
  name = String(name || '').trim().toLowerCase();
  if (!name) return null;
  var cats = getCategories(type);
  for (var i = 0; i < cats.length; i++) if (cats[i].name.toLowerCase() === name) return cats[i];
  for (i = 0; i < cats.length; i++) if (cats[i].name.toLowerCase().indexOf(name) >= 0) return cats[i];
  for (i = 0; i < cats.length; i++) if (cats[i].keywords.indexOf(name) >= 0) return cats[i];
  return null;
}

/** เดาหมวดจากคำค้นในตาราง Categories */
function guessCategory(text, type) {
  text = String(text || '').toLowerCase();
  var cats = getCategories(type);
  for (var i = 0; i < cats.length; i++) {
    for (var j = 0; j < cats[i].keywords.length; j++) {
      if (text.indexOf(cats[i].keywords[j]) >= 0) return cats[i].name;
    }
  }
  return defaultCategory_(type);
}

function defaultCategory_(type) {
  return type === INCOME ? 'รายรับอื่นๆ' : 'รายจ่ายอื่นๆ';
}

function setBudget(catName, amount) {
  var c = findCategory(catName, EXPENSE);
  if (!c) return null;
  sheet_(SHEET.CAT).getRange(c.row, 4).setValue(amount);
  c.budget = amount;
  return c;
}

// ---------- Users ----------

/** บันทึก/อัปเดตผู้ใช้ คืนค่า {userId, name, role} */
function touchUser_(src) {
  if (!src || !src.userId) return { userId: '', name: 'ไม่ทราบชื่อ', role: 'staff' };
  var sh = sheet_(SHEET.USERS);
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === src.userId) {
      return { userId: src.userId, name: rows[i][1] || 'ไม่ทราบชื่อ', role: rows[i][2] || 'staff' };
    }
  }
  var name = getDisplayName(src) || 'ไม่ทราบชื่อ';
  sh.appendRow([src.userId, name, 'staff', new Date()]);
  return { userId: src.userId, name: name, role: 'staff' };
}

function setUserRole_(userId, role) {
  var sh = sheet_(SHEET.USERS);
  var last = sh.getLastRow();
  var ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === userId) {
      sh.getRange(i + 2, 3).setValue(role);
      return true;
    }
  }
  return false;
}

function hasAnyAdmin_() {
  var sh = sheet_(SHEET.USERS);
  if (sh.getLastRow() < 2) return false;
  return sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().some(function (r) { return r[0] === 'admin'; });
}

// ===== Setup.gs =====
/** ติดตั้งชีต ค่าเริ่มต้น และเครื่องมือทดสอบ */

function defaultCategories_() {
  return [
  // [ชื่อหมวด, ประเภท, คำค้น (คั่นด้วย ,), งบ/เดือน]
  ['ค่าโฆษณา', EXPENSE, 'ads,แอด,โฆษณา,facebook,meta,fb,google ads,tiktok,youtube,boost,บูสต์', 0],
  ['ค่า VPS/Server', EXPENSE, 'vps,server,hosting,aws,contabo,vultr,digitalocean,cloud,domain,โดเมน', 0],
  ['ค่าซอฟต์แวร์/Subscription', EXPENSE, 'mt4,mt5,metaquotes,tradingview,chatgpt,openai,canva,capcut,subscription,ซับ,license,myfxbook', 0],
  ['เงินเดือน/ค่าจ้างทีม', EXPENSE, 'เงินเดือน,ค่าจ้าง,แอดมิน,admin,ฟรีแลนซ์,freelance,โบนัส', 0],
  ['ค่าคอม/ตัวแทน', EXPENSE, 'ค่าคอม,คอมมิชชั่น,commission,affiliate,ตัวแทน,นายหน้า', 0],
  ['ค่าคอนเทนต์/กราฟิก', EXPENSE, 'กราฟิก,ตัดต่อ,คอนเทนต์,content,รูป,วิดีโอ,ถ่ายทำ', 0],
  ['อุปกรณ์/เครื่องมือ', EXPENSE, 'อุปกรณ์,คอมพิวเตอร์,จอ,มือถือ,shopee,lazada', 0],
  ['ค่าเน็ต/โทรศัพท์/สาธารณูปโภค', EXPENSE, 'เน็ต,internet,true,ais,dtac,3bb,ค่าไฟ,ค่าน้ำ,ค่าโทร', 0],
  ['ค่าธรรมเนียม/ภาษี', EXPENSE, 'ค่าธรรมเนียม,fee,ภาษี,vat,tax', 0],
  ['รายจ่ายอื่นๆ', EXPENSE, '', 0],
  ['ขาย EA/License', INCOME, 'ea,license,ไลเซนส์,บอท,bot,ขาย,ค่าบอท', 0],
  ['ค่าสมาชิก/VIP', INCOME, 'vip,สมาชิก,member,กลุ่ม,คอร์ส,course,สัมมนา', 0],
  ['ค่าคอม IB/Rebate', INCOME, 'ib,rebate,รีเบท,partner,คอม ib', 0],
  ['รายรับอื่นๆ', INCOME, '', 0]
  ];
}

function configDefaults_() {
  return [
    ['LINE_CHANNEL_ID', '', 'LINE Developers > Basic settings > Channel ID'],
    ['LINE_CHANNEL_SECRET', '', 'LINE Developers > Basic settings > Channel secret (ระบบออก token ให้เองอัตโนมัติ)'],
    ['LINE_CHANNEL_ACCESS_TOKEN', '', '(ไม่บังคับ) ถ้าใส่ long-lived token จะใช้อันนี้แทน ID/Secret'],
    ['GEMINI_API_KEY', '', 'ฟรีจาก https://aistudio.google.com/apikey'],
    ['GEMINI_MODEL', 'gemini-flash-latest', 'alias รุ่นล่าสุด; ถ้าต้องการ pin รุ่นใช้ gemini-3.8-flash หรือ gemini-3.5-flash-lite'],
    ['GEMINI_FALLBACK_MODELS', 'gemini-flash-lite-latest', 'รุ่นสำรองเมื่อรุ่นหลักคนใช้เยอะ (คั่นด้วย ,)'],
    ['WEB_APP_URL', '', 'วาง URL ที่ได้จาก Deploy > Web app (ลงท้าย /exec)'],
    ['WEBHOOK_KEY', randomKey_(24), 'รหัสลับต่อท้าย webhook (?key=) — ห้ามเผยแพร่'],
    ['DASHBOARD_KEY', randomKey_(16), 'รหัสลับเปิดแดชบอร์ด เปลี่ยนได้ถ้าลิงก์หลุด'],
    ['ADMIN_CODE', String(Math.floor(100000 + Math.random() * 900000)), 'พิมพ์ "แอดมิน <รหัส>" ในไลน์เพื่อเป็นแอดมิน'],
    ['APPROVE_MODE', 'admin', 'admin = เฉพาะแอดมินกดอนุมัติ / anyone = ใครก็ได้'],
    ['BUSINESS_NAME', 'เพจ EA', 'ชื่อธุรกิจ แสดงในสรุป'],
    ['OWN_ACCOUNT_KEYWORDS', '', 'ชื่อบัญชี/เลขท้ายบัญชีของธุรกิจ คั่นด้วย , (ใช้แยกว่าเป็นเงินเข้าหรือเงินออก)'],
    ['DEFAULT_WALLET', 'บัญชีหลัก', 'กระเป๋าเริ่มต้น'],
    ['FX_USD', 33, 'อัตราแลก USD→THB สำหรับค่าแอดที่จ่ายเป็นดอลลาร์'],
    ['DAILY_SUMMARY', 'on', 'on/off สรุปรายวันเข้ากลุ่ม (ใช้โควต้า push)'],
    ['DAILY_SUMMARY_HOUR', 21, 'ชั่วโมงที่ส่งสรุปรายวัน (0-23)'],
    ['GROUP_ID', '', 'ระบบใส่ให้อัตโนมัติเมื่อบอทเข้ากลุ่ม หรือพิมพ์ "ตั้งกลุ่มนี้"'],
    ['SLIP_FOLDER_ID', '', 'ระบบสร้างให้อัตโนมัติ'],
    ['RICHMENU_ID', '', 'ระบบใส่ให้อัตโนมัติ']
  ];
}

function randomKey_(len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var s = '';
  for (var i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function ensureSheet_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground(color).setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** รันครั้งแรก (และรันซ้ำได้ ไม่ทับข้อมูลเดิม) */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  var tx = ensureSheet_(ss, SHEET.TX, TX_HEADERS, '#0f766e');
  tx.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');
  tx.getRange('D:D').setNumberFormat('#,##0.00');
  tx.getRange('F:F').setNumberFormat('#,##0.00');
  tx.getRange('S:T').setNumberFormat('dd/MM/yyyy HH:mm');

  var cat = ensureSheet_(ss, SHEET.CAT, ['หมวด', 'ประเภท', 'คำค้น (คั่นด้วย ,)', 'งบ/เดือน (บาท)'], '#7c3aed');
  if (cat.getLastRow() < 2) {
    var defs = defaultCategories_();
    cat.getRange(2, 1, defs.length, 4).setValues(defs);
  }
  cat.getRange('D:D').setNumberFormat('#,##0');

  ensureSheet_(ss, SHEET.USERS, ['userId', 'ชื่อ', 'สิทธิ์ (admin/staff)', 'เริ่มใช้งาน'], '#1d4ed8');

  var conf = ensureSheet_(ss, SHEET.CONFIG, ['key', 'value', 'คำอธิบาย'], '#b45309');
  CONFIG_CACHE_ = null;
  var have = getConfig();
  configDefaults_().forEach(function (r) {
    if (!(r[0] in have)) conf.appendRow(r);
  });
  conf.setColumnWidth(1, 230).setColumnWidth(2, 320).setColumnWidth(3, 420);

  ensureSheet_(ss, SHEET.LOG, ['เวลา', 'จุดที่เกิด', 'ข้อผิดพลาด', 'ข้อมูล'], '#6b7280');

  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  CONFIG_CACHE_ = null;
  slipFolder_();

  var cfg = getConfig();
  safeAlert_('ติดตั้งเสร็จแล้ว ✅\n\n' +
    'ต่อไป:\n' +
    '1) ใส่ LINE_CHANNEL_ID, LINE_CHANNEL_SECRET และ GEMINI_API_KEY ในชีต Config\n' +
    '2) Deploy เป็น Web app แล้ววาง URL ลงช่อง WEB_APP_URL\n' +
    '3) เมนู EA Finance > แสดงลิงก์ Webhook แล้วไปวางใน LINE Developers\n\n' +
    'รหัสแอดมิน: ' + cfg.ADMIN_CODE + '\n(พิมพ์ "แอดมิน ' + cfg.ADMIN_CODE + '" ในไลน์)');
}

function slipFolder_() {
  var cfg = getConfig();
  if (cfg.SLIP_FOLDER_ID) {
    try { return DriveApp.getFolderById(cfg.SLIP_FOLDER_ID); } catch (e) {}
  }
  var folder = DriveApp.createFolder('EA Finance - สลิป');
  setConfig('SLIP_FOLDER_ID', folder.getId());
  return folder;
}

function webAppUrl_() {
  var cfg = getConfig();
  var url = cfg.WEB_APP_URL || ScriptApp.getService().getUrl() || '';
  return String(url).trim();
}

function dashboardUrl_(month) {
  var url = webAppUrl_();
  if (!url) return '';
  return url + '?key=' + encodeURIComponent(getConfig().DASHBOARD_KEY) + (month ? '&m=' + month : '');
}

function showLinks() {
  var url = webAppUrl_();
  if (!url) {
    safeAlert_('ยังไม่มี WEB_APP_URL\nกด Deploy > New deployment > Web app ก่อน แล้ววาง URL ลงชีต Config');
    return;
  }
  safeAlert_('Webhook URL (วางใน LINE Developers):\n' + url + '?key=' + getConfig().WEBHOOK_KEY +
    '\n\nDashboard URL:\n' + dashboardUrl_());
}

function testConnections() {
  var out = [];
  try {
    var info = lineFetch_('/v2/bot/info', null, 'get');
    out.push('LINE ✅ เชื่อมต่อบอท: ' + (info.displayName || '?'));
  } catch (e) {
    out.push('LINE ❌ ' + e.message);
  }
  try {
    var r = geminiJson_('ตอบเป็น JSON {"ok": true} เท่านั้น', null);
    out.push('Gemini ' + (r && r.ok ? '✅ ใช้งานได้' : '⚠️ ตอบกลับผิดรูปแบบ'));
  } catch (e) {
    out.push('Gemini ❌ ' + e.message);
  }
  safeAlert_(out.join('\n'));
}

function safeAlert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

// ===== Line.gs =====
/** LINE Messaging API + Flex message */

/**
 * คืน channel access token
 * - ถ้าใส่ LINE_CHANNEL_ACCESS_TOKEN (long-lived) ไว้ ใช้อันนั้น
 * - ไม่งั้นออก token อายุ 30 วันเองจาก LINE_CHANNEL_ID + LINE_CHANNEL_SECRET แล้วต่ออายุอัตโนมัติ
 */
function lineToken_() {
  var cfg = getConfig();
  if (cfg.LINE_CHANNEL_ACCESS_TOKEN) return cfg.LINE_CHANNEL_ACCESS_TOKEN;
  if (!cfg.LINE_CHANNEL_ID || !cfg.LINE_CHANNEL_SECRET) {
    throw new Error('ยังไม่ได้ใส่ LINE_CHANNEL_ID + LINE_CHANNEL_SECRET (หรือ LINE_CHANNEL_ACCESS_TOKEN) ในชีต Config');
  }
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('LINE_TOKEN');
  var exp = Number(props.getProperty('LINE_TOKEN_EXP') || 0);
  var owner = props.getProperty('LINE_TOKEN_CH');
  if (cached && owner === String(cfg.LINE_CHANNEL_ID) && exp > Date.now() + 86400000) return cached;

  var res = UrlFetchApp.fetch('https://api.line.me/v2/oauth/accessToken', {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: String(cfg.LINE_CHANNEL_ID), client_secret: String(cfg.LINE_CHANNEL_SECRET) },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('ออก LINE token ไม่สำเร็จ (ตรวจ Channel ID / Secret): ' + res.getContentText().slice(0, 200));
  }
  var data = JSON.parse(res.getContentText());
  props.setProperties({
    LINE_TOKEN: data.access_token,
    LINE_TOKEN_EXP: String(Date.now() + Number(data.expires_in || 2592000) * 1000),
    LINE_TOKEN_CH: String(cfg.LINE_CHANNEL_ID)
  });
  return data.access_token;
}

function lineFetch_(path, payload, method, host) {
  var token = lineToken_();
  var opts = {
    method: method || 'post',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (payload !== null && payload !== undefined) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  var res = UrlFetchApp.fetch((host || 'https://api.line.me') + path, opts);
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code >= 300) throw new Error('LINE ' + code + ': ' + body);
  return body ? JSON.parse(body) : {};
}

function reply(replyToken, messages) {
  if (!replyToken) return;
  try {
    lineFetch_('/v2/bot/message/reply', { replyToken: replyToken, messages: messages.slice(0, 5) });
  } catch (e) {
    logError_('reply', e, messages);
  }
}

function push(to, messages) {
  if (!to) return;
  lineFetch_('/v2/bot/message/push', { to: to, messages: messages.slice(0, 5) });
}

function getMessageContent(messageId) {
  var res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + messageId + '/content', {
    headers: { Authorization: 'Bearer ' + lineToken_() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('ดึงรูปไม่สำเร็จ ' + res.getResponseCode());
  return res.getBlob();
}

function getDisplayName(src) {
  try {
    var p;
    if (src.type === 'group') p = lineFetch_('/v2/bot/group/' + src.groupId + '/member/' + src.userId, null, 'get');
    else if (src.type === 'room') p = lineFetch_('/v2/bot/room/' + src.roomId + '/member/' + src.userId, null, 'get');
    else p = lineFetch_('/v2/bot/profile/' + src.userId, null, 'get');
    return p.displayName;
  } catch (e) {
    return '';
  }
}

// ---------- formatting ----------

function money(n, currency) {
  n = Number(n) || 0;
  var neg = n < 0;
  var parts = Math.abs(n).toFixed(2).split('.');
  var s = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] === '00' ? '' : '.' + parts[1]);
  var sym = !currency || currency === 'THB' ? '฿' : (currency === 'USD' ? '$' : currency + ' ');
  return (neg ? '-' : '') + sym + s;
}

function fmtDate(d, pattern) {
  if (!(d instanceof Date)) return String(d || '-');
  return Utilities.formatDate(d, TZ, pattern || 'dd/MM/yyyy HH:mm');
}

// ---------- Flex: การ์ดรายการ ----------

function txCard(tx, opts) {
  opts = opts || {};
  var isIn = tx.type === INCOME;
  var color = isIn ? '#16a34a' : '#dc2626';
  var statusColor = tx.status === ST_APPROVED ? '#16a34a' : (tx.status === ST_REJECTED ? '#6b7280' : '#d97706');

  var rows = [
    ['หมวด', tx.category],
    ['วันที่', fmtDate(tx.date)],
    ['ผู้โอน', tx.sender],
    ['ผู้รับ', tx.receiver],
    ['ธนาคาร', tx.bank],
    ['อ้างอิง', tx.ref],
    ['กระเป๋า', tx.wallet],
    ['รายละเอียด', tx.note],
    ['ส่งโดย', tx.by]
  ].filter(function (r) { return r[1]; }).map(function (r) {
    return {
      type: 'box', layout: 'baseline', spacing: 'sm', contents: [
        { type: 'text', text: r[0], size: 'sm', color: '#8b8b8b', flex: 3 },
        { type: 'text', text: String(r[1]).slice(0, 80), size: 'sm', color: '#222222', flex: 7, wrap: true }
      ]
    };
  });

  var amountText = (isIn ? '+' : '-') + money(tx.amount, tx.currency);
  var body = [
    {
      type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: tx.type, size: 'sm', color: color, weight: 'bold' },
        { type: 'text', text: tx.status, size: 'sm', color: statusColor, weight: 'bold', align: 'end' }
      ]
    },
    { type: 'text', text: amountText, size: 'xxl', weight: 'bold', color: color, margin: 'md' }
  ];
  if (tx.currency && tx.currency !== 'THB') {
    body.push({ type: 'text', text: '≈ ' + money(tx.thb), size: 'sm', color: '#8b8b8b' });
  }
  body.push({ type: 'separator', margin: 'lg' });
  body.push({ type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm', contents: rows });
  if (opts.warning) {
    body.push({ type: 'text', text: opts.warning, size: 'sm', color: '#d97706', wrap: true, margin: 'lg', weight: 'bold' });
  }

  var footer = [];
  if (tx.status === ST_PENDING) {
    footer.push({
      type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
        btn_('✅ อนุมัติ', 'a=ok&id=' + tx.id, 'primary', '#16a34a'),
        btn_('❌ ปฏิเสธ/ยกเลิก', 'a=no&id=' + tx.id, 'secondary')
      ]
    });
    footer.push({
      type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
        btn_('🏷 เปลี่ยนหมวด', 'a=cat&id=' + tx.id, 'secondary'),
        btn_('🔁 รับ/จ่าย', 'a=flip&id=' + tx.id, 'secondary')
      ]
    });
  }
  if (tx.slipUrl) {
    footer.push({ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'ดูสลิป', uri: tx.slipUrl } });
  }

  var bubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box', layout: 'horizontal', backgroundColor: color, paddingAll: '12px', contents: [
        { type: 'text', text: isIn ? '💰 เงินเข้า' : '💸 เงินออก', color: '#ffffff', weight: 'bold', size: 'md' },
        { type: 'text', text: tx.id, color: '#ffffff', size: 'sm', align: 'end', gravity: 'center' }
      ]
    },
    body: { type: 'box', layout: 'vertical', contents: body }
  };
  if (footer.length) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer };
  return bubble;
}

function btn_(label, data, style, color) {
  var b = { type: 'button', style: style, height: 'sm', action: { type: 'postback', label: label, data: data, displayText: label } };
  if (color) b.color = color;
  return b;
}

function flexMsg(altText, contents) {
  return { type: 'flex', altText: altText.slice(0, 400), contents: contents };
}

function cardMsg(tx, opts) {
  var alt = tx.id + ' ' + tx.type + ' ' + money(tx.amount, tx.currency) + ' ' + tx.category + ' (' + tx.status + ')';
  return flexMsg(alt, txCard(tx, opts));
}

/** quick reply ให้เลือกหมวด (สูงสุด 13 ปุ่ม) */
function categoryQuickReply(tx) {
  var items = getCategories(tx.type).slice(0, 13).map(function (c) {
    return {
      type: 'action',
      action: { type: 'postback', label: c.name.slice(0, 20), data: 'a=setcat&id=' + tx.id + '&c=' + encodeURIComponent(c.name), displayText: '🏷 ' + c.name }
    };
  });
  return { items: items };
}

// ===== Slip.gs =====
/** อ่านสลิป/ใบเสร็จด้วย Gemini (ฟรีจาก Google AI Studio) */

var GEMINI_RETRY_CODES = [429, 500, 502, 503, 504];

/** รายชื่อรุ่นที่จะลองตามลำดับ: GEMINI_MODEL แล้วต่อด้วย GEMINI_FALLBACK_MODELS */
function geminiModels_() {
  var cfg = getConfig();
  var list = [cfg.GEMINI_MODEL || 'gemini-flash-latest'];
  var fb = cfg.GEMINI_FALLBACK_MODELS === undefined ? 'gemini-flash-lite-latest' : String(cfg.GEMINI_FALLBACK_MODELS);
  fb.split(',').map(function (m) { return m.trim(); }).filter(String).forEach(function (m) {
    if (list.indexOf(m) < 0) list.push(m);
  });
  return list;
}

/**
 * เรียก Gemini แล้วคืน JSON
 * - error ชั่วคราว (503 คนใช้เยอะ, 429 โควตา, 5xx) → รอแล้วลองใหม่ จากนั้นสลับไปรุ่นสำรอง
 * - 404 (ชื่อรุ่นใช้ไม่ได้) → ข้ามไปรุ่นสำรองทันที
 */
function geminiJson_(prompt, blob) {
  var cfg = getConfig();
  if (!cfg.GEMINI_API_KEY) throw new Error('ยังไม่ได้ใส่ GEMINI_API_KEY ในชีต Config');
  var parts = [{ text: prompt }];
  if (blob) {
    parts.push({ inline_data: { mime_type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } });
  }
  var payload = JSON.stringify({
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
  });

  var models = geminiModels_();
  var lastErr = null;
  for (var i = 0; i < models.length; i++) {
    for (var attempt = 1; attempt <= 2; attempt++) {
      var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': cfg.GEMINI_API_KEY },
        payload: payload,
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code === 200) return parseGeminiJson_(res.getContentText());
      lastErr = new Error('Gemini ' + code + ' (' + models[i] + '): ' + res.getContentText().slice(0, 200));
      lastErr.code = code;
      if (GEMINI_RETRY_CODES.indexOf(code) < 0) break;
      if (attempt < 2) Utilities.sleep(2000 * attempt);
    }
    if (lastErr.code !== 404 && GEMINI_RETRY_CODES.indexOf(lastErr.code) < 0) break;
  }
  throw lastErr;
}

function parseGeminiJson_(body) {
  var data = JSON.parse(body);
  var cand = (data.candidates || [])[0];
  var text = cand && cand.content && cand.content.parts
    ? cand.content.parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('')
    : '';
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(text);
}

/** ข้อความ error ที่คนทั่วไปอ่านเข้าใจ */
function geminiErrorText_(e) {
  var code = e && e.code;
  if (code === 503 || code === 500 || code === 502 || code === 504) return 'ระบบ AI อ่านสลิป (Gemini) มีคนใช้เยอะชั่วคราว ลองแล้วยังไม่สำเร็จ';
  if (code === 429) return 'ใช้โควตา Gemini ฟรีเต็มชั่วคราว (รอสักครู่แล้วลองใหม่)';
  if (code === 400 || code === 403) return 'GEMINI_API_KEY ไม่ถูกต้องหรือไม่มีสิทธิ์ (เช็กในชีต Config)';
  return 'อ่านสลิปไม่สำเร็จ (' + String(e && e.message || e).slice(0, 100) + ')';
}

function slipPrompt_() {
  var cfg = getConfig();
  var exp = getCategories(EXPENSE).map(function (c) { return c.name; }).join(', ');
  var inc = getCategories(INCOME).map(function (c) { return c.name; }).join(', ');
  return [
    'คุณคือผู้ช่วยบัญชีของธุรกิจ "' + (cfg.BUSINESS_NAME || 'เพจ EA') + '" (ขาย EA/บอทเทรด Forex, ยิงโฆษณา)',
    'อ่านรูปนี้ แล้วตอบเป็น JSON เท่านั้น ตามโครงสร้าง:',
    '{',
    '  "is_financial": true/false,        // เป็นสลิปโอนเงิน ใบเสร็จ หรือใบแจ้งหนี้ หรือไม่',
    '  "doc_type": "transfer_slip" | "receipt" | "invoice" | "other",',
    '  "amount": number,                   // ยอดสุทธิที่จ่าย/ได้รับ ไม่ต้องมีคอมม่า',
    '  "currency": "THB" | "USD" | ...,',
    '  "datetime": "YYYY-MM-DD HH:mm",     // ปี ค.ศ. เท่านั้น (ถ้าเป็น พ.ศ. ให้ลบ 543, ถ้าเห็น "69" แบบย่อ = 2569 = 2026)',
    '  "sender_name": string,',
    '  "sender_account": string,           // เลขบัญชี/เบอร์ที่เห็น (มักถูกปิดบางส่วน)',
    '  "receiver_name": string,            // หรือชื่อร้าน/บริษัทในใบเสร็จ',
    '  "receiver_account": string,',
    '  "bank": string,                     // ธนาคารหรือช่องทาง เช่น KBank, SCB, PromptPay, Visa',
    '  "ref": string,                      // เลขที่รายการ/เลขอ้างอิง/เลขที่ใบเสร็จ',
    '  "memo": string,                     // บันทึกช่วยจำ หรือรายการสินค้าสั้นๆ',
    '  "direction": "income" | "expense",  // เดาว่าธุรกิจได้รับเงิน หรือจ่ายเงิน',
    '  "category": string                  // เลือกจากรายการด้านล่างเท่านั้น',
    '}',
    'หมวดรายจ่าย: ' + exp,
    'หมวดรายรับ: ' + inc,
    cfg.OWN_ACCOUNT_KEYWORDS ? 'ชื่อ/บัญชีของธุรกิจเรา: ' + cfg.OWN_ACCOUNT_KEYWORDS + ' (ถ้าเราเป็นผู้รับ = income, ถ้าเราเป็นผู้โอน = expense)' : '',
    'ใบเสร็จค่าโฆษณา Facebook/Meta/Google/TikTok = expense หมวดค่าโฆษณา',
    'ถ้าข้อมูลไหนไม่มี ให้ใส่ "" (หรือ 0 สำหรับ amount)'
  ].filter(String).join('\n');
}

/** อ่านรูป → object ข้อมูลรายการ (ยังไม่บันทึก) */
function readSlip(blob) {
  var r = geminiJson_(slipPrompt_(), blob);
  if (Array.isArray(r)) r = r[0] || {};
  return r;
}

function parseSlipDate_(s) {
  var m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return new Date();
  var y = Number(m[1]);
  if (y > 2400) y -= 543;
  var d = new Date(y, Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
  // กันอ่านปีผิดจนวันที่อยู่ในอนาคตไกลๆ
  if (isNaN(d.getTime()) || d.getTime() > Date.now() + 86400000 * 2) return new Date();
  return d;
}

function decideType_(r) {
  var kws = String(getConfig().OWN_ACCOUNT_KEYWORDS || '').split(',')
    .map(function (s) { return s.trim().toLowerCase(); }).filter(String);
  var recv = (String(r.receiver_name || '') + ' ' + String(r.receiver_account || '')).toLowerCase();
  var send = (String(r.sender_name || '') + ' ' + String(r.sender_account || '')).toLowerCase();
  var hit = function (s) { return kws.some(function (k) { return s.indexOf(k) >= 0; }); };
  if (kws.length && hit(recv) && !hit(send)) return INCOME;
  if (kws.length && hit(send) && !hit(recv)) return EXPENSE;
  if (r.doc_type === 'receipt' || r.doc_type === 'invoice') return EXPENSE;
  return r.direction === 'income' ? INCOME : EXPENSE;
}

function saveSlipImage_(blob, id) {
  var root = slipFolder_();
  var month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  var it = root.getFoldersByName(month);
  var folder = it.hasNext() ? it.next() : root.createFolder(month);
  var ext = (blob.getContentType() || '').indexOf('png') >= 0 ? '.png' : (blob.getContentType() || '').indexOf('pdf') >= 0 ? '.pdf' : '.jpg';
  var file = folder.createFile(blob.setName(id + ext));
  return file.getUrl();
}

/** event รูปภาพ/ไฟล์จาก LINE */
function handleSlip_(ev) {
  var src = ev.source;
  var inGroup = src.type !== 'user';
  var user = touchUser_(src);
  var blob = getMessageContent(ev.message.id);

  // อ่านรูป + เรียก Gemini อาจใช้เวลาหลายวินาที ให้ตอบรับทันทีในกลุ่ม
  // แล้วส่งการ์ดผลลัพธ์ด้วย push ภายหลัง เพื่อไม่ให้ผู้ใช้เห็นแค่ auto-reply ของ OA
  if (inGroup) reply(ev.replyToken, [{ type: 'text', text: '⏳ รับรูปแล้ว กำลังอ่านยอดและตรวจว่าเป็นรายรับ/รายจ่ายให้ครับ…' }]);

  var sendResult = function (messages) {
    if (inGroup) return push(src.groupId, messages);
    return reply(ev.replyToken, messages);
  };

  if ((blob.getContentType() || '').indexOf('pdf') >= 0 && blob.getBytes().length > 15 * 1024 * 1024) {
    if (!inGroup) reply(ev.replyToken, [{ type: 'text', text: 'ไฟล์ใหญ่เกินไป' }]);
    return;
  }

  processSlip_(blob, user, sendResult, inGroup);
}

/** เก็บรูปที่อ่านไม่สำเร็จไว้ชั่วคราว เพื่อให้กด "ลองอ่านใหม่" ได้โดยไม่ต้องส่งรูปซ้ำ */
function retryFolder_() {
  var root = slipFolder_();
  var it = root.getFoldersByName('_รออ่านใหม่');
  return it.hasNext() ? it.next() : root.createFolder('_รออ่านใหม่');
}

/** ปุ่ม 🔄 ลองอ่านใหม่ (postback a=retry&f=<fileId>) */
function handleRetrySlip_(ev, fileId) {
  var src = ev.source;
  var inGroup = src.type !== 'user';
  var file = null;
  try {
    file = DriveApp.getFileById(fileId);
    if (file.getParents().next().getId() !== retryFolder_().getId()) file = null;
  } catch (e) {
    file = null;
  }
  if (!file) return reply(ev.replyToken, [{ type: 'text', text: 'ไม่พบรูปเดิมแล้ว กรุณาส่งรูปสลิปใหม่อีกครั้ง' }]);
  if (file.isTrashed()) return reply(ev.replyToken, [{ type: 'text', text: 'สลิปนี้อ่านเสร็จไปแล้ว ✅' }]);

  var user = touchUser_(src);
  if (inGroup) reply(ev.replyToken, [{ type: 'text', text: '🔄 กำลังลองอ่านสลิปใหม่…' }]);
  var sendResult = function (messages) {
    if (inGroup) return push(src.groupId, messages);
    return reply(ev.replyToken, messages);
  };
  if (processSlip_(file.getBlob(), user, sendResult, inGroup)) file.setTrashed(true);
}

/** อ่านสลิปแล้วสร้างรายการ คืน true เมื่อเรียก AI สำเร็จ (false = ต้องลองใหม่) */
function processSlip_(blob, user, sendResult, inGroup) {
  var r;
  try {
    r = readSlip(blob);
  } catch (e) {
    logError_('gemini', e);
    var retryId = '';
    try {
      retryId = retryFolder_().createFile(blob.copyBlob ? blob.copyBlob() : blob).getId();
    } catch (e2) {
      logError_('saveRetry', e2);
    }
    var msg = {
      type: 'text',
      text: '⚠️ ' + geminiErrorText_(e) + '\n' +
        (retryId ? 'กดปุ่ม 🔄 ด้านล่างเพื่อลองอ่านใหม่ (ไม่ต้องส่งรูปซ้ำ)' : 'ลองส่งรูปใหม่อีกครั้ง') +
        '\nหรือพิมพ์บันทึกเอง เช่น  -500 ค่าแอด'
    };
    if (retryId) {
      msg.quickReply = { items: [{ type: 'action', action: { type: 'postback', label: '🔄 ลองอ่านใหม่', data: 'a=retry&f=' + retryId, displayText: '🔄 ลองอ่านสลิปใหม่' } }] };
    }
    sendResult([msg]);
    return false;
  }

  // ในกลุ่ม: ถ้าไม่ใช่เอกสารการเงิน (รูปทั่วไป) ให้เงียบไว้ ไม่รบกวนแชท
  if (!r || !r.is_financial || !(Number(r.amount) > 0)) {
    if (!inGroup) sendResult([{ type: 'text', text: 'รูปนี้ไม่น่าจะเป็นสลิป/ใบเสร็จ 🤔\nถ้าใช่ ลองพิมพ์บันทึกเอง เช่น  -500 ค่าแอด' }]);
    return true;
  }

  var type = decideType_(r);
  var cat = findCategory(r.category, type);
  var note = [r.memo, r.doc_type === 'receipt' || r.doc_type === 'invoice' ? r.receiver_name : ''].filter(String).join(' / ');

  var tx = addTx({
    date: parseSlipDate_(r.datetime),
    type: type,
    amount: Math.abs(Number(r.amount)),
    currency: r.currency || 'THB',
    category: cat ? cat.name : guessCategory([r.memo, r.receiver_name, r.sender_name].join(' '), type),
    wallet: getConfig().DEFAULT_WALLET || 'บัญชีหลัก',
    note: note,
    sender: [r.sender_name, r.sender_account].filter(String).join(' '),
    receiver: [r.receiver_name, r.receiver_account].filter(String).join(' '),
    bank: r.bank || '',
    ref: r.ref || '',
    status: ST_PENDING,
    by: user.name,
    byId: user.userId,
    source: 'slip'
  });

  try {
    var url = saveSlipImage_(blob, tx.id);
    tx = updateTx(tx.id, { slipUrl: url });
  } catch (e) {
    logError_('saveSlip', e);
  }

  var dup = findDuplicate(tx);
  var warning = dup ? '⚠️ อาจเป็นสลิปซ้ำกับ ' + dup.id + ' (' + money(dup.amount) + ', ' + dup.status + ')' : '';
  sendResult([cardMsg(tx, { warning: warning })]);
  return true;
}

// ===== Commands.gs =====
/** คำสั่งข้อความ + ปุ่ม postback */

var AMOUNT_RE = '([\\d,]+(?:\\.\\d+)?)';

function handleText_(ev) {
  var src = ev.source;
  var raw = String(ev.message.text || '').trim();
  var t = raw.replace(/\s+/g, ' ');
  var lower = t.toLowerCase();
  var rt = ev.replyToken;
  var inGroup = src.type !== 'user';
  var m;

  // ---- บันทึกเอง: +1500 ขาย EA / -500 ค่าแอด / -$50 facebook / รับ 1500 ... / จ่าย 500 ...
  m = t.match(new RegExp('^([+\\-]|รับ|จ่าย)\\s*(\\$|usd\\s*)?' + AMOUNT_RE + '\\s*(.*)$', 'i'));
  // ในกลุ่มใช้ได้เฉพาะ +/- (กันแชทปกติอย่าง "รับ 2 คน" ถูกบันทึกโดยไม่ตั้งใจ)
  if (m && !(inGroup && /^(รับ|จ่าย)$/.test(m[1]))) return manualEntry_(ev, m[1], m[2], m[3], m[4]);

  // คนมักพิมพ์ภาษาธรรมชาติ เช่น "ค่าแอด 1,650 บาท" หรือ "ลูกค้าโอน 2,990 บาท"
  // ในกลุ่มให้รับเฉพาะข้อความที่ขึ้นต้นด้วยคำบอกธุรกรรม เพื่อลดการจับแชททั่วไปเป็นรายการเงิน
  if (inGroup && (m = naturalEntry_(t))) {
    return manualEntry_(ev, m.sign, m.currency, m.amount, m.note);
  }

  if (/^(help|วิธีใช้|ช่วยเหลือ|เมนู|คำสั่ง)$/i.test(lower)) return reply(rt, [{ type: 'text', text: helpText_() }]);
  if (/^(วิธีบันทึก|บันทึกเอง)$/.test(t)) return reply(rt, [{ type: 'text', text: manualHelpText_() }]);
  if (/^(สรุป|สรุปยอด)$/.test(t)) return reply(rt, [{ type: 'text', text: todayText_() + '\n\n' + monthText_() }]);
  if (t === 'สรุปวันนี้') return reply(rt, [{ type: 'text', text: todayText_() }]);
  if ((m = t.match(/^สรุปเดือน(?:\s*(\d{4})-(\d{1,2}))?$/))) {
    return reply(rt, [{ type: 'text', text: monthText_(m[1] ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null) }]);
  }
  if (/^(แดชบอร์ด|dashboard|กราฟ)$/i.test(lower)) {
    var url = dashboardUrl_();
    return reply(rt, [{ type: 'text', text: url ? '📊 แดชบอร์ด\n' + url : 'ยังไม่ได้ตั้งค่า WEB_APP_URL ในชีต Config' }]);
  }
  if (t === 'รออนุมัติ') return replyPending_(rt);
  if (t === 'หมวด') return reply(rt, [{ type: 'text', text: categoriesText_() }]);
  if (t === 'งบ') return reply(rt, [{ type: 'text', text: budgetText_() }]);
  if (/^(myid|ไอดี)$/i.test(lower)) {
    return reply(rt, [{ type: 'text', text: 'userId: ' + src.userId + (src.groupId ? '\ngroupId: ' + src.groupId : '') }]);
  }

  // ---- ลงทะเบียนแอดมิน
  if ((m = t.match(/^แอดมิน\s+(\S+)$/))) {
    var u = touchUser_(src);
    if (String(m[1]) !== String(getConfig().ADMIN_CODE)) return reply(rt, [{ type: 'text', text: '❌ รหัสแอดมินไม่ถูกต้อง' }]);
    setUserRole_(u.userId, 'admin');
    return reply(rt, [{ type: 'text', text: '👑 ' + u.name + ' เป็นแอดมินแล้ว อนุมัติรายการได้' }]);
  }

  // ยกเลิกแบบไม่ต้องพิมพ์ ID: ใช้รายการรออนุมัติล่าสุดของผู้ส่งเอง
  if (t === 'ยกเลิก') {
    var ownPending = readAllTx().filter(function (tx) {
      return tx.status === ST_PENDING && tx.byId === src.userId;
    });
    if (!ownPending.length) return reply(rt, [{ type: 'text', text: 'ไม่พบรายการรออนุมัติของคุณ' }]);
    return approveCmd_(ev, ownPending[ownPending.length - 1].id, false);
  }

  // ---- คำสั่งที่ต้องอ้าง ID
  if ((m = t.match(/^(อนุมัติ|approve)\s+(T\d+)$/i))) return approveCmd_(ev, m[2], true);
  if ((m = t.match(/^(ปฏิเสธ|reject|ยกเลิก)\s+(T\d+)$/i))) return approveCmd_(ev, m[2], false);
  if (t === 'อนุมัติทั้งหมด') return approveAll_(ev);
  if ((m = t.match(new RegExp('^แก้\\s+(T\\d+)\\s+(\\$)?' + AMOUNT_RE + '$', 'i')))) {
    return editCmd_(ev, m[1], { amount: num_(m[3]), currency: m[2] ? 'USD' : undefined });
  }
  if ((m = t.match(/^หมวด\s+(T\d+)\s+(.+)$/i))) return setCategoryCmd_(ev, m[1], m[2]);
  if ((m = t.match(/^โน้ต\s+(T\d+)\s+(.+)$/i))) return editCmd_(ev, m[1], { note: m[2] });
  if ((m = t.match(/^กระเป๋า\s+(T\d+)\s+(.+)$/i))) return editCmd_(ev, m[1], { wallet: m[2] });
  if ((m = t.match(/^(ดู|id)\s+(T\d+)$/i))) {
    var tx = findTx(m[2]);
    return reply(rt, [tx ? cardMsg(tx) : { type: 'text', text: 'ไม่พบ ' + m[2] }]);
  }

  // ---- แอดมิน
  if (t === 'ตั้งกลุ่มนี้') {
    if (!requireAdmin_(ev)) return;
    if (!src.groupId) return reply(rt, [{ type: 'text', text: 'ใช้คำสั่งนี้ในกลุ่มเท่านั้น' }]);
    setConfig('GROUP_ID', src.groupId);
    return reply(rt, [{ type: 'text', text: '✅ ตั้งกลุ่มนี้เป็นห้องรับสรุปอัตโนมัติแล้ว' }]);
  }
  if ((m = t.match(new RegExp('^ตั้งงบ\\s+(.+?)\\s+' + AMOUNT_RE + '$')))) {
    if (!requireAdmin_(ev)) return;
    var c = setBudget(m[1], num_(m[2]));
    return reply(rt, [{ type: 'text', text: c ? '✅ ตั้งงบ ' + c.name + ' = ' + money(c.budget) + '/เดือน' : 'ไม่พบหมวด "' + m[1] + '" (พิมพ์ "หมวด" เพื่อดูรายชื่อ)' }]);
  }
  if ((m = t.match(/^(export|ส่งออก)(?:\s+(\d{4})-(\d{1,2}))?$/i))) {
    if (!requireAdmin_(ev)) return;
    var d = m[2] ? new Date(Number(m[2]), Number(m[3]) - 1, 1) : new Date();
    var file = exportMonth(d);
    return reply(rt, [{ type: 'text', text: '📁 ส่งออก ' + file.month + ' (' + file.count + ' รายการ)\n' + file.url }]);
  }

  // ข้อความอื่นในกลุ่ม = แชทปกติของทีม → ไม่ตอบ
  if (!inGroup) reply(rt, [{ type: 'text', text: 'ส่งรูปสลิปมาได้เลย 📷 หรือพิมพ์ "วิธีใช้" เพื่อดูคำสั่ง' }]);
}

function naturalEntry_(text) {
  var m = String(text || '').match(/^(.+?)\s+([\d,]+(?:\.\d+)?)\s*(บาท|thb|usd|\$)?$/i);
  if (!m) return null;
  var note = m[1].trim();
  var head = note.toLowerCase();
  var expense = /^(ค่า|จ่าย|ชำระ|ซื้อ|โอนจ่าย|รายจ่าย)/.test(head);
  var income = /^(รับ|รายรับ|ลูกค้า|โอนเข้า|ได้เงิน|ขาย)/.test(head);
  if (!expense && !income) return null;
  return {
    sign: income ? '+' : '-',
    currency: /usd|\$/i.test(m[3] || '') ? 'USD' : '',
    amount: m[2],
    note: note
  };
}

function num_(s) {
  return Number(String(s).replace(/,/g, '')) || 0;
}

function isAdmin_(user) {
  return user.role === 'admin';
}

function requireAdmin_(ev) {
  var u = touchUser_(ev.source);
  if (isAdmin_(u)) return u;
  reply(ev.replyToken, [{ type: 'text', text: '🔒 คำสั่งนี้สำหรับแอดมินเท่านั้น' + (hasAnyAdmin_() ? '' : '\n(ยังไม่มีแอดมิน: พิมพ์ "แอดมิน <รหัส>" รหัสอยู่ในชีต Config)') }]);
  return null;
}

function canApprove_(user) {
  return getConfig().APPROVE_MODE === 'anyone' || isAdmin_(user);
}

/** แก้ไขได้: แอดมิน หรือคนส่ง (ตอนยังรออนุมัติ) */
function canEdit_(user, tx) {
  return isAdmin_(user) || (tx.status === ST_PENDING && tx.byId === user.userId);
}

// ---------- บันทึกเอง ----------

function manualEntry_(ev, sign, usd, amountStr, rest) {
  var user = touchUser_(ev.source);
  var type = (sign === '+' || sign === 'รับ') ? INCOME : EXPENSE;
  var note = String(rest || '').trim();
  var currency = usd ? 'USD' : 'THB';
  if (/(usd|dollar|ดอลลาร์)/i.test(note)) currency = 'USD';

  // #หมวด และ @กระเป๋า
  var catName = '';
  var wallet = getConfig().DEFAULT_WALLET || 'บัญชีหลัก';
  note = note.replace(/#(\S+)/, function (_, c) { catName = c; return ''; });
  note = note.replace(/@(\S+)/, function (_, w) { wallet = w; return ''; }).trim();

  var cat = catName ? findCategory(catName, type) : null;
  var auto = isAdmin_(user);
  var now = new Date();
  var tx = addTx({
    date: now,
    type: type,
    amount: num_(amountStr),
    currency: currency,
    category: cat ? cat.name : guessCategory(note + ' ' + catName, type),
    wallet: wallet,
    note: note,
    status: auto ? ST_APPROVED : ST_PENDING,
    by: user.name,
    byId: user.userId,
    approvedBy: auto ? user.name : '',
    approvedAt: auto ? now : '',
    source: 'manual'
  });
  var msgs = [cardMsg(tx)];
  if (auto) {
    var w = budgetWarning_(tx);
    if (w) msgs.push({ type: 'text', text: w });
  }
  reply(ev.replyToken, msgs);
}

// ---------- อนุมัติ / แก้ไข ----------

function approveCmd_(ev, id, ok) {
  var user = touchUser_(ev.source);
  var tx = findTx(id);
  if (!tx) return reply(ev.replyToken, [{ type: 'text', text: 'ไม่พบรายการ ' + id }]);
  var isAdmin = canApprove_(user);
  var canCancelOwn = !ok && tx.status === ST_PENDING && tx.byId === user.userId;
  if (!isAdmin && !canCancelOwn) {
    return reply(ev.replyToken, [{ type: 'text', text: '🔒 เฉพาะแอดมินที่อนุมัติได้' + (hasAnyAdmin_() ? '' : '\n(ยังไม่มีแอดมิน: พิมพ์ "แอดมิน <รหัส>" รหัสอยู่ในชีต Config)') }]);
  }
  if (tx.status !== ST_PENDING) {
    return reply(ev.replyToken, [{ type: 'text', text: tx.id + ' ' + tx.status + 'ไปแล้ว' + (tx.approvedBy ? ' โดย ' + tx.approvedBy : '') }]);
  }
  tx = updateTx(tx.id, { status: ok ? ST_APPROVED : ST_REJECTED, approvedBy: ok ? user.name : '', approvedAt: ok ? new Date() : '' });
  var action = ok ? '✅ อนุมัติ ' : (canCancelOwn ? '🗑 ยกเลิก ' : '❌ ปฏิเสธ ');
  var line = action + tx.id + '  ' + (tx.type === INCOME ? '+' : '-') + money(tx.amount, tx.currency) +
    '  ' + tx.category + '\nโดย ' + user.name;
  if (ok) {
    var w = budgetWarning_(tx);
    if (w) line += '\n\n' + w;
  }
  reply(ev.replyToken, [{ type: 'text', text: line }]);
}

function approveAll_(ev) {
  var user = touchUser_(ev.source);
  if (!isAdmin_(user)) return reply(ev.replyToken, [{ type: 'text', text: '🔒 คำสั่งนี้สำหรับแอดมินเท่านั้น' }]);
  var pending = readAllTx().filter(function (t) { return t.status === ST_PENDING; });
  var now = new Date();
  var sum = { inc: 0, exp: 0 };
  pending.forEach(function (t) {
    updateTx(t.id, { status: ST_APPROVED, approvedBy: user.name, approvedAt: now });
    if (t.type === INCOME) sum.inc += t.thb; else sum.exp += t.thb;
  });
  reply(ev.replyToken, [{
    type: 'text', text: pending.length
      ? '✅ อนุมัติทั้งหมด ' + pending.length + ' รายการ\nรับ ' + money(sum.inc) + ' | จ่าย ' + money(sum.exp)
      : 'ไม่มีรายการรออนุมัติ 🎉'
  }]);
}

function editCmd_(ev, id, patch) {
  var user = touchUser_(ev.source);
  var tx = findTx(id);
  if (!tx) return reply(ev.replyToken, [{ type: 'text', text: 'ไม่พบรายการ ' + id }]);
  if (!canEdit_(user, tx)) return reply(ev.replyToken, [{ type: 'text', text: '🔒 แก้ได้เฉพาะคนส่ง (ตอนรออนุมัติ) หรือแอดมิน' }]);
  Object.keys(patch).forEach(function (k) { if (patch[k] === undefined) delete patch[k]; });
  tx = updateTx(tx.id, patch);
  reply(ev.replyToken, [{ type: 'text', text: '✏️ แก้ไข ' + tx.id + ' แล้ว' }, cardMsg(tx)]);
}

function setCategoryCmd_(ev, id, name) {
  var tx = findTx(id);
  if (!tx) return reply(ev.replyToken, [{ type: 'text', text: 'ไม่พบรายการ ' + id }]);
  var c = findCategory(name, tx.type);
  if (!c) return reply(ev.replyToken, [{ type: 'text', text: 'ไม่พบหมวด "' + name + '"\n\n' + categoriesText_() }]);
  editCmd_(ev, id, { category: c.name });
}

function replyPending_(rt) {
  var pending = readAllTx().filter(function (t) { return t.status === ST_PENDING; });
  if (!pending.length) return reply(rt, [{ type: 'text', text: 'ไม่มีรายการรออนุมัติ 🎉' }]);
  var shown = pending.slice(-10).reverse();
  var msgs = [flexMsg('รออนุมัติ ' + pending.length + ' รายการ', { type: 'carousel', contents: shown.map(function (t) { return txCard(t); }) })];
  var sumIn = 0, sumOut = 0;
  pending.forEach(function (t) { if (t.type === INCOME) sumIn += t.thb; else sumOut += t.thb; });
  msgs.unshift({
    type: 'text', text: '⏳ รออนุมัติ ' + pending.length + ' รายการ\nรับ ' + money(sumIn) + ' | จ่าย ' + money(sumOut) +
      (pending.length > 10 ? '\n(แสดง 10 รายการล่าสุด)' : '') + '\nแอดมินพิมพ์ "อนุมัติทั้งหมด" ได้'
  });
  reply(rt, msgs);
}

// ---------- postback (ปุ่มบนการ์ด) ----------

function handlePostback_(ev) {
  var p = {};
  String(ev.postback.data || '').split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  });
  var rt = ev.replyToken;
  switch (p.a) {
    case 'retry': return handleRetrySlip_(ev, p.f);
    case 'ok': return approveCmd_(ev, p.id, true);
    case 'no': return approveCmd_(ev, p.id, false);
    case 'cat': {
      var tx = findTx(p.id);
      if (!tx) return reply(rt, [{ type: 'text', text: 'ไม่พบรายการ' }]);
      var user = touchUser_(ev.source);
      if (!canEdit_(user, tx)) return reply(rt, [{ type: 'text', text: '🔒 แก้ได้เฉพาะคนส่ง (ตอนรออนุมัติ) หรือแอดมิน' }]);
      return reply(rt, [{ type: 'text', text: 'เลือกหมวดของ ' + tx.id + ' 👇', quickReply: categoryQuickReply(tx) }]);
    }
    case 'setcat': return setCategoryCmd_(ev, p.id, p.c);
    case 'flip': {
      var t2 = findTx(p.id);
      if (!t2) return reply(rt, [{ type: 'text', text: 'ไม่พบรายการ' }]);
      var newType = t2.type === INCOME ? EXPENSE : INCOME;
      var keep = findCategory(t2.category, newType);
      return editCmd_(ev, p.id, { type: newType, category: keep ? keep.name : guessCategory(t2.note, newType) });
    }
  }
}

// ---------- ข้อความช่วยเหลือ ----------

function welcomeText_() {
  return '👋 สวัสดีครับ ผมคือบอทบัญชีของ' + (getConfig().BUSINESS_NAME || 'เพจ EA') + '\n\n' +
    '📷 ส่งรูปสลิป/ใบเสร็จเข้ามาได้เลย ผมจะอ่านยอดให้ แล้วแอดมินกดอนุมัติเพื่อบันทึกลงบัญชี\n\n' +
    'พิมพ์ "วิธีใช้" เพื่อดูคำสั่งทั้งหมด';
}

function manualHelpText_() {
  return '✍️ บันทึกเอง (พิมพ์ในแชท)\n\n' +
    '-500 ค่าแอด          → รายจ่าย 500\n' +
    '+1500 ขาย EA         → รายรับ 1,500\n' +
    'ค่าแอด 1,650 บาท     → รายจ่าย 1,650\n' +
    'ลูกค้าโอน 2,990 บาท  → รายรับ 2,990\n' +
    '-$50 facebook        → รายจ่าย 50 USD\n' +
    'จ่าย 300 ค่าเน็ต      → รายจ่าย (แชท 1:1)\n' +
    'รับ 2000 VIP          → รายรับ (แชท 1:1)\n\n' +
    'ในกลุ่มใช้ + / - หรือพิมพ์ ค่าแอด 1,650 บาท ได้\n' +
    'ระบุหมวด: ใส่ #ชื่อหมวด  เช่น  -900 #VPS\n' +
    'ระบุกระเป๋า: ใส่ @ชื่อ  เช่น  -200 ค่าแอด @บัตรเครดิต\n\n' +
    'ถ้าไม่ใส่หมวด ระบบจะเดาจากคำในข้อความ';
}

function helpText_() {
  return '📖 คำสั่งทั้งหมด\n\n' +
    '📷 ส่งรูปสลิป/ใบเสร็จ → อ่านยอดอัตโนมัติ\n' +
    '✍️ -500 ค่าแอด / +1500 ขาย EA → บันทึกเอง\n\n' +
    '📊 สรุป | สรุปวันนี้ | สรุปเดือน | สรุปเดือน 2026-09\n' +
    '📈 แดชบอร์ด\n' +
    '⏳ รออนุมัติ\n' +
    '🏷 หมวด | งบ\n' +
    '🔎 ดู T0001\n\n' +
    '✏️ แก้ไข (คนส่งหรือแอดมิน)\n' +
    'แก้ T0001 450\n' +
    'หมวด T0001 ค่าโฆษณา\n' +
    'โน้ต T0001 แคมเปญ ต.ค.\n' +
    'กระเป๋า T0001 บัตรเครดิต\n\n' +
    '👑 แอดมิน\n' +
    'อนุมัติ T0001 | ปฏิเสธ T0001 | อนุมัติทั้งหมด\n' +
    'ตั้งงบ ค่าโฆษณา 20000\n' +
    'export | export 2026-09\n' +
    'ตั้งกลุ่มนี้ (ห้องรับสรุปอัตโนมัติ)\n' +
    'แอดมิน <รหัส> (ลงทะเบียนเป็นแอดมิน)\n' +
    'ผู้ส่งยกเลิกรายการที่ตัวเองส่งได้ ขณะยังรออนุมัติ';
}

function categoriesText_() {
  var lines = ['🏷 หมวดรายจ่าย'];
  getCategories(EXPENSE).forEach(function (c) { lines.push('• ' + c.name + (c.budget ? '  (งบ ' + money(c.budget) + ')' : '')); });
  lines.push('', '🏷 หมวดรายรับ');
  getCategories(INCOME).forEach(function (c) { lines.push('• ' + c.name); });
  lines.push('', 'เพิ่ม/แก้หมวดได้ที่ชีต Categories');
  return lines.join('\n');
}

// ===== Summary.gs =====
/** สรุปยอด งบประมาณ ส่งออก และงานตั้งเวลา */

function monthStart_(d) {
  d = d || new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function nextMonth_(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function dayStart_(d) {
  d = d || new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function inRange_(t, from, to) {
  return t.date instanceof Date && t.date >= from && t.date < to;
}

/** รวมยอด (เฉพาะที่อนุมัติแล้ว) */
function stats_(all, from, to) {
  var s = { inc: 0, exp: 0, count: 0, byCat: {}, byWallet: {} };
  all.forEach(function (t) {
    if (t.status !== ST_APPROVED || !inRange_(t, from, to)) return;
    s.count++;
    if (t.type === INCOME) s.inc += t.thb; else s.exp += t.thb;
    var key = t.type + '|' + t.category;
    s.byCat[key] = (s.byCat[key] || 0) + t.thb;
    var w = t.wallet || '-';
    s.byWallet[w] = s.byWallet[w] || { inc: 0, exp: 0 };
    s.byWallet[w][t.type === INCOME ? 'inc' : 'exp'] += t.thb;
  });
  s.net = s.inc - s.exp;
  return s;
}

function catList_(s, type) {
  return Object.keys(s.byCat)
    .filter(function (k) { return k.indexOf(type + '|') === 0; })
    .map(function (k) { return { name: k.split('|')[1], value: s.byCat[k] }; })
    .sort(function (a, b) { return b.value - a.value; });
}

function pendingCount_(all) {
  return all.filter(function (t) { return t.status === ST_PENDING; }).length;
}

function todayText_(all) {
  all = all || readAllTx();
  var from = dayStart_();
  var s = stats_(all, from, new Date(from.getTime() + 86400000));
  return '📅 วันนี้ ' + fmtDate(from, 'dd/MM/yyyy') + '\n' +
    '💰 รับ ' + money(s.inc) + '\n' +
    '💸 จ่าย ' + money(s.exp) + '\n' +
    (s.net >= 0 ? '🟢' : '🔴') + ' สุทธิ ' + money(s.net) + '  (' + s.count + ' รายการ)';
}

function monthText_(d, all) {
  all = all || readAllTx();
  var from = monthStart_(d);
  var s = stats_(all, from, nextMonth_(from));
  var lines = [
    '🗓 เดือน ' + fmtDate(from, 'MM/yyyy'),
    '💰 รับ ' + money(s.inc),
    '💸 จ่าย ' + money(s.exp),
    (s.net >= 0 ? '🟢 กำไร ' : '🔴 ขาดทุน ') + money(Math.abs(s.net)) + '  (' + s.count + ' รายการ)'
  ];
  var top = catList_(s, EXPENSE).slice(0, 5);
  if (top.length) {
    lines.push('', 'รายจ่ายสูงสุด');
    top.forEach(function (c) { lines.push('• ' + c.name + ' ' + money(c.value)); });
  }
  var inc = catList_(s, INCOME).slice(0, 3);
  if (inc.length) {
    lines.push('', 'รายรับหลัก');
    inc.forEach(function (c) { lines.push('• ' + c.name + ' ' + money(c.value)); });
  }
  var p = pendingCount_(all);
  if (p) lines.push('', '⏳ รออนุมัติ ' + p + ' รายการ');
  return lines.join('\n');
}

// ---------- งบประมาณ ----------

function spentThisMonth_(category, all) {
  var from = monthStart_();
  return stats_(all || readAllTx(), from, nextMonth_(from)).byCat[EXPENSE + '|' + category] || 0;
}

/** เตือนเมื่อหมวดรายจ่ายใช้เกิน 80% / 100% ของงบเดือนนี้ */
function budgetWarning_(tx) {
  if (tx.type !== EXPENSE || tx.status !== ST_APPROVED) return '';
  var c = findCategory(tx.category, EXPENSE);
  if (!c || !c.budget) return '';
  var spent = spentThisMonth_(c.name);
  var pct = Math.round(spent / c.budget * 100);
  if (pct >= 100) return '🚨 ' + c.name + ' เกินงบแล้ว! ใช้ไป ' + money(spent) + ' / ' + money(c.budget) + ' (' + pct + '%)';
  if (pct >= 80) return '⚠️ ' + c.name + ' ใช้ไป ' + pct + '% ของงบ (' + money(spent) + ' / ' + money(c.budget) + ')';
  return '';
}

function budgetText_() {
  var all = readAllTx();
  var cats = getCategories(EXPENSE).filter(function (c) { return c.budget > 0; });
  if (!cats.length) return 'ยังไม่ได้ตั้งงบ\nแอดมินพิมพ์ เช่น  ตั้งงบ ค่าโฆษณา 20000';
  var lines = ['🎯 งบเดือนนี้'];
  cats.forEach(function (c) {
    var spent = spentThisMonth_(c.name, all);
    var pct = Math.round(spent / c.budget * 100);
    var icon = pct >= 100 ? '🔴' : pct >= 80 ? '🟠' : '🟢';
    lines.push(icon + ' ' + c.name + '\n    ' + money(spent) + ' / ' + money(c.budget) + ' (' + pct + '%)');
  });
  return lines.join('\n');
}

// ---------- งานตั้งเวลา ----------

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['dailyJob', 'monthlyJob'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  var hour = Number(getConfig().DAILY_SUMMARY_HOUR);
  if (isNaN(hour) || hour < 0 || hour > 23) hour = 21;
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(hour).inTimezone(TZ).create();
  ScriptApp.newTrigger('monthlyJob').timeBased().onMonthDay(1).atHour(9).inTimezone(TZ).create();
  safeAlert_('ตั้งเวลาเรียบร้อย ✅\n• สรุปรายวัน ประมาณ ' + hour + ':00 น.\n• สรุปเดือนก่อน วันที่ 1 ประมาณ 09:00 น.');
}

/** สรุปรายวันเข้ากลุ่ม — ส่งเฉพาะวันที่มีความเคลื่อนไหวหรือมีรายการค้าง (ประหยัดโควต้า push) */
function dailyJob() {
  var cfg = getConfig();
  if (String(cfg.DAILY_SUMMARY).toLowerCase() !== 'on' || !cfg.GROUP_ID) return;
  var all = readAllTx();
  var from = dayStart_();
  var today = all.filter(function (t) { return t.createdAt instanceof Date && t.createdAt >= from; }).length;
  var pending = pendingCount_(all);
  if (!today && !pending) return;

  var text = '🌙 สรุปประจำวัน — ' + (cfg.BUSINESS_NAME || '') + '\n\n' + todayText_(all) + '\n\n' + monthText_(null, all);
  var warn = budgetText_();
  if (warn.indexOf('🔴') >= 0 || warn.indexOf('🟠') >= 0) text += '\n\n' + warn;
  var url = dashboardUrl_();
  if (url) text += '\n\n📈 ' + url;
  push(cfg.GROUP_ID, [{ type: 'text', text: text.slice(0, 4900) }]);
}

/** วันที่ 1: สรุปเดือนที่แล้ว */
function monthlyJob() {
  var cfg = getConfig();
  if (!cfg.GROUP_ID) return;
  var now = new Date();
  var last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var text = '📆 ปิดยอดเดือน ' + fmtDate(last, 'MM/yyyy') + '\n\n' + monthText_(last);
  var url = dashboardUrl_(fmtDate(last, 'yyyy-MM'));
  if (url) text += '\n\n📈 ' + url;
  push(cfg.GROUP_ID, [{ type: 'text', text: text.slice(0, 4900) }]);
}

// ---------- ส่งออก ----------

function exportMonth(d) {
  var from = monthStart_(d);
  var to = nextMonth_(from);
  var month = fmtDate(from, 'yyyy-MM');
  var rows = readAllTx().filter(function (t) { return inRange_(t, from, to) && t.status !== ST_REJECTED; })
    .sort(function (a, b) { return a.date - b.date; });

  var ss = SpreadsheetApp.create('EA Finance ' + month);
  var sh = ss.getSheets()[0].setName(month);
  sh.getRange(1, 1, 1, TX_HEADERS.length).setValues([TX_HEADERS]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, TX_KEYS.length).setValues(rows.map(txToRow_));
  sh.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');
  sh.getRange('D:F').setNumberFormat('#,##0.00');
  sh.setFrozenRows(1);

  var s = stats_(rows, from, to);
  var sum = ss.insertSheet('สรุป');
  var data = [['รายการ', 'จำนวน (THB)'], ['รายรับ', s.inc], ['รายจ่าย', s.exp], ['สุทธิ', s.net], ['', '']];
  catList_(s, INCOME).forEach(function (c) { data.push(['รับ: ' + c.name, c.value]); });
  catList_(s, EXPENSE).forEach(function (c) { data.push(['จ่าย: ' + c.name, c.value]); });
  sum.getRange(1, 1, data.length, 2).setValues(data);
  sum.getRange('B:B').setNumberFormat('#,##0.00');
  sum.getRange(1, 1, 1, 2).setFontWeight('bold');

  var file = DriveApp.getFileById(ss.getId());
  file.moveTo(slipFolder_());
  return { url: ss.getUrl(), count: rows.length, month: month };
}

// ---------- ข้อมูลแดชบอร์ด ----------

function getDashboardData(monthStr) {
  var m = String(monthStr || '').match(/^(\d{4})-(\d{1,2})$/);
  var from = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : monthStart_();
  var to = nextMonth_(from);
  var all = readAllTx();
  var s = stats_(all, from, to);

  var days = Math.round((to - from) / 86400000);
  var daily = [];
  for (var i = 0; i < days; i++) daily.push({ d: i + 1, inc: 0, exp: 0 });
  all.forEach(function (t) {
    if (t.status !== ST_APPROVED || !inRange_(t, from, to)) return;
    daily[t.date.getDate() - 1][t.type === INCOME ? 'inc' : 'exp'] += t.thb;
  });

  var trend = [];
  for (var k = 5; k >= 0; k--) {
    var a = new Date(from.getFullYear(), from.getMonth() - k, 1);
    var st = stats_(all, a, nextMonth_(a));
    trend.push({ m: fmtDate(a, 'MM/yy'), inc: st.inc, exp: st.exp, net: st.net });
  }

  var budgets = getCategories(EXPENSE).filter(function (c) { return c.budget > 0; }).map(function (c) {
    return { name: c.name, budget: c.budget, spent: s.byCat[EXPENSE + '|' + c.name] || 0 };
  });

  var recent = all.filter(function (t) { return inRange_(t, from, to) || t.status === ST_PENDING; })
    .sort(function (a, b) { return b.date - a.date; })
    .slice(0, 40)
    .map(function (t) {
      return { id: t.id, date: fmtDate(t.date, 'dd/MM HH:mm'), type: t.type, amount: t.thb, category: t.category, note: t.note || t.receiver || t.sender || '', status: t.status, by: t.by };
    });

  return {
    business: getConfig().BUSINESS_NAME || 'EA Finance',
    month: fmtDate(from, 'yyyy-MM'),
    monthLabel: fmtDate(from, 'MM/yyyy'),
    prev: fmtDate(new Date(from.getFullYear(), from.getMonth() - 1, 1), 'yyyy-MM'),
    next: fmtDate(to, 'yyyy-MM'),
    inc: s.inc, exp: s.exp, net: s.net, count: s.count,
    pending: pendingCount_(all),
    expCats: catList_(s, EXPENSE),
    incCats: catList_(s, INCOME),
    wallets: Object.keys(s.byWallet).map(function (w) { return { name: w, inc: s.byWallet[w].inc, exp: s.byWallet[w].exp }; }),
    daily: daily,
    trend: trend,
    budgets: budgets,
    recent: recent,
    updated: fmtDate(new Date())
  };
}

function renderDashboard_(month) {
  var t = HtmlService.createTemplateFromFile('Dashboard');
  var data = getDashboardData(month);
  t.dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
  t.baseUrl = dashboardUrl_();
  return t.evaluate()
    .setTitle('แดชบอร์ด ' + data.business)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===== RichMenu.gs =====
/**
 * สร้าง Rich Menu 6 ปุ่ม (2500x1686)
 * ก่อนรัน: อัปโหลดไฟล์ richmenu.png (จากโฟลเดอร์ richmenu/ ใน repo) ขึ้น Google Drive
 * หมายเหตุ: Rich Menu แสดงในแชท 1:1 กับ OA เท่านั้น LINE ไม่แสดงในห้องกลุ่ม
 */
function setupRichMenu() {
  var dash = dashboardUrl_();
  if (!dash) {
    safeAlert_('ใส่ WEB_APP_URL ในชีต Config ก่อน (ปุ่มแดชบอร์ดต้องใช้ลิงก์นี้)');
    return;
  }
  var files = DriveApp.getFilesByName('richmenu.png');
  if (!files.hasNext()) {
    safeAlert_('ไม่พบไฟล์ richmenu.png ใน Google Drive\nอัปโหลดรูปจากโฟลเดอร์ richmenu/ ของโปรเจกต์ขึ้น Drive ก่อน');
    return;
  }
  var image = files.next().getBlob();

  var W = 2500, H = 1686, cw = [833, 834, 833], ch = H / 2;
  var actions = [
    { type: 'uri', label: 'ส่งสลิป', uri: 'https://line.me/R/nv/cameraRoll/multi' },
    { type: 'message', label: 'บันทึกเอง', text: 'วิธีบันทึก' },
    { type: 'uri', label: 'แดชบอร์ด', uri: dash },
    { type: 'message', label: 'สรุปยอด', text: 'สรุป' },
    { type: 'message', label: 'รออนุมัติ', text: 'รออนุมัติ' },
    { type: 'message', label: 'วิธีใช้', text: 'วิธีใช้' }
  ];
  var areas = actions.map(function (a, i) {
    var c = i % 3, r = Math.floor(i / 3);
    var x = c === 0 ? 0 : (c === 1 ? cw[0] : cw[0] + cw[1]);
    return { bounds: { x: x, y: r * ch, width: cw[c], height: ch }, action: a };
  });

  // จำเมนูเก่าไว้ลบหลังเมนูใหม่พร้อมใช้งานแล้ว
  var old = getConfig().RICHMENU_ID;

  var created = lineFetch_('/v2/bot/richmenu', {
    size: { width: W, height: H },
    selected: true,
    name: 'EA Finance Menu',
    chatBarText: 'เมนูบัญชี',
    areas: areas
  });
  var id = created.richMenuId;

  var up = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/richmenu/' + id + '/content', {
    method: 'post',
    contentType: 'image/png',
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: image.getBytes(),
    muteHttpExceptions: true
  });
  if (up.getResponseCode() !== 200) throw new Error('อัปโหลดรูป Rich Menu ไม่สำเร็จ: ' + up.getContentText());

  lineFetch_('/v2/bot/user/all/richmenu/' + id, null, 'post');

  // ตั้งเมนูใหม่ก่อน แล้วค่อยลบเมนูเก่า เพื่อไม่ให้แชทว่างถ้าการสร้าง/อัปโหลดล้มเหลว
  // หลังตั้ง default ใหม่แล้ว เมนูเก่าจะไม่ใช่ default จึงลบได้ตามลำดับของ LINE API
  if (old && old !== id) {
    try { lineFetch_('/v2/bot/richmenu/' + old, null, 'delete'); } catch (e) {}
  }
  setConfig('RICHMENU_ID', id);
  safeAlert_('สร้าง Rich Menu สำเร็จ ✅\nเปิดแชท 1:1 กับ LINE OA เพื่อดูเมนู (อาจต้องปิดแล้วเปิดแชทใหม่)');
}

// ===== Code.gs =====
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
  // ContentService redirects web-app responses to script.googleusercontent.com (302),
  // which LINE webhook verification rejects. HtmlService returns the response directly.
  return HtmlService.createHtmlOutput(String(s));
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
