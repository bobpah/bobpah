/**
 * จำลองการทำงานของบอทแบบออฟไลน์ (mock Google Sheet / LINE / Gemini)
 * รัน: node tests/simulate.js
 */
process.env.TZ = 'Asia/Bangkok';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ---------- in-memory spreadsheet ----------
function makeSheet(name) {
  const data = [];
  const width = () => Math.max(0, ...data.map((r) => r.length));
  const ensure = (r, c) => {
    while (data.length < r) data.push([]);
    for (let i = 0; i < r; i++) while (data[i].length < c) data[i].push('');
  };
  const range = (r, c, nr, nc) => {
    if (typeof r === 'string') return chain({});
    nr = nr || 1; nc = nc || 1;
    let self;
    return (self = chain({
      getValues: () => { ensure(r + nr - 1, c + nc - 1); return data.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)); },
      setValues: (v) => { ensure(r + nr - 1, c + nc - 1); v.forEach((row, i) => row.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; })); return self; },
      setValue: (x) => { ensure(r, c); data[r - 1][c - 1] = x; return self; }
    }));
  };
  function chain(o) {
    return new Proxy(o, { get: (t, k) => (k in t ? t[k] : () => chain(t)) });
  }
  const sh = {
    _data: data,
    getName: () => name,
    setName: () => sh,
    getLastRow: () => { let n = data.length; while (n && data[n - 1].every((x) => x === '')) n--; return n; },
    getRange: range,
    getDataRange: () => range(1, 1, data.length, width()),
    appendRow: (row) => { const n = sh.getLastRow(); data.length = n; data.push(row.slice()); },
    setFrozenRows: () => sh,
    setColumnWidth: () => sh
  };
  return sh;
}
function makeSpreadsheet() {
  const sheets = {};
  return {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: () => {},
    setSpreadsheetTimeZone: () => {},
    getId: () => 'ss1',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/x',
    _sheets: sheets
  };
}

// ---------- services ----------
const ss = makeSpreadsheet();
const sent = [];
let geminiReply = {};
let oauthCalls = 0;
const props = {};
const cache = {};

const pad = (n) => String(n).padStart(2, '0');
const ctx = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, create: () => { const s = makeSpreadsheet(); s.insertSheet('Sheet1'); return s; }, getUi: () => { throw new Error('no ui'); } },
  Utilities: {
    formatDate: (d, tz, p) => p.replace('yyyy', d.getFullYear()).replace('yy', String(d.getFullYear()).slice(2))
      .replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())).replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())),
    base64Encode: (b) => Buffer.from(b).toString('base64')
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; }, setProperties: (o) => Object.assign(props, o) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  DriveApp: (() => {
    const folder = { getId: () => 'f1', getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => folder, createFile: () => ({ getUrl: () => 'https://drive.google.com/file/x' }) };
    const richMenuImage = { getBlob: () => ({ getBytes: () => [1, 2, 3] }) };
    return { createFolder: () => folder, getFolderById: () => folder, getFileById: () => ({ moveTo: () => {} }), getFilesByName: () => ({ hasNext: () => true, next: () => richMenuImage }) };
  })(),
  ScriptApp: { getService: () => ({ getUrl: () => '' }) },
  ContentService: { createTextOutput: (s) => s },
  HtmlService: { createHtmlOutput: (s) => ({ kind: 'html', content: String(s) }) },
  UrlFetchApp: {
    fetch: (url, opts) => {
      if (url.includes('/message/') && url.includes('/content')) {
        return { getResponseCode: () => 200, getBlob: () => ({ getContentType: () => 'image/jpeg', getBytes: () => [1, 2, 3], setName() { return this; } }) };
      }
      if (url.includes('/oauth/accessToken')) {
        oauthCalls++;
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'short-tok', expires_in: 2592000 }) };
      }
      if (url.includes('generativelanguage')) {
        const body = { candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply) }] } }] };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
      }
      if (url.endsWith('/v2/bot/richmenu')) {
        sent.push({ url, body: opts.payload ? JSON.parse(opts.payload) : null });
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ richMenuId: 'rm-new' }) };
      }
      if (url.includes('/member/') || url.includes('/profile/')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ displayName: url.includes('Uadmin') ? 'บอส' : 'น้องแอด' }) };
      }
      const body = opts.payload ? (typeof opts.payload === 'string' ? JSON.parse(opts.payload) : opts.payload) : null;
      sent.push({ url, body });
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    }
  }
};
vm.createContext(ctx);
const dir = process.env.SRC_DIR || path.join(__dirname, '..', 'apps-script');
fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));

