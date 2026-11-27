
(() => {
  "use strict";

  const API = (window.APP_CONFIG?.REFERRAL_API_URL || "").replace(/\/+$/, "");
  const MAIN_API = (window.APP_CONFIG?.API_BASE_URL || "").replace(/\/+$/, "");

  if (!API || !MAIN_API || !window.firebase) {
    console.error("Islandora Referral: configuration missing.");
    return;
  }

  const DEVICE_KEY = "islandora_device_token";
  const PENDING_KEY = "islandora_pending_referral";
  const REGISTER_KEY = "islandora_registration_started";
  const LANG_KEY = "islandora_referral_language";

  let user = null;
  let referralCode = "";
  let validCount = 0;
  let commissionBalance = 0;
  let commissionEarned = 0;
  let commissionClaimable = 0;
  let language = localStorage.getItem(LANG_KEY) || "en";
  let referralView = null;
  let loading = false;

  const words = {
    en: {
      title: "Referral Program",
      subtitle: "Invite friends and grow your Islandora network.",
      code: "Your Referral Code",
      link: "Your Referral Link",
      copy: "Copy",
      copied: "Copied!",
      valid: "Valid Referrals",
      commission: "Referral Commission Balance",
      earned: "Total Earned",
      claim: "Claim Coins",
      claimMinimum: "Minimum claim: 5 Coins",
      claimSuccess: "Referral commission claimed successfully.",
      noticeTitle: "Important Notice",
      notice: "Creating an account alone does not count as a valid referral. A referred user will only count after opening at least one mining box.",
      same: "Accounts using the same device will not count as valid referrals and will not generate referral rewards.",
      login: "Please log in to view your referral information.",
      loading: "Loading referral information...",
      failed: "Unable to load referral information. Please try again.",
      close: "Close"
    },
    bn: {
      title: "রেফারেল প্রোগ্রাম",
      subtitle: "বন্ধুদের আমন্ত্রণ জানান এবং Islandora নেটওয়ার্ক বড় করুন।",
      code: "আপনার রেফারেল কোড",
      link: "আপনার রেফারেল লিংক",
      copy: "কপি",
      copied: "কপি হয়েছে!",
      valid: "বৈধ রেফারেলের সংখ্যা",
      commission: "রেফারেল কমিশন ব্যালেন্স",
      earned: "মোট আয়",
      claim: "কয়েন ক্লেইম করুন",
      claimMinimum: "সর্বনিম্ন ক্লেইম: ৫ Coins",
      claimSuccess: "রেফারেল কমিশন সফলভাবে ক্লেইম হয়েছে।",
      noticeTitle: "গুরুত্বপূর্ণ বিজ্ঞপ্তি",
      notice: "শুধু অ্যাকাউন্ট তৈরি করলেই বৈধ রেফারেল হিসেবে গণনা হবে না। আমন্ত্রিত ব্যবহারকারী অন্তত একটি মাইনিং বক্স খুললেই কেবল তাকে বৈধ রেফারেল হিসেবে গণনা করা হবে।",
      same: "একই ডিভাইস ব্যবহার করে তৈরি অ্যাকাউন্ট বৈধ রেফারেল হিসেবে গণনা হবে না এবং কোনো রেফারেল পুরস্কারও তৈরি করবে না।",
      login: "রেফারেল তথ্য দেখতে অনুগ্রহ করে লগইন করুন।",
      loading: "রেফারেল তথ্য লোড হচ্ছে...",
      failed: "রেফারেল তথ্য লোড করা যায়নি। আবার চেষ্টা করুন।",
      close: "বন্ধ করুন"
    },
    hi: {
      title: "रेफरल प्रोग्राम",
      subtitle: "दोस्तों को आमंत्रित करें और अपना Islandora नेटवर्क बढ़ाएँ।",
      code: "आपका रेफरल कोड",
      link: "आपका रेफरल लिंक",
      copy: "कॉपी करें",
      copied: "कॉपी हो गया!",
      valid: "मान्य रेफरल",
      commission: "रेफरल कमीशन बैलेंस",
      earned: "कुल कमाई",
      claim: "Coins क्लेम करें",
      claimMinimum: "न्यूनतम क्लेम: 5 Coins",
      claimSuccess: "रेफरल कमीशन सफलतापूर्वक क्लेम हुआ।",
      noticeTitle: "महत्वपूर्ण सूचना",
      notice: "केवल अकाउंट बनाने से कोई रेफरल मान्य नहीं होगा। आमंत्रित उपयोगकर्ता कम से कम एक माइनिंग बॉक्स खोलने के बाद ही मान्य रेफरल माना जाएगा।",
      same: "एक ही डिवाइस से बनाए गए अकाउंट मान्य रेफरल नहीं माने जाएंगे और उनसे कोई रेफरल पुरस्कार नहीं मिलेगा।",
      login: "अपनी रेफरल जानकारी देखने के लिए कृपया लॉग इन करें।",
      loading: "रेफरल जानकारी लोड हो रही है...",
      failed: "रेफरल जानकारी लोड नहीं हो सकी। कृपया फिर कोशिश करें।",
      close: "बंद करें"
    }
  };

  const t = key => (words[language] || words.en)[key];

  function getDeviceToken() {
    let token = localStorage.getItem(DEVICE_KEY);

    if (!token) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
      localStorage.setItem(DEVICE_KEY, token);
    }

    return token;
  }

  function getReferralFromURL() {
    const params = new URLSearchParams(location.search);
    const code = (params.get("ref") || "").trim().toLowerCase();

    if (/^[a-f0-9]{16}$/.test(code)) {
      sessionStorage.setItem(PENDING_KEY, code);
    }

    return sessionStorage.getItem(PENDING_KEY) || "";
  }

  async function getToken() {
    if (!user) throw new Error("User is not logged in.");
    return user.getIdToken();
  }

  async function request(url, method = "GET", body = null) {
    const token = await getToken();

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
      throw new Error(
        data.message || data.error || "Request failed"
      );
    }

    return data;
  }

  async function requestMain(path, method = "GET", body = null) {
    const token = await getToken();
    const response = await fetch(MAIN_API + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.message || data.error || "Request failed");
    }
    return data;
  }

  async function syncMainBackend() {
    const token = await getToken();

    const response = await fetch(MAIN_API + "/api/auth/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(data.message || "Account synchronization failed.");
    }

    return data;
  }

  async function applyPendingReferral() {
    const code = sessionStorage.getItem(PENDING_KEY);
    const registrationStarted =
      sessionStorage.getItem(REGISTER_KEY) === "1";

    if (!code || !registrationStarted || !user) return true;

    const created = Date.parse(user.metadata?.creationTime || "");
    const signedIn = Date.parse(user.metadata?.lastSignInTime || "");

    // A fresh registration normally has matching creation and sign-in times.
    // This also prevents a stale registration flag applying on a later login.
    if (
      !created ||
      !signedIn ||
      Math.abs(signedIn - created) > 120000
    ) {
      sessionStorage.removeItem(REGISTER_KEY);
      return true;
    }

    try {
      await syncMainBackend();

      await request(API + "/api/referral/device", "POST", {
        device_token: getDeviceToken()
      });

      await request(API + "/api/referral/apply", "POST", {
        referral_code: code,
        device_token: getDeviceToken()
      });

      sessionStorage.removeItem(PENDING_KEY);
      sessionStorage.removeItem(REGISTER_KEY);
      console.info("Islandora referral code applied.");
      return true;
    } catch (error) {
      console.error("Referral application failed:", error);
      sessionStorage.setItem(REGISTER_KEY, "1");
      return false;
    }
  }

  function addStyles() {
    if (document.getElementById("islandora-referral-css")) return;

    const style = document.createElement("style");
    style.id = "islandora-referral-css";
    style.textContent = `
      #islandoraReferralView {
        position:fixed;
        inset:0;
        z-index:99999;
        overflow-y:auto;
        background:#071b24;
        color:#fff;
        padding:22px 16px 40px;
        font-family:inherit;
      }
      .ir-wrap {max-width:620px;margin:auto}
      .ir-top {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
        margin-bottom:20px;
      }
      .ir-title {font-size:25px;font-weight:800;margin:0 0 7px}
      .ir-subtitle {font-size:13px;color:#b6cbd0}
      .ir-card {
        background:#102d38;
        border:1px solid #28505b;
        border-radius:15px;
        padding:18px;
        margin:14px 0;
      }
      .ir-label {
        display:block;
        color:#b6cbd0;
        font-size:13px;
        margin-bottom:10px;
      }
      .ir-code {
        font-size:22px;
        font-weight:800;
        letter-spacing:2px;
        overflow-wrap:anywhere;
        color:#7fffd4;
        margin-bottom:13px;
      }
      .ir-link {
        overflow-wrap:anywhere;
        font-size:13px;
        color:#a8e6d5;
        margin:8px 0 14px;
      }
      .ir-button {
        border:0;
        border-radius:9px;
        padding:11px 16px;
        background:#18a77b;
        color:white;
        font-weight:700;
        cursor:pointer;
      }
      .ir-count {font-size:32px;font-weight:800;color:#7fffd4}
      .ir-notice {border-left:4px solid #eab54b}
      .ir-notice strong {display:block;color:#ffd77b;margin-bottom:9px}
      .ir-notice p {
        color:#d7e4e6;
        line-height:1.6;
        font-size:13px;
        margin:7px 0;
      }
      .ir-language,.ir-close {
        background:#28505b;
        color:white;
        border:1px solid #41616b;
        border-radius:8px;
        padding:9px 12px;
      }
      .ir-message {font-size:13px;color:#b6e8d9;margin-top:10px}
    `;
    document.head.appendChild(style);
  }

  function createView() {
    if (referralView) return referralView;

    addStyles();

    referralView = document.createElement("div");
    referralView.id = "islandoraReferralView";
    referralView.hidden = true;
    document.body.appendChild(referralView);

    return referralView;
  }

  async function copyText(value) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const field = document.createElement("textarea");
      field.value = value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }

    const message = document.getElementById("irMessage");
    if (message) message.textContent = t("copied");
  }

  function render(message = "") {
    const view = createView();

    const link = referralCode
      ? location.origin + location.pathname + "?ref=" + referralCode
      : "";

    view.innerHTML = `
      <div class="ir-wrap">
        <div class="ir-top">
          <div>
            <h2 class="ir-title">${t("title")}</h2>
            <div class="ir-subtitle">${t("subtitle")}</div>
          </div>
          <button class="ir-close" id="irClose">${t("close")}</button>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
          <select class="ir-language" id="irLanguage">
            <option value="en" ${language === "en" ? "selected" : ""}>English</option>
            <option value="bn" ${language === "bn" ? "selected" : ""}>বাংলা</option>
            <option value="hi" ${language === "hi" ? "selected" : ""}>हिन्दी</option>
          </select>
        </div>

        ${
          !user
            ? `<div class="ir-card">${t("login")}</div>`
            : `
              <div class="ir-card">
                <span class="ir-label">${t("code")}</span>
                <div class="ir-code">${referralCode || "..."}</div>
                <button class="ir-button" id="irCopyCode">${t("copy")}</button>
              </div>

              <div class="ir-card">
                <span class="ir-label">${t("link")}</span>
                <div class="ir-link">${link}</div>
                <button class="ir-button" id="irCopyLink">${t("copy")}</button>
              </div>

              <div class="ir-card">
                <span class="ir-label">${t("valid")}</span>
                <div class="ir-count">${validCount}</div>
              </div>
              <div class="ir-card">
                <span class="ir-label">${t("commission")}</span>
                <div class="ir-count">${commissionBalance.toFixed(3)} Coins</div>
                <p class="ir-subtitle">${t("earned")}: ${commissionEarned.toFixed(3)} Coins</p>
                <p class="ir-subtitle">${t("claimMinimum")}</p>
                <button class="ir-button" id="irClaimCommission" ${commissionClaimable < 5 ? "disabled" : ""}>${t("claim")} (${commissionClaimable.toLocaleString()} Coins)</button>
              </div>
            `
        }

        <div class="ir-card ir-notice">
          <strong>${t("noticeTitle")}</strong>
          <p>${t("notice")}</p>
          <p>${t("same")}</p>
        </div>

        <div class="ir-message" id="irMessage">${message}</div>
      </div>
    `;

    view.querySelector("#irClose").addEventListener("click", () => {
      view.hidden = true;
    });

    view.querySelector("#irLanguage").addEventListener("change", event => {
      language = event.target.value;
      localStorage.setItem(LANG_KEY, language);
      render(message);
    });

    if (user) {
      const claimButton = view.querySelector("#irClaimCommission");
      claimButton?.addEventListener("click", async () => {
        claimButton.disabled = true;
        try {
          const result = await requestMain("/api/referral/commission/claim", "POST", {
            idempotency_key: crypto.randomUUID().replace(/-/g, "")
          });
          commissionBalance = Number(result.remaining_coins || 0);
          await loadReferralData();
          render(t("claimSuccess"));
        } catch (error) {
          render(error.message);
        }
      });
      view.querySelector("#irCopyCode").addEventListener("click", () => {
        copyText(referralCode);
      });

      view.querySelector("#irCopyLink").addEventListener("click", () => {
        copyText(link);
      });
    }

    return view;
  }

  async function loadReferralData() {
    if (!user || loading) return;

    loading = true;

    try {
      const device = await request(
        API + "/api/referral/device",
        "POST",
        { device_token: getDeviceToken() }
      );

      referralCode =
        device.referral_code ||
        device.referralCode ||
        device.data?.referral_code ||
        "";

      const result = await request(API + "/api/referral/me");

      referralCode =
        result.referral_code ||
        result.referralCode ||
        result.data?.referral_code ||
        referralCode;

      validCount = Number(
        result.valid_referrals ??
        result.valid_count ??
        result.count ??
        result.data?.valid_referrals ??
        0
      );
      const commission = await requestMain("/api/referral/commission");
      commissionBalance = Number(commission.balance_coins || 0);
      commissionEarned = Number(commission.earned_coins || 0);
      commissionClaimable = Number(commission.claimable_coins || 0);

      render();
    } catch (error) {
      console.error("Referral data error:", error);
      render(t("failed"));
    } finally {
      loading = false;
    }
  }

  function addSignupField() {
    const form = document.getElementById("registerForm");
    if (!form || document.getElementById("islandoraSignupReferral")) return;

    const field = document.createElement("div");
    field.className = "auth-field";
    field.innerHTML = `
      <label for="islandoraSignupReferral">Referral Code (Optional)</label>
      <input
        id="islandoraSignupReferral"
        type="text"
        maxlength="16"
        autocomplete="off"
        placeholder="Enter referral code"
      >
    `;

    const button = document.getElementById("registerButton");

    if (button) {
      form.insertBefore(field, button);
    } else {
      form.appendChild(field);
    }

    const savedCode = getReferralFromURL();
    const input = document.getElementById("islandoraSignupReferral");

    if (savedCode && input) {
      input.value = savedCode;
      input.readOnly = true;
    }

    // Capture runs before app.js handles the registration submit.
    form.addEventListener("submit", () => {
      const entered = (input?.value || "").trim().toLowerCase();

      if (/^[a-f0-9]{16}$/.test(entered)) {
        sessionStorage.setItem(PENDING_KEY, entered);
        sessionStorage.setItem(REGISTER_KEY, "1");
      } else {
        sessionStorage.removeItem(REGISTER_KEY);
      }
    }, true);
  }

  function installNavigation() {
    document.addEventListener("click", event => {
      const link = event.target.closest('a[href="#referral"]');
      if (!link) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const view = render();
      view.hidden = false;

      if (user) loadReferralData();
    }, true);
  }

  function start() {
    getReferralFromURL();
    addSignupField();
    installNavigation();

    const observer = new MutationObserver(addSignupField);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    firebase.auth().onAuthStateChanged(async currentUser => {
      user = currentUser || null;

      if (!user) {
        referralCode = "";
        validCount = 0;
        return;
      }

      const referralReady = await applyPendingReferral();
      window.__islandoraReferralStatus = { uid: user.uid, success: referralReady !== false };
      window.dispatchEvent(new CustomEvent("islandora-referral-ready", {
        detail: { uid: user.uid, success: referralReady !== false }
      }));
      await loadReferralData();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
