(() => {
  "use strict";

  const token = localStorage.getItem("adera-token");
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  const walletBalance = document.getElementById("walletBalance");
  const walletStatus = document.getElementById("walletStatus");
  const suspendedBanner = document.getElementById("suspendedBanner");
  const walletTxBody = document.getElementById("walletTxBody");
  const logoutBtn = document.getElementById("logoutBtn");

  const topupForm = document.getElementById("topupForm");
  const topupAmount = document.getElementById("topupAmount");
  const topupReference = document.getElementById("topupReference");
  const topupError = document.getElementById("topupError");
  const topupSubmit = document.getElementById("topupSubmit");

  const TYPE_LABELS = {
    topup: "Top up",
    delivery_payout: "Delivery payout",
    commission_debit: "Commission debit",
  };

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function authedFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem("adera-token");
      localStorage.removeItem("adera-courier-name");
      window.location.href = "login.html";
      throw new Error("Session expired");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function renderTransactions(transactions) {
    if (!transactions.length) {
      walletTxBody.innerHTML = `<tr><td colspan="5" class="empty-state">No wallet activity yet.</td></tr>`;
      return;
    }
    walletTxBody.innerHTML = transactions
      .map((t) => {
        const amountClass = t.amountBirr >= 0 ? "amount-positive" : "amount-negative";
        const sign = t.amountBirr >= 0 ? "+" : "";
        return `
        <tr>
          <td>${new Date(t.createdAt.replace(" ", "T") + "Z").toLocaleString()}</td>
          <td>${TYPE_LABELS[t.type] || t.type}</td>
          <td>${
            t.orderTrackingCode
              ? `<a class="tracking-code" href="/track.html?code=${encodeURIComponent(t.orderTrackingCode)}" target="_blank" rel="noopener">${esc(t.orderTrackingCode)}</a>`
              : "—"
          }</td>
          <td class="${amountClass}">${sign}${Math.round(t.amountBirr).toLocaleString("en-US")} birr</td>
          <td>${Math.round(t.balanceAfterBirr).toLocaleString("en-US")} birr</td>
        </tr>`;
      })
      .join("");
  }

  async function loadWallet() {
    walletTxBody.innerHTML = `<tr><td colspan="5" class="empty-state">Loading…</td></tr>`;
    try {
      const data = await authedFetch("/api/wallet/me");
      walletBalance.textContent = `${Math.round(data.walletBalanceBirr).toLocaleString("en-US")} birr`;
      walletStatus.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
      suspendedBanner.hidden = data.status !== "suspended";
      renderTransactions(data.transactions || []);
    } catch (err) {
      walletTxBody.innerHTML = `<tr><td colspan="5" class="empty-state">${esc(err.message)}</td></tr>`;
    }
  }

  topupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    topupError.hidden = true;

    const amountBirr = Number(topupAmount.value);
    const reference = topupReference.value.trim();
    if (!Number.isFinite(amountBirr) || amountBirr <= 0) {
      topupError.textContent = "Enter a valid amount.";
      topupError.hidden = false;
      return;
    }
    if (!reference) {
      topupError.textContent = "Enter the transaction reference from your payment.";
      topupError.hidden = false;
      return;
    }

    topupSubmit.disabled = true;
    topupSubmit.textContent = "Submitting…";
    try {
      await authedFetch("/api/wallet/me/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountBirr, reference }),
      });
      topupForm.reset();
      await loadWallet();
    } catch (err) {
      topupError.textContent = err.message || "Something went wrong. Please try again.";
      topupError.hidden = false;
    } finally {
      topupSubmit.disabled = false;
      topupSubmit.textContent = "Top up";
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await authedFetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      // already redirected on 401; otherwise just proceed to clear locally
    }
    localStorage.removeItem("adera-token");
    localStorage.removeItem("adera-courier-name");
    window.location.href = "login.html";
  });

  document.getElementById("refreshWallet").addEventListener("click", loadWallet);

  loadWallet();
})();
