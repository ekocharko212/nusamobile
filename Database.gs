/**
 * ============================================================
 * NUSA mobile - Database.gs
 * Layer akses ke Google Spreadsheet (USERS, APPLICATIONS, ACCESS, LOGS)
 * ============================================================
 */

function _ss() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function _sheet(name) {
  const ss = _ss();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    _initSheetHeaders(sh, name);
  }
  return sh;
}

function _initSheetHeaders(sh, name) {
  const headers = {
    USERS: ['Email', 'Nama', 'Jabatan', 'Status', 'Role'],
    APPLICATIONS: ['AppID', 'Nama Aplikasi', 'URL', 'Icon', 'Warna', 'Kategori', 'Deskripsi', 'Status'],
    ACCESS: ['Email', 'AppID'],
    LOGS: ['Tanggal', 'Jam', 'Email', 'Aplikasi', 'Status', 'Perangkat']
  };
  if (headers[name]) {
    sh.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]);
    sh.setFrozenRows(1);
  }
}

/** Ambil semua baris sebuah sheet sebagai array of objects, key = header row */
function _readAll(sheetName) {
  const sh = _sheet(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(c => c === '')) continue; // skip baris kosong
    const obj = { _row: i + 1 };
    headers.forEach((h, idx) => obj[h] = row[idx]);
    rows.push(obj);
  }
  return rows;
}

// ---------------- USERS ----------------

function getAllUsers() {
  return _readAll(CONFIG.SHEETS.USERS);
}

function getUserByEmail(email) {
  if (!email) return null;
  email = String(email).toLowerCase().trim();
  return getAllUsers().find(u => String(u.Email).toLowerCase().trim() === email) || null;
}

function addUserRecord(user) {
  const sh = _sheet(CONFIG.SHEETS.USERS);
  sh.appendRow([user.Email, user.Nama, user.Jabatan || '', user.Status || 'Aktif', user.Role || CONFIG.ROLES.VIEWER]);
  _invalidateUserCache(user.Email);
}

function updateUserRecord(email, updates) {
  const sh = _sheet(CONFIG.SHEETS.USERS);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const emailCol = headers.indexOf('Email');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][emailCol]).toLowerCase().trim() === String(email).toLowerCase().trim()) {
      Object.keys(updates).forEach(key => {
        const col = headers.indexOf(key);
        if (col !== -1) sh.getRange(i + 1, col + 1).setValue(updates[key]);
      });
      _invalidateUserCache(email);
      return true;
    }
  }
  return false;
}

function setUserStatus(email, status) {
  return updateUserRecord(email, { Status: status });
}

// ---------------- APPLICATIONS ----------------

function getAllApplications() {
  return _readAll(CONFIG.SHEETS.APPLICATIONS);
}

function getActiveApplications() {
  return getAllApplications().filter(a => String(a.Status).toLowerCase() !== 'nonaktif');
}

function getApplicationById(appId) {
  return getAllApplications().find(a => String(a.AppID) === String(appId)) || null;
}

function addApplicationRecord(app) {
  const sh = _sheet(CONFIG.SHEETS.APPLICATIONS);
  const existingIds = getAllApplications().map(a => a.AppID);
  let appId = app.AppID;
  if (!appId) {
    let n = existingIds.length + 1;
    do {
      appId = 'APP' + String(n).padStart(3, '0');
      n++;
    } while (existingIds.indexOf(appId) !== -1);
  }
  sh.appendRow([
    appId, app.Nama, app.URL, app.Icon || 'apps', app.Warna || '#2196F3',
    app.Kategori || 'Umum', app.Deskripsi || '', app.Status || 'Aktif'
  ]);
  _invalidateAppCache();
  return appId;
}

function updateApplicationRecord(appId, updates) {
  const sh = _sheet(CONFIG.SHEETS.APPLICATIONS);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('AppID');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(appId)) {
      Object.keys(updates).forEach(key => {
        const col = headers.indexOf(key);
        if (col !== -1) sh.getRange(i + 1, col + 1).setValue(updates[key]);
      });
      _invalidateAppCache();
      return true;
    }
  }
  return false;
}

// ---------------- ACCESS ----------------

function getAllAccess() {
  return _readAll(CONFIG.SHEETS.ACCESS);
}

function getAccessAppIdsForEmail(email) {
  email = String(email).toLowerCase().trim();
  return getAllAccess()
    .filter(a => String(a.Email).toLowerCase().trim() === email)
    .map(a => String(a.AppID));
}

/** Set ulang seluruh akses seorang user ke daftar AppID tertentu (dipakai admin panel) */
function setAccessForUser(email, appIds) {
  const sh = _sheet(CONFIG.SHEETS.ACCESS);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const emailCol = headers.indexOf('Email');

  // Hapus baris lama milik email ini (dari bawah ke atas agar index aman)
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][emailCol]).toLowerCase().trim() === String(email).toLowerCase().trim()) {
      sh.deleteRow(i + 1);
    }
  }
  // Tambahkan baris baru
  appIds.forEach(appId => sh.appendRow([email, appId]));
  _invalidateUserCache(email);
}

// ---------------- LOGS ----------------

function logActivity(email, appId, status) {
  try {
    const sh = _sheet(CONFIG.SHEETS.LOGS);
    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const tanggal = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const jam = Utilities.formatDate(now, tz, 'HH:mm:ss');
    sh.appendRow([tanggal, jam, email, appId || '-', status, '-']);
  } catch (e) {
    // Jangan sampai kegagalan logging mengganggu alur login utama
    console.error('logActivity error: ' + e);
  }
}

function getRecentLogs(limit) {
  const rows = _readAll(CONFIG.SHEETS.LOGS);
  return rows.slice(Math.max(0, rows.length - (limit || 100))).reverse();
}

function getLogsFiltered(filters) {
  filters = filters || {};
  let rows = _readAll(CONFIG.SHEETS.LOGS);
  if (filters.email) {
    rows = rows.filter(r => String(r.Email).toLowerCase().includes(String(filters.email).toLowerCase()));
  }
  if (filters.status) {
    rows = rows.filter(r => String(r.Status) === filters.status);
  }
  if (filters.date) {
    rows = rows.filter(r => String(r.Tanggal) === filters.date);
  }
  return rows.reverse();
}

// ---------------- Cache helpers ----------------

function _invalidateUserCache(email) {
  try {
    CacheService.getScriptCache().remove('nusa_user_' + String(email).toLowerCase().trim());
  } catch (e) { /* ignore */ }
}

function _invalidateAppCache() {
  try {
    CacheService.getScriptCache().remove('nusa_apps_all');
  } catch (e) { /* ignore */ }
}
