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
