
(() => {
  "use strict";

  if (window.ISLANDORA_AUTH_FIX_LOADED) return;
  window.ISLANDORA_AUTH_FIX_LOADED = true;

  function startAuthFix() {
    if (!window.firebase || !firebase.auth) {
      console.error("Firebase Authentication SDK not loaded.");
      return;
    }

    const auth = firebase.auth();

    const form = document.getElementById("loginForm");
    const button = document.getElementById("loginButton");
    const errorBox = document.getElementById("authError");

    if (!form || !button || !errorBox) {
      console.error("Islandora login elements not found.");
      return;
    }

    function showError(message) {
      errorBox.textContent = message;
      errorBox.style.display = "block";
      errorBox.style.color = "#ff9292";
    }

    function getErrorMessage(error) {
      const messages = {
        "auth/invalid-email":
          "Invalid email address.",

        "auth/user-not-found":
          "No account found with this email.",

        "auth/wrong-password":
          "Incorrect password.",

        "auth/invalid-credential":
          "Incorrect email or password.",

        "auth/too-many-requests":
          "Too many login attempts. Please try again later.",

        "auth/network-request-failed":
          "Network error. Please check your internet connection.",

        "auth/operation-not-allowed":
          "Email and password login is disabled in Firebase.",

        "auth/user-disabled":
          "This account has been disabled.",

        "auth/web-storage-unsupported":
          "Your browser does not support secure login storage."
      };

      return messages[error.code] ||
        "Login failed: " +
        (error.code || error.message || "Unknown error");
    }

    document.addEventListener("submit", async event => {
      if (event.target !== form) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (button.disabled) return;

      const email =
        document.getElementById("loginEmail").value.trim();

      const password =
        document.getElementById("loginPassword").value;

      errorBox.textContent = "";

      if (!email || !password) {
        showError("Please enter your email and password.");
        return;
      }

      button.disabled = true;
      button.textContent = "LOGGING IN...";

      try {
        await auth.setPersistence(
          firebase.auth.Auth.Persistence.LOCAL
        );

        const result =
          await auth.signInWithEmailAndPassword(
            email,
            password
          );

        if (!result || !result.user) {
          throw new Error("Firebase did not return a user.");
        }

        await result.user.getIdToken(true);

        form.reset();

        console.info(
          "Islandora login successful:",
          result.user.uid
        );

      } catch (error) {
        console.error("Islandora login failed:", error);

        showError(getErrorMessage(error));

      } finally {
        button.disabled = false;
        button.textContent = "LOGIN";
      }

    }, true);

    console.info("Islandora Auth Fix loaded.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAuthFix);
  } else {
    startAuthFix();
  }
})();
