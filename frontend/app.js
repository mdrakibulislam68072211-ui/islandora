
(() => {
  "use strict";

  // ==========================================
  // TELEGRAM MINI APP
  // ==========================================

  const telegram = window.Telegram?.WebApp;

  if (telegram) {
    telegram.ready();
    telegram.expand();
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
  // CHEST IMAGE FILES
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
  // ISLAND 1 BOX PRICES AND MINING RATES
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

  let selectedIsland = 0;
  let toastTimer = null;

  const boxCounts = Array(10).fill(0);

  const $ = selector => document.querySelector(selector);

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
  // TOAST MESSAGE
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
  // ISLAND UNLOCK STATUS
  // PREVIEW ONLY
  // ==========================================

  function isUnlocked(index) {
    // Actual unlock status will come from backend.
    return index === 0;
  }

  // ==========================================
  // RENDER ISLAND SIDEBAR
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

    // Set the correct original island image.
    hero.style.setProperty(
      "--island-image",
      `url("${islandImagePath(selectedIsland)}")`
    );

    renderIslandList();
    renderBoxes();
  }

  // ==========================================
  // RENDER MINING BOXES
  // ==========================================

  function renderBoxes() {
    const grid = $("#boxGrid");

    // Locked island preview.
    if (!isUnlocked(selectedIsland)) {
      grid.innerHTML = `
        <div class="locked-island-message">

          <div style="font-size:48px">
            🔒
          </div>

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
  // PREVIEW ONLY
  // ==========================================

  function updateStorage() {
    $("#pendingCoins").textContent = "0.00";
    $("#storageAmount").textContent = "0.00";

    $("#claimButton").disabled = true;
  }

  // ==========================================
  // ISLAND SELECTION
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
  // CHEST BUTTONS
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
  // PROFILE BUTTON
  // ==========================================

  $("#profileButton").addEventListener("click", () => {
    showToast(
      "Profile will be available after account integration."
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
      } else {
        showToast(
          item.textContent.trim() + " will be available soon."
        );
      }
    });
  });

  // ==========================================
  // INITIALIZE ISLANDORA
  // ==========================================

  renderIsland();
  updateStorage();

  console.info(
    "Islandora Premium Image Dashboard initialized."
  );

})();
