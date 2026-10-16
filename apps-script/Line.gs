/** LINE Messaging API + Flex message */

function lineFetch_(path, payload, method, host) {
  var token = getConfig().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('ยังไม่ได้ใส่ LINE_CHANNEL_ACCESS_TOKEN ในชีต Config');
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
    headers: { Authorization: 'Bearer ' + getConfig().LINE_CHANNEL_ACCESS_TOKEN },
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
        btn_('❌ ปฏิเสธ', 'a=no&id=' + tx.id, 'secondary')
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
