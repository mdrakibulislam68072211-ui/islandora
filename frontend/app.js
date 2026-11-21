
(() => {
  "use strict";

  const telegram = window.Telegram?.WebApp;
  if (telegram) {
    telegram.ready();
    telegram.expand();
  }

  const islands = [
    ["Emerald Haven", "Starter Island", "Begin your mining journey on this peaceful island!", 500],
    ["Frozen Kingdom", "Ice Island", "Discover the frozen treasures of the northern seas.", 1000],
    ["Volcano Valley", "Fire Island", "Explore the fiery land of ancient volcanoes.", 2000],
    ["Crystal Paradise", "Crystal Island", "A mysterious island filled with glowing crystals.", 4000],
    ["Golden Oasis", "Golden Island", "Find the golden treasures hidden in the desert.", 8000],
    ["Mystic Forest", "Forest Island", "Enter an enchanted forest full of hidden riches.", 16000],
    ["Sky Kingdom", "Cloud Island", "Explore magical islands floating above the clouds.", 32000],
    ["Coral Paradise", "Ocean Island", "Discover secrets beneath the deep blue ocean.", 64000],
    ["Dragon Realm", "Dragon Island", "A legendary land guarded by ancient dragons.", 128000],
    ["Celestial World", "Final Island", "Reach the ultimate world of legendary treasures.", 256000]
  ];

  const prices = [10, 20, 30, 50, 100, 150, 200, 300, 500, 1000];
  const rates = [2, 4, 6, 10, 20, 30, 40, 50, 100, 200];

  let selectedIsland = 0;
  let toastTimer;

  const $ = selector => document.querySelector(selector);
  const boxCounts = Array(10).fill(0);

  function showToast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
  }

  function imagePath(folder, number) {
    return `assets/${folder}/${folder === "islands" ? "island" : "chest"}-${number}.png`;
  }

  function isUnlocked(index) {
    // Preview only: actual unlock status will come from the secure backend.
    return index === 0;
  }

  function renderIslandList() {
    $("#islandList").innerHTML = islands.map((island, index) => {
      const unlocked = isUnlocked(index);
      return `
        <button class="island-card ${selectedIsland === index ? "active" : ""} ${unlocked ? "" : "locked"}"
          data-island="${index}">
          <span class="island-thumb">
            <img src="${imagePath("islands", index + 1)}"
                 alt="${island[0]}" loading="lazy">
          </span>
          <span class="island-details">
            <strong>Island ${index + 1}</strong>
            <span>${unlocked ? island[1] : "Unlock after completing Island " + index}</span>
          </span>
          <span class="island-lock">${unlocked ? "›" : "🔒"}</span>
        </button>
      `;
    }).join("");
  }

  function renderIsland() {
    const island = islands[selectedIsland];
    const hero = $("#islandHero");

    $("#islandTitle").textContent = `Island ${selectedIsland + 1}`;
    $("#islandSubtitle").textContent = island[0];
    $("#islandDescription").textContent = island[2];
    $("#islandCost").textContent = island[3].toLocaleString() + " Gems";
    $("#islandStatus").textContent = isUnlocked(selectedIsland) ? "✓ UNLOCKED" : "🔒 LOCKED";

    hero.style.setProperty(
      "--island-image",
      `url("${imagePath("islands", selectedIsland + 1)}")`
    );

    renderIslandList();
    renderBoxes();
  }

  function renderBoxes() {
    const grid = $("#boxGrid");

    if (selectedIsland !== 0) {
      grid.innerHTML = `
        <div class="locked-island-message">
          <div style="font-size:48px">🔒</div>
          <h3>${islands[selectedIsland][0]}</h3>
          <p>Complete the previous island to unlock this island.</p>
        </div>`;
      return;
    }

    grid.innerHTML = prices.map((price, index) => {
      const count = boxCounts[index];
      const maxed = count >= 10;

      return `
        <article class="mining-box ${maxed ? "maxed" : ""}">
          <div class="box-name">Box #${index + 1}</div>
          <div class="chest-art">
            <img src="${imagePath("chests", index + 1)}"
                 alt="Treasure Chest ${index + 1}" loading="lazy">
          </div>
          <div class="box-cost">💎 ${price.toLocaleString()}</div>
          <div class="box-rate">⛏ +${rates[index]} / day</div>
          <button class="open-button" data-box="${index}" disabled>
            ${maxed ? "MAX" : "Open"}
          </button>
          <div class="box-count">${count}/10 Opened</div>
        </article>
      `;
    }).join("");

    const totalRate = rates.reduce(
      (sum, rate, index) => sum + rate * boxCounts[index], 0
    );

    $("#islandRate").textContent = totalRate.toLocaleString() + " Coins/day";
  }

  function updateStorage() {
    $("#pendingCoins").textContent = "0.00";
    $("#storageAmount").textContent = "0.00";
    $("#claimButton").disabled = true;
  }

  $("#islandList").addEventListener("click", event => {
    const card = event.target.closest("[data-island]");
    if (!card) return;

    const index = Number(card.dataset.island);

    if (!isUnlocked(index)) {
      showToast("🔒 Complete the previous island to unlock this island.");
      return;
    }

    selectedIsland = index;
    renderIsland();
  });

  $("#boxGrid").addEventListener("click", event => {
    const button = event.target.closest("[data-box]");
    if (!button || button.disabled) return;
    showToast("Mining will be activated after secure backend integration.");
  });

  $("#viewAllIslands").addEventListener("click", () => {
    $("#islandList").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  $("#claimButton").addEventListener("click", () => {
    showToast("Coin claiming will be available after backend integration.");
  });

  $("#profileButton").addEventListener("click", () => {
    showToast("Profile will be available after account integration.");
  });

  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", event => {
      event.preventDefault();
      document.querySelectorAll(".nav-item").forEach(nav => nav.classList.remove("active"));
      item.classList.add("active");

      const target = item.getAttribute("href");
      if (target === "#home" || target === "#mining") {
        document.querySelector(target)?.scrollIntoView({ behavior: "smooth" });
      } else {
        showToast(item.textContent.trim() + " will be available soon.");
      }
    });
  });

  renderIsland();
  updateStorage();
  console.info("Islandora image dashboard initialized.");
})();
