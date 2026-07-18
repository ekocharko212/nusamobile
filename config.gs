/**
 * ============================================================
 * NUSA mobile - Config.gs
 * ============================================================
 * Ubah SPREADSHEET_ID di bawah ini ke ID Google Spreadsheet
 * yang berisi sheet USERS, APPLICATIONS, ACCESS, dan LOGS.
 *
 * Cara ambil ID: buka spreadsheet, lihat URL, ID-nya ada di antara
 * "/d/" dan "/edit", contoh:
 * https://docs.google.com/spreadsheets/d/ID_SPREADSHEET_ANDA/edit
 * ============================================================
 */

const CONFIG = {
  SPREADSHEET_ID: '1-OQK4Ymv-TOnh7auuWUh3z_Rr0hmcu4OR3f89ytCJsM',

  // OAuth Client ID (Web application) dari Google Cloud Console.
  // Dipakai untuk alur "Sign in with Google" lewat redirect penuh
  // (OAuth 2.0 Authorization Code), BUKAN lagi Google Identity Services
  // client-side (google.accounts.id) - karena GIS mengecek origin
  // JavaScript, sedangkan konten Web App Apps Script selalu di-serve
  // dari dalam iframe sandbox di domain script.googleusercontent.com
  // yang dinamis, sehingga origin TIDAK PERNAH bisa cocok -> error
  // "origin_mismatch" / "no registered origin". Redirect flow ini
  // memakai "Authorized redirect URIs" (bukan JavaScript origins),
  // yang cocok dipakai untuk top-level navigation seperti ini.
  GOOGLE_CLIENT_ID: '263604591330-qj8e2df3ovbd3f3g5pb3bhdji85ld5fp.apps.googleusercontent.com',

  // Client Secret TIDAK disimpan di sini (jangan taruh secret di kode).
  // Isi lewat: Project Settings (ikon gerigi) > Script Properties >
  // tambah property dengan nama persis "GOOGLE_CLIENT_SECRET".
  // Nilainya diambil dari Google Cloud Console > Credentials > Client
  // ID yang sama > kolom "Client secret".


  SHEETS: {
    USERS: 'USERS',
    APPLICATIONS: 'APPLICATIONS',
    ACCESS: 'ACCESS',
    LOGS: 'LOGS'
  },

  // Lama sesi aktif (jam) sebelum client dianggap perlu re-check akses
  SESSION_DURATION_HOURS: 8,

  // Lama cache server-side (detik) untuk data user & apps - mengurangi baca Sheet berulang
  CACHE_DURATION_SECONDS: 6 * 60 * 60, // 6 jam, di bawah SESSION_DURATION_HOURS

  // Kosongkan array untuk mengizinkan semua domain Google. Isi mis. ['oikn.go.id']
  // untuk membatasi hanya email dari domain tertentu yang boleh mencoba login.
  ALLOWED_DOMAINS: [],

  ROLES: {
    ADMIN: 'Administrator',
    OPERATOR: 'Operator',
    SUPERVISOR: 'Supervisor',
    VIEWER: 'Viewer'
  },

  APP_NAME: 'NUSA mobile',
  ORG_NAME: 'Otorita Ibu Kota Nusantara'
};

/**
 * Web app root URL, dipakai untuk membangun link admin/logout dsb.
 */
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}
