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

  // ลบเมนูเก่าที่เคยสร้าง
  var old = getConfig().RICHMENU_ID;
  if (old) {
    try { lineFetch_('/v2/bot/richmenu/' + old, null, 'delete'); } catch (e) {}
  }

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
    headers: { Authorization: 'Bearer ' + getConfig().LINE_CHANNEL_ACCESS_TOKEN },
    payload: image.getBytes(),
    muteHttpExceptions: true
  });
  if (up.getResponseCode() !== 200) throw new Error('อัปโหลดรูป Rich Menu ไม่สำเร็จ: ' + up.getContentText());

  lineFetch_('/v2/bot/user/all/richmenu/' + id, null, 'post');
  setConfig('RICHMENU_ID', id);
  safeAlert_('สร้าง Rich Menu สำเร็จ ✅\nเปิดแชท 1:1 กับ LINE OA เพื่อดูเมนู (อาจต้องปิดแล้วเปิดแชทใหม่)');
}
