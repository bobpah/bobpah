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
