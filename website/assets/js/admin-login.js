(() => {
  "use strict";

  const form = document.getElementById("adminLoginForm");
  const errorEl = document.getElementById("adminLoginError");

  // Already logged in? Skip straight to the admin dashboard.
  if (localStorage.getItem("loyal-admin-token")) {
    window.location.href = "admin.html";
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const username = document.getElementById("adminLoginUsername").value.trim();
    const password = document.getElementById("adminLoginPassword").value;

    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      localStorage.setItem("loyal-admin-token", data.token);
      localStorage.setItem("loyal-admin-username", data.admin.username);
      window.location.href = "admin.html";
    } catch (err) {
      errorEl.textContent = err.message || "Couldn't reach the Loyal Delivery Movers API — is the server running?";
      errorEl.hidden = false;
    }
  });
})();
