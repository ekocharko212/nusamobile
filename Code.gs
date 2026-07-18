/**
 * ============================================================
 * NUSA mobile - Code.gs
 * Entry point WebApp
 * ============================================================
 */

function doGet(e) {
  const redirectUri = ScriptApp.getService().getUrl();
  const template = HtmlService.createTemplateFromFile('Index');
  template.appName = CONFIG.APP_NAME;
  template.orgName = CONFIG.ORG_NAME;
  template.googleAuthUrl = buildGoogleAuthUrl(redirectUri);
  template.initialSessionToken = '';
  template.oauthError = '';

  if (e && e.parameter && e.parameter.error) {
    // User membatalkan / menolak consent Google.
    template.oauthError = 'Login Google dibatalkan atau ditolak. Silakan coba lagi.';
  } else if (e && e.parameter && e.parameter.code) {
    // Google baru saja redirect balik membawa authorization code.
    const result = exchangeCodeForBootstrap(e.parameter.code, redirectUri);
    if (result.sessionToken) {
      template.initialSessionToken = result.sessionToken;
    } else {
      template.oauthError = result.message || 'Login Google gagal. Silakan coba lagi.';
    }
  }

  return template.evaluate()
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    // HtmlOutput.addMetaTag() di Apps Script HANYA mengizinkan 2 nama:
    // 'viewport' dan 'apple-mobile-web-app-capable'. Nama lain akan
    // menyebabkan Exception: "The meta tag you specified is not allowed
    // in this context." saat WebApp dibuka.
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Helper untuk menyisipkan file HTML lain (CSS/JS terpisah) ke dalam template */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
