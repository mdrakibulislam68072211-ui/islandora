// UI bootstrap only. Live balances must come from the authenticated Worker API.
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }
  // Never calculate or award Coins/Gems in this file.
  // The Worker must verify Firebase ID tokens or Telegram initData and own all balances.
  const api = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL;
  if (!api || api.includes("YOUR-WORKER")) {
    console.info("Set API_BASE_URL in config.js after deploying the Cloudflare Worker.");
  }
})();
