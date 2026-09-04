(() => {
  "use strict";

  /* ---------- theme toggle ---------- */
  const root = document.documentElement;
  const themeToggle = document.getElementById("themeToggle");
  const THEME_KEY = "loyal-theme";

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
  }

  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) applyTheme(savedTheme);

  themeToggle.addEventListener("click", () => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = root.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });

  /* ---------- mobile nav ---------- */
  const navToggle = document.getElementById("navToggle");
  const mainNav = document.getElementById("mainNav");

  navToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  mainNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      mainNav.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });

  /* ---------- "Admin" nav dropdown ---------- */
  function closeAllDropdowns() {
    document.querySelectorAll(".nav-dropdown.open").forEach((dropdown) => {
      dropdown.classList.remove("open");
      dropdown.querySelector(".nav-dropdown-toggle")?.setAttribute("aria-expanded", "false");
    });
  }

  document.querySelectorAll(".nav-dropdown-toggle").forEach((toggle) => {
    const dropdown = toggle.closest(".nav-dropdown");
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = !dropdown.classList.contains("open");
      closeAllDropdowns();
      if (willOpen) {
        dropdown.classList.add("open");
        toggle.setAttribute("aria-expanded", "true");
      }
    });
  });

  document.addEventListener("click", closeAllDropdowns);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllDropdowns();
  });

  /* ---------- pricing calculator ---------- */
  const TIERS = {
    express: { label: "Express", base: 60, rate: 15, baseline: 300 },
    standard: { label: "Standard", base: 80, rate: 15, baseline: 350 },
    secure: { label: "Secure", base: 180, rate: 25, baseline: 450 },
    cargo: { label: "Cargo", base: 600, rate: 80, baseline: 900 },
  };

  const distanceRange = document.getElementById("distanceRange");
  const distanceValue = document.getElementById("distanceValue");
  const calcTotal = document.getElementById("calcTotal");
  const calcBreakdown = document.getElementById("calcBreakdown");
  const calcSavings = document.getElementById("calcSavings");
  const tierInputs = document.querySelectorAll('#tierSelect input[name="tier"]');
  const calculatorLocked = document.getElementById("calculatorLocked");
  const calculatorUnlocked = document.getElementById("calculatorUnlocked");

  // "Live pricing" on the homepage is gated to logged-in users — any of the
  // three account types (admin, courier, or a sender account) unlocks it.
  // Only index.html carries calculatorLocked/calculatorUnlocked, so this is
  // a no-op everywhere else.
  const isLoggedIn = Boolean(
    localStorage.getItem("loyal-admin-token") ||
      localStorage.getItem("loyal-token") ||
      localStorage.getItem("loyal-sender-token")
  );
  if (calculatorLocked && calculatorUnlocked) {
    calculatorLocked.hidden = isLoggedIn;
    calculatorUnlocked.hidden = !isLoggedIn;
  }

  function currentTierKey() {
    const checked = document.querySelector('#tierSelect input[name="tier"]:checked');
    return checked ? checked.value : "express";
  }

  function computePrice(tierKey, km) {
    const tier = TIERS[tierKey];
    const billableKm = Math.max(0, km - 2);
    const total = tier.base + billableKm * tier.rate;
    return { tier, billableKm, total };
  }

  function formatBirr(n) {
    return Math.round(n).toLocaleString("en-US");
  }

  function updateCalculator() {
    const km = Number(distanceRange.value);
    const tierKey = currentTierKey();
    const { tier, billableKm, total } = computePrice(tierKey, km);

    distanceValue.textContent = `${km} km`;
    calcTotal.textContent = formatBirr(total);

    if (billableKm > 0) {
      calcBreakdown.textContent = `${tier.base} birr base + ${billableKm} km × ${tier.rate} birr`;
    } else {
      calcBreakdown.textContent = `${tier.base} birr flat — within the first 2 km`;
    }

    const diff = tier.baseline - total;
    if (diff > 0) {
      const pct = Math.round((diff / tier.baseline) * 100);
      calcSavings.textContent = `≈ ${pct}% cheaper than a typical traditional courier for this tier`;
    } else {
      calcSavings.textContent = "Still far below the cost of arranging this privately";
    }
  }

  // Only the homepage carries the calculator markup — guarded so this file
  // can be safely included, unmodified, on order/track/admin pages too.
  if (distanceRange && calcTotal) {
    distanceRange.addEventListener("input", updateCalculator);
    tierInputs.forEach((input) => input.addEventListener("change", updateCalculator));
    updateCalculator();
  }

  /* ---------- contact form (mailto fallback) ---------- */
  const contactForm = document.getElementById("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = document.getElementById("fName").value.trim();
      const email = document.getElementById("fEmail").value.trim();
      const role = document.getElementById("fRole").value;
      const message = document.getElementById("fMsg").value.trim();

      const subject = encodeURIComponent(`Loyal Delivery Movers inquiry from ${name} (${role})`);
      const body = encodeURIComponent(`${message}\n\n—\n${name}\n${email}\n${role}`);
      window.location.href = `mailto:hello@loyaldeliverymovers.com?subject=${subject}&body=${body}`;
    });
  }

  /* ---------- footer year ---------- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- reveal on scroll ---------- */
  const revealTargets = document.querySelectorAll(
    ".card, .tier-card, .stat-tile, .chart-card, .roadmap li, .flow li"
  );

  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealTargets.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(14px)";
      el.style.transition = "opacity .5s ease, transform .5s ease";
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    revealTargets.forEach((el) => observer.observe(el));
  }

  /* ---------- sticky header shadow ---------- */
  const header = document.getElementById("siteHeader");
  const onScroll = () => {
    header.style.boxShadow = window.scrollY > 8 ? "0 1px 0 rgba(0,0,0,0.02)" : "none";
  };
  document.addEventListener("scroll", onScroll, { passive: true });
})();
