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
