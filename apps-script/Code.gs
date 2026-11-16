/**
 * Cuan! — aplikasi catatan keuangan pribadi
 * File: Code.gs (backend Google Apps Script)
 *
 * Script ini terhubung ke spreadsheet "Cuan! – Catatan Keuangan Wendy".
 * Tampilan aplikasinya ada di GitHub Pages dan memanggil script ini lewat
 * doPost. Semua permintaan dilindungi PIN.
 *
 * Aturan penting:
 * - Kolom dicari berdasarkan NAMA header (bukan posisi), jadi urutan kolom
 *   boleh diubah dan kolom tambahan milikmu tidak akan disentuh.
 * - Data lama tidak pernah diubah, kecuali kamu sendiri mengedit/menghapus
 *   transaksi itu dari aplikasi.
 */

// ID spreadsheet Cuan! (aman juga kalau script ditempel langsung di spreadsheet).
// Isi dengan ID spreadsheet kalau script dibuat terpisah di script.google.com.
const SPREADSHEET_ID = '194H1EifTKLpIRGVXrAOv4ogKhoQ87Kicv86FDOaNals';

const SHEET = {
  IN: 'Pemasukan',
  OUT: 'Pengeluaran',
  CAT: 'Kategori',
  BUDGET: 'Budget',
  GOAL: 'Tabungan',
  GOAL_LOG: 'Tabungan Riwayat',
  DEBT: 'Hutang',
  DEBT_LOG: 'Hutang Riwayat',
  INV: 'Investasi',
  INV_LOG: 'Investasi Riwayat',
  BILL: 'Tagihan Rutin',
  BILL_LOG: 'Tagihan Dibayar'
};

// Header standar tiap sheet. setup() hanya MENAMBAH header yang belum ada.
const HEADERS = {
  'Pemasukan': ['ID', 'Tanggal', 'Kategori', 'Nominal', 'Catatan', 'Dicatat Pada'],
  'Pengeluaran': ['ID', 'Tanggal', 'Kategori', 'Nominal', 'Catatan', 'Dicatat Pada'],
  'Kategori': ['Jenis', 'Nama'],
  'Budget': ['Kategori', 'Budget per Bulan', 'Terpakai Bulan Ini', 'Sisa'],
  'Tabungan': ['ID', 'Nama Target', 'Target Dana', 'Tenggat', 'Terkumpul', 'Sisa', 'Dibuat'],
  'Tabungan Riwayat': ['ID', 'Tabungan ID', 'Tanggal', 'Jenis', 'Nominal', 'Catatan', 'Dicatat Pada'],
  'Hutang': ['ID', 'Nama', 'Jenis', 'Total Hutang', 'Terbayar', 'Sisa', 'Dibuat'],
  'Hutang Riwayat': ['ID', 'Hutang ID', 'Tanggal', 'Jenis', 'Nominal', 'Catatan', 'Dicatat Pada'],
  'Investasi': ['ID', 'Nama', 'Platform', 'Jenis', 'Modal', 'Nilai Terkini', 'Untung/Rugi', 'Update Terakhir'],
  'Investasi Riwayat': ['ID', 'Investasi ID', 'Tanggal', 'Jenis', 'Nominal', 'Catatan', 'Dicatat Pada'],
  'Tagihan Rutin': ['ID', 'Nama', 'Tanggal Jatuh Tempo', 'Nominal', 'Kategori', 'Dibuat', 'Mulai'],
  'Tagihan Dibayar': ['ID', 'Tagihan ID', 'Periode', 'Transaksi ID', 'Tanggal', 'Nominal', 'Dicatat Pada']
};

// Nama lain yang juga dikenali untuk sebuah kolom (huruf besar/kecil diabaikan).
const ALIASES = {
  'tanggal': ['tanggal', 'tgl', 'date'],
  'nominal': ['nominal', 'jumlah', 'amount', 'nilai'],
  'kategori': ['kategori', 'category'],
  'catatan': ['catatan', 'keterangan', 'deskripsi', 'note', 'notes'],
  'id': ['id']
};

const DEFAULT_CATEGORIES = {
  in: ['Gaji'],
  out: ['Makan & Minum', 'Transportasi', 'Belanja', 'Tagihan', 'Hiburan', 'Kesehatan', 'Lainnya'],
  auto: ['Bayar Hutang', 'Setor Tabungan', 'Setor Investasi']
};

const MONEY_FORMAT = '"Rp" #,##0';

/* =========================================================
 * API publik (dipanggil dari aplikasi di GitHub Pages)
 * Semua permintaan wajib membawa token yang didapat dari PIN.
 * ======================================================= */

const APP_URL = 'https://aekklesiaa.github.io/cuan/';
const PIN_MAX_FAILS = 5;            // salah PIN berturut-turut sebelum dikunci
const PIN_LOCK_SECONDS = 15 * 60;   // lama kunci setelah terlalu banyak salah
const TOKEN_DAYS = 60;              // HP tetap "masuk" selama 60 hari

