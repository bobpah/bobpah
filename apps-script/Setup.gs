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
    ['GEMINI_MODEL', 'gemini-flash-latest', 'ถ้าใช้ไม่ได้ ลอง gemini-2.5-flash'],
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
