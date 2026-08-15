(() => {
  "use strict";

  const listEl = document.getElementById("testimonialList");
  const form = document.getElementById("testimonialForm");
  const errorEl = document.getElementById("testimonialError");

  const ROLE_LABELS = { sender: "Sender", receiver: "Receiver", courier: "Courier" };

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function stars(rating) {
    if (!rating) return "";
    return `<span class="stars" aria-label="${rating} out of 5 stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span>`;
  }

  function renderTestimonials(items) {
    if (!items.length) {
      listEl.innerHTML = `<p class="empty-state">No testimonials yet — be the first to leave one.</p>`;
      return;
    }
    listEl.innerHTML = items
      .map(
        (t) => `
        <article class="testimonial-card">
          <div class="testimonial-head">
            <strong>${esc(t.authorName)}</strong>
            <span class="status-badge status-matched">${esc(ROLE_LABELS[t.role] || t.role)}</span>
          </div>
          ${stars(t.rating)}
          <p>${esc(t.comment)}</p>
          <time>${new Date(t.createdAt.replace(" ", "T") + "Z").toLocaleDateString()}</time>
        </article>`
      )
      .join("");
  }

  async function loadTestimonials() {
    listEl.innerHTML = `<p class="empty-state">Loading testimonials…</p>`;
    try {
      const res = await fetch("/api/testimonials");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load testimonials");
      renderTestimonials(data.testimonials || []);
    } catch (err) {
      listEl.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const payload = {
      authorName: document.getElementById("testName").value.trim(),
      role: document.getElementById("testRole").value,
      rating: document.getElementById("testRating").value || null,
      comment: document.getElementById("testComment").value.trim(),
    };

    try {
      const res = await fetch("/api/testimonials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not submit testimonial");

      form.reset();
      await loadTestimonials();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  document.getElementById("refreshTestimonials").addEventListener("click", loadTestimonials);

  loadTestimonials();
})();