function doGet() {
  return ContentService.createTextOutput('Cuan! aktif. Buka aplikasinya di ' + APP_URL);
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e && e.postData ? e.postData.contents : '{}'); }
  catch (err) { return json_({ ok: false, error: 'Permintaan tidak valid.' }); }
  try {
    const fn = String(req.fn || '');
    if (fn === 'pinStatus') return json_({ ok: true, data: { hasPin: !!prop_('PIN_HASH'), len: Number(prop_('PIN_LEN') || 0) } });
    if (fn === 'createPin') return json_({ ok: true, data: createPin_(req.pin) });
    if (fn === 'login') return json_({ ok: true, data: login_(req.pin) });
    checkToken_(req.token);
    if (fn === 'logout') { removeToken_(req.token); return json_({ ok: true, data: true }); }
    const api = {
      getAll: getAll_, saveTransaction: saveTransaction_, deleteTransaction: deleteTransaction_,
      setBudget: setBudget_, addGoal: addGoal_, goalTx: goalTx_, addDebt: addDebt_, debtTx: debtTx_,
      addInv: addInv_, invTx: invTx_, deleteItem: deleteItem_, editItem: editItem_,
      addBill: addBill_, payBill: payBill_, unpayBill: unpayBill_
    };
    if (!api[fn]) throw new Error('Perintah tidak dikenal.');
    const args = Array.isArray(req.args) ? req.args : [];
    return json_({ ok: true, data: api[fn].apply(null, args) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err), code: err && err.code || '' });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- PIN & token ---------- */

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function hash_(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function validPin_(pin) {
  pin = String(pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN harus 4 sampai 6 angka.');
  return pin;
}

function createPin_(pin) {
  pin = validPin_(pin);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (prop_('PIN_HASH')) throw new Error('PIN sudah pernah dibuat. Masukkan PIN-mu.');
    const salt = Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperties({ PIN_SALT: salt, PIN_HASH: hash_(pin, salt), PIN_LEN: String(pin.length), TOKENS: '{}' });
    return { token: issueToken_() };
  } finally { lock.releaseLock(); }
}

function login_(pin) {
  const cache = CacheService.getScriptCache();
  if (cache.get('PIN_LOCKED')) throw authErr_('Terlalu banyak salah PIN. Coba lagi 15 menit lagi.', 'LOCKED');
  if (!prop_('PIN_HASH')) throw authErr_('PIN belum dibuat.', 'NO_PIN');
  pin = String(pin || '');
  if (hash_(pin, prop_('PIN_SALT')) !== prop_('PIN_HASH')) {
    const fails = Number(cache.get('PIN_FAILS') || 0) + 1;
    if (fails >= PIN_MAX_FAILS) { cache.put('PIN_LOCKED', '1', PIN_LOCK_SECONDS); cache.remove('PIN_FAILS'); throw authErr_('Terlalu banyak salah PIN. Coba lagi 15 menit lagi.', 'LOCKED'); }
    cache.put('PIN_FAILS', String(fails), PIN_LOCK_SECONDS);
    throw authErr_('PIN salah. Sisa ' + (PIN_MAX_FAILS - fails) + ' kali coba.', 'BAD_PIN');
  }
  cache.remove('PIN_FAILS');
  if (!prop_('PIN_LEN')) PropertiesService.getScriptProperties().setProperty('PIN_LEN', String(pin.length));
  return { token: issueToken_() };
}

function issueToken_() {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let tokens = {};
  try { tokens = JSON.parse(props.getProperty('TOKENS') || '{}'); } catch (e) { tokens = {}; }
  Object.keys(tokens).forEach(function (t) { if (tokens[t] < now) delete tokens[t]; });
  const keys = Object.keys(tokens).sort(function (a, b) { return tokens[a] - tokens[b]; });
  while (keys.length >= 10) delete tokens[keys.shift()];
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  tokens[token] = now + TOKEN_DAYS * 864e5;
  props.setProperty('TOKENS', JSON.stringify(tokens));
  return token;
}

function checkToken_(token) {
  let tokens = {};
  try { tokens = JSON.parse(prop_('TOKENS') || '{}'); } catch (e) { tokens = {}; }
  if (!token || !tokens[token] || tokens[token] < Date.now()) throw authErr_('Sesi habis. Masukkan PIN lagi.', 'AUTH');
}

function removeToken_(token) {
  const props = PropertiesService.getScriptProperties();
  let tokens = {};
  try { tokens = JSON.parse(props.getProperty('TOKENS') || '{}'); } catch (e) { tokens = {}; }
  delete tokens[token];
  props.setProperty('TOKENS', JSON.stringify(tokens));
}

function authErr_(msg, code) { const e = new Error(msg); e.code = code; return e; }

/**
 * Lupa PIN? Jalankan fungsi ini dari editor Apps Script.
 * PIN lama dihapus dan semua HP keluar. Buka aplikasi lalu buat PIN baru.
 */
function resetPin() {
  const props = PropertiesService.getScriptProperties();
  ['PIN_HASH', 'PIN_SALT', 'PIN_LEN', 'TOKENS'].forEach(function (k) { props.deleteProperty(k); });
  CacheService.getScriptCache().removeAll(['PIN_FAILS', 'PIN_LOCKED']);
}

/* =========================================================
 * Fungsi yang dipanggil dari aplikasi
 * Semua fungsi mengembalikan data terbaru (getAll) supaya tampilan selalu sinkron.
 * ======================================================= */

function getAll_() {
  const ss = ss_();
  const tz = ss.getSpreadsheetTimeZone();
  const inc = readTransactions_(ss, SHEET.IN, 'in', tz);
  const out = readTransactions_(ss, SHEET.OUT, 'out', tz);
  return {
    today: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
    categories: readCategories_(ss),
    transactions: inc.concat(out),
    budgets: readBudgets_(ss),
    goals: readGoals_(ss, tz),
    debts: readDebts_(ss),
    invs: readInvs_(ss, tz),
    bills: readBills_(ss, tz, out),
    syncedAt: new Date().toISOString()
  };
}

/**
 * Tambah atau edit transaksi.
 * tx = {id?, origType?, type:'in'|'out', date:'yyyy-MM-dd', category, amount, note}
 */
function saveTransaction_(tx) {
  const clean = validateTx_(tx);
  return withLock_(function (ss, tz) {
    if (tx.id) {
      const found = findTxRow_(ss, String(tx.id));
      if (!found) throw new Error('Transaksi tidak ditemukan. Mungkin sudah dihapus di spreadsheet.');
      const targetSheet = clean.type === 'in' ? SHEET.IN : SHEET.OUT;
      if (found.sheetName === targetSheet) {
        writeTxRow_(found.t, found.row, Object.assign({ id: String(tx.id) }, clean), tz, false);
      } else {
        // Jenis berubah (pengeluaran <-> pemasukan): pindahkan baris ke sheet yang benar.
        found.t.sh.deleteRow(found.row);
        appendTx_(ss, Object.assign({ id: String(tx.id) }, clean), tz);
      }
    } else {
      appendTx_(ss, Object.assign({ id: newId_(clean.type === 'in' ? 'IN' : 'OUT') }, clean), tz);
    }
  });
}

function deleteTransaction_(id) {
  return withLock_(function (ss) {
    const found = findTxRow_(ss, String(id));
    if (!found) throw new Error('Transaksi tidak ditemukan. Mungkin sudah dihapus di spreadsheet.');
    found.t.sh.deleteRow(found.row);
  });
}

/** Hapus satu hutang / tabungan / investasi beserta seluruh riwayatnya. kind = 'debt'|'goal'|'inv' */
function deleteItem_(kind, id) {
  const map = {
    debt: { main: SHEET.DEBT, log: SHEET.DEBT_LOG, parent: 'Hutang ID', label: 'Hutang' },
    goal: { main: SHEET.GOAL, log: SHEET.GOAL_LOG, parent: 'Tabungan ID', label: 'Target tabungan' },
    inv: { main: SHEET.INV, log: SHEET.INV_LOG, parent: 'Investasi ID', label: 'Aset' },
    bill: { main: SHEET.BILL, log: SHEET.BILL_LOG, parent: 'Tagihan ID', label: 'Tagihan' }
  }[kind];
  if (!map) throw new Error('Jenis data tidak dikenal.');
  id = String(id || '').trim();
  if (!id) throw new Error('ID kosong.');
  return withLock_(function (ss) {
    const t = table_(ss, map.main), cId = col_(t, 'ID', true);
    let row = -1;
    t.rows.forEach(function (r, i) { if (String(r[cId]).trim() === id) row = i + 2; });
    if (row < 0) throw new Error(map.label + ' tidak ditemukan. Mungkin sudah dihapus di spreadsheet.');
    const log = table_(ss, map.log), cP = col_(log, map.parent, true);
    for (let i = log.rows.length - 1; i >= 0; i--) {
      if (String(log.rows[i][cP]).trim() === id) log.sh.deleteRow(i + 2);
    }
    t.sh.deleteRow(row);
  });
}

/** Ubah data dasar hutang / tabungan / investasi. o berisi kolom yang mau diubah. */
function editItem_(kind, id, o) {
  o = o || {}; id = String(id || '').trim();
  const name = String(o.name || '').trim();
  if (!name) throw new Error('Namanya belum diisi.');
  return withLock_(function (ss, tz) {
    const sheet = { debt: SHEET.DEBT, goal: SHEET.GOAL, inv: SHEET.INV, bill: SHEET.BILL }[kind];
    if (!sheet) throw new Error('Jenis data tidak dikenal.');
    const t = table_(ss, sheet), cId = col_(t, 'ID', true);
    let row = -1;
    t.rows.forEach(function (r, i) { if (String(r[cId]).trim() === id) row = i + 2; });
    if (row < 0) throw new Error('Data tidak ditemukan. Mungkin sudah dihapus.');
    const set = function (h, v, fmt) { const c = col_(t, h, false); if (c === undefined) return; const cell = t.sh.getRange(row, c + 1).setValue(v); if (fmt) cell.setNumberFormat(fmt); };
    if (kind === 'goal') {
      const target = toNum_(o.target);
      if (!(target > 0)) throw new Error('Target dana harus lebih dari 0.');
      set('Nama Target', name);
      set('Target Dana', target, MONEY_FORMAT);
      set('Tenggat', /^\d{4}-\d{2}$/.test(o.deadline || '') ? Utilities.parseDate(o.deadline + '-01', tz, 'yyyy-MM-dd') : '', 'mmm yyyy');
      refreshGoals_(ss, tz);
    } else if (kind === 'debt') {
      set('Nama', name);
      set('Jenis', o.kind || 'Pribadi');
      const total = toNum_(o.total);
      if (o.total !== undefined && o.total !== '') {
        if (!(total > 0)) throw new Error('Total hutang harus lebih dari 0.');
        const d = readDebts_(ss).filter(function (x) { return x.id === id; })[0];
        if (total < d.paid) throw new Error('Total tidak boleh lebih kecil dari yang sudah dibayar (' + rp_(d.paid) + ').');
        const delta = total - d.total;
        if (delta !== 0) appendByHeader_(table_(ss, SHEET.DEBT_LOG), { 'ID': newId_('HR'), 'Hutang ID': id, 'Tanggal': new Date(), 'Jenis': 'Tambah', 'Nominal': delta, 'Catatan': 'Koreksi total hutang', 'Dicatat Pada': new Date() });
      }
      refreshDebts_(ss);
    } else if (kind === 'bill') {
      const b = cleanBill_(o);
      set('Nama', b.name); set('Tanggal Jatuh Tempo', b.day); set('Nominal', b.amount, MONEY_FORMAT); set('Kategori', b.category); set('Mulai', b.start ? "'" + b.start : '');
    } else {
      set('Nama', name);
      set('Platform', o.platform || '');
      set('Jenis', o.kind || 'Lainnya');
    }
  });
}

/* ---------- Tagihan rutin bulanan ---------- */
function cleanBill_(o) {
  const name = String(o.name || '').trim(), day = Math.round(toNum_(o.day)), amount = toNum_(o.amount), category = String(o.category || '').trim();
  if (!name) throw new Error('Nama tagihan belum diisi.');
  if (!(day >= 1 && day <= 31)) throw new Error('Tanggal jatuh tempo harus 1 sampai 31.');
  if (!(amount > 0)) throw new Error('Nominal harus lebih dari 0.');
  if (!category) throw new Error('Kategori belum dipilih.');
  const start = /^\d{4}-\d{2}$/.test(o.start || '') ? o.start : '';
  return { name: name, day: day, amount: amount, category: category, start: start };
}

/** o = {name, day, amount, category} */
function addBill_(o) {
  const b = cleanBill_(o);
  return withLock_(function (ss) {
    ensureSheet_(ss, SHEET.BILL); ensureSheet_(ss, SHEET.BILL_LOG);
    appendByHeader_(table_(ss, SHEET.BILL), { 'ID': newId_('TGH'), 'Nama': b.name, 'Tanggal Jatuh Tempo': b.day, 'Nominal': b.amount, 'Kategori': b.category, 'Dibuat': new Date(), 'Mulai': b.start ? "'" + b.start : '' });
  });
}

/** o = {id, period:'yyyy-MM', amount, date} → catat sebagai pengeluaran */
function payBill_(o) {
  const n = toNum_(o.amount), period = String(o.period || '');
  if (!(n > 0)) throw new Error('Nominal harus lebih dari 0.');
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Periode tidak valid.');
  return withLock_(function (ss, tz) {
    ensureSheet_(ss, SHEET.BILL_LOG);
    const out = readTransactions_(ss, SHEET.OUT, 'out', tz);
    const bill = readBills_(ss, tz, out).filter(function (b) { return b.id === o.id; })[0];
    if (!bill) throw new Error('Tagihan tidak ditemukan.');
    if (bill.paid[period]) throw new Error('Tagihan ini sudah dibayar untuk bulan itu.');
    const date = validDate_(o.date), txId = newId_('OUT');
    appendTx_(ss, { id: txId, type: 'out', date: date, category: bill.category, amount: n, note: bill.name }, tz);
    appendByHeader_(table_(ss, SHEET.BILL_LOG), { 'ID': newId_('TB'), 'Tagihan ID': bill.id, 'Periode': "'" + period, 'Transaksi ID': txId, 'Tanggal': Utilities.parseDate(date, tz, 'yyyy-MM-dd'), 'Nominal': n, 'Dicatat Pada': new Date() });
  });
}

/** Batalkan pembayaran: hapus catatan bayar dan pengeluarannya. */
function unpayBill_(o) {
  const period = String(o.period || '');
  return withLock_(function (ss) {
    const log = table_(ss, SHEET.BILL_LOG);
    const cP = col_(log, 'Tagihan ID', true), cPer = col_(log, 'Periode', true), cTx = col_(log, 'Transaksi ID', true);
    for (let i = log.rows.length - 1; i >= 0; i--) {
      const r = log.rows[i];
      if (String(r[cP]).trim() !== o.id || periodOf_(r[cPer]) !== period) continue;
      const found = findTxRow_(ss, String(r[cTx]).trim());
      if (found) found.t.sh.deleteRow(found.row);
      log.sh.deleteRow(i + 2);
    }
  });
}

function periodOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM');
  const m = String(v || '').match(/(\d{4})-(\d{2})/);
  return m ? m[1] + '-' + m[2] : '';
}

