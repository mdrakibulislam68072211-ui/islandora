
(() => {
  "use strict";

  // ==========================================
  // FIREBASE AUTHENTICATION
  // ==========================================

  const firebaseConfig = window.APP_CONFIG?.FIREBASE;

  if (!firebaseConfig || !firebaseConfig.apiKey) {
    console.error("Firebase configuration is missing.");
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();

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

  let toastTimer = null;

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
        "Email/Password login is not enabled in Firebase."
    };

    return messages[error.code] ||
      "Something went wrong. Please try again.";
  }

  // ==========================================
  // REGISTER
  // ==========================================

  $("#registerForm").addEventListener("submit", async event => {
    event.preventDefault();

    const email = $("#registerEmail").value.trim();
    const password = $("#registerPassword").value;
    const confirmPassword = $("#confirmPassword").value;

    const button = $("#registerButton");

    authError.textContent = "";

    if (password.length < 6) {
      authError.textContent =
        "Password must be at least 6 characters.";
      return;
    }

    if (password !== confirmPassword) {
      authError.textContent =
        "Passwords do not match.";
      return;
    }

    button.disabled = true;
    button.textContent = "CREATING ACCOUNT...";

    try {
      await auth.createUserWithEmailAndPassword(
        email,
        password
      );

      $("#registerForm").reset();

    } catch (error) {
      console.error("Registration error:", error);
      authError.textContent = getAuthErrorMessage(error);

    } finally {
      button.disabled = false;
      button.textContent = "CREATE ACCOUNT";
    }
  });

  // ==========================================
  // LOGIN
  // ==========================================

  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;

    const button = $("#loginButton");

    authError.textContent = "";

    button.disabled = true;
    button.textContent = "LOGGING IN...";

    try {
      await auth.signInWithEmailAndPassword(
        email,
        password
      );

      $("#loginForm").reset();

    } catch (error) {
      console.error("Login error:", error);
      authError.textContent = getAuthErrorMessage(error);

    } finally {
      button.disabled = false;
      button.textContent = "LOGIN";
    }
  });

  // ==========================================
  // PROFILE PANEL
  // ==========================================

  const profilePanel = $("#profilePanel");

  function openProfilePanel() {
    const user = auth.currentUser;

    if (!user) return;

    $("#profileEmail").textContent =
      user.email || "Email not available";

    $("#profileUid").textContent =
      user.uid || "User ID not available";

    $("#profileStatus").textContent =
      user.emailVerified
        ? "Active · Email verified"
        : "Active · Email not verified";

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

  $("#logoutButton").addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Are you sure you want to logout?"
    );

    if (!confirmed) return;

    const logoutButton = $("#logoutButton");

    logoutButton.disabled = true;
    logoutButton.textContent = "LOGGING OUT...";

    try {
      await auth.signOut();
      closeProfilePanel();

    } catch (error) {
      console.error("Logout error:", error);

      showToast(
        "Unable to logout. Please try again."
      );

    } finally {
      logoutButton.disabled = false;
      logoutButton.textContent = "↪ LOG OUT";
    }
  });

  // ==========================================
  // CLOUDFLARE WORKER API
  // ==========================================

  const API_BASE_URL =
    window.APP_CONFIG?.API_BASE_URL?.replace(/\/+$/, "");

  let backendSyncedUid = null;

  async function syncUserWithBackend(user) {
    if (!API_BASE_URL) {
      throw new Error("Backend API URL is missing.");
    }

    const idToken = await user.getIdToken();

    const result = await fetch(
      `${API_BASE_URL}/api/auth/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        }
      }
    );

    const data = await result.json();

    if (!result.ok || !data.success) {
      throw new Error(
        data.message ||
        data.error ||
        "Backend synchronization failed."
      );
    }

    return data.user;
  }

  // ==========================================
  // AUTH STATE
  // ==========================================

  auth.onAuthStateChanged(async user => {
    if (user) {
      authScreen.hidden = true;
      gameShell.hidden = false;

      $("#profileButton").title =
        user.email || "Account";

      $("#profileEmail").textContent =
        user.email || "Email not available";

      $("#profileUid").textContent =
        user.uid || "User ID not available";

      $("#profileStatus").textContent =
        user.emailVerified
          ? "Active · Email verified"
          : "Active · Email not verified";

      try {
        if (backendSyncedUid !== user.uid) {
          const backendUser =
            await syncUserWithBackend(user);

          backendSyncedUid = user.uid;

          console.info(
            "Islandora account synchronized with D1:",
            backendUser
          );

          $("#profileStatus").textContent =
            user.emailVerified
              ? "Active · Email verified"
              : "Active · Email not verified";
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

      console.info(
        "Islandora user authenticated:",
        user.uid
      );

    } else {
      backendSyncedUid = null;

      closeProfilePanel();

      gameShell.hidden = true;
      authScreen.hidden = false;

      if (new URLSearchParams(window.location.search).has("ref")) {
  showRegister();
} else {
  showLogin();
}
    
  });
}
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

  const boxCounts = Array(10).fill(0);

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
  // UNLOCK STATUS - PREVIEW
  // ==========================================

  function isUnlocked(index) {
    return index === 0;
  }

  // ==========================================
  // RENDER ISLAND LIST
  // ==========================================

  function renderIslandList() {
    const islandList = $("#islandList");

    islandList.innerHTML = islands.map((island, index) => {
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
                  : "Unlock after completing Island " + index
              }
            </span>
          </span>

          <span class="island-lock">
            ${unlocked ? "›" : "🔒"}
          </span>

        </button>
      `;
    }).join("");
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

    $("#islandCost").textContent =
      island.cost.toLocaleString() + " Gems";

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
      grid.innerHTML = `
        <div class="locked-island-message">
          <div style="font-size:48px">🔒</div>

          <h3>${islands[selectedIsland].name}</h3>

          <p>
            Complete the previous island to unlock this island.
          </p>
        </div>
      `;

      $("#islandRate").textContent = "0 Coins/day";

      return;
    }

    grid.innerHTML = prices.map((price, index) => {
      const count = boxCounts[index];
      const maxed = count >= 10;

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
            ⛏ +${rates[index]} / day
          </div>

          <button
            class="open-button"
            data-box="${index}"
            type="button"
            disabled
          >
            ${maxed ? "MAX" : "Open"}
          </button>

          <div class="box-count">
            ${count}/10 Opened
          </div>

        </article>
      `;
    }).join("");

    const totalRate = rates.reduce(
      (sum, rate, index) => {
        return sum + rate * boxCounts[index];
      },
      0
    );

    $("#islandRate").textContent =
      totalRate.toLocaleString() + " Coins/day";
  }

  // ==========================================
  // MINING STORAGE
  // ==========================================

  function updateStorage(amount = pendingCoins) {
    const current = Math.max(
      0,
      Math.min(Number(amount) || 0, STORAGE_CAP)
    );

    pendingCoins = current;

    const percentage = (current / STORAGE_CAP) * 100;

    $("#pendingCoins").textContent =
      current.toFixed(2);

    $("#storageAmount").textContent =
      current.toFixed(2);

    $("#storageProgressText").textContent =
      `${current.toFixed(2)} / ${STORAGE_CAP.toLocaleString()} Coins`;

    $("#storagePercentage").textContent =
      `${percentage.toFixed(1)}%`;

    $("#storageProgressFill").style.width =
      `${percentage}%`;

    $("#storagePanel").classList.toggle(
      "storage-full",
      current >= STORAGE_CAP
    );

    $("#claimButton").disabled = true;
  }

  // ==========================================
  // ISLAND CLICK
  // ==========================================

  $("#islandList").addEventListener("click", event => {
    const card = event.target.closest("[data-island]");

    if (!card) return;

    const index = Number(card.dataset.island);

    if (!isUnlocked(index)) {
      showToast(
        "🔒 Complete the previous island to unlock this island."
      );

      return;
    }

    selectedIsland = index;

    renderIsland();
  });

  // ==========================================
  // CHEST CLICK
  // ==========================================

  $("#boxGrid").addEventListener("click", event => {
    const button = event.target.closest("[data-box]");

    if (!button || button.disabled) return;

    showToast(
      "Mining will be activated after secure backend integration."
    );
  });

  // ==========================================
  // VIEW ALL ISLANDS
  // ==========================================

  $("#viewAllIslands").addEventListener("click", () => {
    $("#islandList").scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  });

  // ==========================================
  // CLAIM COINS
  // ==========================================

  $("#claimButton").addEventListener("click", () => {
    showToast(
      "Coin claiming will be available after backend integration."
    );
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

      } else {
        showToast(
          item.textContent.trim() + " will be available soon."
        );
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
