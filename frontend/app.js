
(() => {
  "use strict";

  const config = window.APP_CONFIG || {};
  const telegram = window.Telegram?.WebApp;

  // Telegram Mini App initialization
  if (telegram) {
    telegram.ready();
    telegram.expand();

    try {
      telegram.setHeaderColor("#071b25");
      telegram.setBackgroundColor("#071b25");
    } catch (error) {
      console.warn("Telegram theme setup unavailable.");
    }
  }

  // Preview mode until the backend is connected
  const apiConfigured =
    config.API_BASE_URL &&
    !config.API_BASE_URL.includes("YOUR-WORKER");

  if (!apiConfigured) {
    console.info("Islandora is running in preview mode.");
  }

  // Toast notification
  function showToast(message) {
    let toast = document.querySelector(".toast");

    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("show");

    window.clearTimeout(toast.hideTimer);
    toast.hideTimer = window.setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  }

  // Smooth navigation
  document.addEventListener("click", (event) => {
    const nav = event.target.closest(".nav-item");

    if (nav) {
      document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.remove("selected");
      });

      nav.classList.add("selected");

      const target = nav.getAttribute("href");

      if (target && target.startsWith("#")) {
        const section = document.querySelector(target);

        if (section) {
          event.preventDefault();
          section.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      }
    }
  });

  // Island selection preview
  document.querySelectorAll(".island-tile").forEach((tile) => {
    tile.addEventListener("click", (event) => {
      if (event.target.closest("button, a")) return;

      if (tile.classList.contains("locked-tile")) {
        showToast("This island is locked. Unlock it to continue.");
      }
    });
  });

  // Locked island buttons
  document.querySelectorAll(".locked-label").forEach((item) => {
    item.addEventListener("click", () => {
      showToast("This island is currently locked.");
    });
  });

  // Show all islands preview
  document.querySelectorAll(".text-btn").forEach((button) => {
    button.addEventListener("click", () => {
      showToast("More islands will be available soon.");
    });
  });

  // Prevent unfinished demo actions from appearing functional
  document.querySelectorAll(
    ".primary-btn, .secondary-btn, .open-label"
  ).forEach((button) => {
    button.addEventListener("click", (event) => {
      if (button.matches(".locked-label")) return;

      if (!apiConfigured) {
        event.preventDefault();
        showToast("Game features will be available soon.");
      }
    });
  });

  // Avoid accidental placeholder links jumping to page top
  document.querySelectorAll('a[href="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
    });
  });

  console.info("Islandora frontend initialized.");
})();
