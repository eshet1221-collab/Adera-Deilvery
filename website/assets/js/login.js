(() => {
  "use strict";

  const form = document.getElementById("loginForm");
  const errorEl = document.getElementById("loginError");

  // Already logged in? Skip straight to the dashboard.
  if (localStorage.getItem("adera-token")) {
    window.location.href = "dashboard.html";
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const phone = document.getElementById("loginPhone").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      localStorage.setItem("adera-token", data.token);
      localStorage.setItem("adera-courier-name", data.courier.fullName);
      window.location.href = "dashboard.html";
    } catch (err) {
      errorEl.textContent = err.message || "Couldn't reach the Adera Delivery API — is the server running?";
      errorEl.hidden = false;
    }
  });
})();