function readBills_(ss, tz, outTx) {
  if (!ss.getSheetByName(SHEET.BILL)) return [];
  const t = table_(ss, SHEET.BILL);
  const cId = col_(t, 'ID', true), cName = col_(t, 'Nama', true), cDay = col_(t, 'Tanggal Jatuh Tempo', true), cAmt = col_(t, 'Nominal', true), cCat = col_(t, 'Kategori', false), cStart = col_(t, 'Mulai', false);
  const txIds = {}; (outTx || []).forEach(function (x) { txIds[x.id] = x; });
  const paid = {};
  if (ss.getSheetByName(SHEET.BILL_LOG)) {
    const log = table_(ss, SHEET.BILL_LOG);
    const cP = col_(log, 'Tagihan ID', true), cPer = col_(log, 'Periode', true), cTx = col_(log, 'Transaksi ID', true);
    log.rows.forEach(function (r) {
      const tx = txIds[String(r[cTx]).trim()];
      if (!tx) return; // pengeluarannya sudah dihapus → dianggap belum bayar
      const id = String(r[cP]).trim();
      (paid[id] = paid[id] || {})[periodOf_(r[cPer])] = { date: tx.date, amount: tx.amount };
    });
  }
  return t.rows.filter(function (r) { return String(r[cId]).trim(); }).map(function (r) {
    const id = String(r[cId]).trim();
    return { id: id, name: String(r[cName]), day: Math.round(toNum_(r[cDay])) || 1, amount: toNum_(r[cAmt]) || 0, category: cCat !== undefined ? String(r[cCat] || 'Tagihan') : 'Tagihan', start: cStart !== undefined ? periodOf_(r[cStart]) : '', paid: paid[id] || {} };
  });
}

