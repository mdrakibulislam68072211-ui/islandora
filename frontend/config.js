
window.APP_CONFIG = {
  APP_NAME: "Islandora",

  // Cloudflare Worker API address
  API_BASE_URL: "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev",

  // Firebase Authentication configuration
  FIREBASE: {
    apiKey: "YOUR_FIREBASE_WEB_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    appId: "YOUR_FIREBASE_APP_ID"
  },

  // Telegram Mini App configuration
  TELEGRAM: {
    BOT_USERNAME: "YOUR_BOT_USERNAME"
  },

  // Application settings
  SETTINGS: {
    DEFAULT_LANGUAGE: "en",
    CURRENCY_NAME: "Coins",
    GEM_NAME: "Gems",
    PREVIEW_MODE: true
  }
};
