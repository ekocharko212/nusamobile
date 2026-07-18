/**
 * ============================================================
 * NUSA mobile - Auth.gs
 * ============================================================
 * Login memakai "Sign in with Google" lewat OAuth 2.0
 * Authorization Code flow (redirect penuh halaman) - BUKAN lagi
 * Google Identity Services (google.accounts.id) client-side, dan
 * BUKAN Session.getActiveUser().
 *
 * Kenapa BUKAN Google Identity Services (GIS) client-side:
 * - GIS mewajibkan origin JavaScript halaman yang memanggilnya
 *   cocok persis dengan salah satu "Authorized JavaScript origins"
 *   di Cloud Console. Tapi konten Web App Apps Script (HtmlService)
 *   SELALU dirender di dalam iframe sandbox tersembunyi yang
 *   di-serve dari domain script.googleusercontent.com yang dinamis
 *   (bukan script.google.com yang terlihat di address bar) -
 *   sehingga origin itu tidak pernah bisa didaftarkan, dan GIS akan
 *   selalu gagal dengan error "origin_mismatch" / "no registered
 *   origin". Ini keterbatasan arsitektur Apps Script, bukan salah
 *   konfigurasi.
 *
 * Kenapa BUKAN Session.getActiveUser():
 * - Itu hanya berfungsi kalau deployment di-set "Execute as: User
 *   accessing the web app", yang memaksa Google meminta izin scope
 *   Spreadsheet dari SETIAP akun yang membuka web app -> memicu layar
 *   "Google belum memverifikasi aplikasi ini" untuk semua orang
 *   selain developer.
 *
 * Kenapa OAuth 2.0 Authorization Code (redirect):
 * - Tombol login adalah <a href="..."> biasa yang membawa browser
 *   pindah halaman sepenuhnya (top-level navigation, keluar dari
 *   iframe sandbox) ke accounts.google.com, lalu Google redirect
 *   balik ke URL Web App ini (dicocokkan lewat "Authorized redirect
 *   URIs", BUKAN "Authorized JavaScript origins") membawa `?code=...`.
 *   Server (doGet) menukar code itu ke token lewat UrlFetchApp -
 *   proses ini sepenuhnya server-to-server, tidak terpengaruh iframe
 *   origin sama sekali.
 * - Deployment cukup "Execute as: Me" + "Who has access: Anyone",
 *   sama seperti sebelumnya - hanya developer yang authorize scope
 *   Spreadsheet (sekali), visitor lain hanya diminta scope dasar
 *   (openid/email/profile) yang tidak pernah memicu layar "unverified".
 *
 * Alur:
 * 1. User klik link "Sign in with Google" (dibangun oleh
 *    buildGoogleAuthUrl(), lihat Code.gs) -> pindah halaman penuh ke
 *    accounts.google.com.
 * 2. Setelah user login & consent, Google redirect balik ke URL Web
 *    App ini dengan query string ?code=...
 * 3. doGet(e) di Code.gs mendeteksi e.parameter.code, memanggil
 *    exchangeCodeForBootstrap(code, redirectUri) di file ini.
 * 4. Fungsi itu menukar code -> token ke Google
 *    (oauth2.googleapis.com/token) memakai Client ID + Client Secret
 *    (Client Secret disimpan di Script Properties, TIDAK di kode),
 *    ambil email dari id_token, lalu cek user terdaftar & Aktif di
 *    sheet USERS (logic sama seperti sebelumnya).
 * 5. Kalau lolos, server terbitkan "session token" bertanda-tangan
 *    sendiri (HMAC-SHA256, secret juga di Script Properties),
 *    disisipkan ke halaman & disimpan di client (localStorage, dengan
 *    fallback in-memory kalau storage diblokir Safari).
 * 6. Semua pemanggilan berikutnya (buka app, panel admin, resume
 *    sesi saat reload, dst) menyertakan session token ini; server
 *    verifikasi ulang setiap kali lewat resumeSession()/_requireSession().
 *
 * WAJIB diatur:
 * - Deploy > Manage deployments > Edit: Execute as "Me", Who has
 *   access "Anyone".
 * - Project Settings > Script Properties: tambah "GOOGLE_CLIENT_SECRET"
 *   (nilai dari Cloud Console > Credentials > Client ID yang sama).
 * - Cloud Console > Credentials > Client ID > Authorized redirect URIs:
 *   tambahkan persis URL /exec Web App ini (lihat instruksi terpisah).
 * ============================================================
 */

