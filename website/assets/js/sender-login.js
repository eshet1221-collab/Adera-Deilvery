(() => {
  "use strict";

  const loginForm = document.getElementById("senderLoginForm");
  const signupForm = document.getElementById("senderSignupForm");
  const loginError = document.getElementById("senderLoginError");
  const signupError = document.getElementById("senderSignupError");
  const pageTitle = document.getElementById("senderPageTitle");
  const pageLede = document.getElementById("senderPageLede");

  // Already logged in? Skip straight back to the pricing section.
  if (localStorage.getItem("loyal-sender-token")) {
    window.location.href = "index.html#calculator";
    return;
  }

  function showLogin() {
    signupForm.hidden = true;
    loginForm.hidden = false;
    pageTitle.textContent = "Log in";
    pageLede.textContent = "Log in to see live pricing, or create an account if you're new here.";
  }

  function showSignup() {
    loginForm.hidden = true;
    signupForm.hidden = false;
    pageTitle.textContent = "Create an account";
    pageLede.textContent = "A few details and you're in — no documents or ID needed, that's only for couriers.";
  }

  document.getElementById("showSignup").addEventListener("click", showSignup);
  document.getElementById("showLogin").addEventListener("click", showLogin);

  function afterLogin(data) {
    localStorage.setItem("loyal-sender-token", data.token);
    localStorage.setItem("loyal-sender-name", data.sender.fullName);
    window.location.href = "index.html#calculator";
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.hidden = true;

    const phone = document.getElementById("senderLoginPhone").value.trim();
    const password = document.getElementById("senderLoginPassword").value;

    try {
      const res = await fetch("/api/senders/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      afterLogin(data);
    } catch (err) {
      loginError.textContent = err.message || "Couldn't reach the Loyal Delivery Movers API — is the server running?";
      loginError.hidden = false;
    }
  });

  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    signupError.hidden = true;

    const fullName = document.getElementById("senderSignupName").value.trim();
    const phone = document.getElementById("senderSignupPhone").value.trim();
    const password = document.getElementById("senderSignupPassword").value;

    try {
      const res = await fetch("/api/senders/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sign up failed");
      afterLogin(data);
    } catch (err) {
      signupError.textContent = err.message || "Couldn't reach the Loyal Delivery Movers API — is the server running?";
      signupError.hidden = false;
    }
  });
})();
