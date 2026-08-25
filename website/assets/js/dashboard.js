(() => {
  "use strict";

  const token = localStorage.getItem("loyal-token");
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  const welcomeEl = document.getElementById("dashWelcome");
  const statDeliveries = document.getElementById("statDeliveries");
  const statAmount = document.getElementById("statAmount");
  const statEarnings = document.getElementById("statEarnings");
  const statWallet = document.getElementById("statWallet");
  const statLast = document.getElementById("statLast");
  const suspendedBanner = document.getElementById("suspendedBanner");
  const logoutBtn = document.getElementById("logoutBtn");

  async function authedFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem("loyal-token");
      localStorage.removeItem("loyal-courier-name");
      window.location.href = "login.html";
      throw new Error("Session expired");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadMe() {
    const data = await authedFetch("/api/auth/me");
    welcomeEl.textContent = `Welcome, ${data.courier.fullName}`;
  }

  // GET /me/stats — the logged-in courier's own numbers only. There is no
  // way to fetch anyone else's from here; the full-roster view lives in the
  // admin tooling (earnings.html), not behind a courier's own login.
  async function loadMyStats() {
    try {
      const data = await authedFetch("/api/couriers/me/stats");
      renderStats(data.stats);
    } catch (err) {
      welcomeEl.textContent = "Couldn't load your stats";
    }
  }

  function renderStats(s) {
    statDeliveries.textContent = s.deliveryCount;
    statAmount.textContent = `${Math.round(s.totalAmountBirr).toLocaleString("en-US")} birr`;
    statEarnings.textContent = `${Math.round(s.totalEarningsBirr).toLocaleString("en-US")} birr`;
    statWallet.textContent = `${Math.round(s.walletBalanceBirr).toLocaleString("en-US")} birr`;
    statLast.textContent = s.lastDeliveryAt ? new Date(s.lastDeliveryAt.replace(" ", "T") + "Z").toLocaleDateString() : "—";
    suspendedBanner.hidden = s.status !== "suspended";
  }

  logoutBtn.addEventListener("click", async () => {
    try {
      await authedFetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      // already redirected on 401; otherwise just proceed to clear locally
    }
    localStorage.removeItem("loyal-token");
    localStorage.removeItem("loyal-courier-name");
    window.location.href = "login.html";
  });

  (async () => {
    try {
      await loadMe();
      await loadMyStats();
    } catch (err) {
      // authedFetch already redirects to login.html on a 401
    }
  })();
})();