function ensureSheet_(ss, name) {
  if (ss.getSheetByName(name)) return;
  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold').setBackground('#2747D6').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
}

function setBudget_(category, amount) {
  const n = toNum_(amount);
  if (!category) throw new Error('Kategori belum dipilih.');
  if (!(n >= 0)) throw new Error('Budget tidak boleh negatif.');
  return withLock_(function (ss) {
    const t = table_(ss, SHEET.BUDGET);
    const cCat = col_(t, 'Kategori', true), cAmt = col_(t, 'Budget per Bulan', true);
    let row = -1;
    t.rows.forEach(function (r, i) { if (String(r[cCat]).trim() === category) row = i + 2; });
    if (row > 0) {
      t.sh.getRange(row, cAmt + 1).setValue(n);
    } else {
      const newRow = t.sh.getLastRow() + 1;
      t.sh.getRange(newRow, cCat + 1).setValue(category);
      t.sh.getRange(newRow, cAmt + 1).setValue(n).setNumberFormat(MONEY_FORMAT);
      // Salin rumus "Terpakai" dan "Sisa" dari baris pertama, kalau ada.
      const cUsed = col_(t, 'Terpakai Bulan Ini', false), cLeft = col_(t, 'Sisa', false);
      [cUsed, cLeft].forEach(function (c) {
        if (c !== undefined && t.rows.length) t.sh.getRange(2, c + 1).copyTo(t.sh.getRange(newRow, c + 1));
      });
    }
  });
}