// ---------- helpers ----------
const G = 'Cgroup1';
let evN = 0;
function post(events) {
  sent.length = 0;
  const r = ctx.doPost({ parameter: { key: ctx.getConfig().WEBHOOK_KEY }, postData: { contents: JSON.stringify({ events }) } });
  assert.deepStrictEqual(r, { kind: 'html', content: 'ok' });
  return sent.map((s) => s.body && s.body.messages).filter(Boolean).flat();
}
const text = (userId, t, type = 'group') => post([{ type: 'message', webhookEventId: 'e' + ++evN, replyToken: 'r', source: { type, groupId: G, userId }, message: { type: 'text', text: t } }]);
const image = (userId) => post([{ type: 'message', webhookEventId: 'e' + ++evN, replyToken: 'r', source: { type: 'group', groupId: G, userId }, message: { type: 'image', id: 'm1' } }]);
const postback = (userId, data) => post([{ type: 'postback', webhookEventId: 'e' + ++evN, replyToken: 'r', source: { type: 'group', groupId: G, userId }, postback: { data } }]);
const txt = (msgs) => msgs.map((m) => m.text || m.altText).join('\n---\n');
const tx = () => ctx.readAllTx();
let pass = 0;
function check(name, fn) { fn(); pass++; console.log('✓', name); }

// ---------- scenarios ----------
ctx.setup();
ctx.setConfig('LINE_CHANNEL_ACCESS_TOKEN', 'tok');
ctx.setConfig('GEMINI_API_KEY', 'gk');
ctx.setConfig('WEB_APP_URL', 'https://script.google.com/macros/s/X/exec');
ctx.setConfig('OWN_ACCOUNT_KEYWORDS', 'บจก. อีเอ เทรด, xxx-1234');
const code = ctx.getConfig().ADMIN_CODE;

check('forbidden without key', () => {
  assert.deepStrictEqual(ctx.doPost({ parameter: {}, postData: { contents: '{}' } }), { kind: 'html', content: 'forbidden' });
});

check('webhook response uses HtmlService (avoids LINE 302 rejection)', () => {
  const r = ctx.doPost({ parameter: { key: ctx.getConfig().WEBHOOK_KEY }, postData: { contents: JSON.stringify({ events: [] }) } });
  assert.deepStrictEqual(r, { kind: 'html', content: 'ok' });
});

check('group id remembered + admin register', () => {
  let m = text('Uadmin', 'แอดมิน 000');
  assert.match(txt(m), /ไม่ถูกต้อง/);
  m = text('Uadmin', 'แอดมิน ' + code);
  assert.match(txt(m), /บอส เป็นแอดมินแล้ว/);
  assert.strictEqual(ctx.getConfig().GROUP_ID, G);
});

check('normal group chat is ignored', () => {
  assert.strictEqual(text('Ustaff', 'วันนี้ยิงแอดกี่โมงครับ').length, 0);
  assert.strictEqual(text('Ustaff', 'รับ 2 คนนะ').length, 0);
});

check('standby events are ignored without side effects', () => {
  const before = tx().length;
  const m = post([{ type: 'message', mode: 'standby', webhookEventId: 'standby1', replyToken: 'r', source: { type: 'group', groupId: G, userId: 'Ustaff' }, message: { type: 'text', text: '-999 ค่าแอด' } }]);
  assert.strictEqual(m.length, 0);
  assert.strictEqual(tx().length, before);
});

check('slip (expense, facebook ads in USD) → pending card', () => {
  geminiReply = { is_financial: true, doc_type: 'receipt', amount: 50, currency: 'USD', datetime: '2569-10-15 14:30', receiver_name: 'Meta Platforms', bank: 'Visa', ref: 'FB-123456', memo: 'Facebook ads', direction: 'expense', category: 'ค่าโฆษณา' };
  const m = image('Ustaff');
  assert.match(txt([m[0]]), /กำลังอ่านยอด/);
  assert.ok(m.some((x) => x.type === 'flex'));
  const t = tx()[0];
  assert.strictEqual(t.type, 'รายจ่าย');
  assert.strictEqual(t.category, 'ค่าโฆษณา');
  assert.strictEqual(t.thb, 50 * 33);
  assert.strictEqual(t.status, 'รออนุมัติ');
  assert.strictEqual(t.date.getFullYear(), 2026);
  assert.strictEqual(t.by, 'น้องแอด');
});

