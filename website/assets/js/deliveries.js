(() => {
  "use strict";

  const token = localStorage.getItem("adera-token");
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  const welcomeEl = document.getElementById("delWelcome");
  const deliveriesBody = document.getElementById("deliveriesBody");
  const logoutBtn = document.getElementById("logoutBtn");

  const otpDialog = document.getElementById("otpDialog");
  const otpForm = document.getElementById("otpForm");
  const otpInput = document.getElementById("otpInput");
  const otpError = document.getElementById("otpError");
  const otpCancel = document.getElementById("otpCancel");

  const proofDialog = document.getElementById("proofDialog");
  const proofForm = document.getElementById("proofForm");
  const proofInput = document.getElementById("proofInput");
  const proofError = document.getElementById("proofError");
  const proofCancel = document.getElementById("proofCancel");

  const STATUS_LABELS = {
    matched: "Matched",
    picked_up: "Picked up",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };

  let pendingOtpOrderId = null;
  let pendingProofOrderId = null;

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

  async function loadMe() {
    const data = await authedFetch("/api/auth/me");
    welcomeEl.textContent = `Welcome, ${data.courier.fullName}`;
  }

  async function loadDeliveries() {
    deliveriesBody.innerHTML = `<tr><td colspan="7" class="empty-state">Loading…</td></tr>`;
    try {
      const data = await authedFetch("/api/orders/mine");
      renderDeliveries(data.orders || []);
    } catch (err) {
      deliveriesBody.innerHTML = `<tr><td colspan="7" class="empty-state">${esc(err.message)}</td></tr>`;
    }
  }

  function actionCell(order) {
    switch (order.status) {
      case "matched":
        return `
          <div class="row-actions">
            <button class="btn btn-primary btn-sm" data-action="pickup" data-id="${order.id}">Mark picked up</button>
          </div>
          <button class="link-btn" data-action="cancel" data-id="${order.id}">cancel</button>`;
      case "picked_up":
        return order.proofSubmitted
          ? `
          <div class="row-actions">
            <button class="btn btn-primary btn-sm" data-action="deliver" data-id="${order.id}">Confirm delivery</button>
          </div>
          <button class="link-btn" data-action="cancel" data-id="${order.id}">cancel</button>`
          : `
          <div class="row-actions">
            <button class="btn btn-primary btn-sm" data-action="proof" data-id="${order.id}">Upload proof</button>
          </div>
          <button class="link-btn" data-action="cancel" data-id="${order.id}">cancel</button>`;
      default:
        return "—";
    }
  }

  function proofCell(order) {
    if (!order.proofSubmitted) return order.status === "delivered" ? "—" : "Not yet";
    return `<a href="${esc(order.proofUrl)}" target="_blank" rel="noopener">View ✓</a>`;
  }

  function renderDeliveries(orders) {
    if (!orders.length) {
      deliveriesBody.innerHTML = `<tr><td colspan="7" class="empty-state">Nothing assigned to you yet — check back once the call center or admin matches you to an order.</td></tr>`;
      return;
    }
    deliveriesBody.innerHTML = orders
      .map(
        (o) => `
        <tr data-order-row="${o.id}">
          <td><a class="tracking-code" href="/track.html?code=${encodeURIComponent(o.trackingCode)}" target="_blank" rel="noopener">${esc(o.trackingCode)}</a></td>
          <td>${esc(o.tier)}</td>
          <td class="wrap-cell">${esc(o.pickupAddress)} → ${esc(o.dropoffAddress)}</td>
          <td>${Math.round(o.priceBirr).toLocaleString("en-US")} birr</td>
          <td><span class="status-badge status-${o.status}">${STATUS_LABELS[o.status] || o.status}</span></td>
          <td>${proofCell(o)}</td>
          <td>${actionCell(o)}</td>
        </tr>`
      )
      .join("");
  }

  deliveriesBody.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === "pickup") {
      await updateStatus(id, "picked_up");
    } else if (action === "cancel") {
      if (confirm("Cancel this delivery?")) await updateStatus(id, "cancelled");
    } else if (action === "deliver") {
      openOtpDialog(id);
    } else if (action === "proof") {
      openProofDialog(id);
    }
  });

  async function updateStatus(id, status, extra = {}) {
    try {
      await authedFetch(`/api/orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      await loadDeliveries();
    } catch (err) {
      alert(err.message);
    }
  }

  /* ---------- OTP dialog ---------- */
  function openOtpDialog(orderId) {
    pendingOtpOrderId = orderId;
    otpInput.value = "";
    otpError.hidden = true;
    otpDialog.showModal();
    otpInput.focus();
  }

  otpCancel.addEventListener("click", () => otpDialog.close());

  otpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    otpError.hidden = true;
    try {
      await authedFetch(`/api/orders/${pendingOtpOrderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered", otp: otpInput.value.trim() }),
      });
      otpDialog.close();
      await loadDeliveries();
    } catch (err) {
      otpError.textContent = err.message;
      otpError.hidden = false;
    }
  });

  /* ---------- proof dialog ---------- */
  function openProofDialog(orderId) {
    pendingProofOrderId = orderId;
    proofForm.reset();
    proofError.hidden = true;
    proofDialog.showModal();
  }

  proofCancel.addEventListener("click", () => proofDialog.close());

  proofForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    proofError.hidden = true;

    const file = proofInput.files[0];
    if (!file) {
      proofError.textContent = "Choose a photo or video first.";
      proofError.hidden = false;
      return;
    }

    const formData = new FormData();
    formData.append("proof", file);

    try {
      // No Content-Type header here on purpose — the browser sets the
      // multipart boundary itself when the body is a FormData instance.
      await authedFetch(`/api/orders/${pendingProofOrderId}/proof`, { method: "POST", body: formData });
      proofDialog.close();
      await loadDeliveries();
    } catch (err) {
      proofError.textContent = err.message;
      proofError.hidden = false;
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

  document.getElementById("refreshDeliveries").addEventListener("click", loadDeliveries);

  (async () => {
    try {
      await loadMe();
      await loadDeliveries();
    } catch (err) {
      // authedFetch already redirects to login.html on a 401
    }
  })();
})();