/** o = {name, target, deadline:'yyyy-MM'} */
function addGoal_(o) {
  const name = String(o.name || '').trim(), target = toNum_(o.target);
  if (!name) throw new Error('Nama target belum diisi.');
  if (!(target > 0)) throw new Error('Target dana harus lebih dari 0.');
  return withLock_(function (ss, tz) {
    const t = table_(ss, SHEET.GOAL);
    const deadline = /^\d{4}-\d{2}$/.test(o.deadline || '') ? Utilities.parseDate(o.deadline + '-01', tz, 'yyyy-MM-dd') : '';
    appendByHeader_(t, { 'ID': newId_('TAB'), 'Nama Target': name, 'Target Dana': target, 'Tenggat': deadline, 'Terkumpul': 0, 'Sisa': target, 'Dibuat': new Date() });
  });
}

/** o = {id, kind:'Setor'|'Tarik', amount, date, note, alsoExpense} */
function goalTx_(o) {
  const n = toNum_(o.amount);
  if (!(n > 0)) throw new Error('Nominal harus lebih dari 0.');
  if (['Setor', 'Tarik'].indexOf(o.kind) < 0) throw new Error('Jenis transaksi tabungan tidak dikenal.');
  return withLock_(function (ss, tz) {
    const goal = readGoals_(ss, tz).filter(function (g) { return g.id === o.id; })[0];
    if (!goal) throw new Error('Target tabungan tidak ditemukan.');
    if (o.kind === 'Tarik' && n > goal.saved) throw new Error('Melebihi saldo tabungan (' + rp_(goal.saved) + ').');
    const date = validDate_(o.date);
    appendByHeader_(table_(ss, SHEET.GOAL_LOG), { 'ID': newId_('TR'), 'Tabungan ID': o.id, 'Tanggal': Utilities.parseDate(date, tz, 'yyyy-MM-dd'), 'Jenis': o.kind, 'Nominal': n, 'Catatan': o.note || '', 'Dicatat Pada': new Date() });
    if (o.alsoExpense && o.kind === 'Setor') appendTx_(ss, { id: newId_('OUT'), type: 'out', date: date, category: 'Setor Tabungan', amount: n, note: 'Setor ke ' + goal.name }, tz);
    refreshGoals_(ss, tz);
  });
}

/** o = {name, kind, total, date, note} */
function addDebt_(o) {
  const name = String(o.name || '').trim(), total = toNum_(o.total);
  if (!name) throw new Error('Nama hutang belum diisi.');
  if (!(total > 0)) throw new Error('Total hutang harus lebih dari 0.');
  return withLock_(function (ss, tz) {
    const id = newId_('HTG');
    appendByHeader_(table_(ss, SHEET.DEBT), { 'ID': id, 'Nama': name, 'Jenis': o.kind || 'Pribadi', 'Total Hutang': total, 'Terbayar': 0, 'Sisa': total, 'Dibuat': new Date() });
    appendByHeader_(table_(ss, SHEET.DEBT_LOG), { 'ID': newId_('HR'), 'Hutang ID': id, 'Tanggal': Utilities.parseDate(validDate_(o.date), tz, 'yyyy-MM-dd'), 'Jenis': 'Tambah', 'Nominal': total, 'Catatan': o.note || 'Hutang awal', 'Dicatat Pada': new Date() });
    refreshDebts_(ss);
  });
}

/** o = {id, kind:'Bayar'|'Tambah', amount, date, note, alsoExpense} */
function debtTx_(o) {
  const n = toNum_(o.amount);
  if (!(n > 0)) throw new Error('Nominal harus lebih dari 0.');
  if (['Bayar', 'Tambah'].indexOf(o.kind) < 0) throw new Error('Jenis transaksi hutang tidak dikenal.');
  return withLock_(function (ss, tz) {
    const d = readDebts_(ss).filter(function (x) { return x.id === o.id; })[0];
    if (!d) throw new Error('Hutang tidak ditemukan.');
    const left = d.total - d.paid;
    if (o.kind === 'Bayar' && n > left) throw new Error('Melebihi sisa hutang (' + rp_(left) + ').');
    const date = validDate_(o.date);
    appendByHeader_(table_(ss, SHEET.DEBT_LOG), { 'ID': newId_('HR'), 'Hutang ID': o.id, 'Tanggal': Utilities.parseDate(date, tz, 'yyyy-MM-dd'), 'Jenis': o.kind, 'Nominal': n, 'Catatan': o.note || '', 'Dicatat Pada': new Date() });
    if (o.alsoExpense && o.kind === 'Bayar') appendTx_(ss, { id: newId_('OUT'), type: 'out', date: date, category: 'Bayar Hutang', amount: n, note: 'Bayar ' + d.name }, tz);
    refreshDebts_(ss);
  });
}

