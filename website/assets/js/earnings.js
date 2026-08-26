(() => {
  "use strict";

  const adminToken = localStorage.getItem("loyal-admin-token");
  if (!adminToken) {
    window.location.href = "admin-login.html";
    return;
  }

  const statsBody = document.getElementById("statsBody");
  const sortSelect = document.getElementById("sortSelect");

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (res.status === 401) {
      localStorage.removeItem("loyal-admin-token");
      localStorage.removeItem("loyal-admin-username");
      window.location.href = "admin-login.html";
      throw new Error("Session expired");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  document.getElementById("adminLogout")?.addEventListener("click", async () => {
    try {
      await fetch("/api/admin/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });
    } catch {
      // ignore — clear + redirect below regardless
    }
    localStorage.removeItem("loyal-admin-token");
    localStorage.removeItem("loyal-admin-username");
    window.location.href = "admin-login.html";
  });

  // GET /api/couriers/stats is the admin-side full roster view (see
  // server/routes/couriers.js, requireAdminAuth). A courier's own login only
  // ever reaches GET /api/couriers/me/stats, which returns just their own row.
  async function loadStats() {
    statsBody.innerHTML = `<tr><td colspan="8" class="empty-state">Loading…</td></tr>`;
    try {
      const data = await fetchJson(`/api/couriers/stats?sort=${encodeURIComponent(sortSelect.value)}`);
      renderStats(data.stats || []);
    } catch (err) {
      statsBody.innerHTML = `<tr><td colspan="8" class="empty-state">${esc(err.message)}</td></tr>`;
    }
  }

  function renderStats(stats) {
    if (!stats.length) {
      statsBody.innerHTML = `<tr><td colspan="8" class="empty-state">No couriers registered yet.</td></tr>`;
      return;
    }
    statsBody.innerHTML = stats
      .map(
        (s) => `
        <tr>
          <td>${esc(s.fullName)}</td>
          <td>${esc(s.phone)}</td>
          <td><span class="status-badge status-${esc(s.status)}">${esc(s.status)}</span></td>
          <td>${s.deliveryCount}</td>
          <td>${Math.round(s.totalAmountBirr).toLocaleString("en-US")} birr</td>
          <td>${Math.round(s.totalEarningsBirr).toLocaleString("en-US")} birr</td>
          <td>${Math.round(s.walletBalanceBirr).toLocaleString("en-US")} birr</td>
          <td>${s.lastDeliveryAt ? new Date(s.lastDeliveryAt.replace(" ", "T") + "Z").toLocaleDateString() : "—"}</td>
        </tr>`
      )
      .join("");
  }

  sortSelect.addEventListener("change", loadStats);

  loadStats();
})();
