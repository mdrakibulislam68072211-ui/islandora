(() => {
  "use strict";

  const notice = document.getElementById("adblockNotice");
  const retryButton = document.getElementById("adblockRetry");
  const continueButton = document.getElementById("adblockContinue");
  const status = document.getElementById("adblockStatus");

  if (!notice || !retryButton || !continueButton || !status) return;

  let dismissedForSession = false;

  function checkAdBlocker() {
    const bait = document.createElement("div");
    bait.className = "adsbox ad-placement ad-unit";
    bait.setAttribute("aria-hidden", "true");
    bait.style.cssText = "position:absolute!important;left:-10000px!important;top:-10000px!important;width:10px!important;height:10px!important;pointer-events:none!important;";
    document.body.appendChild(bait);

    const blocked = bait.offsetHeight === 0 ||
      bait.offsetWidth === 0 ||
      window.getComputedStyle(bait).display === "none";

    bait.remove();
    return blocked;
  }

  function runCheck() {
    if (dismissedForSession) return;
    const blocked = checkAdBlocker();
    notice.hidden = !blocked;
    if (!blocked) status.textContent = "No ad blocker was detected.";
    return blocked;
  }

  retryButton.addEventListener("click", () => {
    retryButton.disabled = true;
    status.textContent = "Checking again...";
    window.setTimeout(() => {
      const blocked = runCheck();
      if (blocked) {
        status.textContent = "An ad blocker may still be active. You can disable it or continue anyway.";
      } else {
        status.textContent = "Thanks! No ad blocker was detected.";
      }
      retryButton.disabled = false;
    }, 250);
  });

  continueButton.addEventListener("click", () => {
    dismissedForSession = true;
    notice.hidden = true;
  });

  window.addEventListener("load", () => {
    window.setTimeout(runCheck, 700);
  }, { once: true });
})();