/** o = {name, platform, kind, modal, date} */
function addInv_(o) {
  const name = String(o.name || '').trim(), modal = toNum_(o.modal);
  if (!name) throw new Error('Nama aset belum diisi.');
  if (!(modal > 0)) throw new Error('Modal awal harus lebih dari 0.');
  return withLock_(function (ss, tz) {
    const id = newId_('INV');
    appendByHeader_(table_(ss, SHEET.INV), { 'ID': id, 'Nama': name, 'Platform': o.platform || '', 'Jenis': o.kind || 'Lainnya', 'Modal': modal, 'Nilai Terkini': modal, 'Untung/Rugi': 0, 'Update Terakhir': new Date() });
    appendByHeader_(table_(ss, SHEET.INV_LOG), { 'ID': newId_('IR'), 'Investasi ID': id, 'Tanggal': Utilities.parseDate(validDate_(o.date), tz, 'yyyy-MM-dd'), 'Jenis': 'Setor', 'Nominal': modal, 'Catatan': 'Modal awal', 'Dicatat Pada': new Date() });
    refreshInvs_(ss, tz);
  });
}

/** o = {id, kind:'Setor'|'Tarik'|'Update Nilai', amount, date, note, alsoExpense} */
function invTx_(o) {
  const n = toNum_(o.amount);
  if (!(n >= 0) || (o.kind !== 'Update Nilai' && !(n > 0))) throw new Error('Nominal harus lebih dari 0.');
  if (['Setor', 'Tarik', 'Update Nilai'].indexOf(o.kind) < 0) throw new Error('Jenis transaksi investasi tidak dikenal.');
  return withLock_(function (ss, tz) {
    const t = table_(ss, SHEET.INV);
    const cId = col_(t, 'ID', true), cVal = col_(t, 'Nilai Terkini', true), cUpd = col_(t, 'Update Terakhir', false);
    let rowIdx = -1;
    t.rows.forEach(function (r, i) { if (String(r[cId]) === o.id) rowIdx = i; });
    if (rowIdx < 0) throw new Error('Aset tidak ditemukan.');
    const name = String(t.rows[rowIdx][col_(t, 'Nama', true)]);
    const cur = toNum_(t.rows[rowIdx][cVal]) || 0;
    if (o.kind === 'Tarik' && n > cur) throw new Error('Melebihi nilai saat ini (' + rp_(cur) + ').');
    const next = o.kind === 'Setor' ? cur + n : o.kind === 'Tarik' ? cur - n : n;
    t.sh.getRange(rowIdx + 2, cVal + 1).setValue(next);
    if (cUpd !== undefined) t.sh.getRange(rowIdx + 2, cUpd + 1).setValue(new Date());
    const date = validDate_(o.date);
    appendByHeader_(table_(ss, SHEET.INV_LOG), { 'ID': newId_('IR'), 'Investasi ID': o.id, 'Tanggal': Utilities.parseDate(date, tz, 'yyyy-MM-dd'), 'Jenis': o.kind, 'Nominal': n, 'Catatan': o.note || '', 'Dicatat Pada': new Date() });
    if (o.alsoExpense && o.kind === 'Setor') appendTx_(ss, { id: newId_('OUT'), type: 'out', date: date, category: 'Setor Investasi', amount: n, note: 'Setor ke ' + name }, tz);
    refreshInvs_(ss, tz);
  });
}

/* =========================================================
 * Setup: jalankan SEKALI dari editor (pilih fungsi setup, klik Jalankan).
 * Aman dijalankan ulang: hanya menambah yang belum ada, tidak menghapus data.
 * ======================================================= */

function setup() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const isEmpty = existing.every(function (h) { return !h; });
    if (isEmpty) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    } else {
      HEADERS[name].forEach(function (h) {
        const keys = ALIASES[h.toLowerCase()] || [h.toLowerCase()];
        const has = existing.some(function (e) { return keys.indexOf(e) >= 0; });
        if (!has) { sh.getRange(1, sh.getLastColumn() + 1).setValue(h); existing.push(h.toLowerCase()); }
      });
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#2747D6').setFontColor('#FFFFFF');
  });
  // Kategori bawaan kalau sheet Kategori masih kosong.
  const cat = ss.getSheetByName(SHEET.CAT);
  if (cat.getLastRow() < 2) {
    const rows = [];
    DEFAULT_CATEGORIES.in.forEach(function (n) { rows.push(['Pemasukan', n]); });
    DEFAULT_CATEGORIES.out.forEach(function (n) { rows.push(['Pengeluaran', n]); });
    DEFAULT_CATEGORIES.auto.forEach(function (n) { rows.push(['Otomatis', n]); });
    cat.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  // Isi ID untuk baris lama yang belum punya ID (tidak mengubah isi lainnya).
  const tz = ss.getSpreadsheetTimeZone();
  readTransactions_(ss, SHEET.IN, 'in', tz);
  readTransactions_(ss, SHEET.OUT, 'out', tz);
  refreshGoals_(ss, tz);
  refreshDebts_(ss);
  refreshInvs_(ss, tz);
  SpreadsheetApp.getUi && safeToast_(ss, 'Setup selesai. Lanjut ke Deploy > Deployment baru.');
}

/* =========================================================
 * Membaca data
 * ======================================================= */

function readTransactions_(ss, sheetName, type, tz) {
  const t = table_(ss, sheetName);
  const cId = col_(t, 'ID', false), cDate = col_(t, 'Tanggal', true), cCat = col_(t, 'Kategori', true);
  const cAmt = col_(t, 'Nominal', true), cNote = col_(t, 'Catatan', false);
  const list = [], missing = [];
  t.rows.forEach(function (r, i) {
    const amount = toNum_(r[cAmt]);
    const date = toIso_(r[cDate], tz);
    if (!date && !amount) return; // baris kosong
    let id = cId !== undefined ? String(r[cId] || '').trim() : '';
    if (!id && cId !== undefined) { id = newId_(type === 'in' ? 'IN' : 'OUT'); missing.push([i + 2, id]); }
    if (!id) id = sheetName + '#' + (i + 2);
    list.push({ id: id, type: type, date: date || '', category: String(r[cCat] || 'Lainnya').trim() || 'Lainnya', amount: amount || 0, note: cNote !== undefined ? String(r[cNote] || '') : '' });
  });
  // Baris lama tanpa ID diberi ID supaya bisa diedit/dihapus dari aplikasi.
  missing.forEach(function (m) { t.sh.getRange(m[0], cId + 1).setValue(m[1]); });
  return list;
}

