
(() => {
  "use strict";

  // ==========================================
  // FIREBASE INITIALIZATION
  // ==========================================

  const firebaseConfig = window.APP_CONFIG?.FIREBASE;

  if (!firebaseConfig || !firebaseConfig.apiKey) {
    console.error("Firebase configuration is missing.");
    return;
  }

  if (!window.firebase || !firebase.auth) {
    console.error("Firebase SDK is not loaded.");
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();

  const persistenceReady = auth.setPersistence(
    firebase.auth.Auth.Persistence.LOCAL
  ).catch(error => {
    console.error("Firebase persistence error:", error);
    throw error;
  });

  // ==========================================
  // TELEGRAM MINI APP
  // ==========================================

  const telegram = window.Telegram?.WebApp;

  if (telegram) {
    telegram.ready();
    telegram.expand();
  }

  // ==========================================
  // DOM HELPERS
  // ==========================================

  const $ = selector => document.querySelector(selector);

  const authScreen = $("#authScreen");
  const gameShell = $("#gameShell");
  const authError = $("#authError");
  const profilePanel = $("#profilePanel");

  let toastTimer = null;
  let backendSyncedUid = null;

  // ==========================================
  // REQUIRED DOM CHECK
  // ==========================================

  const requiredElements = [
    "#authScreen",
    "#gameShell",
    "#authError",
    "#loginForm",
    "#registerForm",
    "#loginEmail",
    "#loginPassword",
    "#loginButton",
    "#registerEmail",
    "#registerPassword",
    "#confirmPassword",
    "#registerButton",
    "#loginTab",
    "#registerTab",
    "#profilePanel",
    "#profileButton",
    "#closeProfileButton",
    "#logoutButton",
    "#islandList",
    "#islandHero",
    "#islandTitle",
    "#islandSubtitle",
    "#islandDescription",
    "#islandCost",
    "#islandStatus",
    "#boxGrid",
    "#islandRate",
    "#viewAllIslands",
    "#claimButton",
    "#pendingCoins",
    "#storageAmount",
    "#storageProgressText",
    "#storagePercentage",
    "#storageProgressFill",
    "#storagePanel"
  ];

  const missingElements = requiredElements.filter(
    selector => !$(selector)
  );

  if (missingElements.length) {
    console.error(
      "Islandora HTML elements are missing:",
      missingElements
    );

    return;
  }

  // ==========================================
  // TOAST
  // ==========================================

  function showToast(message) {
    const element = $("#toast");

    if (!element) return;

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      element.classList.remove("show");
    }, 2600);
  }

  // ==========================================
  // AUTH ERROR MESSAGES
  // ==========================================

  function getAuthErrorMessage(error) {
    const messages = {
      "auth/email-already-in-use":
        "This email is already registered. Please login.",

      "auth/invalid-email":
        "Please enter a valid email address.",

      "auth/weak-password":
        "Password must be at least 6 characters.",

      "auth/user-not-found":
        "No account found with this email.",

      "auth/wrong-password":
        "Incorrect password. Please try again.",

      "auth/invalid-credential":
        "Incorrect email or password.",

      "auth/too-many-requests":
        "Too many attempts. Please try again later.",

      "auth/network-request-failed":
        "Network error. Check your internet connection.",

      "auth/operation-not-allowed":
        "Email/Password login is not enabled in Firebase.",

      "auth/invalid-api-key":
        "Firebase API configuration is invalid.",

      "auth/app-not-authorized":
        "This website is not authorized in Firebase."
    };

    return messages[error.code] ||
      error.message ||
      "Something went wrong. Please try again.";
  }

  // ==========================================
  // AUTHENTICATION TABS
  // ==========================================

  function showLogin() {
    $("#loginForm").hidden = false;
    $("#registerForm").hidden = true;

    $("#loginTab").classList.add("active");
    $("#registerTab").classList.remove("active");

    authError.textContent = "";
  }

  function showRegister() {
    $("#loginForm").hidden = true;
    $("#registerForm").hidden = false;

    $("#loginTab").classList.remove("active");
    $("#registerTab").classList.add("active");

    authError.textContent = "";
  }

  $("#loginTab").addEventListener("click", showLogin);
  $("#registerTab").addEventListener("click", showRegister);

  // ==========================================
  // REGISTER
  // ==========================================

  $("#registerForm").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const email = $("#registerEmail").value.trim();
      const password = $("#registerPassword").value;
      const confirmPassword = $("#confirmPassword").value;
      const button = $("#registerButton");

      authError.textContent = "";

      if (!email) {
        authError.textContent = "Please enter your email.";
        return;
      }

      if (password.length < 6) {
        authError.textContent =
          "Password must be at least 6 characters.";
        return;
      }

      if (password !== confirmPassword) {
        authError.textContent = "Passwords do not match.";
        return;
      }

      button.disabled = true;
      button.textContent = "CREATING ACCOUNT...";

      try {
        await persistenceReady;

        await auth.createUserWithEmailAndPassword(
          email,
          password
        );

        $("#registerForm").reset();

      } catch (error) {
        console.error("Registration error:", error);

        authError.textContent =
          getAuthErrorMessage(error);

      } finally {
        button.disabled = false;
        button.textContent = "CREATE ACCOUNT";
      }
    }
  );

  // ==========================================
  // LOGIN
  // ==========================================

  $("#loginForm").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const email = $("#loginEmail").value.trim();
      const password = $("#loginPassword").value;
      const button = $("#loginButton");

      authError.textContent = "";

      if (!email || !password) {
        authError.textContent =
          "Please enter your email and password.";
        return;
      }

      button.disabled = true;
      button.textContent = "LOGGING IN...";

      try {
        await persistenceReady;

        const result =
          await auth.signInWithEmailAndPassword(
            email,
            password
          );

        console.info(
          "Firebase login successful:",
          result.user.uid
        );

        $("#loginForm").reset();

      } catch (error) {
        console.error("Login error:", error);

        authError.textContent =
          getAuthErrorMessage(error);

      } finally {
        button.disabled = false;
        button.textContent = "LOGIN";
      }
    }
  );

  // ==========================================
  // PROFILE PANEL
  // ==========================================

  function updateProfile(user) {
    $("#profileEmail").textContent =
      user.email || "Email not available";

    $("#profileUid").textContent =
      user.uid || "User ID not available";

    $("#profileStatus").textContent =
      user.emailVerified
        ? "Active · Email verified"
        : "Active · Email not verified";
  }

  function openProfilePanel() {
    const user = auth.currentUser;

    if (!user) return;

    updateProfile(user);
    profilePanel.hidden = false;
  }

  function closeProfilePanel() {
    profilePanel.hidden = true;
  }

  $("#profileButton").addEventListener(
    "click",
    openProfilePanel
  );

  $("#closeProfileButton").addEventListener(
    "click",
    closeProfilePanel
  );

  profilePanel.addEventListener("click", event => {
    if (event.target === profilePanel) {
      closeProfilePanel();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !profilePanel.hidden) {
      closeProfilePanel();
    }
  });

  // ==========================================
  // LOGOUT
  // ==========================================

  $("#logoutButton").addEventListener(
    "click",
    async () => {
      const confirmed = window.confirm(
        "Are you sure you want to logout?"
      );

      if (!confirmed) return;

      const button = $("#logoutButton");

      button.disabled = true;
      button.textContent = "LOGGING OUT...";

      try {
        await auth.signOut();
        closeProfilePanel();

      } catch (error) {
        console.error("Logout error:", error);

        showToast(
          "Unable to logout. Please try again."
        );

      } finally {
        button.disabled = false;
        button.textContent = "↪ LOG OUT";
      }
    }
  );

  // ==========================================
  // CLOUDFLARE WORKER API
  // ==========================================

  const API_BASE_URL =
    window.APP_CONFIG?.API_BASE_URL?.replace(/\/+$/, "");

  async function syncUserWithBackend(user) {
    if (!API_BASE_URL) {
      throw new Error("Backend API URL is missing.");
    }

    const idToken = await user.getIdToken();

    const response = await fetch(
      `${API_BASE_URL}/api/auth/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.message ||
        data.error ||
        "Backend synchronization failed."
      );
    }

    return data.user;
  }

  async function apiRequest(user, path, method = "GET", payload = null) {
    const token = await user.getIdToken();
    const response = await fetch(API_BASE_URL + path, {
      method,
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || data.error || "Game request failed.");
    return data;
  }

  async function loadGameState(user) {
    gameStateData = await apiRequest(user, "/api/game/state");
    const wallet = gameStateData.user || {};
    $("#gemBalance").textContent = Number(wallet.gems || 0).toLocaleString();
    $("#coinBalance").textContent = Number(wallet.coins || 0).toLocaleString();
    pendingCoins = Number(gameStateData.islands?.[selectedIsland]?.pending_coins || 0);
    renderIsland();
    updateStorage(pendingCoins);
    if (typeof loadWithdrawalHistory === "function") await loadWithdrawalHistory();
    if (typeof loadAdPlacements === "function") await loadAdPlacements(user);
    if (typeof loadAdminPanel === "function") await loadAdminPanel(user);
  }

  function makeIdempotencyKey() { return crypto.randomUUID().replace(/-/g, ""); }

  // ==========================================
  // FIREBASE AUTH STATE LISTENER
  // ==========================================

  auth.onAuthStateChanged(async user => {
    if (user) {
      authScreen.hidden = true;
      gameShell.hidden = false;

      updateProfile(user);

      $("#profileButton").title =
        user.email || "Account";

      console.info(
        "Islandora user authenticated:",
        user.uid
      );

      // Backend synchronization must not block login.
      try {
        if (backendSyncedUid !== user.uid) {
          const backendUser =
            await syncUserWithBackend(user);

          // Display the server-authoritative Gems balance.
          $("#gemBalance").textContent =
            Number(backendUser.gems || 0).toLocaleString();

          backendSyncedUid = user.uid;
        }

        await loadGameState(user);

        console.info(
            "Islandora account synchronized with D1:",
            backendUser
          );
        }

      } catch (error) {
        console.error(
          "Backend synchronization error:",
          error
        );

        $("#profileStatus").textContent =
          "Active · Backend sync pending";

        showToast(
          "Server connection failed. Please refresh and try again."
        );
      }

    } else {
      backendSyncedUid = null;

      closeProfilePanel();

      gameShell.hidden = true;
      authScreen.hidden = false;

      const params =
        new URLSearchParams(window.location.search);

      if (params.has("ref")) {
        showRegister();
      } else {
        showLogin();
      }
    }
  }, error => {
    console.error("Firebase Auth State error:", error);

    authError.textContent =
      getAuthErrorMessage(error);

    authScreen.hidden = false;
    gameShell.hidden = true;
  });

  // ==========================================
  // ISLAND DATA
  // ==========================================

  const islands = [
    {
      name: "Emerald Haven",
      type: "Starter Island",
      description: "Begin your mining journey on this peaceful island!",
      cost: 500,
      image: "island-01-emerald-haven.png"
    },
    {
      name: "Frozen Kingdom",
      type: "Ice Island",
      description: "Discover the frozen treasures of the northern seas.",
      cost: 1000,
      image: "island-02-frost-glacier.png"
    },
    {
      name: "Volcano Valley",
      type: "Fire Island",
      description: "Explore the fiery land of ancient volcanoes.",
      cost: 2000,
      image: "island-03-volcano-peak.png"
    },
    {
      name: "Crystal Paradise",
      type: "Crystal Island",
      description: "A mysterious island filled with glowing crystals.",
      cost: 4000,
      image: "island-04-crystal-realm.png"
    },
    {
      name: "Golden Oasis",
      type: "Golden Island",
      description: "Find the golden treasures hidden in the desert.",
      cost: 8000,
      image: "island-05-golden-desert.png"
    },
    {
      name: "Mystic Forest",
      type: "Forest Island",
      description: "Enter an enchanted forest full of hidden riches.",
      cost: 16000,
      image: "island-06-mystic-forest.png"
    },
    {
      name: "Sky Kingdom",
      type: "Cloud Island",
      description: "Explore magical islands floating above the clouds.",
      cost: 32000,
      image: "island-07-sky-kingdom.png"
    },
    {
      name: "Coral Paradise",
      type: "Ocean Island",
      description: "Discover secrets beneath the deep blue ocean.",
      cost: 64000,
      image: "island-08-coral-ocean.png"
    },
    {
      name: "Dragon Realm",
      type: "Dragon Island",
      description: "A legendary land guarded by ancient dragons.",
      cost: 128000,
      image: "island-09-dragon-realm.png"
    },
    {
      name: "Celestial World",
      type: "Final Island",
      description: "Reach the ultimate world of legendary treasures.",
      cost: 256000,
      image: "island-10-celestial-world.png"
    }
  ];

  // ==========================================
  // CHEST IMAGES
  // ==========================================

  const chestImages = [
    "chest-01-emerald.png",
    "chest-02-sapphire.png",
    "chest-03-amethyst.png",
    "chest-04-pearl-gold.png",
    "chest-05-ruby.png",
    "chest-06-turquoise.png",
    "chest-07-royal-blue.png",
    "chest-08-violet-silver.png",
    "chest-09-ember-orange.png",
    "chest-10-legendary-ice.png"
  ];

  // ==========================================
  // ISLAND 1 BOX DATA
  // ==========================================

  const prices = [
    10, 20, 30, 50, 100,
    150, 200, 300, 500, 1000
  ];

  const rates = [
    2, 4, 6, 10, 20,
    30, 40, 50, 100, 200
  ];

  // ==========================================
  // PREVIEW STATE
  // ==========================================

  const STORAGE_CAP = 1500;

  let selectedIsland = 0;

  let gameStateData = null;
  let pendingCoins = 0;

  // ==========================================
  // IMAGE PATHS
  // ==========================================

  function islandImagePath(index) {
    return `assets/islands/${islands[index].image}`;
  }

  function chestImagePath(index) {
    return `assets/chests/${chestImages[index]}`;
  }

  // ==========================================
  // UNLOCK STATUS - PREVIEW
  // ==========================================

  function isUnlocked(index) {
    return !!gameStateData?.islands?.[index]?.is_unlocked;
  }

  // ==========================================
  // RENDER ISLAND LIST
  // ==========================================

  function renderIslandList() {
    const islandList = $("#islandList");

    islandList.innerHTML = islands.map(
      (island, index) => {
        const unlocked = isUnlocked(index);

        return `
          <button
            class="island-card
              ${selectedIsland === index ? "active" : ""}
              ${unlocked ? "" : "locked"}"
            data-island="${index}"
            type="button"
          >
            <span class="island-thumb">
              <img
                src="${islandImagePath(index)}"
                alt="${island.name}"
                loading="lazy"
              >
            </span>

            <span class="island-details">
              <strong>Island ${index + 1}</strong>
              <span>
                ${
                  unlocked
                    ? island.type
                    : index === 0
                      ? "Unlock with 500 Gems"
                      : "Complete Island " + index + " first"
                }
              </span>
            </span>

            <span class="island-lock">
              ${unlocked ? "›" : "🔒"}
            </span>
          </button>
        `;
      }
    ).join("");
  }

  // ==========================================
  // RENDER SELECTED ISLAND
  // ==========================================

  function renderIsland() {
    const island = islands[selectedIsland];
    const hero = $("#islandHero");

    $("#islandTitle").textContent =
      `Island ${selectedIsland + 1}`;

    $("#islandSubtitle").textContent =
      island.name;

    $("#islandDescription").textContent =
      island.description;

    const liveIsland = gameStateData?.islands?.[selectedIsland];
    $("#islandCost").textContent =
      Number(liveIsland?.unlock_cost_gems ?? island.cost).toLocaleString() + " Gems";

    $("#islandStatus").textContent =
      isUnlocked(selectedIsland)
        ? "✓ UNLOCKED"
        : "🔒 LOCKED";

    hero.style.setProperty(
      "--island-image",
      `url("${islandImagePath(selectedIsland)}")`
    );

    renderIslandList();
    renderBoxes();
  }

  // ==========================================
  // RENDER CHESTS
  // ==========================================

  function renderBoxes() {
    const grid = $("#boxGrid");

    if (!isUnlocked(selectedIsland)) {
      const liveIsland = gameStateData?.islands?.[selectedIsland];
      const previousComplete = selectedIsland === 0 ||
        gameStateData?.islands?.[selectedIsland - 1]?.boxes?.every(box => box.open_count >= 10);
      grid.innerHTML = `
        <div class="locked-island-message">
          <div style="font-size:48px">🔒</div>
          <h3>${islands[selectedIsland].name}</h3>
          <p>Unlock this island to continue your mining journey.</p>
          <p>Cost: 💎 ${Number(liveIsland?.unlock_cost_gems ?? islands[selectedIsland].cost).toLocaleString()} Gems</p>
          ${previousComplete ? '<button type="button" class="open-button" data-unlock-island>Unlock Island</button>' : '<p>Open every box 10 times on the previous island first.</p>'}
        </div>
      `;
      $("#islandRate").textContent = "0 Coins/day";
      return;
    }

    const currentBoxes = gameStateData?.islands?.[selectedIsland]?.boxes || [];
    grid.innerHTML = currentBoxes.map((box, index) => {
      const price = Number(box.price_gems || prices[index]);
      const rate = Number(box.rate_coins_per_day || rates[index]);
      const count = Number(box.open_count || 0);
      const maxed = count >= 10;
      const canAfford = Number(gameStateData?.user?.gems || 0) >= price;

      return `
        <article class="mining-box ${maxed ? "maxed" : ""}">
          <div class="box-name">
            Box #${index + 1}
          </div>

          <div class="chest-art">
            <img
              src="${chestImagePath(index)}"
              alt="Treasure Chest ${index + 1}"
              loading="lazy"
            >
          </div>

          <div class="box-cost">
            💎 ${price.toLocaleString()}
          </div>

          <div class="box-rate">
            ⛏ +${rate} / day
          </div>

          <button
            class="open-button"
            data-box="${index}"
            type="button"
            ${maxed || !canAfford ? "disabled" : ""}
          >
            ${maxed ? "MAX" : "Open"}
          </button>

          <div class="box-count">
            ${count}/10 Opened
          </div>
        </article>
      `;
    }).join("");

    const totalRate = currentBoxes.reduce(
      (sum, box) => sum + Number(box.rate_coins_per_day || 0) * Number(box.open_count || 0),
      0
    );

    $("#islandRate").textContent =
      totalRate.toLocaleString() + " Coins/day";
  }

  // ==========================================
  // MINING STORAGE - PREVIEW
  // ==========================================

  function updateStorage(amount = pendingCoins) {
    const cap = selectedIsland === 0 ? STORAGE_CAP : Number.MAX_SAFE_INTEGER;
    const current = Math.max(0, Math.min(Number(amount) || 0, cap));
    pendingCoins = current;

    const percentage = selectedIsland === 0
      ? Math.min(100, (current / STORAGE_CAP) * 100)
      : 0;

    $("#pendingCoins").textContent =
      current.toFixed(2);

    $("#storageAmount").textContent =
      current.toFixed(2);

    $("#storageProgressText").textContent =
      selectedIsland === 0 ? `${current.toFixed(2)} / ${STORAGE_CAP.toLocaleString()} Coins` : `${current.toFixed(2)} Coins`;

    $("#storagePercentage").textContent =
      selectedIsland === 0 ? `${percentage.toFixed(1)}%` : "No fixed cap";
    const capacityLabel = $("#storageCapacityLabel");
    if (capacityLabel) capacityLabel.textContent = selectedIsland === 0
      ? "Storage capacity: 1,500 Coins"
      : "No fixed storage cap";

    $("#storageProgressFill").style.width =
      `${percentage}%`;

    $("#storagePanel").classList.toggle(
      "storage-full",
      current >= STORAGE_CAP
    );

    $("#claimButton").disabled = current < 5;
  }

  // ==========================================
  // ISLAND CLICK
  // ==========================================

  $("#islandList").addEventListener(
    "click",
    event => {
      const card = event.target.closest("[data-island]");

      if (!card) return;

      const index = Number(card.dataset.island);

      selectedIsland = index;
      renderIsland();
      updateStorage(gameStateData?.islands?.[index]?.pending_coins || 0);
    }
  );

  // ==========================================
  // CHEST CLICK
  // ==========================================

  $("#boxGrid").addEventListener("click", async event => {
    const unlockButton = event.target.closest("[data-unlock-island]");
    if (unlockButton) {
      unlockButton.disabled = true;
      try {
        const user = auth.currentUser;
        await apiRequest(user, "/api/game/island/unlock", "POST", {
          island_number: selectedIsland + 1, idempotency_key: makeIdempotencyKey()
        });
        await loadGameState(user);
        showToast("Island unlocked successfully!");
      } catch (error) { showToast(error.message); unlockButton.disabled = false; }
      return;
    }
    const button = event.target.closest("[data-box]");
    if (!button || button.disabled) return;
    const boxNumber = Number(button.dataset.box) + 1;
    button.disabled = true;
    try {
      const user = auth.currentUser;
      await apiRequest(user, "/api/game/box/open", "POST", {
        island_number: selectedIsland + 1, box_number: boxNumber, idempotency_key: makeIdempotencyKey()
      });
      await loadGameState(user);
      showToast("Mining box opened successfully!");
    } catch (error) { showToast(error.message); button.disabled = false; }
  });

  // ==========================================
  // VIEW ALL ISLANDS
  // ==========================================

  $("#viewAllIslands").addEventListener(
    "click",
    () => {
      $("#islandList").scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  );

  // ==========================================
  // CLAIM COINS
  // ==========================================

  $("#claimButton").addEventListener("click", async () => {
    const button = $("#claimButton");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const user = auth.currentUser;
      const result = await apiRequest(user, "/api/game/claim", "POST", {
        island_number: selectedIsland + 1, idempotency_key: makeIdempotencyKey()
      });
      await loadGameState(user);
      showToast(`Claimed ${Number(result.claimed_coins || 0).toLocaleString()} Coins!`);
    } catch (error) { showToast(error.message); button.disabled = false; }
  });

  const exchangeInput = $("#exchangeCoins");
  const exchangePreview = $("#exchangePreview");
  const exchangeButton = $("#exchangeButton");

  function updateExchangePreview() {
    const amount = Math.floor(Number(exchangeInput.value) || 0);
    const fee = amount > 0 ? Math.ceil(amount * 0.01) : 0;
    const gems = Math.max(0, amount - fee);
    exchangePreview.textContent = `Fee: ${fee.toLocaleString()} Coins · You receive: ${gems.toLocaleString()} Gems`;
    exchangeButton.disabled = amount < 2 || !Number.isSafeInteger(amount);
  }

  exchangeInput.addEventListener("input", updateExchangePreview);
  exchangeButton.addEventListener("click", async () => {
    const amount = Math.floor(Number(exchangeInput.value) || 0);
    if (amount < 2) return;
    exchangeButton.disabled = true;
    try {
      const result = await apiRequest(auth.currentUser, "/api/game/exchange", "POST", {
        coins: amount, idempotency_key: makeIdempotencyKey()
      });
      await loadGameState(auth.currentUser);
      exchangeInput.value = "";
      updateExchangePreview();
      showToast(`Converted ${result.coins_spent} Coins into ${result.gems_received} Gems.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      updateExchangePreview();
    }
  });
  updateExchangePreview();

  const withdrawalAmount = $("#withdrawalAmount");
  const withdrawalMethod = $("#withdrawalMethod");
  const withdrawalDetails = $("#withdrawalDetails");
  const withdrawalButton = $("#withdrawalButton");
  const withdrawalMessage = $("#withdrawalMessage");
  const withdrawalHistory = $("#withdrawalHistory");

  async function loadWithdrawalHistory() {
    try {
      const data = await apiRequest(auth.currentUser, "/api/withdrawals");
      withdrawalHistory.replaceChildren();
      if (!data.withdrawals?.length) {
        withdrawalHistory.textContent = "No withdrawal requests yet.";
        return;
      }
      data.withdrawals.forEach(item => {
        const row = document.createElement("div");
        row.className = "withdrawal-history-row";
        row.textContent = `${Number(item.amount).toLocaleString()} Coins · ${item.payment_method} · ${item.status.toUpperCase()} · ${new Date(item.created_at + "Z").toLocaleString()}`;
        withdrawalHistory.appendChild(row);
      });
    } catch (error) {
      withdrawalHistory.textContent = "Withdrawal history unavailable.";
    }
  }

  withdrawalButton.addEventListener("click", async () => {
    const amount = Math.floor(Number(withdrawalAmount.value) || 0);
    const details = withdrawalDetails.value.trim();
    if (amount < 10000 || !details) {
      withdrawalMessage.textContent = "Enter at least 10,000 Coins and your payment details.";
      return;
    }
    withdrawalButton.disabled = true;
    withdrawalMessage.textContent = "Submitting request...";
    try {
      const result = await apiRequest(auth.currentUser, "/api/withdrawals", "POST", {
        amount,
        payment_method: withdrawalMethod.value,
        payment_details: details,
        idempotency_key: makeIdempotencyKey()
      });
      withdrawalMessage.textContent = `Request submitted. Reference: ${result.withdrawal_id}`;
      withdrawalAmount.value = "";
      withdrawalDetails.value = "";
      await loadGameState(auth.currentUser);
      await loadWithdrawalHistory();
    } catch (error) {
      withdrawalMessage.textContent = error.message;
    } finally {
      withdrawalButton.disabled = false;
    }
  });

  let adsterraSettingId = null;
  async function loadAdPlacements(user) {
    try {
      const data = await apiRequest(user, "/api/ads/placements");
      const ad = data.ads?.find(item => item.provider === "Adsterra" && item.ad_type === "direct_link");
      adsterraSettingId = ad?.id || null;
      $("#adsterraCard").hidden = !adsterraSettingId;
    } catch (error) {
      adsterraSettingId = null;
      $("#adsterraCard").hidden = true;
    }
  }
  $("#adsterraButton").addEventListener("click", async () => {
    if (!adsterraSettingId) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      $("#adsterraMessage").textContent = "Allow pop-ups to open this optional link. The game remains available.";
      return;
    }
    $("#adsterraButton").disabled = true;
    try {
      const result = await apiRequest(auth.currentUser, "/api/ads/direct-open", "POST", {
        ad_setting_id: adsterraSettingId
      });
      popup.location.href = result.url;
      $("#adsterraMessage").textContent = "Partner offer opened in a new tab.";
    } catch (error) {
      popup.close();
      $("#adsterraMessage").textContent = error.message;
    } finally {
      $("#adsterraButton").disabled = false;
    }
  });

  const adminPanel = $("#adminPanel");
  const adminNavItem = $("#adminNavItem");
  const adminIslandNumber = $("#adminIslandNumber");

  async function loadAdminIslandConfig(user) {
    const data = await apiRequest(user, "/api/admin/islands");
    const island = data.islands[Number(adminIslandNumber.value)-1];
    $("#adminUnlockCost").value = island.unlock_cost_gems;
    $("#adminBoxPrices").value = island.box_prices.join(",");
    $("#adminBoxRates").value = island.box_rates.join(",");
    $("#adminStorageCap").value = island.storage_cap;
  }

  async function loadAdminWithdrawals(user) {
    const data = await apiRequest(user, "/api/admin/withdrawals");
    const list = $("#adminWithdrawalList");
    list.replaceChildren();
    if (!data.withdrawals.length) { list.textContent = "No withdrawal requests."; return; }
    data.withdrawals.forEach(item => {
      const row = document.createElement("div");
      row.className = "withdrawal-history-row";
      const summary = document.createElement("p");
      summary.textContent = `${item.firebase_uid} · ${Number(item.amount).toLocaleString()} Coins · ${item.payment_method} · ${item.status.toUpperCase()} · ${item.payment_details}`;
      row.appendChild(summary);
      if (item.status === "pending") {
        ["approved","rejected"].forEach(status => {
          const button = document.createElement("button");
          button.type = "button"; button.className = "open-button";
          button.dataset.withdrawalId = item.id; button.dataset.withdrawalStatus = status;
          button.textContent = status === "approved" ? "Approve" : "Reject & Refund";
          row.appendChild(button);
        });
      }
      list.appendChild(row);
    });
  }

  async function loadAdminPanel(user) {
    try {
      const data = await apiRequest(user, "/api/admin/overview");
      adminPanel.hidden = false;
      adminNavItem.hidden = false;
      $("#adminOverview").textContent =
        `Users: ${data.users} · Gems: ${data.total_gems.toLocaleString()} · Coins: ${data.total_coins.toLocaleString()} · Pending withdrawals: ${data.pending_withdrawals} · Valid referrals: ${data.valid_referrals}`;
      await loadAdminIslandConfig(user);
      await loadAdminWithdrawals(user);
      await loadAdminAds(user);
    } catch (error) {
      adminPanel.hidden = true;
      adminNavItem.hidden = true;
    }
  }

  async function loadAdminAds(user) {
    const data = await apiRequest(user, "/api/admin/ads");
    const list = $("#adminAdsList"); list.replaceChildren();
    if (!data.ads.length) { list.textContent = "No ad placements configured."; return; }
    data.ads.forEach(ad => {
      const row = document.createElement("div"); row.className = "withdrawal-history-row";
      row.textContent = `${ad.provider} · ${ad.ad_type} · ${ad.name} · ${ad.enabled ? "ENABLED" : "DISABLED"} · cooldown ${ad.cooldown_hours}h · daily ${ad.daily_limit}`;
      list.appendChild(row);
    });
  }
  $("#adminSaveAd").addEventListener("click", async () => {
    const provider = $("#adminAdProvider").value;
    const type = provider === "Adsterra" ? "direct_link" : "rewarded";
    try {
      await apiRequest(auth.currentUser, "/api/admin/ads", "POST", {
        provider, ad_type: type, name: $("#adminAdName").value.trim(),
        direct_link_url: $("#adminAdUrl").value.trim(),
        placement_id: $("#adminAdPlacement").value.trim(),
        cooldown_hours: Number($("#adminAdCooldown").value),
        daily_limit: Number($("#adminAdDailyLimit").value),
        reward_coins: Number($("#adminAdReward").value),
        enabled: $("#adminAdEnabled").checked
      });
      $("#adminAdMessage").textContent = "Ad settings saved.";
      await loadAdminAds(auth.currentUser);
    } catch (error) { $("#adminAdMessage").textContent = error.message; }
  });

  adminIslandNumber.addEventListener("change", async () => {
    try { await loadAdminIslandConfig(auth.currentUser); }
    catch (error) { $("#adminIslandMessage").textContent = error.message; }
  });
  $("#adminSaveIsland").addEventListener("click", async () => {
    const parseList = value => value.split(",").map(x => Number(x.trim()));
    try {
      const result = await apiRequest(auth.currentUser, "/api/admin/islands", "POST", {
        island_number: Number(adminIslandNumber.value),
        unlock_cost_gems: Number($("#adminUnlockCost").value),
        box_prices: parseList($("#adminBoxPrices").value),
        box_rates: parseList($("#adminBoxRates").value),
        storage_cap: Number($("#adminStorageCap").value)
      });
      $("#adminIslandMessage").textContent = "Island settings saved.";
      await loadGameState(auth.currentUser);
    } catch (error) { $("#adminIslandMessage").textContent = error.message; }
  });
  $("#adminSearchButton").addEventListener("click", async () => {
    try {
      const q = encodeURIComponent($("#adminUserSearch").value.trim());
      const data = await apiRequest(auth.currentUser, "/api/admin/users?q=" + q);
      const list = $("#adminUsersList"); list.replaceChildren();
      data.users.forEach(user => {
        const row = document.createElement("div"); row.className = "withdrawal-history-row";
        row.textContent = `${user.email} · ${user.firebase_uid} · ${user.gems} Gems · ${user.coins} Coins`;
        row.addEventListener("click", () => { $("#adminTargetUid").value = user.firebase_uid; });
        list.appendChild(row);
      });
      if (!data.users.length) list.textContent = "No users found.";
    } catch (error) { $("#adminUsersList").textContent = error.message; }
  });
  $("#adminAdjustButton").addEventListener("click", async () => {
    try {
      const result = await apiRequest(auth.currentUser, "/api/admin/wallet/adjust", "POST", {
        user_uid: $("#adminTargetUid").value.trim(),
        currency: $("#adminCurrency").value,
        amount: Number($("#adminAdjustment").value),
        description: $("#adminAdjustmentNote").value,
        idempotency_key: makeIdempotencyKey()
      });
      $("#adminAdjustMessage").textContent = "Balance adjustment applied.";
      await loadAdminPanel(auth.currentUser);
    } catch (error) { $("#adminAdjustMessage").textContent = error.message; }
  });
  $("#adminRefreshWithdrawals").addEventListener("click", () => loadAdminWithdrawals(auth.currentUser));
  $("#adminWithdrawalList").addEventListener("click", async event => {
    const button = event.target.closest("[data-withdrawal-id]");
    if (!button) return;
    button.disabled = true;
    try {
      await apiRequest(auth.currentUser, "/api/admin/withdrawals/review", "POST", {
        withdrawal_id: button.dataset.withdrawalId,
        status: button.dataset.withdrawalStatus,
        admin_note: ""
      });
      await loadAdminWithdrawals(auth.currentUser);
      await loadAdminPanel(auth.currentUser);
    } catch (error) { showToast(error.message); button.disabled = false; }
  });

  // ==========================================
  // BOTTOM NAVIGATION
  // ==========================================

  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", event => {
      event.preventDefault();

      document.querySelectorAll(".nav-item").forEach(nav => {
        nav.classList.remove("active");
      });

      item.classList.add("active");

      const target = item.getAttribute("href");

      if (target === "#home" || target === "#mining") {
        document.querySelector(target)?.scrollIntoView({
          behavior: "smooth"
        });

      } else if (target === "#profile") {
        openProfilePanel();

      } else if (target === "#wallet" || target === "#admin") {
        document.querySelector(target)?.scrollIntoView({ behavior: "smooth" });
      } else {
        showToast(item.textContent.trim() + " will be available soon.");
      }
    });
  });

  // ==========================================
  // INITIALIZE GAME
  // ==========================================

  renderIsland();
  updateStorage(0);

  console.info(
    "Islandora Premium Dashboard initialized."
  );

})();
