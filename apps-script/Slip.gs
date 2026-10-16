/** อ่านสลิป/ใบเสร็จด้วย Gemini (ฟรีจาก Google AI Studio) */

function geminiJson_(prompt, blob) {
  var cfg = getConfig();
  if (!cfg.GEMINI_API_KEY) throw new Error('ยังไม่ได้ใส่ GEMINI_API_KEY ในชีต Config');
  var model = cfg.GEMINI_MODEL || 'gemini-flash-latest';
  var parts = [{ text: prompt }];
  if (blob) {
    parts.push({ inline_data: { mime_type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } });
  }
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': cfg.GEMINI_API_KEY },
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  var data = JSON.parse(res.getContentText());
  var cand = (data.candidates || [])[0];
  var text = cand && cand.content && cand.content.parts
    ? cand.content.parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('')
    : '';
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(text);
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

  if ((blob.getContentType() || '').indexOf('pdf') >= 0 && blob.getBytes().length > 15 * 1024 * 1024) {
    if (!inGroup) reply(ev.replyToken, [{ type: 'text', text: 'ไฟล์ใหญ่เกินไป' }]);
    return;
  }

  var r;
  try {
    r = readSlip(blob);
  } catch (e) {
    logError_('gemini', e);
    reply(ev.replyToken, [{ type: 'text', text: '⚠️ อ่านสลิปไม่สำเร็จ (' + String(e.message).slice(0, 120) + ')\nลองส่งใหม่ หรือพิมพ์บันทึกเอง เช่น  -500 ค่าแอด' }]);
    return;
  }

  // ในกลุ่ม: ถ้าไม่ใช่เอกสารการเงิน (รูปทั่วไป) ให้เงียบไว้ ไม่รบกวนแชท
  if (!r || !r.is_financial || !(Number(r.amount) > 0)) {
    if (!inGroup) reply(ev.replyToken, [{ type: 'text', text: 'รูปนี้ไม่น่าจะเป็นสลิป/ใบเสร็จ 🤔\nถ้าใช่ ลองพิมพ์บันทึกเอง เช่น  -500 ค่าแอด' }]);
    return;
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
  reply(ev.replyToken, [cardMsg(tx, { warning: warning })]);
}