function readCategories_(ss) {
  const sh = ss.getSheetByName(SHEET.CAT);
  if (!sh || sh.getLastRow() < 2) return DEFAULT_CATEGORIES;
  const t = table_(ss, SHEET.CAT);
  const cType = col_(t, 'Jenis', true), cName = col_(t, 'Nama', true);
  const res = { in: [], out: [], auto: [] };
  t.rows.forEach(function (r) {
    const type = String(r[cType]).trim().toLowerCase(), name = String(r[cName]).trim();
    if (!name) return;
    if (type === 'pemasukan') res.in.push(name);
    else if (type === 'pengeluaran') res.out.push(name);
    else if (type === 'otomatis') res.auto.push(name);
  });
  if (!res.in.length) res.in = DEFAULT_CATEGORIES.in;
  if (!res.out.length) res.out = DEFAULT_CATEGORIES.out;
  if (!res.auto.length) res.auto = DEFAULT_CATEGORIES.auto;
  return res;
}

function readBudgets_(ss) {
  const t = table_(ss, SHEET.BUDGET);
  const cCat = col_(t, 'Kategori', true), cAmt = col_(t, 'Budget per Bulan', true);
  const res = {};
  t.rows.forEach(function (r) {
    const c = String(r[cCat]).trim(), n = toNum_(r[cAmt]);
    if (c && n > 0) res[c] = n;
  });
  return res;
}

function readGoals_(ss, tz) {
  const t = table_(ss, SHEET.GOAL), log = table_(ss, SHEET.GOAL_LOG);
  const saved = sumLog_(log, 'Tabungan ID', { 'Setor': 1, 'Tarik': -1 });
  const cId = col_(t, 'ID', true), cName = col_(t, 'Nama Target', true), cTarget = col_(t, 'Target Dana', true), cDl = col_(t, 'Tenggat', false);
  return t.rows.filter(function (r) { return String(r[cId]).trim(); }).map(function (r) {
    const id = String(r[cId]).trim();
    let dl = cDl !== undefined ? r[cDl] : '';
    dl = dl instanceof Date ? Utilities.formatDate(dl, tz, 'yyyy-MM') : (/^\d{4}-\d{2}/.test(String(dl)) ? String(dl).slice(0, 7) : '');
    return { id: id, name: String(r[cName]), target: toNum_(r[cTarget]) || 0, saved: saved[id] || 0, deadline: dl };
  });
}

function readDebts_(ss) {
  const t = table_(ss, SHEET.DEBT), log = table_(ss, SHEET.DEBT_LOG);
  const added = sumLog_(log, 'Hutang ID', { 'Tambah': 1 });
  const paid = sumLog_(log, 'Hutang ID', { 'Bayar': 1 });
  const cId = col_(t, 'ID', true), cName = col_(t, 'Nama', true), cKind = col_(t, 'Jenis', false);
  return t.rows.filter(function (r) { return String(r[cId]).trim(); }).map(function (r) {
    const id = String(r[cId]).trim();
    return { id: id, name: String(r[cName]), kind: cKind !== undefined ? String(r[cKind] || '') : '', total: added[id] || 0, paid: paid[id] || 0 };
  });
}

function readInvs_(ss, tz) {
  const t = table_(ss, SHEET.INV), log = table_(ss, SHEET.INV_LOG);
  const modal = sumLog_(log, 'Investasi ID', { 'Setor': 1, 'Tarik': -1 });
  const cId = col_(t, 'ID', true), cName = col_(t, 'Nama', true), cPlat = col_(t, 'Platform', false), cKind = col_(t, 'Jenis', false);
  const cVal = col_(t, 'Nilai Terkini', true), cUpd = col_(t, 'Update Terakhir', false);
  return t.rows.filter(function (r) { return String(r[cId]).trim(); }).map(function (r) {
    const id = String(r[cId]).trim();
    const upd = cUpd !== undefined && r[cUpd] instanceof Date ? Utilities.formatDate(r[cUpd], tz, 'yyyy-MM-dd') : '';
    return { id: id, name: String(r[cName]), platform: cPlat !== undefined ? String(r[cPlat] || '') : '', kind: cKind !== undefined ? String(r[cKind] || '') : '', modal: Math.max(0, modal[id] || 0), nilai: toNum_(r[cVal]) || 0, updated: upd };
  });
}

/** Jumlahkan nominal riwayat per ID induk. weights: {'Setor': 1, 'Tarik': -1} */
function sumLog_(log, parentHeader, weights) {
  const cP = col_(log, parentHeader, true), cK = col_(log, 'Jenis', true), cN = col_(log, 'Nominal', true);
  const res = {};
  log.rows.forEach(function (r) {
    const w = weights[String(r[cK]).trim()];
    if (!w) return;
    const id = String(r[cP]).trim();
    res[id] = (res[id] || 0) + w * (toNum_(r[cN]) || 0);
  });
  return res;
}

