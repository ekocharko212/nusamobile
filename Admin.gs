/**
 * ============================================================
 * NUSA mobile - Admin.gs
 * Semua fungsi di sini dipanggil dari admin.html via google.script.run
 * dan WAJIB memverifikasi isAdmin() sebelum mengubah data apa pun.
 * ============================================================
 */

function _requireAdmin(token) {
  const email = _requireSession(token);
  if (!isAdmin(email)) {
    throw new Error('Akses ditolak: hanya Administrator yang dapat melakukan aksi ini.');
  }
  return email;
}

// ---------------- Dashboard ----------------

function adminGetDashboardStats(token) {
  _requireAdmin(token);

  const users = getAllUsers();
  const apps = getAllApplications();
  const logs = _readAll(CONFIG.SHEETS.LOGS);

  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const thisMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  const loginsToday = logs.filter(l => String(l.Tanggal) === today && l.Status === 'Berhasil').length;

  const uniqueOnlineToday = new Set(
    logs.filter(l => String(l.Tanggal) === today).map(l => l.Email)
  ).size;

  // Aplikasi terbanyak dibuka (all-time, status 'Dibuka')
  const openCounts = {};
  logs.filter(l => l.Status === 'Dibuka').forEach(l => {
    openCounts[l.Aplikasi] = (openCounts[l.Aplikasi] || 0) + 1;
  });
  const topApps = Object.keys(openCounts)
    .map(appId => {
      const app = apps.find(a => String(a.AppID) === appId);
      return { appId: appId, nama: app ? app['Nama Aplikasi'] : appId, jumlah: openCounts[appId] };
    })
    .sort((a, b) => b.jumlah - a.jumlah)
    .slice(0, 5);

  // Grafik 14 hari terakhir
  const dailyMap = {};
  logs.filter(l => l.Status === 'Berhasil').forEach(l => {
    dailyMap[l.Tanggal] = (dailyMap[l.Tanggal] || 0) + 1;
  });
  const dailyChart = Object.keys(dailyMap).sort().slice(-14).map(d => ({ tanggal: d, jumlah: dailyMap[d] }));

  // Grafik bulanan (12 bulan terakhir)
  const monthlyMap = {};
  logs.filter(l => l.Status === 'Berhasil').forEach(l => {
    const bulan = String(l.Tanggal).slice(0, 7);
    monthlyMap[bulan] = (monthlyMap[bulan] || 0) + 1;
  });
  const monthlyChart = Object.keys(monthlyMap).sort().slice(-12).map(m => ({ bulan: m, jumlah: monthlyMap[m] }));

  return {
    jumlahUser: users.length,
    jumlahAplikasi: apps.length,
    loginHariIni: loginsToday,
    userOnline: uniqueOnlineToday,
    topApps: topApps,
    dailyChart: dailyChart,
    monthlyChart: monthlyChart
  };
}

// ---------------- Users ----------------

function adminGetUsers(token) {
  _requireAdmin(token);
  return getAllUsers();
}

function adminSaveUser(token, user) {
  _requireAdmin(token);
  if (!user.Email) throw new Error('Email wajib diisi.');
  const existing = getUserByEmail(user.Email);
  if (existing) {
    updateUserRecord(user.Email, {
      Nama: user.Nama, Jabatan: user.Jabatan, Status: user.Status, Role: user.Role
    });
  } else {
    addUserRecord(user);
  }
  return true;
}

function adminSetUserStatus(token, email, status) {
  _requireAdmin(token);
  return setUserStatus(email, status);
}

/** Import banyak user sekaligus, format: [{Email,Nama,Jabatan,Status,Role}, ...] */
function adminImportUsers(token, userList) {
  _requireAdmin(token);
  let count = 0;
  userList.forEach(u => {
    if (!u.Email) return;
    if (getUserByEmail(u.Email)) {
      updateUserRecord(u.Email, u);
    } else {
      addUserRecord(u);
    }
    count++;
  });
  return count;
}

// ---------------- Applications ----------------

function adminGetApplications(token) {
  _requireAdmin(token);
  return getAllApplications();
}

function adminSaveApplication(token, app) {
  _requireAdmin(token);
  if (!app.Nama || !app.URL) throw new Error('Nama dan URL aplikasi wajib diisi.');
  if (app.AppID && getApplicationById(app.AppID)) {
    updateApplicationRecord(app.AppID, {
      'Nama Aplikasi': app.Nama, URL: app.URL, Icon: app.Icon, Warna: app.Warna,
      Kategori: app.Kategori, Deskripsi: app.Deskripsi, Status: app.Status
    });
    return app.AppID;
  } else {
    return addApplicationRecord(app);
  }
}

// ---------------- Access ----------------

function adminGetAccessMatrix(token) {
  _requireAdmin(token);
  const users = getAllUsers();
  const apps = getActiveApplications();
  const access = getAllAccess();
  const matrix = users.map(u => {
    const appIds = access.filter(a => String(a.Email).toLowerCase() === String(u.Email).toLowerCase()).map(a => String(a.AppID));
    return { email: u.Email, nama: u.Nama, role: u.Role, appIds: appIds };
  });
  return { users: matrix, apps: apps };
}

function adminSaveAccess(token, email, appIds) {
  _requireAdmin(token);
  setAccessForUser(email, appIds);
  return true;
}

// ---------------- Logs ----------------

function adminGetLogs(token, filters) {
  _requireAdmin(token);
  return getLogsFiltered(filters).slice(0, 500);
}
