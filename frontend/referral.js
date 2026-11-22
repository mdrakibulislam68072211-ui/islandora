
(() => {
  "use strict";

  const API = window.APP_CONFIG?.REFERRAL_API_URL;
  if (!API || !window.firebase) {
    console.error("Islandora Referral: configuration or Firebase missing.");
    return;
  }

  const STORAGE_KEY = "islandora_device_token";
  const PENDING_KEY = "islandora_pending_referral";
  const LANG_KEY = "islandora_referral_language";

  let currentUser = null;
  let myReferralCode = "";
  let validCount = 0;
  let language = localStorage.getItem(LANG_KEY) || "en";
  let referralView = null;

  const translations = {
    en: {
      title: "Referral Program",
      subtitle: "Invite friends and grow your Islandora network.",
      yourCode: "Your Referral Code",
      yourLink: "Your Referral Link",
      copy: "Copy",
      copied: "Copied!",
      valid: "Valid Referrals",
      enter: "Enter Referral Code",
      apply: "Apply Code",
      applied: "Referral code applied successfully.",
      noticeTitle: "Important Notice",
      notice: "Creating an account alone does not count as a valid referral. A referred user will only count after opening at least one mining box.",
      same: "Accounts using the same device will not count as valid referrals and will not generate referral rewards.",
      login: "Please log in to view your referral information.",
      invalid: "Please enter a valid referral code.",
      loading: "Loading referral information...",
      failed: "Unable to load referral information. Please try again.",
      appliedBefore: "A referral code may only be applied once.",
      back: "Close",
      signup: "Referral Code (Optional)"
    },
    bn: {
      title: "রেফারেল প্রোগ্রাম",
      subtitle: "বন্ধুদের আমন্ত্রণ জানান এবং Islandora নেটওয়ার্ক বড় করুন।",
      yourCode: "আপনার রেফারেল কোড",
      yourLink: "আপনার রেফারেল লিংক",
      copy: "কপি",
      copied: "কপি হয়েছে!",
      valid: "বৈধ রেফারেলের সংখ্যা",
      enter: "রেফারেল কোড লিখুন",
      apply: "কোড প্রয়োগ করুন",
      applied: "রেফারেল কোড সফলভাবে যুক্ত হয়েছে।",
      noticeTitle: "গুরুত্বপূর্ণ বিজ্ঞপ্তি",
      notice: "শুধু অ্যাকাউন্ট তৈরি করলেই বৈধ রেফারেল হিসেবে গণনা হবে না। আমন্ত্রিত ব্যবহারকারী অন্তত একটি মাইনিং বক্স খুললেই কেবল তাকে বৈধ রেফারেল হিসেবে গণনা করা হবে।",
      same: "একই ডিভাইস ব্যবহার করে তৈরি অ্যাকাউন্ট বৈধ রেফারেল হিসেবে গণনা হবে না এবং কোনো রেফারেল পুরস্কারও তৈরি করবে না।",
      login: "রেফারেল তথ্য দেখতে অনুগ্রহ করে লগইন করুন।",
      invalid: "অনুগ্রহ করে সঠিক রেফারেল কোড লিখুন।",
      loading: "রেফারেল তথ্য লোড হচ্ছে...",
      failed: "রেফারেল তথ্য লোড করা যায়নি। আবার চেষ্টা করুন।",
      appliedBefore: "একটি অ্যাকাউন্টে একবারই রেফারেল কোড যুক্ত করা যাবে।",
      back: "বন্ধ করুন",
      signup: "রেফারেল কোড (ঐচ্ছিক)"
    },
    hi: {
      title: "रेफरल प्रोग्राम",
      subtitle: "दोस्तों को आमंत्रित करें और अपना Islandora नेटवर्क बढ़ाएँ।",
      yourCode: "आपका रेफरल कोड",
      yourLink: "आपका रेफरल लिंक",
      copy: "कॉपी करें",
      copied: "कॉपी हो गया!",
      valid: "मान्य रेफरल",
      enter: "रेफरल कोड दर्ज करें",
      apply: "कोड लागू करें",
      applied: "रेफरल कोड सफलतापूर्वक लागू हुआ।",
      noticeTitle: "महत्वपूर्ण सूचना",
      notice: "केवल अकाउंट बनाने से कोई रेफरल मान्य नहीं होगा। आमंत्रित उपयोगकर्ता कम से कम एक माइनिंग बॉक्स खोलने के बाद ही मान्य रेफरल माना जाएगा।",
      same: "एक ही डिवाइस से बनाए गए अकाउंट मान्य रेफरल नहीं माने जाएंगे और उनसे कोई रेफरल पुरस्कार नहीं मिलेगा।",
      login: "अपनी रेफरल जानकारी देखने के लिए कृपया लॉग इन करें।",
      invalid: "कृपया एक सही रेफरल कोड दर्ज करें।",
      loading: "रेफरल जानकारी लोड हो रही है...",
      failed: "रेफरल जानकारी लोड नहीं हो सकी। कृपया फिर कोशिश करें।",
      appliedBefore: "एक अकाउंट पर केवल एक बार रेफरल कोड लागू किया जा सकता है।",
      back: "बंद करें",
      signup: "रेफरल कोड (वैकल्पिक)"
    }
  };

  const t = key => (translations[language] || translations.en)[key];

  function getDeviceToken() {
    let token = localStorage.getItem(STORAGE_KEY);

    if (!token) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      localStorage.setItem(STORAGE_KEY, token);
    }

    return token;
  }

  function getPendingCode() {
    const params = new URLSearchParams(location.search);
    const urlCode = params.get("ref");

    if (urlCode) {
      const code = urlCode.trim().toLowerCase();
      if (/^[a-f0-9]{16}$/.test(code)) {
        sessionStorage.setItem(PENDING_KEY, code);
      }
    }

    return sessionStorage.getItem(PENDING_KEY) || "";
  }

  async function apiRequest(path, method = "GET", body = null) {
    if (!currentUser) throw new Error("Please log in.");

    const token = await currentUser.getIdToken();

    const response = await fetch(API + path, {
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

  function ensureStyles() {
    if (document.getElementById("islandora-referral-styles")) return;

    const style = document.createElement("style");
    style.id = "islandora-referral-styles";
    style.textContent = `
      #islandoraReferralView {
        position: fixed;
        inset: 0;
        z-index: 99999;
        overflow-y: auto;
        background: #071b24;
        color: #fff;
        padding: 22px 16px 40px;
        font-family: inherit;
      }
      .ir-wrap {
        max-width: 620px;
        margin: 0 auto;
      }
      .ir-top {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin-bottom:24px;
      }
      .ir-title {
        font-size:25px;
        font-weight:800;
        margin:0 0 7px;
      }
      .ir-subtitle {
        color:#b6cbd0;
        font-size:13px;
      }
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
        font-size:23px;
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
      .ir-button.secondary {
        background:#28505b;
      }
      .ir-input {
        width:100%;
        box-sizing:border-box;
        background:#071b24;
        color:white;
        border:1px solid #41616b;
        border-radius:9px;
        padding:13px;
        margin:7px 0 12px;
        font-size:15px;
      }
      .ir-count {
        font-size:32px;
        font-weight:800;
        color:#7fffd4;
      }
      .ir-notice {
        border-left:4px solid #eab54b;
      }
      .ir-notice strong {
        display:block;
        color:#ffd77b;
        margin-bottom:9px;
      }
      .ir-notice p {
        color:#d7e4e6;
        line-height:1.6;
        font-size:13px;
        margin:7px 0;
      }
      .ir-message {
        font-size:13px;
        line-height:1.5;
        color:#b6e8d9;
        margin-top:10px;
        overflow-wrap:anywhere;
      }
      .ir-language {
        background:#102d38;
        color:white;
        border:1px solid #41616b;
        border-radius:8px;
        padding:9px;
      }
      .ir-close {
        background:#28505b;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 12px;
        cursor:pointer;
      }
    `;
    document.head.appendChild(style);
  }

  function createReferralView() {
    if (referralView) return referralView;

    ensureStyles();

    referralView = document.createElement("div");
    referralView.id = "islandoraReferralView";
    referralView.hidden = true;
    document.body.appendChild(referralView);

    return referralView;
  }

  function render(message = "") {
    const view = createReferralView();

    view.innerHTML = `
      <div class="ir-wrap">
        <div class="ir-top">
          <div>
            <h2 class="ir-title">${t("title")}</h2>
            <div class="ir-subtitle">${t("subtitle")}</div>
          </div>
          <button class="ir-close" id="irClose">${t("back")}</button>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
          <select class="ir-language" id="irLanguage" aria-label="Language">
            <option value="en" ${language === "en" ? "selected" : ""}>English</option>
            <option value="bn" ${language === "bn" ? "selected" : ""}>বাংলা</option>
            <option value="hi" ${language === "hi" ? "selected" : ""}>हिन्दी</option>
          </select>
        </div>

        ${
          !currentUser
            ? `<div class="ir-card">${t("login")}</div>`
            : `
              <div class="ir-card">
                <span class="ir-label">${t("yourCode")}</span>
                <div class="ir-code">${myReferralCode || "..."}</div>
                <button class="ir-button" id="irCopyCode">${t("copy")}</button>
              </div>

              <div class="ir-card">
                <span class="ir-label">${t("yourLink")}</span>
                <div class="ir-link" id="irReferralLink"></div>
                <button class="ir-button" id="irCopyLink">${t("copy")}</button>
              </div>

              <div class="ir-card">
                <span class="ir-label">${t("valid")}</span>
                <div class="ir-count">${validCount}</div>
              </div>

              <div class="ir-card">
                <span class="ir-label">${t("enter")}</span>
                <input class="ir-input" id="irApplyInput"
                  placeholder="${t("enter")}" maxlength="16"
                  autocomplete="off">
                <button class="ir-button" id="irApply">${t("apply")}</button>
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

    if (currentUser) {
      const link = myReferralCode
        ? `${location.origin}${location.pathname}?ref=${myReferralCode}`
        : "";

      view.querySelector("#irReferralLink").textContent = link;

      view.querySelector("#irCopyCode").addEventListener("click", async () => {
        await copyText(myReferralCode);
        showMessage(t("copied"));
      });

      view.querySelector("#irCopyLink").addEventListener("click", async () => {
        await copyText(link);
        showMessage(t("copied"));
      });

      view.querySelector("#irApply").addEventListener("click", applyEnteredCode);
    }

    return view;
  }

  async function copyText(value) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  }

  function showMessage(message) {
    const node = document.getElementById("irMessage");
    if (node) node.textContent = message;
  }

  async function loadReferralData() {
    if (!currentUser) return;

    try {
      const device = await apiRequest("/api/referral/device", "POST", {
        device_token: getDeviceToken()
      });

      myReferralCode =
        device.referral_code ||
        device.referralCode ||
        device.data?.referral_code ||
        "";

      const me = await apiRequest("/api/referral/me");

      myReferralCode =
        me.referral_code ||
        me.referralCode ||
        me.data?.referral_code ||
        myReferralCode;

      validCount = Number(
        me.valid_referrals ??
        me.valid_count ??
        me.count ??
        me.data?.valid_referrals ??
        0
      );

      render();
    } catch (error) {
      console.error("Referral loading error:", error);
      render(t("failed"));
    }
  }

  async function applyCode(code) {
    if (!code || !/^[a-f0-9]{16}$/i.test(code)) {
      throw new Error(t("invalid"));
    }

    await apiRequest("/api/referral/apply", "POST", {
      referral_code: code.toLowerCase(),
      device_token: getDeviceToken()
    });

    sessionStorage.removeItem(PENDING_KEY);
  }

  async function applyEnteredCode() {
    const input = document.getElementById("irApplyInput");
    const code = input?.value.trim().toLowerCase();

    try {
      await applyCode(code);
      showMessage(t("applied"));
      if (input) input.value = "";
    } catch (error) {
      showMessage(error.message || t("failed"));
    }
  }

  function addSignupReferralField() {
    const forms = Array.from(document.querySelectorAll("form"));

    const form =
      document.getElementById("registerForm") ||
      document.querySelector('form[data-form="register"]') ||
      forms.find(item => {
        const text = (item.innerText || "").toLowerCase();
        return (
          item.querySelector('input[type="password"]') &&
          /register|sign up|create account|রেজিস্টার|নিবন্ধন/i.test(text)
        );
      });

    if (!form || form.querySelector("#islandoraSignupReferral")) return;

    const field = document.createElement("div");
    field.style.margin = "12px 0";
    field.innerHTML = `
      <label for="islandoraSignupReferral"
        style="display:block;margin-bottom:7px;font-size:13px">
        ${t("signup")}
      </label>
      <input id="islandoraSignupReferral"
        type="text" maxlength="16" autocomplete="off"
        placeholder="${t("signup")}"
        style="width:100%;box-sizing:border-box;padding:12px;border-radius:8px">
    `;

    const submit = form.querySelector(
      'button[type="submit"],input[type="submit"]'
    );

    if (submit) {
      submit.parentNode.insertBefore(field, submit);
    } else {
      form.appendChild(field);
    }

    form.addEventListener("submit", () => {
      const code = document
        .getElementById("islandoraSignupReferral")
        ?.value.trim().toLowerCase();

      if (code && /^[a-f0-9]{16}$/.test(code)) {
        sessionStorage.setItem(PENDING_KEY, code);
      }
    }, true);
  }

  function installNavigation() {
    document.addEventListener("click", event => {
      const link = event.target.closest('a[href="#referral"]');
      if (!link) return;

      event.preventDefault();
      event.stopPropagation();

      const view = render();
      view.hidden = false;

      if (currentUser) loadReferralData();
    }, true);
  }

  async function handlePendingReferral(user) {
    const code = getPendingCode();
    if (!code || !user) return;

    try {
      await applyCode(code);
      console.log("Referral code applied.");
    } catch (error) {
      console.warn("Referral code was not applied:", error.message);
      sessionStorage.removeItem(PENDING_KEY);
    }
  }

  function start() {
    addSignupReferralField();
    installNavigation();

    const observer = new MutationObserver(() => {
      addSignupReferralField();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    firebase.auth().onAuthStateChanged(async user => {
      currentUser = user || null;

      if (!user) {
        myReferralCode = "";
        validCount = 0;
        return;
      }

      await handlePendingReferral(user);
      await loadReferralData();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