/* Kolom ringkasan (Terkumpul, Sisa, Total, dst.) ditulis ulang supaya sheet mudah dibaca. */
function refreshGoals_(ss, tz) {
  const goals = readGoals_(ss, tz), t = table_(ss, SHEET.GOAL);
  writeSummary_(t, goals, { 'Terkumpul': function (g) { return g.saved; }, 'Sisa': function (g) { return Math.max(0, g.target - g.saved); } });
}
function refreshDebts_(ss) {
  const debts = readDebts_(ss), t = table_(ss, SHEET.DEBT);
  writeSummary_(t, debts, { 'Total Hutang': function (d) { return d.total; }, 'Terbayar': function (d) { return d.paid; }, 'Sisa': function (d) { return d.total - d.paid; } });
}
function refreshInvs_(ss, tz) {
  const invs = readInvs_(ss, tz), t = table_(ss, SHEET.INV);
  writeSummary_(t, invs, { 'Modal': function (x) { return x.modal; }, 'Untung/Rugi': function (x) { return x.nilai - x.modal; } });
}
function writeSummary_(t, items, getters) {
  if (!t.rows.length) return;
  const cId = col_(t, 'ID', true);
  const byId = {}; items.forEach(function (x) { byId[x.id] = x; });
  Object.keys(getters).forEach(function (h) {
    const c = col_(t, h, false);
    if (c === undefined) return;
    const vals = t.rows.map(function (r) { const x = byId[String(r[cId]).trim()]; return [x ? getters[h](x) : r[c]]; });
    t.sh.getRange(2, c + 1, vals.length, 1).setValues(vals).setNumberFormat(MONEY_FORMAT);
  });
}

/* =========================================================
 * Menulis data
 * ======================================================= */

function appendTx_(ss, tx, tz) {
  const t = table_(ss, tx.type === 'in' ? SHEET.IN : SHEET.OUT);
  const row = t.sh.getLastRow() + 1;
  writeTxRow_(t, row, tx, tz, true);
}

/** Tulis satu transaksi ke baris tertentu. Kolom lain di baris itu tidak disentuh. */
function writeTxRow_(t, row, tx, tz, isNew) {
  const set = function (header, value, fmt) {
    const c = col_(t, header, header !== 'ID' && header !== 'Catatan' && header !== 'Dicatat Pada');
    if (c === undefined) return;
    const cell = t.sh.getRange(row, c + 1).setValue(value);
    if (fmt) cell.setNumberFormat(fmt);
  };
  set('ID', tx.id);
  set('Tanggal', Utilities.parseDate(tx.date, tz, 'yyyy-MM-dd'), 'dd/mm/yyyy');
  set('Kategori', tx.category);
  set('Nominal', tx.amount, MONEY_FORMAT);
  set('Catatan', tx.note || '');
  if (isNew) set('Dicatat Pada', new Date(), 'dd/mm/yyyy hh:mm');
}

/** Tambah baris baru berdasarkan nama header. Header yang tidak ada dilewati. */
function appendByHeader_(t, obj) {
  const row = new Array(Math.max(t.lastCol, 1)).fill('');
  Object.keys(obj).forEach(function (h) {
    const c = col_(t, h, false);
    if (c !== undefined) row[c] = obj[h];
  });
  t.sh.appendRow(row);
}

function findTxRow_(ss, id) {
  const names = [SHEET.IN, SHEET.OUT];
  for (let k = 0; k < names.length; k++) {
    const t = table_(ss, names[k]);
    const c = col_(t, 'ID', false);
    if (c === undefined) continue;
    for (let i = 0; i < t.rows.length; i++) {
      if (String(t.rows[i][c]).trim() === id) return { t: t, row: i + 2, sheetName: names[k] };
    }
  }
  return null;
}

/* =========================================================
 * Utilitas
 * ======================================================= */

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Spreadsheet sedang sibuk. Coba lagi sebentar.');
  try {
    const ss = ss_();
    fn(ss, ss.getSpreadsheetTimeZone());
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return getAll_();
}

function table_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" tidak ditemukan. Jalankan fungsi setup sekali dari editor Apps Script.');
  const lastRow = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), 1);
  const values = lastRow > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [new Array(lastCol).fill('')];
  const col = {};
  values[0].forEach(function (h, i) { const k = String(h).trim().toLowerCase(); if (k && col[k] === undefined) col[k] = i; });
  return { sh: sh, col: col, rows: values.slice(1), lastCol: lastCol };
}

function col_(t, header, required) {
  const key = header.toLowerCase();
  const names = ALIASES[key] || [key];
  for (let i = 0; i < names.length; i++) if (t.col[names[i]] !== undefined) return t.col[names[i]];
  if (required) throw new Error('Kolom "' + header + '" tidak ditemukan di sheet "' + t.sh.getName() + '".');
  return undefined;
}

function validateTx_(tx) {
  if (!tx) throw new Error('Data transaksi kosong.');
  const type = tx.type === 'in' ? 'in' : tx.type === 'out' ? 'out' : null;
  if (!type) throw new Error('Jenis transaksi tidak valid.');
  const amount = toNum_(tx.amount);
  if (!amount) throw new Error('Nominal belum diisi.');
  if (!(amount > 0)) throw new Error('Nominal harus lebih dari 0.');
  const category = String(tx.category || '').trim();
  if (!category) throw new Error('Kategori belum dipilih.');
  return { type: type, amount: Math.round(amount * 100) / 100, category: category, date: validDate_(tx.date), note: String(tx.note || '').trim().slice(0, 500) };
}

function validDate_(s) {
  s = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Tanggal tidak valid.');
  return s;
}

function toNum_(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).replace(/[^\d,.\-]/g, '');
  // Format Indonesia: titik = ribuan, koma = desimal.
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function toIso_(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return m[3] + '-' + pad_(m[2]) + '-' + pad_(m[1]);
  return '';
}

function pad_(n) { return ('0' + n).slice(-2); }

function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 6);
}

function rp_(n) {
  return 'Rp ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function safeToast_(ss, msg) {
  try { ss.toast(msg, 'Cuan!', 8); } catch (e) { /* abaikan */ }
}
