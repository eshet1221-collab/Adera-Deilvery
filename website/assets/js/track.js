(() => {
  "use strict";

  const form = document.getElementById("trackForm");
  const input = document.getElementById("trackingInput");
  const errorEl = document.getElementById("trackError");
  const resultSection = document.getElementById("trackResult");

  const ORDER_STEPS = ["pending", "matched", "picked_up", "delivered"];
  const STATUS_LABELS = {
    pending: "Pending",
    matched: "Courier matched",
    picked_up: "Picked up",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function renderTimeline(status) {
    const idx = ORDER_STEPS.indexOf(status);
    document.querySelectorAll("#trTimeline li").forEach((li) => {
      const stepIdx = ORDER_STEPS.indexOf(li.dataset.status);
      li.classList.toggle("is-done", idx >= 0 && stepIdx <= idx);
      li.classList.toggle("is-current", stepIdx === idx);
    });
  }

  function renderOrder(order) {
    document.getElementById("trTrackingCode").textContent = order.trackingCode;

    const badge = document.getElementById("trStatusBadge");
    badge.textContent = STATUS_LABELS[order.status] || order.status;
    badge.className = `status-badge status-${order.status}`;

    document.getElementById("trTier").textContent = order.tier;
    document.getElementById("trPrice").textContent = `${Math.round(order.priceBirr).toLocaleString("en-US")} birr`;
    document.getElementById("trCourier").textContent = order.courierName || "Not yet matched";
    document.getElementById("trPickup").textContent = order.pickupAddress;
    document.getElementById("trDropoff").textContent = order.dropoffAddress;
    document.getElementById("trProof").textContent = order.proofSubmitted ? "Submitted ✓" : "Not yet submitted";
    document.getElementById("trUpdated").textContent = new Date(order.updatedAt.replace(" ", "T") + "Z").toLocaleString();

    renderTimeline(order.status);
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function lookup(code) {
    showError("");
    resultSection.hidden = true;
    if (!code) {
      showError("Enter a tracking code.");
      return;
    }
    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(code.trim().toUpperCase())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Order not found");
      renderOrder(data.order);
    } catch (err) {
      showError(err.message || "Couldn't reach the Loyal Delivery Movers API — is the server running?");
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    lookup(input.value);
  });

  const params = new URLSearchParams(window.location.search);
  const prefill = params.get("code");
  if (prefill) {
    input.value = prefill;
    lookup(prefill);
  }
})();