check('slip income detected by own account keyword', () => {
  geminiReply = { is_financial: true, doc_type: 'transfer_slip', amount: 2990, currency: 'THB', datetime: '2026-10-16 09:05', sender_name: 'นาย ลูกค้า', receiver_name: 'บจก. อีเอ เทรด', receiver_account: 'xxx-1234', bank: 'KBank', ref: '016289090512ABC', direction: 'expense', category: 'ขาย EA/License' };
  image('Ustaff');
  const t = tx()[1];
  assert.strictEqual(t.type, 'รายรับ');
  assert.strictEqual(t.category, 'ขาย EA/License');
});

check('duplicate slip warned', () => {
  const m = image('Ustaff');
  assert.match(JSON.stringify(m), /สลิปซ้ำกับ T0002/);
});

check('non-financial image acknowledged without transaction', () => {
  const before = tx().length;
  geminiReply = { is_financial: false, amount: 0 };
  const m = image('Ustaff');
  assert.match(txt(m), /กำลังอ่านยอด/);
  assert.strictEqual(tx().length, before);
});

check('staff cannot approve, admin can; budget warning', () => {
  let m = postback('Ustaff', 'a=ok&id=T0001');
  assert.match(txt(m), /เฉพาะแอดมิน/);
  text('Uadmin', 'ตั้งงบ ค่าโฆษณา 1800');
  m = postback('Uadmin', 'a=ok&id=T0001');
  assert.match(txt(m), /อนุมัติ T0001/);
  assert.match(txt(m), /ค่าโฆษณา ใช้ไป 92%/);
  m = postback('Uadmin', 'a=ok&id=T0001');
  assert.match(txt(m), /อนุมัติแล้วไปแล้ว/);
});

check('change category via quick reply + flip type', () => {
  let m = postback('Ustaff', 'a=cat&id=T0003');
  assert.ok(m[0].quickReply.items.length > 0);
  m = postback('Ustaff', 'a=setcat&id=T0003&c=' + encodeURIComponent('ค่าสมาชิก/VIP'));
  assert.strictEqual(ctx.findTx('T0003').category, 'ค่าสมาชิก/VIP');
  postback('Ustaff', 'a=flip&id=T0003');
  assert.strictEqual(ctx.findTx('T0003').type, 'รายจ่าย');
  postback('Uadmin', 'a=no&id=T0003');
  assert.strictEqual(ctx.findTx('T0003').status, 'ปฏิเสธ');
});

check('manual entries', () => {
  text('Ustaff', '-900 ค่า vps contabo');
  let t = tx().slice(-1)[0];
  assert.strictEqual(t.category, 'ค่า VPS/Server');
  assert.strictEqual(t.status, 'รออนุมัติ');
  text('Uadmin', '+1500 ขาย ea @กสิกร');
  t = tx().slice(-1)[0];
  assert.strictEqual(t.type, 'รายรับ');
  assert.strictEqual(t.status, 'อนุมัติแล้ว');
  assert.strictEqual(t.wallet, 'กสิกร');
  text('Ustaff', '-$20 #ซอฟต์แวร์ tradingview');
  t = tx().slice(-1)[0];
  assert.strictEqual(t.currency, 'USD');
  assert.strictEqual(t.category, 'ค่าซอฟต์แวร์/Subscription');
  text('Ustaff', 'จ่าย 300 ค่าเน็ต', 'user');
  assert.strictEqual(tx().slice(-1)[0].category, 'ค่าเน็ต/โทรศัพท์/สาธารณูปโภค');
});

check('sender can cancel own pending entry, not someone elses', () => {
  text('Ustaff', '-111 ค่าแอด');
  const own = tx().slice(-1)[0];
  let m = postback('Ustaff', 'a=no&id=' + own.id);
  assert.match(txt(m), /ยกเลิก/);
  assert.strictEqual(ctx.findTx(own.id).status, 'ปฏิเสธ');

  text('Ustaff', '-222 ค่าแอด');
  const other = tx().slice(-1)[0];
  m = postback('Uother', 'a=no&id=' + other.id);
  assert.match(txt(m), /เฉพาะแอดมิน/);
  assert.strictEqual(ctx.findTx(other.id).status, 'รออนุมัติ');
});