// ---------------- Session token (ditandatangani sendiri, HMAC) ----------------

function _getSessionSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  return secret;
}

function _sign(payload) {
  const bytes = Utilities.computeHmacSha256Signature(payload, _getSessionSecret());
  return Utilities.base64EncodeWebSafe(bytes);
}

function _makeSessionToken(email) {
  const payload = JSON.stringify({ email: email, exp: Date.now() + CONFIG.SESSION_DURATION_HOURS * 3600000 });
  const encoded = Utilities.base64EncodeWebSafe(payload);
  return encoded + '.' + _sign(encoded);
}

function _verifySessionToken(token) {
  if (!token || token.indexOf('.') === -1) throw new Error('Sesi tidak valid. Silakan login ulang.');
  const parts = token.split('.');
  const encoded = parts[0], sig = parts[1];
  if (_sign(encoded) !== sig) throw new Error('Sesi tidak valid. Silakan login ulang.');
  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString());
  } catch (e) {
    throw new Error('Sesi tidak valid. Silakan login ulang.');
  }
  if (!payload.exp || payload.exp < Date.now()) throw new Error('Sesi berakhir. Silakan login ulang.');
  return String(payload.email).toLowerCase().trim();
}

/** Dipakai fungsi admin & privileged lain untuk memastikan pemanggil punya sesi valid. */
function _requireSession(token) {
  return _verifySessionToken(token);
}

// ---------------- Verifikasi identitas Google (OAuth Authorization Code) ----------------

/** Ambil Client Secret dari Script Properties (JANGAN taruh secret di kode). */
function _getClientSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_SECRET');
  if (!secret) {
    throw new Error('GOOGLE_CLIENT_SECRET belum diisi di Script Properties (Project Settings > Script Properties).');
  }
  return secret;
}

/** Decode payload JWT (id_token) tanpa perlu verifikasi signature - signature sudah
 * implisit terpercaya karena id_token ini didapat langsung dari koneksi
 * server-ke-server (HTTPS) ke oauth2.googleapis.com/token, bukan dari client. */
function _decodeJwtPayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) throw new Error('id_token tidak valid.');
  const payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString();
  return JSON.parse(payload);
}

/** Bangun URL "Sign in with Google" (dipakai sebagai href tombol login di Index.html). */
function buildGoogleAuthUrl(redirectUri) {
  const params = {
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    include_granted_scopes: 'true'
  };
  const query = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + query;
}

/** Tukar authorization code (dari redirect Google) menjadi profil (email/nama/foto). */
function _exchangeCodeForProfile(code, redirectUri) {
  if (!code) throw new Error('Kode otorisasi Google tidak ditemukan.');
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.indexOf('PASTE_') === 0) {
    throw new Error('GOOGLE_CLIENT_ID belum diisi di Config.gs.');
  }
  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      code: code,
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      client_secret: _getClientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });
  const body = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200 || !body.id_token) {
    throw new Error('Gagal menukar kode otorisasi Google: ' + (body.error_description || body.error || 'tidak diketahui') + '. Coba login ulang.');
  }
  const data = _decodeJwtPayload(body.id_token);
  if (data.email_verified !== 'true' && data.email_verified !== true) throw new Error('Email Google belum terverifikasi.');
  return {
    email: String(data.email).toLowerCase().trim(),
    name: data.name || data.email,
    picture: data.picture || ''
  };
}

function _isDomainAllowed(email) {
  if (!CONFIG.ALLOWED_DOMAINS || CONFIG.ALLOWED_DOMAINS.length === 0) return true;
  const domain = String(email).split('@')[1] || '';
  return CONFIG.ALLOWED_DOMAINS.indexOf(domain) !== -1;
}

