
(() => {
  "use strict";

  const config = window.APP_CONFIG || {};
  const telegram = window.Telegram?.WebApp;

  if (telegram) {
    telegram.ready();
    telegram.expand();
  }

  const islandData = [
    { name: "Emerald Haven", subtitle: "Starter Island", description: "Begin your mining journey on this peaceful island!", cost: 500, theme: "emerald", art: "🏝️" },
    { name: "Frozen Kingdom", subtitle: "Ice Island", description: "Discover the frozen treasures of the northern seas.", cost: 1000, theme: "ice", art: "❄️" },
    { name: "Volcano Valley", subtitle: "Fire Island", description: "Explore the fiery land of ancient volcanoes.", cost: 2000, theme: "volcano", art: "🌋" },
    { name: "Crystal Paradise", subtitle: "Crystal Island", description: "A mysterious island filled with glowing crystals.", cost: 4000, theme: "crystal", art: "💎" },
    { name: "Golden Oasis", subtitle: "Golden Island", description: "Find the golden treasures hidden in the desert.", cost: 8000, theme: "gold", art: "🏜️" },
    { name: "Mystic Forest", subtitle: "Forest Island", description: "Enter an enchanted forest full of hidden riches.", cost: 16000, theme: "forest", art: "🌳" },
    { name: "Sky Kingdom", subtitle: "Cloud Island", description: "Explore the magical islands floating above the clouds.", cost: 32000, theme: "sky", art: "☁️" },
    { name: "Coral Paradise", subtitle: "Ocean Island", description: "Discover the secrets beneath the deep blue ocean.", cost: 64000, theme: "ocean", art: "🐠" },
    { name: "Dragon Realm", subtitle: "Dragon Island", description: "A legendary land guarded by ancient dragons.", cost: 128000, theme: "dragon", art: "🐉" },
    { name: "Celestial World", subtitle: "Final Island", description: "Reach the ultimate world of legendary treasures.", cost: 256000, theme: "celestial", art: "✨" }
  ];

  const firstIslandPrices = [10, 20, 30, 50, 100, 150, 200, 300, 500, 1000];
  const firstIslandRates = [2, 4, 6, 10, 20, 30, 40, 50, 100, 200];

  let selectedIsland = 0;
  let previewToastTimer;
  let boxCounts = Array(10).fill(0);

  const $ = (selector) => document.querySelector(selector);

  function toast(message) {
    const element = $("#toast");
    if (!element) return;

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(previewToastTimer);
    previewToastTimer = setTimeout(() => {
      element.classList.remove("show");
    }, 2600);
  }

  function isIslandUnlocked(index) {
    // Preview: only Island 1 is unlocked until account/backend data is connected.
    return index === 0;
  }

  function renderIslandList() {
    const list = $("#islandList");
    if (!list) return;

    list.innerHTML = islandData.map((island, index) => {
      const unlocked = isIslandUnlocked(index);
      const active = selectedIsland === index;

      return `
        <button class="island-card ${active ? "active" : ""} ${unlocked ? "" : "locked"}"
          data-island="${index}" ${unlocked ? "" : 'aria-label="Locked island"'}>
          <span class="island-thumb">${island.art}</span>
          <span class="island-details">
            <strong>Island ${index + 1}</strong>
            <span>${unlocked ? island.subtitle : "Unlock after completing Island " + index}</span>
          </span>
          <span class="island-lock">${unlocked ? "›" : "🔒"}</span>
        </button>
      `;
    }).join("");
  }

  function renderIsland() {
    const island = islandData[selectedIsland];

    $("#islandTitle").textContent = `Island ${selectedIsland + 1}`;
    $("#islandSubtitle").textContent = island.name;
    $("#islandDescription").textContent = island.description;
    $("#islandCost").textContent = island.cost.toLocaleString() + " Gems";
    $("#islandStatus").textContent = isIslandUnlocked(selectedIsland)
      ? "✓ UNLOCKED"
      : "🔒 LOCKED";

    const totalDailyRate = selectedIsland === 0
      ? firstIslandRates.reduce((sum, rate, index) => sum + rate * boxCounts[index], 0)
      : 0;

    $("#islandRate").textContent = totalDailyRate.toLocaleString() + " Coins/day";

    const hero = $("#islandHero");
    hero.dataset.theme = island.theme;

    renderIslandList();
    renderBoxes();
  }

  function renderBoxes() {
    const grid = $("#boxGrid");
    if (!grid) return;

    if (selectedIsland !== 0) {
      grid.innerHTML = `
        <div class="locked-island-message">
          <div style="font-size:48px">🔒</div>
          <h3>${islandData[selectedIsland].name}</h3>
          <p>Complete the previous island and unlock this island to access its mining boxes.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = firstIslandPrices.map((price, index) => {
      const count = boxCounts[index];
      const maxed = count >= 10;

      return `
        <article class="mining-box ${maxed ? "maxed" : ""}">
          <div class="box-name">Box #${index + 1}</div>
          <div class="chest-art">${["🟢","🔵","🟣","🟡","🔴","🟢","🔷","🟣","🟠","❤️"][index]}</div>
          <div class="box-cost">💎 ${price.toLocaleString()}</div>
          <div class="box-rate">⛏ +${firstIslandRates[index]} / day</div>
          <button class="open-button" data-box="${index}" ${maxed ? "disabled" : ""}>
            ${maxed ? "MAX" : "Open"}
          </button>
          <div class="box-count">${count}/10 Opened</div>
        </article>
      `;
    }).join("");

    $("#islandRate").textContent =
      firstIslandRates.reduce((sum, rate, index) => sum + rate * boxCounts[index], 0) +
      " Coins/day";
  }

  function updateStorage() {
    // Preview only. Real storage will be calculated securely by the Worker.
    $("#pendingCoins").textContent = "0.00";
    $("#storageAmount").textContent = "0.00";
    $("#claimButton").disabled = true;
  }

  $("#islandList").addEventListener("click", (event) => {
    const card = event.target.closest("[data-island]");
    if (!card) return;

    const index = Number(card.dataset.island);

    if (!isIslandUnlocked(index)) {
      toast("🔒 Complete the previous island to unlock this island.");
      return;
    }

    selectedIsland = index;
    renderIsland();
  });

  $("#boxGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-box]");
    if (!button || button.disabled) return;

    toast("Mining will be activated after the secure backend is connected.");
  });

  $("#viewAllIslands").addEventListener("click", () => {
    toast("Explore all 10 islands from the island list.");
    $("#islandList").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  $("#claimButton").addEventListener("click", () => {
    toast("Coin claiming will be available after backend integration.");
  });

  $("#profileButton").addEventListener("click", () => {
    toast("Profile will be available after account integration.");
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();

      document.querySelectorAll(".nav-item").forEach((nav) => {
        nav.classList.remove("active");
      });

      item.classList.add("active");

      const section = item.getAttribute("href");

      if (section === "#home" || section === "#mining") {
        document.querySelector(section)?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      } else {
        toast(item.textContent.trim() + " will be available soon.");
      }
    });
  });

  renderIsland();
  updateStorage();

  console.info("Islandora game dashboard preview initialized.");
})();
