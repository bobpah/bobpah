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