check('edit amount: owner ok, others blocked', () => {
  let m = text('Ustaff', 'แก้ T0004 950');
  assert.strictEqual(ctx.findTx('T0004').amount, 950);
  assert.match(txt(text('Ustaff', 'แก้ T0005 1')), /แก้ได้เฉพาะ/);
  m = text('Uother', 'แก้ T0004 1');
  assert.match(txt(m), /แก้ได้เฉพาะ/);
});

check('pending list + approve all', () => {
  let m = text('Ustaff', 'รออนุมัติ');
  assert.match(txt(m), /รออนุมัติ \d+ รายการ/);
  m = text('Uadmin', 'อนุมัติทั้งหมด');
  assert.match(txt(m), /อนุมัติทั้งหมด/);
  assert.ok(tx().every((t) => t.status !== 'รออนุมัติ'));
});

check('summaries / budget / help / dashboard link', () => {
  let m = text('Ustaff', 'สรุป');
  assert.match(txt(m), /วันนี้/);
  assert.match(txt(m), /เดือน/);
  assert.match(txt(text('Ustaff', 'งบ')), /ค่าโฆษณา/);
  assert.match(txt(text('Ustaff', 'วิธีใช้')), /คำสั่งทั้งหมด/);
  assert.match(txt(text('Ustaff', 'แดชบอร์ด')), /exec\?key=/);
});

check('dashboard data', () => {
  const d = ctx.getDashboardData();
  assert.ok(d.inc > 0 && d.exp > 0);
  assert.strictEqual(d.trend.length, 6);
  assert.ok(d.recent.length > 0);
});

check('daily job pushes to group', () => {
  sent.length = 0;
  ctx.dailyJob();
  assert.strictEqual(sent[0].body.to, G);
  assert.match(sent[0].body.messages[0].text, /สรุปประจำวัน/);
});

check('redelivered event ignored', () => {
  const ev = { type: 'message', webhookEventId: 'dup1', replyToken: 'r', source: { type: 'group', groupId: G, userId: 'Ustaff' }, message: { type: 'text', text: 'สรุป' } };
  assert.strictEqual(post([ev]).length, 1);
  assert.strictEqual(post([ev]).length, 0);
});

check('token issued from channel id/secret and cached', () => {
  ctx.setConfig('LINE_CHANNEL_ACCESS_TOKEN', '');
  ctx.setConfig('LINE_CHANNEL_ID', '1234567890');
  ctx.setConfig('LINE_CHANNEL_SECRET', 'fake-secret');
  assert.strictEqual(ctx.lineToken_(), 'short-tok');
  assert.strictEqual(ctx.lineToken_(), 'short-tok');
  assert.strictEqual(oauthCalls, 1);
  assert.strictEqual(text('Ustaff', 'สรุป').length, 1);
});

check('rich menu replaces old menu after new menu is live', () => {
  sent.length = 0;
  ctx.setConfig('LINE_CHANNEL_ACCESS_TOKEN', 'tok');
  ctx.setConfig('RICHMENU_ID', 'rm-old');
  ctx.setupRichMenu();
  const urls = sent.map((s) => s.url);
  const newDefault = urls.indexOf('https://api.line.me/v2/bot/user/all/richmenu/rm-new');
  const oldDelete = urls.indexOf('https://api.line.me/v2/bot/richmenu/rm-old');
  assert.ok(newDefault >= 0);
  assert.ok(oldDelete > newDefault);
  assert.strictEqual(ctx.getConfig().RICHMENU_ID, 'rm-new');
});

check('natural Thai amount in group is recorded', () => {
  const before = tx().length;
  const m = text('Ustaff', 'ค่าเพล 1650 บาท');
  assert.ok(m.length > 0);
  const t = tx()[before];
  assert.strictEqual(t.type, 'รายจ่าย');
  assert.strictEqual(t.amount, 1650);
  assert.strictEqual(t.note, 'ค่าเพล');
});

console.log(`\nผ่านทั้งหมด ${pass} ชุดทดสอบ ✅`);

// DASH_OUT=/path/data.json node tests/simulate.js → เขียนข้อมูลแดชบอร์ดไว้ทดสอบหน้าเว็บ
if (process.env.DASH_OUT) fs.writeFileSync(process.env.DASH_OUT, JSON.stringify(ctx.getDashboardData()));