function isAdmin(email) {
  const user = getUserByEmail(email);
  if (!user) return false;
  const role = String(user.Role || '').trim().toLowerCase();
  const status = String(user.Status || '').trim().toLowerCase();
  return role === CONFIG.ROLES.ADMIN.toLowerCase() && status === 'aktif';
}

// ---------------- Bootstrap data (sama seperti sebelumnya, dipecah jadi helper) ----------------

function _buildBootstrap(email) {
  if (!_isDomainAllowed(email)) {
    logActivity(email, '-', 'Gagal (domain ditolak)');
    return { status: 'DOMAIN_REJECTED', email: email, message: 'Domain email Anda tidak diizinkan mengakses portal ini.' };
  }

  const user = getUserByEmail(email);
  if (!user || String(user.Status || '').trim().toLowerCase() !== 'aktif') {
    logActivity(email, '-', 'Gagal (tidak terdaftar/nonaktif)');
    return { status: 'NO_ACCESS', email: email, message: 'Akun Anda belum terdaftar atau sudah dinonaktifkan. Hubungi Administrator.' };
  }

  const admin = isAdmin(email);
  const apps = admin ? getActiveApplications() : _getAppsForNonAdmin(email);

  logActivity(email, '-', 'Berhasil');

  const cleanApps = apps.map(a => ({
    AppID: a.AppID,
    Nama: a['Nama Aplikasi'],
    URL: a.URL,
    Icon: a.Icon,
    Warna: a.Warna,
    Kategori: a.Kategori,
    Deskripsi: a.Deskripsi
  }));

  if (cleanApps.length === 0) {
    return { status: 'NO_ACCESS', email: email, message: 'Akun Anda terdaftar namun belum memiliki akses ke aplikasi apa pun. Hubungi Administrator.' };
  }

  return {
    status: cleanApps.length === 1 && !admin ? 'SINGLE_APP' : 'MULTI_APP',
    email: email,
    nama: user.Nama || email,
    jabatan: user.Jabatan || '',
    role: user.Role || CONFIG.ROLES.VIEWER,
    isAdmin: admin,
    apps: cleanApps,
    sessionHours: CONFIG.SESSION_DURATION_HOURS,
    appName: CONFIG.APP_NAME,
    orgName: CONFIG.ORG_NAME
  };
}

function _getAppsForNonAdmin(email) {
  const appIds = getAccessAppIdsForEmail(email);
  const allApps = getActiveApplications();
  return allApps.filter(a => appIds.indexOf(String(a.AppID)) !== -1);
}

/** Dipanggil dari doGet (Code.gs) saat Google redirect balik membawa ?code=... */
function exchangeCodeForBootstrap(code, redirectUri) {
  let profile;
  try {
    profile = _exchangeCodeForProfile(code, redirectUri);
  } catch (e) {
    return { status: 'NO_EMAIL', message: e.message || 'Gagal memverifikasi akun Google.' };
  }
  const data = _buildBootstrap(profile.email);
  if (data.status !== 'DOMAIN_REJECTED' && data.status !== 'NO_ACCESS') {
    data.sessionToken = _makeSessionToken(profile.email);
    data.namaGoogle = profile.name;
    data.picture = profile.picture;
  }
  return data;
}

/** Dipanggil client saat reload halaman & sudah ada session token tersimpan (sliding session). */
function resumeSession(token) {
  let email;
  try {
    email = _verifySessionToken(token);
  } catch (e) {
    return { status: 'NO_EMAIL', message: e.message };
  }
  const data = _buildBootstrap(email);
  if (data.status !== 'DOMAIN_REJECTED' && data.status !== 'NO_ACCESS') {
    data.sessionToken = _makeSessionToken(email); // perpanjang masa berlaku sesi
  }
  return data;
}

/** Dipanggil client saat klik "Buka" pada sebuah kartu aplikasi, untuk logging. */
function recordAppOpen(token, appId) {
  let email;
  try {
    email = _requireSession(token);
  } catch (e) {
    return false;
  }
  logActivity(email, appId, 'Dibuka');
  return true;
}
