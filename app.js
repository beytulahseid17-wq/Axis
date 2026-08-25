(function () {
  "use strict";

  var supabaseClient = null;
  try {
    supabaseClient = window.supabase.createClient("https://jcfqjltjnkocjmctnsth.supabase.co", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjZnFqbHRqbmtvY2ptY3Ruc3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMTUwNTEsImV4cCI6MjA5OTU5MTA1MX0.t2U8GsWpm8J3HMj6nmFIwv5RA2dhaRrLo8YdcMnVP7M");
  } catch (e) {
    console.error("Axis: failed to create Supabase client — check config.js", e);
  }

  if (!supabaseClient) {
    document.addEventListener("DOMContentLoaded", function () {
      var banner = document.createElement("div");
      banner.style.cssText = "position:fixed;inset:0;background:#F8F7F2;display:flex;align-items:center;justify-content:center;padding:2rem;z-index:999;font-family:sans-serif;";
      banner.innerHTML =
        '<div style="max-width:360px;text-align:center;">' +
        '<div style="font-weight:700;font-size:1.2rem;margin-bottom:1rem;">Axis <span style="color:#4F46E5;">Planner</span></div>' +
        '<p style="color:#E85A4C;font-size:0.9rem;line-height:1.6;">Setup issue: config.js is missing a valid SUPABASE_URL / SUPABASE_ANON_KEY. Open config.js and paste in your real Project URL and key from Supabase → Settings → API, then reload.</p>' +
        '</div>';
      document.body.innerHTML = "";
      document.body.appendChild(banner);
    });
    return;
  }

  var GUEST_KEY = "axis-guest-data";
  var currentProjectId = null;
  var pendingOnboarding = false;
  var offlineReady = false;
  var syncFlushTimer = null;

  // ==================== OFFLINE ENGINE ====================

  function initOfflineEngine() {
    if (typeof AxisOffline === "undefined") {
      console.warn("Axis: AxisOffline not loaded — offline mode unavailable");
      return;
    }
    AxisOffline.open().then(function () {
      offlineReady = true;
      updateNetworkStatus();
      updateSyncStatusBar();
    }).catch(function (e) {
      console.error("Axis: IndexedDB failed to open", e);
    });

    window.addEventListener("online", function () {
      updateNetworkStatus();
      triggerSync();
    });
    window.addEventListener("offline", updateNetworkStatus);

    // Listen for SW-triggered sync
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", function (e) {
        if (e.data && e.data.type === "TRIGGER_SYNC") triggerSync();
      });
    }
  }

  function updateNetworkStatus() {
    var banner = document.getElementById("offline-banner");
    if (banner) banner.classList.toggle("hidden", navigator.onLine);
  }

  function triggerSync() {
    if (!navigator.onLine || !offlineReady || !state.session) return;
    clearTimeout(syncFlushTimer);
    syncFlushTimer = setTimeout(function () {
      updateSyncBadge("syncing", "Syncing…");
      AxisOffline.flush(supabaseClient).then(function (result) {
        if (result.failed > 0) {
          updateSyncBadge("error", result.failed + " changes failed to sync");
        } else if (result.flushed > 0) {
          updateSyncBadge("synced", "All changes synced");
          setTimeout(updateSyncStatusBar, 2000);
        } else {
          updateSyncStatusBar();
        }
      });
    }, 800);
  }

  function updateSyncStatusBar() {
    if (!offlineReady) return;
    AxisOffline.getPendingCount().then(function (count) {
      var bar = document.getElementById("sync-status-bar");
      var dot = document.getElementById("sync-status-dot");
      var text = document.getElementById("sync-status-text");
      if (!bar || !dot || !text) return;
      if (count === 0) {
        bar.classList.add("hidden");
      } else {
        bar.classList.remove("hidden");
        dot.className = "sync-status-dot" + (navigator.onLine ? " syncing" : "");
        text.textContent = count + " unsaved change" + (count === 1 ? "" : "s") + (navigator.onLine ? " — syncing…" : " — waiting for connection");
      }
    });
  }

  function updateSyncBadge(status, message) {
    var dot = document.getElementById("sync-status-dot");
    var text = document.getElementById("sync-status-text");
    var bar = document.getElementById("sync-status-bar");
    if (!dot || !text || !bar) return;
    bar.classList.remove("hidden");
    dot.className = "sync-status-dot " + status;
    text.textContent = message;
  }

  function enqueueIfOffline(table, type, payload, id) {
    if (!offlineReady) return;
    AxisOffline.enqueue({ table: table, type: type, payload: payload, id: id,
      updated_at: new Date().toISOString() }).then(function () {
      updateSyncStatusBar();
      if (navigator.onLine) triggerSync();
    });
  }

  // ── Project offline toggle ─────────────────────────────────────────────────
  function renderProjectOfflineToggle() {
    if (!offlineReady || !currentProjectId) return;
    var row = document.getElementById("project-offline-row");
    var toggleBtn = document.getElementById("project-offline-toggle");
    var label = document.getElementById("project-offline-label");
    var badge = document.getElementById("project-sync-badge");
    if (!row || !toggleBtn) return;

    AxisOffline.isProjectOffline(currentProjectId).then(function (isOffline) {
      toggleBtn.textContent = isOffline ? "Disable" : "Enable";
      toggleBtn.classList.toggle("enabled", isOffline);
      if (!isOffline) {
        badge.classList.add("hidden");
        return;
      }
      AxisOffline.get("offline_projects", currentProjectId).then(function (rec) {
        if (!rec) return;
        badge.classList.remove("hidden");
        badge.className = "project-sync-badge " + (rec.sync_status || "idle");
        var rel = rec.last_synced ? timeAgo(new Date(rec.last_synced)) : "never";
        badge.textContent = rec.sync_status === "synced" ? "synced " + rel : (rec.sync_status || "idle");
      });
    });
  }

  function initProjectOfflineToggle() {
    var btn = document.getElementById("project-offline-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!offlineReady || !currentProjectId) return;
      AxisOffline.isProjectOffline(currentProjectId).then(function (isOffline) {
        if (isOffline) {
          AxisOffline.disableProjectOffline(currentProjectId).then(function () {
            renderProjectOfflineToggle();
            // Uncache via SW
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({
                type: "UNCACHE_PROJECT", projectId: currentProjectId
              });
            }
          });
        } else {
          downloadProjectOffline(currentProjectId);
        }
      });
    });

    document.getElementById("sync-now-btn") && document.getElementById("sync-now-btn").addEventListener("click", triggerSync);
  }

  function downloadProjectOffline(projectId) {
    if (!state.session) return;
    var badge = document.getElementById("project-sync-badge");
    var toggleBtn = document.getElementById("project-offline-toggle");
    if (badge) { badge.classList.remove("hidden"); badge.className = "project-sync-badge syncing"; badge.textContent = "downloading…"; }
    if (toggleBtn) { toggleBtn.disabled = true; }

    AxisOffline.enableProjectOffline(projectId).then(function () {
      var userId = state.session.user.id;
      return Promise.all([
        supabaseClient.from("projects").select("*").eq("id", projectId).single(),
        supabaseClient.from("notes").select("*").eq("user_id", userId).limit(50),
        supabaseClient.from("habits").select("*").eq("user_id", userId).eq("is_active", true)
      ]).then(function (results) {
        var proj = results[0].data;
        var notes = results[1].data || [];
        var habits = results[2].data || [];
        return AxisOffline.snapshotProject(projectId, proj, [], notes, habits);
      });
    }).then(function () {
      if (toggleBtn) { toggleBtn.disabled = false; }
      renderProjectOfflineToggle();
    }).catch(function (err) {
      console.error("Axis: offline download failed", err);
      AxisOffline.disableProjectOffline(projectId);
      if (toggleBtn) { toggleBtn.disabled = false; }
      if (badge) { badge.className = "project-sync-badge error"; badge.textContent = "download failed"; }
    });
  }

  function timeAgo(date) {
    var sec = Math.round((Date.now() - date) / 1000);
    if (sec < 60) return "just now";
    if (sec < 3600) return Math.floor(sec / 60) + "m ago";
    if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
    return Math.floor(sec / 86400) + "d ago";
  }



  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadGuestState() {
    try {
      var raw = JSON.parse(localStorage.getItem(GUEST_KEY));
      if (!raw) throw new Error("empty");
      return raw;
    } catch (e) {
      return {
        habits: [], entriesByHabit: {}, financial: { income: 0, outcome: 0 },
        transactions: [], financialGoals: [], generalGoals: [], trips: [],
        coins: 0, journeyMilestoneClaimed: 0, displayName: ""
      };
    }
  }

  function saveGuestState() {
    try {
      localStorage.setItem(GUEST_KEY, JSON.stringify({
        habits: state.habits, entriesByHabit: state.entriesByHabit, financial: state.financial,
        transactions: state.transactions, financialGoals: state.financialGoals, generalGoals: state.generalGoals,
        trips: state.trips, coins: state.coins, journeyMilestoneClaimed: state.journeyMilestoneClaimed,
        displayName: state.displayName
      }));
    } catch (e) { console.error("Axis: could not save guest data", e); }
  }

  var state = {
    session: null,
    plan: "free",
    displayName: "",
    fullName: "",
    avatarUrl: "",
    onboardingCompleted: false,
    coins: 0,
    journeyMilestoneClaimed: 0,
    habits: [],
    entriesByHabit: {},
    financial: { income: 0, outcome: 0 },
    transactions: [],
    financialGoals: [],
    generalGoals: [],
    trips: [],
    notes: [],
    projects: [],
    reusableBlocks: []
  };

  var TEMPLATES = [
    { name: "Morning Foundation", desc: "A simple physical + mental start to the day.", items: ["Drink a glass of water", "10 minutes of movement", "Write 3 priorities for today"] },
    { name: "Deep Focus", desc: "Protect a block of real, undistracted work.", items: ["No phone for first hour", "One 90-minute focus block", "Review tomorrow's top task"] },
    { name: "Faith & Reflection", desc: "Small consistent spiritual habits.", items: ["5 minutes of quiet reflection", "Read something meaningful", "One act of kindness"] },
    { name: "Evening Reset", desc: "Close the day with intention.", items: ["Tidy your workspace", "Plan tomorrow", "Screens off 30 min before bed"] }
  ];

  function dateStr(offsetDays) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function fmtMoney(n) {
    var v = Number(n) || 0;
    return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  function statCard(value, label) {
    return '<div class="stat-card"><span class="stat-value">' + value + '</span><span class="stat-label">' + label + '</span></div>';
  }

  // ==================== AUTH GATE (guest-first) ====================

  var gateAuthMode = "signup";
  var pendingSignupContext = null;

  function updateGateFormMode() {
    var isSignup = gateAuthMode === "signup";
    document.getElementById("gate-submit-label").textContent = isSignup ? "Create account" : "Log in";
    document.getElementById("auth-gate-title").textContent = isSignup ? "Create your account" : "Welcome back";
    document.getElementById("gate-toggle").textContent = isSignup ? "Already have an account? Log in" : "Don't have an account? Sign up";
    document.querySelectorAll(".signup-only").forEach(function (el) { el.classList.toggle("hidden", !isSignup); });
    document.querySelectorAll(".login-only").forEach(function (el) { el.classList.toggle("hidden", isSignup); });
    document.getElementById("gate-error").classList.add("hidden");
    document.getElementById("gate-success").classList.add("hidden");
  }

  function openAuthGate(context) {
    var gate = document.getElementById("auth-gate");
    var sub = document.getElementById("auth-gate-sub");
    pendingSignupContext = context;

    var contextMessages = {
      ai: ["Unlock your AI coach", "Sign up to chat with your personal coaching AI."],
      profile: ["Create your profile", "Sign up to save your progress across devices."],
      settings: ["Account required", "Sign up to save your preferences and data."],
      default: ["Create your account", "Sign up to sync your data across devices."]
    };
    var msg = contextMessages[context] || contextMessages.default;
    sub.textContent = msg[1];
    gateAuthMode = "signup";
    updateGateFormMode();
    document.getElementById("auth-gate-title").textContent = msg[0];
    gate.classList.remove("hidden");
  }

  function closeAuthGate() {
    document.getElementById("auth-gate").classList.add("hidden");
  }

  function setGateLoading(loading) {
    var btn = document.getElementById("gate-submit");
    document.getElementById("gate-submit-spinner").classList.toggle("hidden", !loading);
    btn.disabled = loading;
  }

  function initAuthGate() {
    var form = document.getElementById("auth-gate-form");
    var toggle = document.getElementById("gate-toggle");

    toggle.addEventListener("click", function () {
      gateAuthMode = gateAuthMode === "signup" ? "login" : "signup";
      updateGateFormMode();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = document.getElementById("gate-name").value.trim();
      var email = document.getElementById("gate-email").value.trim();
      var password = document.getElementById("gate-password").value;
      var remember = document.getElementById("gate-remember").checked;
      if (!email || !password) return;

      document.getElementById("gate-error").classList.add("hidden");
      setGateLoading(true);

      var action = gateAuthMode === "login"
        ? supabaseClient.auth.signInWithPassword({ email: email, password: password })
        : supabaseClient.auth.signUp({ email: email, password: password, options: { data: { full_name: name } } });

      action.then(function (res) {
        setGateLoading(false);
        if (res.error) {
          document.getElementById("gate-error").textContent = res.error.message;
          document.getElementById("gate-error").classList.remove("hidden");
          return;
        }
        if (gateAuthMode === "login" && !remember) {
          sessionStorage.setItem("axis-no-remember", "1");
        }
        if (gateAuthMode === "signup" && !res.data.session) {
          document.getElementById("gate-success").textContent = "Account created — check your email to verify, then log in.";
          document.getElementById("gate-success").classList.remove("hidden");
          gateAuthMode = "login";
          updateGateFormMode();
          document.getElementById("gate-success").classList.remove("hidden");
          return;
        }
        if (gateAuthMode === "signup") pendingOnboarding = true;
        closeAuthGate();
      });
    });

    document.getElementById("google-login-btn").addEventListener("click", function () {
      supabaseClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    });
    document.getElementById("apple-login-btn").addEventListener("click", function () {
      supabaseClient.auth.signInWithOAuth({ provider: "apple", options: { redirectTo: window.location.origin } });
    });

    document.getElementById("gate-forgot").addEventListener("click", function () {
      openResetModal(document.getElementById("gate-email").value.trim());
    });

    var logoutBtns = ["logout-btn"];
    logoutBtns.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", function () { supabaseClient.auth.signOut(); });
    });

    // If the "remember me" box was unchecked, drop the session when the tab closes.
    window.addEventListener("beforeunload", function () {
      if (sessionStorage.getItem("axis-no-remember") === "1") {
        supabaseClient.auth.signOut();
      }
    });
  }

  // ==================== PASSWORD RESET ====================

  function openResetModal(prefillEmail) {
    var modal = document.getElementById("reset-modal");
    document.getElementById("reset-email").value = prefillEmail || "";
    document.getElementById("reset-request-form").classList.remove("hidden");
    document.getElementById("reset-password-form").classList.add("hidden");
    document.getElementById("reset-error").classList.add("hidden");
    document.getElementById("reset-success").classList.add("hidden");
    modal.classList.remove("hidden");
  }

  function initResetFlow() {
    document.getElementById("reset-modal-close").addEventListener("click", function () {
      document.getElementById("reset-modal").classList.add("hidden");
    });

    document.getElementById("reset-request-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("reset-email").value.trim();
      if (!email) return;
      supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }).then(function (res) {
        var errEl = document.getElementById("reset-error");
        var okEl = document.getElementById("reset-success");
        if (res.error) { errEl.textContent = res.error.message; errEl.classList.remove("hidden"); return; }
        okEl.textContent = "Check your email for a reset link.";
        okEl.classList.remove("hidden");
      });
    });

    document.getElementById("reset-password-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = document.getElementById("new-password").value;
      var confirm = document.getElementById("confirm-password").value;
      var errEl = document.getElementById("reset-error");
      if (pw !== confirm) { errEl.textContent = "Passwords don't match."; errEl.classList.remove("hidden"); return; }
      supabaseClient.auth.updateUser({ password: pw }).then(function (res) {
        if (res.error) { errEl.textContent = res.error.message; errEl.classList.remove("hidden"); return; }
        var okEl = document.getElementById("reset-success");
        okEl.textContent = "Password updated.";
        okEl.classList.remove("hidden");
        setTimeout(function () { document.getElementById("reset-modal").classList.add("hidden"); }, 1500);
      });
    });

    // Supabase redirects back with #access_token=...&type=recovery in the URL hash.
    if (window.location.hash.indexOf("type=recovery") !== -1) {
      openResetModal();
      document.getElementById("reset-request-form").classList.add("hidden");
      document.getElementById("reset-password-form").classList.remove("hidden");
    }
  }

  // ==================== ONBOARDING QUIZ ====================

  var ONBOARDING_QUESTIONS = [
    { key: "focus", title: "What do you want to focus on most?", options: ["Daily habits", "Financial tracking", "Travel planning", "Long-term goals"] },
    { key: "reminder_time", title: "When should Axis check in with you?", options: ["Morning", "Afternoon", "Evening", "I'll open it myself"] },
    { key: "experience", title: "Have you used a habit tracker before?", options: ["This is my first one", "I've tried a few", "I use one regularly", "I've built my own system"] },
    { key: "motivation", title: "What keeps you motivated?", options: ["Streaks", "Seeing progress charts", "Rewards", "Just checking things off"] },
    { key: "ai_interest", title: "Interested in AI coaching?", options: ["Yes, regularly", "Occasionally", "Not really", "Not sure yet"] }
  ];

  var onboardingStep = 0;
  var onboardingAnswers = {};

  function renderOnboardingStep() {
    var q = ONBOARDING_QUESTIONS[onboardingStep];
    var wrap = document.getElementById("onboarding-question-wrap");
    document.getElementById("onboarding-progress-fill").style.width = (((onboardingStep + 1) / ONBOARDING_QUESTIONS.length) * 100) + "%";

    var optionsHtml = q.options.map(function (opt) {
      var selected = onboardingAnswers[q.key] === opt;
      return '<button type="button" class="onboarding-option-btn' + (selected ? " selected" : "") + '" data-value="' + opt + '">' + opt + '</button>';
    }).join("");

    wrap.innerHTML =
      '<p class="onboarding-question-title">' + q.title + '</p>' +
      '<div class="onboarding-options-list">' + optionsHtml + '</div>' +
      '<div class="onboarding-nav-row">' +
      (onboardingStep > 0 ? '<button type="button" class="onboarding-back-btn" id="onboarding-back">Back</button>' : '<span></span>') +
      '<span class="tiny-note">' + (onboardingStep + 1) + ' of ' + ONBOARDING_QUESTIONS.length + '</span>' +
      '</div>';

    wrap.querySelectorAll(".onboarding-option-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        onboardingAnswers[q.key] = btn.getAttribute("data-value");
        if (onboardingStep < ONBOARDING_QUESTIONS.length - 1) {
          onboardingStep++;
          renderOnboardingStep();
        } else {
          finishOnboarding();
        }
      });
    });

    var backBtn = document.getElementById("onboarding-back");
    if (backBtn) backBtn.addEventListener("click", function () { onboardingStep--; renderOnboardingStep(); });
  }

  function startOnboarding() {
    onboardingStep = 0;
    onboardingAnswers = {};
    document.getElementById("onboarding-modal").classList.remove("hidden");
    renderOnboardingStep();
  }

  function finishOnboarding() {
    document.getElementById("onboarding-modal").classList.add("hidden");
    playCompletionAnimation();

    if (!isGuest()) {
      supabaseClient.from("profiles").update({
        preferences: onboardingAnswers, onboarding_completed: true
      }).eq("id", state.session.user.id).then(function (res) {
        if (res.error) console.error("Axis: save onboarding answers failed", res.error);
      });
    }
  }

  function playCompletionAnimation() {
    var screen = document.getElementById("completion-screen");
    screen.classList.remove("hidden");
    // restart CSS animations each time this plays
    var clone = screen.cloneNode(true);
    screen.parentNode.replaceChild(clone, screen);
    clone.classList.remove("hidden");
    setTimeout(function () {
      clone.classList.add("hidden");
    }, 2400);
  }

  // ==================== NAVIGATION ====================

  function isGuest() { return !state.session; }

  function goToPage(pageId) {
    document.querySelectorAll(".page").forEach(function (el) {
      el.classList.toggle("hidden", el.getAttribute("data-page") !== pageId);
    });
    document.querySelectorAll(".nav-item").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-page") === pageId);
    });
    document.querySelectorAll(".bottom-nav-item[data-page]").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-page") === pageId);
    });
    var cluster = document.getElementById("topright-cluster");
    if (cluster) cluster.classList.toggle("hidden", pageId !== "dashboard");
    window.scrollTo(0, 0);
  }

  function initStickyDashTopbar() {
    var bar = document.getElementById("dash-mobile-topbar");
    if (!bar) return;
    var ticking = false;
    function update() {
      bar.classList.toggle("scrolled", window.scrollY > 4);
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();
  }

  function initNav() {
    document.querySelectorAll("[data-page]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        goToPage(el.getAttribute("data-page"));
        var menu = document.getElementById("dash-dropdown-menu");
        if (menu) menu.classList.add("hidden");
      });
    });
    document.querySelectorAll("[data-page-link]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        goToPage(el.getAttribute("data-page-link"));
      });
    });
    var profileFab = document.getElementById("profile-fab");
    if (profileFab) profileFab.addEventListener("click", function () { goToPage("profile"); });

    var dropdownBtn = document.getElementById("dash-dropdown-btn");
    var dropdownMenu = document.getElementById("dash-dropdown-menu");
    if (dropdownBtn && dropdownMenu) {
      dropdownBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        dropdownMenu.classList.toggle("hidden");
      });
      document.addEventListener("click", function (e) {
        if (!dropdownMenu.classList.contains("hidden") && !dropdownMenu.contains(e.target) && e.target !== dropdownBtn) {
          dropdownMenu.classList.add("hidden");
        }
      });
    }

    var quickNoteBtn = document.getElementById("quick-note-btn");
    if (quickNoteBtn) {
      quickNoteBtn.addEventListener("click", function () {
        var notesList = document.getElementById("dash-notes-list");
        if (!notesList) return;
        notesList.scrollIntoView({ behavior: "smooth", block: "center" });
        var input = notesList.querySelector(".add-note-row input");
        if (input) setTimeout(function () { input.focus(); }, 350);
      });
    }

    var dashProfileBtn = document.getElementById("dash-profile-btn");
    if (dashProfileBtn) dashProfileBtn.addEventListener("click", function () { goToPage("profile"); });
  }

  // ==================== THEME ====================

  function initTheme() {
    var saved = localStorage.getItem("axis-theme");
    if (saved === "dark") document.body.classList.add("dark-theme");
    var btn = document.getElementById("theme-btn");
    var label = document.getElementById("theme-label");
    if (btn) btn.addEventListener("click", function () {
      document.body.classList.toggle("dark-theme");
      var dark = document.body.classList.contains("dark-theme");
      localStorage.setItem("axis-theme", dark ? "dark" : "light");
      if (label) label.textContent = dark ? "Light mode" : "Dark mode";
    });
    var dark = document.body.classList.contains("dark-theme");
    if (label) label.textContent = dark ? "Light mode" : "Dark mode";
  }

  // ==================== AD RAIL ====================

  function updateAdRail() {
    var rail = document.getElementById("ad-rail");
    if (!rail) return;
    var shouldShow = state.plan !== "premium" && navigator.onLine;
    rail.classList.toggle("hidden", !shouldShow);
  }

  window.addEventListener("online", updateAdRail);

  var resizeTimer = null;
  var lastChartDayCount = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var current = chartDayCount();
      if (current !== lastChartDayCount) {
        lastChartDayCount = current;
        if (state.session) renderAnalytics();
      }
    }, 200);
  });
  window.addEventListener("offline", updateAdRail);

  // ==================== COINS ====================

  function updateCoinDisplay() {
    var el = document.getElementById("profile-cover-coins");
    if (el) el.textContent = state.coins;
    var trCoins = document.getElementById("tr-coins-value");
    if (trCoins) trCoins.textContent = state.coins;
    var mobileTrCoins = document.getElementById("mobile-tr-coins-value");
    if (mobileTrCoins) mobileTrCoins.textContent = state.coins;
  }

  function adjustCoins(delta) {
    state.coins = Math.max(0, state.coins + delta);
    updateCoinDisplay();
    if (isGuest()) { saveGuestState(); return; }
    supabaseClient.from("profiles").update({ coins: state.coins }).eq("id", state.session.user.id)
      .then(function (res) { if (res.error) console.error("Axis: coin update failed", res.error); });
  }

  // ==================== TOPBAR ====================

  function renderTopbar() {
    var habits = dailyHabits();
    var bestStreak = habits.reduce(function (max, h) { return Math.max(max, habitStreak(h.id)); }, 0);
    // top-right pills (desktop)
    var trStreak = document.getElementById("tr-streak-value");
    if (trStreak) trStreak.textContent = bestStreak;
    var trCoins = document.getElementById("tr-coins-value");
    if (trCoins) trCoins.textContent = state.coins;
    // mobile header pills
    var mobileTrStreak = document.getElementById("mobile-tr-streak-value");
    if (mobileTrStreak) mobileTrStreak.textContent = bestStreak;
    var mobileTrCoins = document.getElementById("mobile-tr-coins-value");
    if (mobileTrCoins) mobileTrCoins.textContent = state.coins;
    // profile cover badges (mobile profile page)
    var coverStreak = document.getElementById("profile-cover-streak");
    if (coverStreak) coverStreak.textContent = bestStreak;
    updateCoinDisplay();

    var remaining = habits.filter(function (h) { return !isDone(h.id, 0); }).length;
    var mobileBadge = document.getElementById("mobile-notif-badge");
    if (mobileBadge) {
      mobileBadge.textContent = remaining;
      mobileBadge.classList.toggle("hidden", remaining === 0);
    }
    // sidebar user row
    var initial = (state.fullName || state.displayName || (state.session && state.session.user.email) || "A").charAt(0).toUpperCase();
    var sideAvatar = document.getElementById("sidebar-user-avatar");
    if (sideAvatar) sideAvatar.textContent = initial;
    var sideName = document.getElementById("sidebar-user-name");
    if (sideName) sideName.textContent = state.fullName || state.displayName || "Your name";
    var sidePlan = document.getElementById("sidebar-user-plan");
    if (sidePlan) sidePlan.textContent = state.plan === "premium" ? "Premium Plan" : "Free Plan";
  }

  // ==================== DATA LOADING ====================

  function loadGuestData() {
    var guest = loadGuestState();
    state.habits = guest.habits;
    state.entriesByHabit = guest.entriesByHabit;
    state.financial = guest.financial;
    state.transactions = guest.transactions;
    state.financialGoals = guest.financialGoals;
    state.generalGoals = guest.generalGoals;
    state.trips = guest.trips;
    state.coins = guest.coins;
    state.journeyMilestoneClaimed = guest.journeyMilestoneClaimed;
    state.displayName = guest.displayName;
    state.plan = "free";
    updateAdRail();
    updateCoinDisplay();
    renderAll();
  }

  function loadAllData() {
    var userId = state.session.user.id;
    var since = dateStr(60);

    var calls = [
      supabaseClient.from("profiles").select("plan, display_name, coins, journey_milestone_claimed, full_name, avatar_url, onboarding_completed").eq("id", userId).single(),
      supabaseClient.from("habits").select("*").eq("user_id", userId).eq("is_active", true).order("created_at"),
      supabaseClient.from("habit_entries").select("habit_id, entry_date").eq("user_id", userId).gte("entry_date", since),
      supabaseClient.from("financial_state").select("*").eq("user_id", userId).maybeSingle(),
      supabaseClient.from("transactions").select("*").eq("user_id", userId).order("entry_date", { ascending: false }).limit(30),
      supabaseClient.from("goals").select("*").eq("user_id", userId).order("created_at"),
      supabaseClient.from("trips").select("*").eq("user_id", userId).order("created_at"),
      supabaseClient.from("notes").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
      supabaseClient.from("projects").select("*").eq("user_id", userId).order("created_at"),
      supabaseClient.from("reusable_blocks").select("*").eq("user_id", userId).order("created_at", { ascending: false })
    ];

    return Promise.all(calls).then(function (results) {
      var profileRes = results[0], habitsRes = results[1], entriesRes = results[2],
          finRes = results[3], txRes = results[4], goalsRes = results[5], tripsRes = results[6],
          notesRes = results[7], projectsRes = results[8], reusableRes = results[9];

      if (profileRes.data) {
        state.plan = profileRes.data.plan || "free";
        state.displayName = profileRes.data.display_name || "";
        state.coins = profileRes.data.coins || 0;
        state.journeyMilestoneClaimed = profileRes.data.journey_milestone_claimed || 0;
        state.fullName = profileRes.data.full_name || "";
        state.avatarUrl = profileRes.data.avatar_url || "";
        state.onboardingCompleted = !!profileRes.data.onboarding_completed;
      }
      if (habitsRes.error) console.error("Axis: habits fetch failed", habitsRes.error);
      state.habits = habitsRes.data || [];

      state.entriesByHabit = {};
      (entriesRes.data || []).forEach(function (row) {
        if (!state.entriesByHabit[row.habit_id]) state.entriesByHabit[row.habit_id] = {};
        state.entriesByHabit[row.habit_id][row.entry_date] = true;
      });

      if (finRes.data) state.financial = { income: finRes.data.income, outcome: finRes.data.outcome };
      state.transactions = txRes.data || [];
      var goals = goalsRes.data || [];
      state.financialGoals = goals.filter(function (g) { return g.category === "financial"; });
      state.generalGoals = goals.filter(function (g) { return g.category === "general"; });
      state.trips = tripsRes.data || [];
      if (notesRes.error) console.error("Axis: notes fetch failed", notesRes.error);
      state.notes = notesRes.data || [];
      if (projectsRes.error) console.error("Axis: projects fetch failed", projectsRes.error);
      state.projects = projectsRes.data || [];
      if (reusableRes.error) console.error("Axis: reusable blocks fetch failed", reusableRes.error);
      state.reusableBlocks = reusableRes.data || [];

      // Persist to IndexedDB for offline access
      if (offlineReady) {
        state.habits.forEach(function (h) { AxisOffline.put("habits", h); });
        state.notes.forEach(function (n) { AxisOffline.put("notes", n); });
        state.projects.forEach(function (p) { AxisOffline.put("projects", p); });
        AxisOffline.flush(supabaseClient).then(function (result) {
          if (result.flushed > 0) updateSyncStatusBar();
        });
      }

      updateAdRail();
      updateCoinDisplay();
      renderAll();
    });
  }

  // ==================== DAILY HABITS ====================

  function isDone(habitId, offsetDays) {
    var set = state.entriesByHabit[habitId];
    return !!(set && set[dateStr(offsetDays)]);
  }

  function habitStreak(habitId) {
    var offset = isDone(habitId, 0) ? 0 : 1;
    if (offset === 1 && !isDone(habitId, 1)) return 0;
    var streak = 0;
    while (isDone(habitId, offset)) { streak++; offset++; }
    return streak;
  }

  function dailyHabits() {
    return state.habits.filter(function (h) { return h.dimension === "daily"; });
  }

  function addHabit(name) {
    if (!name.trim()) return;
    if (isGuest()) {
      state.habits.push({ id: uid(), dimension: "daily", name: name.trim() });
      saveGuestState();
      renderDaily(); renderDashboard(); renderTemplatesTab();
      return;
    }
    var userId = state.session.user.id;
    var tempId = uid();
    var newHabit = { id: tempId, user_id: userId, dimension: "daily", name: name.trim(), is_active: true, created_at: new Date().toISOString() };
    if (offlineReady) AxisOffline.put("habits", newHabit);
    if (!navigator.onLine) {
      state.habits.push(newHabit);
      enqueueIfOffline("habits", "upsert", newHabit);
      renderDaily(); renderDashboard(); renderTemplatesTab();
      return;
    }
    supabaseClient.from("habits").insert({ user_id: userId, dimension: "daily", name: name.trim() })
      .select().single().then(function (res) {
        if (res.error) {
          state.habits.push(newHabit);
          enqueueIfOffline("habits", "upsert", newHabit);
          renderDaily(); renderDashboard(); renderTemplatesTab();
          return;
        }
        if (offlineReady) AxisOffline.put("habits", res.data);
        state.habits.push(res.data);
        renderDaily(); renderDashboard(); renderTemplatesTab();
      });
  }

  function removeHabit(habitId) {
    state.habits = state.habits.filter(function (h) { return h.id !== habitId; });
    if (offlineReady) AxisOffline.del("habits", habitId);
    renderDaily(); renderDashboard();
    if (isGuest()) { saveGuestState(); return; }
    if (!navigator.onLine) { enqueueIfOffline("habits", "delete", null, habitId); return; }
    supabaseClient.from("habits").delete().eq("id", habitId).then(function (res) {
      if (res.error) enqueueIfOffline("habits", "delete", null, habitId);
    });
  }

  function toggleHabit(habitId) {
    var today = dateStr(0);
    var currentlyDone = isDone(habitId, 0);

    if (!state.entriesByHabit[habitId]) state.entriesByHabit[habitId] = {};
    if (currentlyDone) delete state.entriesByHabit[habitId][today];
    else state.entriesByHabit[habitId][today] = true;

    adjustCoins(currentlyDone ? -1 : 1);
    renderDaily(); renderDashboard(); renderAnalytics(); renderTopbar();
    if (isGuest()) { saveGuestState(); return; }

    var entryRecord = { id: habitId + "_" + today, habit_id: habitId, user_id: state.session.user.id, entry_date: today, completed: !currentlyDone };
    if (!currentlyDone && offlineReady) AxisOffline.put("habit_entries", entryRecord);
    else if (currentlyDone && offlineReady) AxisOffline.del("habit_entries", habitId + "_" + today);

    if (!navigator.onLine) {
      enqueueIfOffline("habit_entries", currentlyDone ? "delete" : "upsert", currentlyDone ? null : entryRecord, currentlyDone ? (habitId + "_" + today) : null);
      return;
    }
    var userId = state.session.user.id;
    var query = currentlyDone
      ? supabaseClient.from("habit_entries").delete().eq("habit_id", habitId).eq("entry_date", today)
      : supabaseClient.from("habit_entries").insert({ user_id: userId, habit_id: habitId, entry_date: today, completed: true });
    query.then(function (res) {
      if (res.error) enqueueIfOffline("habit_entries", currentlyDone ? "delete" : "upsert", currentlyDone ? null : entryRecord, currentlyDone ? (habitId + "_" + today) : null);
    });
  }

  function buildHabitListEl(habits) {
    var list = document.createElement("div");
    list.className = "habit-list";
    if (habits.length === 0) {
      var note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "Nothing tracked here yet — add the first thing below.";
      list.appendChild(note);
      return list;
    }
    habits.forEach(function (h) {
      var tpl = document.getElementById("habit-row-template").content.cloneNode(true);
      var row = tpl.querySelector(".habit-row");
      if (isDone(h.id, 0)) row.classList.add("done");
      row.querySelector(".habit-name").textContent = h.name;
      var streak = habitStreak(h.id);
      row.querySelector(".habit-streak").textContent = streak > 0 ? streak + "d streak" : "";
      row.querySelector(".habit-check").addEventListener("click", function () { toggleHabit(h.id); });
      row.querySelector(".habit-remove").addEventListener("click", function () { removeHabit(h.id); });
      list.appendChild(row);
    });
    return list;
  }

  function buildAddRow(onSubmit, placeholder) {
    var addRow = document.createElement("div");
    addRow.className = "add-habit-row";
    addRow.innerHTML = '<input type="text" placeholder="' + (placeholder || "Add task") + '" maxlength="60"><button type="button">Add</button>';
    var input = addRow.querySelector("input");
    var button = addRow.querySelector("button");
    function submit() { if (input.value.trim()) { onSubmit(input.value); input.value = ""; } }
    button.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    return addRow;
  }

  function renderDaily() {
    var habits = dailyHabits();
    var doneCount = habits.filter(function (h) { return isDone(h.id, 0); }).length;
    var bestStreak = habits.reduce(function (max, h) { return Math.max(max, habitStreak(h.id)); }, 0);

    document.getElementById("daily-analytics").innerHTML =
      statCard(doneCount + "/" + habits.length, "Done today") +
      statCard(bestStreak, "Best streak") +
      statCard(habits.length, "Tracked");

    var listWrap = document.getElementById("daily-list");
    listWrap.innerHTML = "";
    listWrap.appendChild(buildHabitListEl(habits));
    listWrap.appendChild(buildAddRow(addHabit, "Add something to track…"));
  }

  // ==================== HOME ====================

  // ==================== DASHBOARD ====================

  function completionSeries(days) {
    var habits = dailyHabits();
    var series = [];
    for (var i = days - 1; i >= 0; i--) {
      var doneCount = habits.filter(function (h) { return isDone(h.id, i); }).length;
      var pct = habits.length ? (doneCount / habits.length) * 100 : 0;
      series.push({ label: "D" + (days - i), pct: pct });
    }
    return series;
  }

  function chartDayCount() {
    return window.innerWidth >= 768 ? 19 : 7;
  }

  function renderComboChart(containerEl, series) {
    var count = series.length;
    var compact = count > 10;
    var barWidth = compact ? 14 : 26;
    var gap = compact ? 5 : 10;
    var height = 90;
    var padding = 12;
    var leftPad = 26;

    var plotWidth = count * (barWidth + gap);
    var svgWidth = plotWidth + leftPad;

    var yTicks = [0, 25, 50, 75, 100];
    var gridLines = yTicks.map(function (t) {
      var y = height - padding - (t / 100) * (height - padding * 2);
      return '<line x1="' + leftPad + '" x2="' + svgWidth + '" y1="' + y + '" y2="' + y + '" stroke="#E8E1D3" stroke-width="1"/>' +
        '<text x="' + (leftPad - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-size="8" fill="#8A8070" font-family="IBM Plex Mono">' + t + '%</text>';
    }).join("");

    var linePoints = series.map(function (d, i) {
      var x = leftPad + i * (barWidth + gap) + barWidth / 2;
      var y = height - padding - (d.pct / 100) * (height - padding * 2);
      return [x, y];
    });
    var linePath = linePoints.map(function (p, i) { return (i === 0 ? "M" : "L") + p[0] + "," + p[1]; }).join(" ");

    var bars = series.map(function (d, i) {
      var barHeight = (d.pct / 100) * (height - padding * 2);
      var x = leftPad + i * (barWidth + gap);
      var y = height - padding - barHeight;
      var showLabel = !compact || i % 3 === 0 || i === count - 1;
      return '<rect x="' + x + '" y="' + y + '" width="' + barWidth + '" height="' + Math.max(barHeight, 2) + '" rx="4" fill="#4F46E5" opacity="0.8"/>' +
        (showLabel ? '<text x="' + (x + barWidth / 2) + '" y="' + (height + 12) + '" text-anchor="middle" font-size="' + (compact ? 6.5 : 9) + '" fill="#8A8070" font-family="IBM Plex Mono">' + d.label + '</text>' : "");
    }).join("");

    containerEl.innerHTML =
      '<svg viewBox="0 0 ' + svgWidth + ' ' + (height + 20) + '" class="chart-svg-wrap" preserveAspectRatio="xMinYMid meet">' +
      gridLines + bars +
      '<path d="' + linePath + '" fill="none" stroke="#23291F" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>' +
      linePoints.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.5" fill="#23291F"/>'; }).join("") +
      '</svg>';
  }

  function renderYourFocus() {
    var pct = Math.round(dayCompletionPct(0));

    // Desktop Focus donut (new element)
    var desktopDonut = document.getElementById("dash-donut");
    if (desktopDonut) {
      desktopDonut.style.background = "conic-gradient(var(--accent) " + pct + "%, var(--surface) " + pct + "%)";
      var pctEl = document.getElementById("dash-donut-value");
      if (pctEl) pctEl.textContent = pct + "%";
    }

    // Mobile momentum donut
    var mobileDonut = document.getElementById("dash-donut-mobile");
    if (mobileDonut) {
      mobileDonut.style.background = "conic-gradient(var(--accent) " + pct + "%, var(--surface-2) " + pct + "%)";
      var mPctEl = document.getElementById("dash-donut-value-mobile");
      if (mPctEl) mPctEl.textContent = pct + "%";
    }

    // Focus goal text
    var focusGoal = document.getElementById("dash-focus-goal");
    if (focusGoal) {
      var topGoal = state.generalGoals[0] || state.financialGoals[0];
      focusGoal.textContent = topGoal ? topGoal.name : "Add goals to see your focus here.";
    }

    // Next action — first incomplete habit
    var nextItem = document.getElementById("dash-next-action-item");
    if (nextItem) {
      var habits = dailyHabits();
      var next = habits.filter(function (h) { return !isDone(h.id, 0); })[0];
      var circle = nextItem.querySelector(".dash-next-circle");
      var text = nextItem.querySelector(".dash-next-text");
      if (next && text) { text.textContent = next.name; }
      else if (text) { text.textContent = habits.length ? "All done today!" : "No habits added yet"; }
    }
  }

  function renderDesktopStats() {
    var habits = dailyHabits();
    var doneCount = habits.filter(function (h) { return isDone(h.id, 0); }).length;
    var todayPct = habits.length ? Math.round((doneCount / habits.length) * 100) : 0;
    var yesterdayPct = Math.round(dayCompletionPct(1));
    var diff = todayPct - yesterdayPct;

    var focusEl = document.getElementById("stat-focus-score");
    if (!focusEl) return;
    focusEl.textContent = todayPct + "%";
    var trendEl = document.getElementById("stat-focus-trend");
    if (habits.length === 0) { trendEl.textContent = ""; }
    else {
      trendEl.textContent = (diff >= 0 ? "↑ " : "↓ ") + Math.abs(diff) + "% from yesterday";
      trendEl.style.color = diff >= 0 ? "var(--accent)" : "var(--physical)";
    }

    var ste = document.getElementById("stat-tasks-today"); if (ste) ste.textContent = doneCount + "/" + habits.length;
    var stp = document.getElementById("stat-tasks-pct"); if (stp) stp.textContent = todayPct + "% momentum";
    var str = document.getElementById("stat-tasks-ring"); if (str) str.style.background = "conic-gradient(var(--accent) " + todayPct + "%, var(--surface-2) " + todayPct + "%)";

    // desktop's paired Task Progress donut (separate element from the mobile "Your Focus" donut)
    var donut2 = document.getElementById("dash-donut-2");
    if (donut2) {
      var pendingPct = 100 - todayPct;
      donut2.style.background = "conic-gradient(var(--accent) " + todayPct + "%, var(--surface-2) " + todayPct + "%)";
      var dv2 = document.getElementById("dash-donut-value-2"); if (dv2) dv2.textContent = todayPct + "%";
      var legend = document.getElementById("dash-donut-legend");
      if (legend) {
        legend.innerHTML =
          '<div class="donut-legend-row"><span><span class="donut-legend-dot" style="background:var(--accent);"></span>Completed</span><span>' + todayPct + '%</span></div>' +
          '<div class="donut-legend-row"><span><span class="donut-legend-dot" style="background:var(--surface-2);border:1px solid var(--line);"></span>Pending</span><span>' + pendingPct + '%</span></div>';
      }
    }
  }

  function renderGoalsPreview() {
    var wrap = document.getElementById("dash-goals-preview");
    if (!wrap) return;
    var goals = state.financialGoals.concat(state.generalGoals).slice(0, 3);
    if (goals.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No goals yet.</p>';
      return;
    }
    wrap.innerHTML = goals.map(function (g) {
      var pct = g.target > 0 ? Math.min(Math.round((g.current / g.target) * 100), 100) : 0;
      return '<div style="margin-bottom:0.9rem;">' +
        '<div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:0.35rem;"><span>' + g.name + '</span><span style="color:var(--text-muted);">' + pct + '%</span></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--accent);"></div></div>' +
        '</div>';
    }).join("");
  }

  function renderDashGreeting() {
    var hour = new Date().getHours();
    var timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    var name = state.fullName || state.displayName;
    var emoji = hour < 12 ? " ☀️" : hour < 18 ? " 👋" : " 🌙";
    var text = timeGreeting + (name ? ", " + name + "!" : "!") + emoji;
    var el = document.getElementById("dash-greeting");
    if (el) el.textContent = text;
    var aiGreeting = document.getElementById("ai-inline-greeting");
    if (aiGreeting) aiGreeting.textContent = (name ? "Hi " + name + "! " : "Hi! ") + "How can I help you build momentum today?";
  }

  function renderGoalsCards() {
    var wrap = document.getElementById("dash-goals-cards");
    if (!wrap) return;
    var goals = state.financialGoals.concat(state.generalGoals).slice(0, 3);
    wrap.innerHTML = goals.map(function (g) {
      var pct = g.target > 0 ? Math.min(Math.round((g.current / g.target) * 100), 100) : 0;
      return '<div class="goal-card-tile">' +
        '<div class="goal-card-tile-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg></div>' +
        '<div><p class="goal-card-tile-name">' + g.name + '</p><p class="goal-card-tile-pct">' + pct + '% there</p></div>' +
        '</div>';
    }).join("") +
      '<div class="goal-card-add" data-page-link="goals"><span class="goal-card-add-icon">+</span><span class="goal-card-add-label">New Goal</span></div>';
    wrap.querySelectorAll("[data-page-link]").forEach(function (el) {
      el.addEventListener("click", function () { goToPage(el.getAttribute("data-page-link")); });
    });
  }

  function renderTodayPlan() {
    var habits = dailyHabits();

    // Desktop — rich rows with check, name, tag, time
    var desktopWrap = document.getElementById("dash-today-plan");
    if (desktopWrap) {
      if (habits.length === 0) {
        desktopWrap.innerHTML = '<p class="empty-note" style="padding:1rem 0;">Add habits to see your plan here.</p>';
      } else {
        desktopWrap.innerHTML = "";
        habits.slice(0, 6).forEach(function (h, idx) {
          var done = isDone(h.id, 0);
          var row = document.createElement("div");
          row.className = "dash-plan-row";
          var hour = 6 + idx * 2;
          var timeStr = (hour > 12 ? hour - 12 : hour) + ":00 " + (hour >= 12 ? "PM" : "AM");
          row.innerHTML =
            '<button type="button" class="dash-plan-check' + (done ? " done" : "") + '" data-habit="' + h.id + '"></button>' +
            '<span class="dash-plan-name' + (done ? " done-text" : "") + '">' + h.name + '</span>' +
            '<span class="dash-plan-time">' + timeStr + '</span>';
          var checkBtn = row.querySelector(".dash-plan-check");
          checkBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleHabit(h.id); });
          desktopWrap.appendChild(row);
        });
      }
    }

    // Mobile — numbered list
    var mobileWrap = document.getElementById("dash-today-plan-mobile");
    if (mobileWrap) {
      mobileWrap.innerHTML = "";
      mobileWrap.appendChild(buildHabitListEl(habits));
    }
  }

  function renderTemplatesPreview() {
    var wrap = document.getElementById("dash-templates-preview");
    wrap.innerHTML = "";
    TEMPLATES.slice(0, 4).forEach(function (t) {
      var card = document.createElement("div");
      card.className = "template-preview-card";
      card.innerHTML = "<h4>" + t.name + "</h4>";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Add";
      btn.addEventListener("click", function () { applyTemplate(t.items); goToPage("daily"); });
      card.appendChild(btn);
      wrap.appendChild(card);
    });
  }


  function renderHabitsWeekGrid() {
    var wrap = document.getElementById("dash-habits-grid");
    var habits = dailyHabits();
    if (habits.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No habits yet.</p>';
      return;
    }
    var dayLetters = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      dayLetters.push(d.toLocaleDateString(undefined, { weekday: "narrow" }));
    }
    var header = '<div class="habit-week-row"><span></span>' +
      dayLetters.map(function (l) { return '<span class="tiny-note" style="text-align:center;">' + l + '</span>'; }).join("") + '</div>';

    var rows = habits.slice(0, 6).map(function (h) {
      var cells = "";
      for (var i = 6; i >= 0; i--) {
        var done = isDone(h.id, i);
        cells += '<span class="habit-week-dot' + (done ? " done" : "") + '"></span>';
      }
      return '<div class="habit-week-row"><span class="habit-week-name">' + h.name + '</span>' + cells + '</div>';
    }).join("");

    wrap.innerHTML = header + rows;
  }

  // ---------- Calendar widget ----------

  var calendarViewDate = new Date();

  function renderCalendar() {
    var wrap = document.getElementById("dash-calendar");
    var year = calendarViewDate.getFullYear();
    var month = calendarViewDate.getMonth();
    var today = new Date();

    document.getElementById("calendar-month-label").textContent =
      calendarViewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    var firstDay = new Date(year, month, 1);
    var startOffset = (firstDay.getDay() + 6) % 7; // Monday-first
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var daysInPrevMonth = new Date(year, month, 0).getDate();

    var dayLabels = ["M", "T", "W", "T", "F", "S", "S"];
    var html = '<div class="cal-grid">' + dayLabels.map(function (l) { return '<span class="cal-day-label">' + l + '</span>'; }).join("");

    for (var i = 0; i < startOffset; i++) {
      html += '<span class="cal-cell muted">' + (daysInPrevMonth - startOffset + i + 1) + '</span>';
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      html += '<span class="cal-cell' + (isToday ? " today" : "") + '">' + d + '</span>';
    }
    var totalCells = startOffset + daysInMonth;
    var trailing = (7 - (totalCells % 7)) % 7;
    for (var t = 1; t <= trailing; t++) {
      html += '<span class="cal-cell muted">' + t + '</span>';
    }
    html += '</div>';
    wrap.innerHTML = html;
  }

  // ---------- Quick notes ----------

  function renderNotes() {
    var wrap = document.getElementById("dash-notes-list");
    wrap.innerHTML = "";
    if (state.notes.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No notes yet.</p>';
    }
    state.notes.slice(0, 5).forEach(function (n) {
      var row = document.createElement("div");
      row.className = "note-item";
      var d = new Date(n.created_at || Date.now());
      row.innerHTML =
        '<span class="note-text">' + n.text.replace(/</g, "&lt;") + '</span>' +
        '<span class="note-date">' + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + '</span>';
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "note-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", function () { removeNote(n.id); });
      row.appendChild(removeBtn);
      wrap.appendChild(row);
    });

    var addRow = document.createElement("div");
    addRow.className = "add-note-row";
    addRow.innerHTML = '<input type="text" placeholder="Add a note…" maxlength="200"><button type="button">Add</button>';
    var input = addRow.querySelector("input");
    addRow.querySelector("button").addEventListener("click", function () {
      if (input.value.trim()) { addNote(input.value.trim()); input.value = ""; }
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && input.value.trim()) { addNote(input.value.trim()); input.value = ""; }
    });
    wrap.appendChild(addRow);
  }

  function addNote(text) {
    var userId = state.session.user.id;
    var tempId = uid();
    var newNote = { id: tempId, user_id: userId, text: text, created_at: new Date().toISOString() };
    if (offlineReady) AxisOffline.put("notes", newNote);
    if (!navigator.onLine) {
      state.notes.unshift(newNote);
      renderNotes();
      enqueueIfOffline("notes", "upsert", newNote);
      return;
    }
    supabaseClient.from("notes").insert({ user_id: userId, text: text }).select().single().then(function (res) {
      if (res.error) {
        state.notes.unshift(newNote);
        renderNotes();
        enqueueIfOffline("notes", "upsert", newNote);
        return;
      }
      if (offlineReady) AxisOffline.put("notes", res.data);
      state.notes.unshift(res.data);
      renderNotes();
    });
  }

  function removeNote(id) {
    state.notes = state.notes.filter(function (n) { return n.id !== id; });
    if (offlineReady) AxisOffline.del("notes", id);
    renderNotes();
    if (!navigator.onLine) { enqueueIfOffline("notes", "delete", null, id); return; }
    supabaseClient.from("notes").delete().eq("id", id).then(function (res) {
      if (res.error) enqueueIfOffline("notes", "delete", null, id);
    });
  }

  // ==================== PROJECTS (blocks, Notion-style) ====================

  function currentProject() {
    return state.projects.filter(function (p) { return p.id === currentProjectId; })[0];
  }

  function projectProgress(project) {
    var total = 0, done = 0;
    (project.content || []).forEach(function (b) {
      if (b.type === "checklist") {
        (b.items || []).forEach(function (it) { total++; if (it.checked) done++; });
      }
    });
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  var DASH_QUOTES = [
    { text: "Discipline is choosing between what you want now and what you want most.", author: "Unknown" },
    { text: "Small steps every day lead to big change over time.", author: "Unknown" },
    { text: "Motivation gets you started. Momentum keeps you going.", author: "Jim Ryun" },
    { text: "You do not rise to the level of your goals. You fall to the level of your systems.", author: "James Clear" },
    { text: "The secret of getting ahead is getting started.", author: "Mark Twain" }
  ];

  function renderDashQuote() {
    var textEl = document.getElementById("dash-quote-text");
    if (!textEl) return;
    var dayIndex = Math.floor(Date.now() / 86400000) % DASH_QUOTES.length;
    var q = DASH_QUOTES[dayIndex];
    textEl.textContent = q.text;
    document.getElementById("dash-quote-author").textContent = "— " + q.author;
  }

  function recentProjects() {
    var active = state.projects.filter(function (p) { return !p.archived; });
    var pinned = active.filter(function (p) { return p.pinned; });
    var unpinned = active.filter(function (p) { return !p.pinned; }).sort(function (a, b) {
      var aT = a.last_opened_at || a.created_at || "";
      var bT = b.last_opened_at || b.created_at || "";
      return bT.localeCompare(aT);
    });
    return pinned.concat(unpinned).slice(0, 4);
  }

  function buildRecentProjectCard(p) {
    var card = document.createElement("div");
    card.className = "recent-project-card";

    var cover = document.createElement("div");
    cover.className = "recent-project-cover";
    if (p.cover_url) cover.style.backgroundImage = "url(" + p.cover_url + ")";

    var icon = document.createElement("div");
    icon.className = "recent-project-icon";
    icon.innerHTML = iconSvg(p.icon);
    cover.appendChild(icon);
    card.appendChild(cover);

    var name = document.createElement("div");
    name.className = "recent-project-name";
    name.textContent = p.name || "Untitled project";
    card.appendChild(name);

    card.addEventListener("click", function () { goToPage("projects"); openProjectDetail(p.id); });
    return card;
  }

  function renderProjectsPreview() {
    var recents = recentProjects();
    [document.getElementById("dash-projects-preview"), document.getElementById("dash-recent-projects-mobile")].forEach(function (wrap) {
      if (!wrap) return;
      if (recents.length === 0) {
        wrap.innerHTML = '<p class="empty-note">No projects yet.</p>';
        return;
      }
      wrap.innerHTML = "";
      recents.forEach(function (p) { wrap.appendChild(buildRecentProjectCard(p)); });
    });
  }

  var projectsFilter = "active";

  function renderProjectsList() {
    var grid = document.getElementById("projects-grid");
    if (!grid) return;

    // If offline and no in-memory projects, try loading from IndexedDB
    if (!navigator.onLine && state.projects.length === 0 && offlineReady) {
      AxisOffline.getAll("projects").then(function (localProjects) {
        state.projects = localProjects || [];
        _renderProjectsGrid(grid);
      });
      return;
    }
    _renderProjectsGrid(grid);
  }

  function _renderProjectsGrid(grid) {
    var filtered = state.projects.filter(function (p) {
      return projectsFilter === "archived" ? !!p.archived : !p.archived;
    });

    if (filtered.length === 0) {
      grid.innerHTML = projectsFilter === "archived"
        ? '<p class="empty-note">No archived projects.</p>'
        : '<p class="empty-note">No projects yet — create your first one.</p>';
      return;
    }
    var offlineIds = {};
    var loadOfflineIds = offlineReady
      ? AxisOffline.getOfflineProjects().then(function (recs) { recs.forEach(function (r) { offlineIds[r.project_id] = true; }); })
      : Promise.resolve();

    loadOfflineIds.then(function () {
      grid.innerHTML = "";
      filtered.forEach(function (p) {
        var pct = projectProgress(p);
        var isOffline = !!offlineIds[p.id];
        var card = document.createElement("div");
        card.className = "project-card";
        card.innerHTML =
          (p.pinned ? '<span class="project-card-pin-badge" title="Pinned"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" stroke-width="2"/><path d="M5 17h14l-2-7V5a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v5z"/></svg></span>' : '') +
          '<button type="button" class="project-card-menu-btn" data-id="' + p.id + '" aria-label="More">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></button>' +
          '<div class="project-card-icon">' + iconSvg(p.icon) + '</div>' +
          '<p class="project-card-name">' + (p.name || "Untitled project") +
          (isOffline ? '<span class="project-card-offline-dot" title="Available offline"></span>' : '') + '</p>' +
          '<p class="project-card-sub">' + (p.subtitle || "No description yet") + '</p>' +
          '<div class="project-card-progress-row"><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--accent);"></div></div><span class="project-card-progress-pct">' + pct + '%</span></div>';
        card.addEventListener("click", function (e) {
          if (e.target.closest(".project-card-menu-btn")) return;
          openProjectDetail(p.id);
        });
        card.querySelector(".project-card-menu-btn").addEventListener("click", function (e) {
          e.stopPropagation();
          openProjectCardMenu(e.currentTarget, p.id);
        });
        grid.appendChild(card);
      });
    });
  }

  function initProjectsTabs() {
    document.querySelectorAll(".projects-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".projects-tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        projectsFilter = tab.getAttribute("data-filter");
        renderProjectsList();
      });
    });
  }

  function addProject() {
    if (isGuest()) { openAuthGate("settings"); return; }
    var userId = state.session.user.id;
    supabaseClient.from("projects").insert({ user_id: userId, name: "New Project", subtitle: "", content: [] })
      .select().single().then(function (res) {
        if (res.error) { console.error("Axis: add project failed", res.error); return; }
        state.projects.push(res.data);
        renderProjectsList(); renderProjectsPreview();
        openProjectDetail(res.data.id);
      });
  }

  function findProject(id) {
    return state.projects.filter(function (p) { return p.id === id; })[0];
  }

  function togglePinProject(id) {
    var project = findProject(id);
    if (!project) return;
    project.pinned = !project.pinned;
    renderProjectsList(); renderProjectsPreview();
    if (offlineReady) AxisOffline.put("projects", project);
    if (isGuest()) return;
    supabaseClient.from("projects").update({ pinned: project.pinned }).eq("id", id).then(function (res) {
      if (res.error) console.error("Axis: pin project failed", res.error);
    });
  }

  function setProjectArchived(id, archived) {
    var project = findProject(id);
    if (!project) return;
    project.archived = archived;
    if (archived) project.pinned = false;
    renderProjectsList(); renderProjectsPreview();
    if (offlineReady) AxisOffline.put("projects", project);
    if (isGuest()) return;
    supabaseClient.from("projects").update({ archived: archived, pinned: project.pinned }).eq("id", id).then(function (res) {
      if (res.error) console.error("Axis: archive project failed", res.error);
    });
  }

  function duplicateProjectFull(id) {
    var project = findProject(id);
    if (!project) return;
    if (isGuest()) { openAuthGate("settings"); return; }
    var userId = state.session.user.id;
    var copy = {
      user_id: userId,
      name: (project.name || "Untitled project") + " (copy)",
      subtitle: project.subtitle || "",
      content: JSON.parse(JSON.stringify(project.content || [])).map(function (b) {
        b.id = uid();
        b.starred = false;
        delete b.reusableId;
        if (b.items) b.items.forEach(function (it) { it.id = uid(); });
        return b;
      }),
      cover_url: project.cover_url || null,
      icon: project.icon || "folder"
    };
    supabaseClient.from("projects").insert(copy).select().single().then(function (res) {
      if (res.error) { console.error("Axis: duplicate project failed", res.error); return; }
      state.projects.push(res.data);
      renderProjectsList(); renderProjectsPreview();
      openProjectDetail(res.data.id);
    });
  }

  function deleteProjectPermanently(id) {
    if (!confirm("Delete this project permanently? This can't be undone.")) return;
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    renderProjectsList(); renderProjectsPreview();
    if (currentProjectId === id) closeProjectDetail();
    if (offlineReady) AxisOffline.del("projects", id);
    if (isGuest()) return;
    supabaseClient.from("projects").delete().eq("id", id).then(function (res) {
      if (res.error) console.error("Axis: remove project failed", res.error);
    });
  }

  // ── Shared card ⋯ menu (Projects list) ──────────────────────────────────────
  var pendingCardMenuProjectId = null;

  function openProjectCardMenu(anchorBtn, projectId) {
    var menu = document.getElementById("project-card-menu");
    var project = findProject(projectId);
    if (!project) return;
    pendingCardMenuProjectId = projectId;

    document.getElementById("card-menu-pin-label").textContent = project.pinned ? "Unpin" : "Pin";
    document.getElementById("card-menu-archive-label").textContent = project.archived ? "Restore" : "Archive";

    var rect = anchorBtn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.left = Math.max(8, rect.right - 170) + "px";
    menu.classList.remove("hidden");
  }

  function closeProjectCardMenu() {
    document.getElementById("project-card-menu").classList.add("hidden");
    pendingCardMenuProjectId = null;
  }

  function initProjectCardMenu() {
    document.getElementById("card-menu-pin").addEventListener("click", function () {
      if (pendingCardMenuProjectId) togglePinProject(pendingCardMenuProjectId);
      closeProjectCardMenu();
    });
    document.getElementById("card-menu-duplicate").addEventListener("click", function () {
      if (pendingCardMenuProjectId) duplicateProjectFull(pendingCardMenuProjectId);
      closeProjectCardMenu();
    });
    document.getElementById("card-menu-archive").addEventListener("click", function () {
      if (pendingCardMenuProjectId) {
        var project = findProject(pendingCardMenuProjectId);
        if (project) setProjectArchived(pendingCardMenuProjectId, !project.archived);
      }
      closeProjectCardMenu();
    });
    document.getElementById("card-menu-delete").addEventListener("click", function () {
      if (pendingCardMenuProjectId) deleteProjectPermanently(pendingCardMenuProjectId);
      closeProjectCardMenu();
    });
    document.addEventListener("click", function (e) {
      var menu = document.getElementById("project-card-menu");
      if (!menu.classList.contains("hidden") && !menu.contains(e.target) && !e.target.closest(".project-card-menu-btn")) {
        closeProjectCardMenu();
      }
    });
  }

  // ── Detail-view ⋯ menu (same actions, acts on the currently open project) ──
  function updateProjectDetailMenuLabels() {
    var project = currentProject();
    if (!project) return;
    var pinLabel = document.getElementById("project-menu-pin-label");
    var archiveLabel = document.getElementById("project-menu-archive-label");
    if (pinLabel) pinLabel.textContent = project.pinned ? "Unpin" : "Pin";
    if (archiveLabel) archiveLabel.textContent = project.archived ? "Restore" : "Archive";
  }

  function initProjectDetailMenu() {
    var menuBtn = document.getElementById("project-menu-btn");
    var menu = document.getElementById("project-menu");
    if (!menuBtn || !menu) return;

    menuBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      updateProjectDetailMenuLabels();
      menu.classList.toggle("hidden");
    });
    document.addEventListener("click", function (e) {
      if (!menu.classList.contains("hidden") && !menu.contains(e.target) && e.target !== menuBtn) {
        menu.classList.add("hidden");
      }
    });
    document.getElementById("project-menu-pin").addEventListener("click", function () {
      if (currentProjectId) togglePinProject(currentProjectId);
      menu.classList.add("hidden");
    });
    document.getElementById("project-menu-duplicate").addEventListener("click", function () {
      if (currentProjectId) duplicateProjectFull(currentProjectId);
      menu.classList.add("hidden");
    });
    document.getElementById("project-menu-archive").addEventListener("click", function () {
      if (currentProjectId) {
        var project = currentProject();
        if (project) setProjectArchived(currentProjectId, !project.archived);
      }
      menu.classList.add("hidden");
    });
    document.getElementById("project-menu-delete").addEventListener("click", function () {
      if (currentProjectId) deleteProjectPermanently(currentProjectId);
      menu.classList.add("hidden");
    });
  }

  var saveProjectTimer = null;
  var undoStack = [];
  var redoStack = [];
  var MAX_HISTORY = 50;

  function snapshotContent() {
    var project = currentProject();
    return project ? JSON.parse(JSON.stringify(project.content || [])) : [];
  }

  function pushUndoSnapshot() {
    undoStack.push(snapshotContent());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    var undoBtn = document.getElementById("undo-btn");
    var redoBtn = document.getElementById("redo-btn");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function undoBlockChange() {
    var project = currentProject();
    if (!project || undoStack.length === 0) return;
    redoStack.push(snapshotContent());
    project.content = undoStack.pop();
    saveCurrentProject();
    renderProjectBlocks();
    updateUndoRedoButtons();
  }

  function redoBlockChange() {
    var project = currentProject();
    if (!project || redoStack.length === 0) return;
    undoStack.push(snapshotContent());
    project.content = redoStack.pop();
    saveCurrentProject();
    renderProjectBlocks();
    updateUndoRedoButtons();
  }

  function resetBlockHistory() {
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
  }

  function setSaveIndicator(status) {
    var el = document.getElementById("save-indicator");
    if (!el) return;
    el.className = "save-indicator " + status;
    if (status === "saving") el.textContent = "Saving…";
    else if (status === "saved") el.textContent = "Saved";
    else el.textContent = "";
    if (status === "saved") {
      setTimeout(function () {
        if (el.className.indexOf("saved") !== -1) el.textContent = "";
      }, 2000);
    }
  }

  // Attach the "snapshot once per typing session" pattern to a text input,
  // so undo reverts a whole edit session rather than one keystroke.
  function wireUndoableInput(inputEl, onChange) {
    var snapshotTaken = false;
    inputEl.addEventListener("focus", function () { snapshotTaken = false; });
    inputEl.addEventListener("input", function () {
      if (!snapshotTaken) { pushUndoSnapshot(); snapshotTaken = true; }
      onChange();
      setSaveIndicator("saving");
      saveCurrentProject();
    });
  }

  function saveCurrentProject() {
    var project = currentProject();
    if (!project) return;
    project.last_opened_at = new Date().toISOString();
    // Write to IndexedDB immediately (offline-first)
    if (offlineReady) AxisOffline.put("projects", project);
    setSaveIndicator("saving");
    clearTimeout(saveProjectTimer);
    saveProjectTimer = setTimeout(function () {
      if (isGuest()) { setSaveIndicator("saved"); return; }
      if (!navigator.onLine) {
        enqueueIfOffline("projects", "upsert", { id: project.id, name: project.name, subtitle: project.subtitle, content: project.content, cover_url: project.cover_url, icon: project.icon, last_opened_at: project.last_opened_at, user_id: state.session && state.session.user.id });
        setSaveIndicator("saved");
        return;
      }
      supabaseClient.from("projects").update({ name: project.name, subtitle: project.subtitle, content: project.content, cover_url: project.cover_url, icon: project.icon, last_opened_at: project.last_opened_at })
        .eq("id", project.id).then(function (res) {
          if (res.error) {
            enqueueIfOffline("projects", "upsert", { id: project.id, name: project.name, subtitle: project.subtitle, content: project.content, cover_url: project.cover_url, icon: project.icon, last_opened_at: project.last_opened_at, user_id: state.session && state.session.user.id });
          }
          setSaveIndicator("saved");
        });
    }, 500);
  }

  function openProjectDetail(id) {
    currentProjectId = id;
    document.getElementById("projects-list-view").classList.add("hidden");
    document.getElementById("project-detail-view").classList.remove("hidden");
    var project = currentProject();
    if (!project) return;
    document.getElementById("project-name-input").value = project.name || "";
    document.getElementById("project-subtitle-input").value = project.subtitle || "";
    resetBlockHistory();
    setSaveIndicator("idle");
    renderProjectBlocks();
    renderProjectOfflineToggle();
    renderProjectCover();

    project.last_opened_at = new Date().toISOString();
    if (offlineReady) AxisOffline.put("projects", project);
    if (!isGuest() && navigator.onLine) {
      supabaseClient.from("projects").update({ last_opened_at: project.last_opened_at }).eq("id", project.id)
        .then(function (res) { if (res.error) console.error("Axis: last_opened_at update failed", res.error); });
    }
  }

  function closeProjectDetail() {
    currentProjectId = null;
    document.getElementById("project-detail-view").classList.add("hidden");
    document.getElementById("projects-list-view").classList.remove("hidden");
    renderProjectsList(); renderProjectsPreview();
  }

  var LIST_TYPES = ["bulleted-list", "numbered-list", "task"];

  function defaultBlockContent(type) {
    switch (type) {
      case "title": return { text: "" };
      case "heading": return { text: "" };
      case "text": return { text: "" };
      case "bulleted-list": return { items: [{ id: uid(), text: "" }] };
      case "numbered-list": return { items: [{ id: uid(), text: "" }] };
      case "task": return { items: [{ id: uid(), text: "", checked: false }] };
      case "divider": return {};
      case "image": return { url: "", caption: "" };
      case "file": return { url: "", filename: "" };
      case "link": return { url: "", label: "" };
      case "table": return { rows: [["", ""], ["", ""]] };
      default: return { text: "" };
    }
  }

  function addBlock(type) {
    var project = currentProject();
    if (!project) return;
    pushUndoSnapshot();
    var block = Object.assign({ id: uid(), type: type, starred: false }, defaultBlockContent(type));
    if (!project.content) project.content = [];
    project.content.push(block);
    saveCurrentProject();
    renderProjectBlocks();
  }

  function addBlockAt(type, index) {
    var project = currentProject();
    if (!project) return;
    pushUndoSnapshot();
    var block = Object.assign({ id: uid(), type: type, starred: false }, defaultBlockContent(type));
    if (!project.content) project.content = [];
    project.content.splice(index, 0, block);
    saveCurrentProject();
    renderProjectBlocks();
  }

  function removeBlock(blockId) {
    var project = currentProject();
    if (!project) return;
    pushUndoSnapshot();
    project.content = project.content.filter(function (b) { return b.id !== blockId; });
    saveCurrentProject();
    renderProjectBlocks();
  }

  function duplicateBlock(blockId) {
    var project = currentProject();
    if (!project) return;
    var idx = project.content.findIndex(function (b) { return b.id === blockId; });
    if (idx === -1) return;
    pushUndoSnapshot();
    var clone = JSON.parse(JSON.stringify(project.content[idx]));
    clone.id = uid();
    clone.starred = false;
    delete clone.reusableId;
    if (clone.items) clone.items.forEach(function (it) { it.id = uid(); });
    project.content.splice(idx + 1, 0, clone);
    saveCurrentProject();
    renderProjectBlocks();
  }

  function reorderBlock(draggedId, targetId, before) {
    var project = currentProject();
    if (!project) return;
    var content = project.content;
    var fromIdx = content.findIndex(function (b) { return b.id === draggedId; });
    if (fromIdx === -1) return;
    pushUndoSnapshot();
    var item = content.splice(fromIdx, 1)[0];
    var toIdx = content.findIndex(function (b) { return b.id === targetId; });
    if (toIdx === -1) toIdx = content.length;
    else if (!before) toIdx++;
    content.splice(toIdx, 0, item);
    saveCurrentProject();
    renderProjectBlocks();
  }

  function blockStarLabel(block) {
    if (LIST_TYPES.indexOf(block.type) !== -1) return block.type.replace("-", " ");
    if (block.type === "table") return "Table";
    if (block.type === "image") return "Image";
    if (block.type === "file") return block.filename || "File";
    if (block.type === "link") return block.label || block.url || "Link";
    if (block.type === "divider") return "Divider";
    return (block.text || "Untitled").slice(0, 40);
  }

  function blockStarPayload(block) {
    if (LIST_TYPES.indexOf(block.type) !== -1) return { items: block.items };
    if (block.type === "table") return { rows: block.rows };
    if (block.type === "image") return { url: block.url, caption: block.caption };
    if (block.type === "file") return { url: block.url, filename: block.filename };
    if (block.type === "link") return { url: block.url, label: block.label };
    if (block.type === "divider") return {};
    return { text: block.text };
  }

  function toggleBlockStar(blockId) {
    var project = currentProject();
    var block = project.content.filter(function (b) { return b.id === blockId; })[0];
    if (!block) return;

    if (!block.starred) {
      supabaseClient.from("reusable_blocks").insert({
        user_id: state.session.user.id, type: block.type, content: blockStarPayload(block), label: blockStarLabel(block)
      }).select().single().then(function (res) {
        if (res.error) { console.error("Axis: star block failed", res.error); return; }
        state.reusableBlocks.unshift(res.data);
        block.starred = true;
        block.reusableId = res.data.id;
        saveCurrentProject();
        renderProjectBlocks();
      });
    } else {
      var reusableId = block.reusableId;
      block.starred = false;
      saveCurrentProject();
      renderProjectBlocks();
      if (reusableId) {
        state.reusableBlocks = state.reusableBlocks.filter(function (b) { return b.id !== reusableId; });
        supabaseClient.from("reusable_blocks").delete().eq("id", reusableId).then(function (res) {
          if (res.error) console.error("Axis: unstar block failed", res.error);
        });
      }
    }
  }

  function buildBlockControls(block) {
    var controls = document.createElement("div");
    controls.className = "block-controls";
    controls.innerHTML =
      '<button type="button" class="block-control-btn block-drag-handle" title="Drag to reorder">⠿</button>' +
      '<button type="button" class="block-control-btn star-btn' + (block.starred ? " star-active" : "") + '" title="Save as reusable">★</button>' +
      '<button type="button" class="block-control-btn duplicate-btn" title="Duplicate">⧉</button>' +
      '<button type="button" class="block-control-btn remove-btn" title="Delete">&times;</button>';
    controls.querySelector(".star-btn").addEventListener("click", function () { toggleBlockStar(block.id); });
    controls.querySelector(".duplicate-btn").addEventListener("click", function () { duplicateBlock(block.id); });
    controls.querySelector(".remove-btn").addEventListener("click", function () { removeBlock(block.id); });
    return controls;
  }

  function buildListBlock(block, markerFn) {
    var wrap = document.createElement("div");
    (block.items || []).forEach(function (item, idx) {
      var row = document.createElement("div");
      row.className = "list-item-row";

      if (block.type === "task") {
        var check = document.createElement("button");
        check.type = "button";
        check.className = "checklist-item-check" + (item.checked ? " checked" : "");
        check.addEventListener("click", function () {
          pushUndoSnapshot();
          item.checked = !item.checked;
          saveCurrentProject();
          renderProjectBlocks();
        });
        row.appendChild(check);
      } else {
        var marker = document.createElement("span");
        marker.className = "list-item-marker";
        marker.textContent = markerFn(idx);
        row.appendChild(marker);
      }

      var textInput = document.createElement("input");
      textInput.type = "text";
      textInput.className = "list-item-text" + (block.type === "task" && item.checked ? " task-done" : "");
      textInput.placeholder = block.type === "task" ? "Task…" : "List item…";
      textInput.value = item.text || "";
      wireUndoableInput(textInput, function () { item.text = textInput.value; });
      row.appendChild(textInput);

      var removeItemBtn = document.createElement("button");
      removeItemBtn.type = "button";
      removeItemBtn.className = "list-item-remove";
      removeItemBtn.innerHTML = "&times;";
      removeItemBtn.addEventListener("click", function () {
        pushUndoSnapshot();
        block.items = block.items.filter(function (it) { return it.id !== item.id; });
        saveCurrentProject();
        renderProjectBlocks();
      });
      row.appendChild(removeItemBtn);

      wrap.appendChild(row);
    });

    var addItemBtn = document.createElement("button");
    addItemBtn.type = "button";
    addItemBtn.className = "list-add-item-btn";
    addItemBtn.textContent = "+ Add item";
    addItemBtn.addEventListener("click", function () {
      pushUndoSnapshot();
      if (!block.items) block.items = [];
      var newItem = { id: uid(), text: "" };
      if (block.type === "task") newItem.checked = false;
      block.items.push(newItem);
      saveCurrentProject();
      renderProjectBlocks();
    });
    wrap.appendChild(addItemBtn);
    return wrap;
  }

  function buildImageBlock(block) {
    var wrap = document.createElement("div");
    if (block.url) {
      var img = document.createElement("img");
      img.className = "block-image-preview";
      img.src = block.url;
      wrap.appendChild(img);
      var caption = document.createElement("input");
      caption.type = "text";
      caption.className = "block-image-caption";
      caption.placeholder = "Add a caption…";
      caption.value = block.caption || "";
      caption.addEventListener("input", function () { block.caption = caption.value; saveCurrentProject(); });
      wrap.appendChild(caption);
    } else {
      var empty = document.createElement("div");
      empty.className = "block-image-empty";
      empty.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg><span>Click to upload an image</span>';
      empty.addEventListener("click", function () { triggerBlockUpload(block, "image"); });
      wrap.appendChild(empty);
    }
    return wrap;
  }

  function buildFileBlock(block) {
    var wrap = document.createElement("div");
    if (block.url) {
      var row = document.createElement("a");
      row.className = "block-file-row";
      row.href = block.url;
      row.target = "_blank";
      row.rel = "noopener";
      row.innerHTML =
        '<span class="block-file-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></span>' +
        '<span class="block-file-name">' + (block.filename || "File") + '</span>';
      wrap.appendChild(row);
    } else {
      var empty = document.createElement("div");
      empty.className = "block-file-empty";
      empty.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg><span>Click to attach a file</span>';
      empty.addEventListener("click", function () { triggerBlockUpload(block, "file"); });
      wrap.appendChild(empty);
    }
    return wrap;
  }

  function buildLinkBlock(block) {
    var wrap = document.createElement("div");
    wrap.className = "block-link-row";
    wrap.innerHTML = '<span class="block-link-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>';
    var inputs = document.createElement("div");
    inputs.className = "block-link-inputs";

    var labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "block-link-label-input";
    labelInput.placeholder = "Link title";
    labelInput.value = block.label || "";
    wireUndoableInput(labelInput, function () { block.label = labelInput.value; });

    var urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "block-link-url-input";
    urlInput.placeholder = "https://…";
    urlInput.value = block.url || "";
    wireUndoableInput(urlInput, function () { block.url = urlInput.value; });

    inputs.appendChild(labelInput);
    inputs.appendChild(urlInput);
    wrap.appendChild(inputs);
    return wrap;
  }

  function buildTableBlock(block) {
    var wrap = document.createElement("div");
    wrap.className = "block-table-wrap";
    if (!block.rows || block.rows.length === 0) block.rows = [["", ""], ["", ""]];

    var table = document.createElement("table");
    table.className = "block-table";
    block.rows.forEach(function (row, rIdx) {
      var tr = document.createElement("tr");
      row.forEach(function (cell, cIdx) {
        var td = document.createElement("td");
        var input = document.createElement("input");
        input.type = "text";
        input.className = "block-table-cell";
        input.value = cell || "";
        wireUndoableInput(input, function () { block.rows[rIdx][cIdx] = input.value; });
        td.appendChild(input);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);

    var controls = document.createElement("div");
    controls.className = "block-table-controls";
    var addRowBtn = document.createElement("button");
    addRowBtn.type = "button";
    addRowBtn.className = "block-table-add-btn";
    addRowBtn.textContent = "+ Row";
    addRowBtn.addEventListener("click", function () {
      pushUndoSnapshot();
      var cols = block.rows[0] ? block.rows[0].length : 2;
      var newRow = [];
      for (var i = 0; i < cols; i++) newRow.push("");
      block.rows.push(newRow);
      saveCurrentProject();
      renderProjectBlocks();
    });
    var addColBtn = document.createElement("button");
    addColBtn.type = "button";
    addColBtn.className = "block-table-add-btn";
    addColBtn.textContent = "+ Column";
    addColBtn.addEventListener("click", function () {
      pushUndoSnapshot();
      block.rows.forEach(function (row) { row.push(""); });
      saveCurrentProject();
      renderProjectBlocks();
    });
    controls.appendChild(addRowBtn);
    controls.appendChild(addColBtn);
    wrap.appendChild(controls);
    return wrap;
  }

  function triggerBlockUpload(block, kind) {
    if (isGuest()) { openAuthGate("settings"); return; }
    var input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "image" ? "image/*" : "*/*";
    input.addEventListener("change", function () {
      var file = input.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { alert("Please choose a file under 8MB."); return; }
      var userId = state.session.user.id;
      var bucket = kind === "image" ? "covers" : "project-files";
      var path = userId + "/" + Date.now() + "-" + file.name.replace(/[^a-z0-9.]/gi, "_");
      supabaseClient.storage.from(bucket).upload(path, file, { upsert: true }).then(function (res) {
        if (res.error) { alert("Upload failed: " + res.error.message); return; }
        var publicUrl = supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
        block.url = publicUrl;
        if (kind === "file") block.filename = file.name;
        saveCurrentProject();
        renderProjectBlocks();
      });
    });
    input.click();
  }

  function buildInsertRow(index) {
    var row = document.createElement("div");
    row.className = "block-insert-row editor-only";
    row.innerHTML =
      '<span class="block-insert-line"></span>' +
      '<button type="button" class="block-insert-btn" title="Insert block">+</button>' +
      '<span class="block-insert-line"></span>';
    row.querySelector(".block-insert-btn").addEventListener("click", function (e) {
      openInsertMenu(e.currentTarget, index);
    });
    return row;
  }

  function renderProjectBlocks() {
    var project = currentProject();
    var wrap = document.getElementById("project-blocks");
    var emptyState = document.getElementById("project-empty-state");
    var toolbar = document.getElementById("block-toolbar");
    if (!project || !wrap) return;

    var hasBlocks = (project.content || []).length > 0;
    if (emptyState) emptyState.classList.toggle("hidden", hasBlocks);
    if (toolbar) toolbar.classList.toggle("hidden", !hasBlocks);
    wrap.classList.toggle("hidden", !hasBlocks);
    if (!hasBlocks) return;

    wrap.innerHTML = "";
    wrap.appendChild(buildInsertRow(0));

    (project.content || []).forEach(function (block, index) {
      var el = document.createElement("div");
      el.className = "content-block";
      el.setAttribute("data-block-id", block.id);
      el.appendChild(buildBlockControls(block));

      if (block.type === "title") {
        var titleInput = document.createElement("input");
        titleInput.type = "text";
        titleInput.className = "block-title-input";
        titleInput.placeholder = "Title";
        titleInput.value = block.text || "";
        wireUndoableInput(titleInput, function () { block.text = titleInput.value; });
        el.appendChild(titleInput);
      } else if (block.type === "heading") {
        var hInput = document.createElement("input");
        hInput.type = "text";
        hInput.className = "block-heading-input";
        hInput.placeholder = "Heading";
        hInput.value = block.text || "";
        wireUndoableInput(hInput, function () { block.text = hInput.value; });
        el.appendChild(hInput);
      } else if (block.type === "text") {
        var tInput = document.createElement("textarea");
        tInput.className = "block-text-input";
        tInput.placeholder = "Write something…";
        tInput.value = block.text || "";
        wireUndoableInput(tInput, function () { block.text = tInput.value; });
        el.appendChild(tInput);
      } else if (block.type === "bulleted-list") {
        el.appendChild(buildListBlock(block, function () { return "•"; }));
      } else if (block.type === "numbered-list") {
        el.appendChild(buildListBlock(block, function (idx) { return (idx + 1) + "."; }));
      } else if (block.type === "task") {
        el.appendChild(buildListBlock(block, null));
      } else if (block.type === "divider") {
        var hr = document.createElement("hr");
        hr.className = "block-divider-line";
        el.appendChild(hr);
      } else if (block.type === "image") {
        el.appendChild(buildImageBlock(block));
      } else if (block.type === "file") {
        el.appendChild(buildFileBlock(block));
      } else if (block.type === "link") {
        el.appendChild(buildLinkBlock(block));
      } else if (block.type === "table") {
        el.appendChild(buildTableBlock(block));
      }

      wrap.appendChild(el);
      wrap.appendChild(buildInsertRow(index + 1));
    });

    applyViewEditMode();
  }

  function renderBlockLibrary() {
    var wrap = document.getElementById("block-library-list");
    if (state.reusableBlocks.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No saved blocks yet — tap the star on any block to save it here.</p>';
      return;
    }
    wrap.innerHTML = "";
    state.reusableBlocks.forEach(function (rb) {
      var row = document.createElement("div");
      row.className = "block-library-item";
      row.innerHTML =
        '<span><span class="block-library-item-label">' + rb.label + '</span><br><span class="block-library-item-type">' + rb.type + '</span></span>' +
        '<span class="calc-btn" style="margin:0;padding:0.35rem 0.8rem;font-size:0.75rem;">Insert</span>';
      row.addEventListener("click", function () { insertLibraryBlock(rb); });
      wrap.appendChild(row);
    });
  }

  function insertLibraryBlock(rb) {
    var project = currentProject();
    if (!project) return;
    var block = Object.assign({ id: uid(), type: rb.type, starred: false }, defaultBlockContent(rb.type));
    if (LIST_TYPES.indexOf(rb.type) !== -1) {
      block.items = (rb.content.items || []).map(function (it) {
        var copy = { id: uid(), text: it.text };
        if (rb.type === "task") copy.checked = false;
        return copy;
      });
    } else if (rb.type === "table") {
      block.rows = (rb.content.rows || []).map(function (row) { return row.slice(); });
    } else if (rb.type === "image") {
      block.url = rb.content.url; block.caption = rb.content.caption;
    } else if (rb.type === "file") {
      block.url = rb.content.url; block.filename = rb.content.filename;
    } else if (rb.type === "link") {
      block.url = rb.content.url; block.label = rb.content.label;
    } else if (rb.type !== "divider") {
      block.text = rb.content.text || "";
    }
    if (!project.content) project.content = [];
    project.content.push(block);
    saveCurrentProject();
    renderProjectBlocks();
    document.getElementById("block-library-modal").classList.add("hidden");
  }

  // ==================== INSERT-BETWEEN-BLOCKS MENU ====================

  var pendingInsertIndex = null;

  function openInsertMenu(anchorBtn, index) {
    var menu = document.getElementById("insert-block-menu");
    var rect = anchorBtn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.left = Math.max(8, rect.left - 90) + "px";
    pendingInsertIndex = index;
    menu.classList.remove("hidden");
    anchorBtn.closest(".block-insert-row").classList.add("menu-open");
  }

  function closeInsertMenu() {
    var menu = document.getElementById("insert-block-menu");
    menu.classList.add("hidden");
    document.querySelectorAll(".block-insert-row.menu-open").forEach(function (r) { r.classList.remove("menu-open"); });
    pendingInsertIndex = null;
  }

  function initInsertMenu() {
    document.querySelectorAll("#insert-block-menu .add-block-menu-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (pendingInsertIndex !== null) addBlockAt(btn.getAttribute("data-block-type"), pendingInsertIndex);
        closeInsertMenu();
      });
    });
    document.addEventListener("click", function (e) {
      var menu = document.getElementById("insert-block-menu");
      if (!menu.classList.contains("hidden") && !menu.contains(e.target) && !e.target.closest(".block-insert-btn")) {
        closeInsertMenu();
      }
    });
  }

  // ==================== VIEW / EDIT MODE ====================

  var projectEditMode = "edit";

  function applyViewEditMode() {
    document.body.classList.toggle("project-view-mode", projectEditMode === "view");
  }

  function initViewEditToggle() {
    document.querySelectorAll(".ve-toggle-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        projectEditMode = btn.getAttribute("data-mode");
        document.querySelectorAll(".ve-toggle-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        applyViewEditMode();
      });
    });
  }

  // ==================== UNDO / REDO WIRING ====================

  function initUndoRedo() {
    document.getElementById("undo-btn").addEventListener("click", undoBlockChange);
    document.getElementById("redo-btn").addEventListener("click", redoBlockChange);
    document.addEventListener("keydown", function (e) {
      var detailVisible = !document.getElementById("project-detail-view").classList.contains("hidden");
      if (!detailVisible) return;
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undoBlockChange(); }
      else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); redoBlockChange(); }
    });
  }

  // ==================== DRAG & DROP REORDERING (pointer-based, mouse + touch) ====================

  function initBlockDragAndDrop() {
    var wrap = document.getElementById("project-blocks");
    if (!wrap) return;

    wrap.addEventListener("pointerdown", function (e) {
      var handle = e.target.closest(".block-drag-handle");
      if (!handle) return;
      var blockEl = handle.closest(".content-block");
      if (!blockEl) return;
      var draggingId = blockEl.getAttribute("data-block-id");
      blockEl.classList.add("dragging");
      e.preventDefault();

      function clearIndicators() {
        wrap.querySelectorAll(".content-block").forEach(function (b) {
          b.classList.remove("drag-over-top", "drag-over-bottom");
        });
      }

      function onMove(ev) {
        var point = ev.touches ? ev.touches[0] : ev;
        var target = document.elementFromPoint(point.clientX, point.clientY);
        var overBlock = target && target.closest(".content-block");
        clearIndicators();
        if (overBlock && overBlock !== blockEl) {
          var rect = overBlock.getBoundingClientRect();
          var midpoint = rect.top + rect.height / 2;
          overBlock.classList.add(point.clientY < midpoint ? "drag-over-top" : "drag-over-bottom");
        }
      }

      function onUp(ev) {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        blockEl.classList.remove("dragging");
        var point = ev.changedTouches ? ev.changedTouches[0] : ev;
        var target = document.elementFromPoint(point.clientX, point.clientY);
        var overBlock = target && target.closest(".content-block");
        clearIndicators();
        if (overBlock && overBlock !== blockEl) {
          var targetId = overBlock.getAttribute("data-block-id");
          var rect = overBlock.getBoundingClientRect();
          var before = point.clientY < rect.top + rect.height / 2;
          reorderBlock(draggingId, targetId, before);
        }
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  // ==================== FOCUS TIMER ====================

  var timerSeconds = 25 * 60;
  var timerInterval = null;
  var timerRunning = false;

  function formatTimer(s) {
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function initFocusTimer() {
    var display = document.getElementById("dash-timer-display");
    var btn = document.getElementById("dash-timer-btn");
    if (!display || !btn) return;

    display.textContent = formatTimer(timerSeconds);

    btn.addEventListener("click", function () {
      if (timerRunning) {
        clearInterval(timerInterval);
        timerRunning = false;
        btn.textContent = "Start";
      } else {
        if (timerSeconds === 0) timerSeconds = 25 * 60;
        timerRunning = true;
        btn.textContent = "Pause";
        timerInterval = setInterval(function () {
          timerSeconds--;
          display.textContent = formatTimer(timerSeconds);
          if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            timerRunning = false;
            btn.textContent = "Start";
            adjustCoins(10);
            showJourneyToast("Focus session complete!", "+10 coins");
          }
        }, 1000);
      }
    });
  }

  // ==================== DAILY REFLECTION ====================

  function initDailyReflection() {
    var btn = document.getElementById("dash-reflection-save-btn");
    var input = document.getElementById("dash-reflection-input");
    if (!btn || !input) return;

    var saved = localStorage.getItem("axis-reflection-" + new Date().toISOString().slice(0, 10));
    if (saved) input.value = saved;

    btn.addEventListener("click", function () {
      var text = input.value.trim();
      if (!text) return;
      localStorage.setItem("axis-reflection-" + new Date().toISOString().slice(0, 10), text);
      btn.style.color = "var(--accent)";
      setTimeout(function () { btn.style.color = ""; }, 1500);
    });
  }

  // ==================== TODAY'S PLAN TABS ====================

  function initDashPlanTabs() {
    document.querySelectorAll(".dash-plan-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".dash-plan-tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        renderTodayPlan();
      });
    });
  }

  // ==================== PROJECT COVER + ICON ====================

  var ICON_OPTIONS = [
    { key: "folder", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>' },
    { key: "book", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' },
    { key: "heart", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>' },
    { key: "chart", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>' },
    { key: "flag", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>' },
    { key: "star", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7L2 9.2l7.1-.6z"/></svg>' },
    { key: "briefcase", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>' },
    { key: "target", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>' },
    { key: "bulb", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>' },
    { key: "rocket", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>' },
    { key: "palette", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 1 0 0 20c1 0 2-1 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1 1-2 2-2h2.3c1.5 0 2.7-1.2 2.7-2.7C20 6.5 16.4 2 12 2z"/></svg>' },
    { key: "code", svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' }
  ];

  var UNSPLASH_COVERS = [
    "https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?q=80&w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?q=80&w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?q=80&w=800&auto=format&fit=crop"
  ];

  function iconSvg(key) {
    var found = ICON_OPTIONS.filter(function (i) { return i.key === key; })[0];
    return found ? found.svg : ICON_OPTIONS[0].svg;
  }

  function renderProjectCover() {
    var project = currentProject();
    if (!project) return;
    var bar = document.getElementById("project-cover-bar");
    var editBtn = document.getElementById("project-cover-edit-btn");
    var iconBadge = document.getElementById("project-icon-badge");

    if (project.cover_url) {
      bar.style.backgroundImage = "url(" + project.cover_url + ")";
      bar.classList.add("has-cover");
      editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg> Change cover';
    } else {
      bar.style.backgroundImage = "none";
      bar.classList.remove("has-cover");
      editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg> Add cover';
    }

    iconBadge.innerHTML = iconSvg(project.icon);
  }

  function initProjectCoverAndIcon() {
    var editBtn = document.getElementById("project-cover-edit-btn");
    var coverModal = document.getElementById("cover-picker-modal");
    var fileTrigger = document.getElementById("cover-upload-trigger");
    var fileInput = document.getElementById("cover-file-input");
    var iconBadge = document.getElementById("project-icon-badge");
    var iconModal = document.getElementById("icon-picker-modal");

    if (editBtn) editBtn.addEventListener("click", function () {
      coverModal.classList.remove("hidden");
    });
    document.getElementById("close-cover-picker-btn").addEventListener("click", function () {
      coverModal.classList.add("hidden");
    });

    // Unsplash preset grid
    var unsplashGrid = document.getElementById("unsplash-cover-grid");
    UNSPLASH_COVERS.forEach(function (url) {
      var thumb = document.createElement("div");
      thumb.className = "unsplash-cover-thumb";
      thumb.style.backgroundImage = "url(" + url + ")";
      thumb.addEventListener("click", function () {
        var project = currentProject();
        if (!project) return;
        project.cover_url = url;
        saveCurrentProject();
        renderProjectCover();
        coverModal.classList.add("hidden");
      });
      unsplashGrid.appendChild(thumb);
    });

    // Local upload
    if (fileTrigger) fileTrigger.addEventListener("click", function () { fileInput.click(); });
    if (fileInput) fileInput.addEventListener("change", function () {
      var file = fileInput.files[0];
      var project = currentProject();
      if (!file || !project) return;
      if (file.size > 4 * 1024 * 1024) { alert("Please choose an image under 4MB."); return; }

      if (isGuest()) {
        // Guests: just preview locally via object URL (not persisted to cloud)
        project.cover_url = URL.createObjectURL(file);
        renderProjectCover();
        coverModal.classList.add("hidden");
        return;
      }

      var userId = state.session.user.id;
      var path = userId + "/" + project.id + "-" + Date.now() + "-" + file.name.replace(/[^a-z0-9.]/gi, "_");
      supabaseClient.storage.from("covers").upload(path, file, { upsert: true }).then(function (res) {
        if (res.error) { alert("Upload failed: " + res.error.message); return; }
        var publicUrl = supabaseClient.storage.from("covers").getPublicUrl(path).data.publicUrl;
        project.cover_url = publicUrl;
        saveCurrentProject();
        renderProjectCover();
        coverModal.classList.add("hidden");
      });
    });

    // Icon picker
    var iconGrid = document.getElementById("icon-picker-grid");
    ICON_OPTIONS.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-picker-option";
      btn.innerHTML = opt.svg;
      btn.addEventListener("click", function () {
        var project = currentProject();
        if (!project) return;
        project.icon = opt.key;
        saveCurrentProject();
        renderProjectCover();
        renderProjectsList();
        renderProjectsPreview();
        iconModal.classList.add("hidden");
      });
      iconGrid.appendChild(btn);
    });

    if (iconBadge) iconBadge.addEventListener("click", function () { iconModal.classList.remove("hidden"); });
    document.getElementById("close-icon-picker-btn").addEventListener("click", function () {
      iconModal.classList.add("hidden");
    });
  }

  function initProjects() {
    document.getElementById("new-project-btn").addEventListener("click", addProject);
    initProjectsTabs();
    initProjectCardMenu();
    initProjectDetailMenu();

    var desktopAddBtn = document.getElementById("desktop-new-project-btn");
    if (desktopAddBtn) desktopAddBtn.addEventListener("click", function () {
      goToPage("projects");
      addProject();
    });

    var mobileAddBtn = document.getElementById("mobile-new-project-btn");
    if (mobileAddBtn) mobileAddBtn.addEventListener("click", function () {
      goToPage("projects");
      addProject();
    });

    document.getElementById("project-back-link").addEventListener("click", function (e) {
      e.preventDefault();
      closeProjectDetail();
    });
    document.getElementById("project-name-input").addEventListener("input", function () {
      var project = currentProject();
      if (!project) return;
      project.name = this.value;
      saveCurrentProject();
    });
    document.getElementById("project-subtitle-input").addEventListener("input", function () {
      var project = currentProject();
      if (!project) return;
      project.subtitle = this.value;
      saveCurrentProject();
    });
    var addBlockMenuBtn = document.getElementById("add-block-menu-btn");
    var addBlockMenu = document.getElementById("add-block-menu");
    if (addBlockMenuBtn && addBlockMenu) {
      addBlockMenuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        addBlockMenu.classList.toggle("hidden");
      });
      document.addEventListener("click", function (e) {
        if (!addBlockMenu.classList.contains("hidden") && !addBlockMenu.contains(e.target) && e.target !== addBlockMenuBtn) {
          addBlockMenu.classList.add("hidden");
        }
      });
      addBlockMenu.querySelectorAll(".add-block-menu-item[data-block-type]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          addBlock(btn.getAttribute("data-block-type"));
          addBlockMenu.classList.add("hidden");
        });
      });
    }

    var emptyAddBtn = document.getElementById("empty-add-block-btn");
    var emptyAddMenu = document.getElementById("empty-add-block-menu");
    if (emptyAddBtn && emptyAddMenu) {
      emptyAddBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        emptyAddMenu.classList.toggle("hidden");
      });
      document.addEventListener("click", function (e) {
        if (!emptyAddMenu.classList.contains("hidden") && !emptyAddMenu.contains(e.target) && e.target !== emptyAddBtn) {
          emptyAddMenu.classList.add("hidden");
        }
      });
      emptyAddMenu.querySelectorAll(".add-block-menu-item[data-block-type]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          addBlock(btn.getAttribute("data-block-type"));
          emptyAddMenu.classList.add("hidden");
        });
      });
    }

    document.getElementById("open-block-library-btn").addEventListener("click", function () {
      renderBlockLibrary();
      document.getElementById("block-library-modal").classList.remove("hidden");
    });
    document.getElementById("close-block-library-btn").addEventListener("click", function () {
      document.getElementById("block-library-modal").classList.add("hidden");
    });

    initInsertMenu();
    initViewEditToggle();
    initUndoRedo();
    initBlockDragAndDrop();
  }

  var dashRange = "daily";

  function initDashboardToggle() {
    document.querySelectorAll(".toggle-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".toggle-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        dashRange = btn.getAttribute("data-range");
        renderDashboardChart();
      });
    });
    document.getElementById("cal-prev").addEventListener("click", function () {
      calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
      renderCalendar();
    });
    document.getElementById("cal-next").addEventListener("click", function () {
      calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
      renderCalendar();
    });
  }

  function renderDashboardChart() {
    var series = dashRange === "weekly" ? completionSeries(28).filter(function (_, i) { return i % 4 === 0; }) : completionSeries(7);
    var chartEl = document.getElementById("dash-chart"); if (chartEl) renderComboChart(chartEl, series);
  }

  function renderDashboard() {
    renderTopbar();
    renderDashGreeting();
    renderDashQuote();
    renderYourFocus();
    renderTodayPlan();
    renderGoalsCards();
    renderProjectsPreview();
    renderCalendar();
    renderNotes();
  }

  // ==================== FINANCIAL ====================

  function saveFinancialState() {
    if (isGuest()) { saveGuestState(); return; }
    var userId = state.session.user.id;
    supabaseClient.from("financial_state")
      .upsert({ user_id: userId, income: state.financial.income, outcome: state.financial.outcome, updated_at: new Date().toISOString() })
      .then(function (res) { if (res.error) console.error("Axis: save financial state failed", res.error); });
  }

  function renderFinancialSummary() {
    var income = Number(state.financial.income) || 0;
    var outcome = Number(state.financial.outcome) || 0;
    var net = income - outcome;

    document.getElementById("fin-income-input").value = income || "";
    document.getElementById("fin-outcome-input").value = outcome || "";

    document.getElementById("fin-net-value").textContent = (net >= 0 ? "+" : "-") + fmtMoney(Math.abs(net));
    document.getElementById("fin-net-value").style.color = net >= 0 ? "var(--mental)" : "var(--physical)";
    document.getElementById("fin-net-note").textContent = income || outcome ? "Based on your entered income and outcome." : "Enter your numbers below and calculate.";

    var total = income > 0 ? income : 2000;
    var spent = outcome > 0 ? outcome : 0;
    var pct = total > 0 ? Math.min((spent / total) * 100, 100) : 0;
    var isOver = pct > 80;

    document.getElementById("fin-budget-label").textContent = fmtMoney(spent) + " / " + fmtMoney(total);
    var bar = document.getElementById("fin-budget-bar");
    bar.style.width = pct + "%";
    bar.classList.toggle("over", isOver);
    document.getElementById("fin-budget-pct").textContent = pct.toFixed(0) + "% of budget used" + (isOver ? " — approaching your limit" : "");
  }

  function initFinancialCalculator() {
    document.getElementById("fin-calculate-btn").addEventListener("click", function () {
      var income = parseFloat(document.getElementById("fin-income-input").value) || 0;
      var outcome = parseFloat(document.getElementById("fin-outcome-input").value) || 0;
      state.financial = { income: income, outcome: outcome };
      renderFinancialSummary();
      renderDashboard();
      saveFinancialState();
    });
  }

  function buildGoalListEl(goals, category) {
    var wrap = document.createElement("div");
    if (goals.length === 0) {
      var note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "No goals yet — add one below.";
      wrap.appendChild(note);
    }
    goals.forEach(function (g) {
      var tpl = document.getElementById("goal-row-template").content.cloneNode(true);
      var row = tpl.querySelector(".goal-row");
      row.querySelector(".goal-name").textContent = g.name;
      var currentInput = row.querySelector(".goal-current-input");
      var targetInput = row.querySelector(".goal-target-input");
      var bar = row.querySelector(".goal-bar");
      currentInput.value = g.current;
      targetInput.value = g.target;
      function updateBar() {
        var cur = parseFloat(currentInput.value) || 0;
        var tgt = parseFloat(targetInput.value) || 0;
        var pct = tgt > 0 ? Math.min((cur / tgt) * 100, 100) : 0;
        bar.style.width = pct + "%";
      }
      updateBar();
      function persist() {
        var cur = parseFloat(currentInput.value) || 0;
        var tgt = parseFloat(targetInput.value) || 0;
        g.current = cur; g.target = tgt;
        updateBar();
        renderGoalsCards(); renderGoalsPreview();
        if (isGuest()) { saveGuestState(); return; }
        supabaseClient.from("goals").update({ current: cur, target: tgt }).eq("id", g.id)
          .then(function (res) { if (res.error) console.error("Axis: goal update failed", res.error); });
      }
      currentInput.addEventListener("change", persist);
      targetInput.addEventListener("change", persist);
      row.querySelector(".goal-remove").addEventListener("click", function () {
        var list = category === "financial" ? "financialGoals" : "generalGoals";
        state[list] = state[list].filter(function (x) { return x.id !== g.id; });
        if (category === "financial") renderFinancialGoals(); else renderGeneralGoals();
        renderGoalsCards(); renderGoalsPreview();
        if (isGuest()) { saveGuestState(); return; }
        supabaseClient.from("goals").delete().eq("id", g.id).then(function (res) {
          if (res.error) console.error("Axis: goal remove failed", res.error);
        });
      });
      wrap.appendChild(row);
    });
    return wrap;
  }

  function addGoal(category, name, target) {
    if (!name.trim()) return;
    if (isGuest()) {
      var newGoal = { id: uid(), category: category, name: name.trim(), current: 0, target: parseFloat(target) || 0 };
      if (category === "financial") { state.financialGoals.push(newGoal); renderFinancialGoals(); }
      else { state.generalGoals.push(newGoal); renderGeneralGoals(); }
      renderGoalsCards(); renderGoalsPreview();
      saveGuestState();
      return;
    }
    var userId = state.session.user.id;
    supabaseClient.from("goals").insert({ user_id: userId, category: category, name: name.trim(), current: 0, target: parseFloat(target) || 0 })
      .select().single()
      .then(function (res) {
        if (res.error) { console.error("Axis: add goal failed", res.error); return; }
        if (category === "financial") { state.financialGoals.push(res.data); renderFinancialGoals(); }
        else { state.generalGoals.push(res.data); renderGeneralGoals(); }
        renderGoalsCards(); renderGoalsPreview();
      });
  }

  function buildGoalAddRow(category) {
    var row = document.createElement("div");
    row.className = "add-goal-row";
    row.innerHTML = '<input type="text" placeholder="Goal name" maxlength="60"><input type="number" min="0" step="0.01" placeholder="Target"><button type="button">Add</button>';
    var nameInput = row.querySelectorAll("input")[0];
    var targetInput = row.querySelectorAll("input")[1];
    var btn = row.querySelector("button");
    function submit() { addGoal(category, nameInput.value, targetInput.value); nameInput.value = ""; targetInput.value = ""; }
    btn.addEventListener("click", submit);
    return row;
  }

  function renderFinancialGoals() {
    var wrap = document.getElementById("financial-goals-list");
    wrap.innerHTML = "";
    wrap.appendChild(buildGoalListEl(state.financialGoals, "financial"));
    wrap.appendChild(buildGoalAddRow("financial"));
  }

  function renderGeneralGoals() {
    var wrap = document.getElementById("general-goals-list");
    wrap.innerHTML = "";
    wrap.appendChild(buildGoalListEl(state.generalGoals, "general"));
    wrap.appendChild(buildGoalAddRow("general"));
  }

  function addTransaction(name, amount) {
    if (!name.trim() || !amount) return;
    if (isGuest()) {
      state.transactions.unshift({ id: uid(), name: name.trim(), amount: parseFloat(amount), entry_date: dateStr(0) });
      renderTransactions();
      renderCashflowChart();
      saveGuestState();
      return;
    }
    var userId = state.session.user.id;
    supabaseClient.from("transactions").insert({ user_id: userId, name: name.trim(), amount: parseFloat(amount), entry_date: dateStr(0) })
      .select().single()
      .then(function (res) {
        if (res.error) { console.error("Axis: add transaction failed", res.error); return; }
        state.transactions.unshift(res.data);
        renderTransactions();
        renderCashflowChart();
      });
  }

  function removeTransaction(id) {
    state.transactions = state.transactions.filter(function (t) { return t.id !== id; });
    renderTransactions();
    renderCashflowChart();
    if (isGuest()) { saveGuestState(); return; }
    supabaseClient.from("transactions").delete().eq("id", id).then(function (res) {
      if (res.error) console.error("Axis: remove transaction failed", res.error);
    });
  }

  function renderTransactions() {
    var wrap = document.getElementById("transactions-list");
    wrap.innerHTML = "";
    if (state.transactions.length === 0) {
      var note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "No transactions yet — add one below.";
      wrap.appendChild(note);
    }
    state.transactions.slice(0, 10).forEach(function (t) {
      var tpl = document.getElementById("transaction-row-template").content.cloneNode(true);
      var row = tpl.querySelector(".tx-row");
      row.querySelector(".tx-name").textContent = t.name;
      row.querySelector(".tx-date").textContent = t.entry_date;
      var amountEl = row.querySelector(".tx-amount");
      var isPos = Number(t.amount) >= 0;
      amountEl.textContent = (isPos ? "+" : "-") + fmtMoney(Math.abs(t.amount));
      amountEl.classList.add(isPos ? "positive" : "negative");
      row.querySelector(".tx-remove").addEventListener("click", function () { removeTransaction(t.id); });
      wrap.appendChild(row);
    });
    var addRow = document.createElement("div");
    addRow.className = "add-tx-row";
    addRow.innerHTML = '<input type="text" placeholder="Name" maxlength="60"><input type="number" step="0.01" placeholder="Amount (+/-)"><button type="button">Add</button>';
    var nameInput = addRow.querySelectorAll("input")[0];
    var amountInput = addRow.querySelectorAll("input")[1];
    addRow.querySelector("button").addEventListener("click", function () {
      addTransaction(nameInput.value, amountInput.value);
      nameInput.value = ""; amountInput.value = "";
    });
    wrap.appendChild(addRow);
  }

  function renderCashflowChart() {
    var el = document.getElementById("fin-chart");
    var tx = state.transactions.slice(0, 10).slice().reverse();
    if (tx.length === 0) {
      el.innerHTML = '<p class="empty-note">Add transactions to see your cashflow here.</p>';
      return;
    }
    var running = 0;
    var points = tx.map(function (t) { running += Number(t.amount); return running; });
    var max = Math.max.apply(null, points.concat([0]));
    var min = Math.min.apply(null, points.concat([0]));
    var range = max - min || 1;
    var width = 560, height = 140, padding = 20;
    var stepX = tx.length > 1 ? (width - padding * 2) / (tx.length - 1) : 0;

    var coords = points.map(function (v, i) {
      var x = padding + i * stepX;
      var y = height - padding - ((v - min) / range) * (height - padding * 2);
      return [x, y];
    });

    var linePath = coords.map(function (p, i) { return (i === 0 ? "M" : "L") + p[0] + "," + p[1]; }).join(" ");
    var lastPositive = points[points.length - 1] >= 0;

    el.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" class="chart-svg-wrap" preserveAspectRatio="none">' +
      '<line x1="' + padding + '" x2="' + (width - padding) + '" y1="' + (height - padding - ((0 - min) / range) * (height - padding * 2)) + '" y2="' + (height - padding - ((0 - min) / range) * (height - padding * 2)) + '" stroke="#E2E8F0" stroke-dasharray="3 4"/>' +
      '<path d="' + linePath + '" fill="none" stroke="' + (lastPositive ? "#4F46E5" : "#E85A4C") + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      coords.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="' + (lastPositive ? "#4F46E5" : "#E85A4C") + '"/>'; }).join("") +
      '</svg>';
  }

  function renderFinancial() {
    renderFinancialSummary();
    renderFinancialGoals();
    renderTransactions();
    renderCashflowChart();
  }

  // ==================== TRIPS ====================

  function addTrip() {
    if (isGuest()) {
      state.trips.push({ id: uid(), name: "New trip" });
      renderTrips();
      saveGuestState();
      return;
    }
    var userId = state.session.user.id;
    supabaseClient.from("trips").insert({ user_id: userId, name: "New trip" }).select().single()
      .then(function (res) {
        if (res.error) { console.error("Axis: add trip failed", res.error); return; }
        state.trips.push(res.data);
        renderTrips();
      });
  }

  function persistTrip(trip) {
    if (isGuest()) { saveGuestState(); return; }
    supabaseClient.from("trips").update({
      name: trip.name, destination: trip.destination, start_date: trip.start_date || null,
      end_date: trip.end_date || null, budget: trip.budget, notes: trip.notes
    }).eq("id", trip.id).then(function (res) { if (res.error) console.error("Axis: trip update failed", res.error); });
  }

  function removeTrip(id) {
    state.trips = state.trips.filter(function (t) { return t.id !== id; });
    renderTrips();
    if (isGuest()) { saveGuestState(); return; }
    supabaseClient.from("trips").delete().eq("id", id).then(function (res) {
      if (res.error) console.error("Axis: remove trip failed", res.error);
    });
  }

  function renderTrips() {
    var wrap = document.getElementById("trips-list");
    wrap.innerHTML = "";
    if (state.trips.length === 0) {
      var note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "No trips yet — add your first one below.";
      wrap.appendChild(note);
    }
    state.trips.forEach(function (trip) {
      var tpl = document.getElementById("trip-card-template").content.cloneNode(true);
      var card = tpl.querySelector(".trip-card");
      var nameI = card.querySelector(".trip-name-input");
      var destI = card.querySelector(".trip-destination-input");
      var startI = card.querySelector(".trip-start-input");
      var endI = card.querySelector(".trip-end-input");
      var budgetI = card.querySelector(".trip-budget-input");
      var notesI = card.querySelector(".trip-notes-input");

      nameI.value = trip.name || "";
      destI.value = trip.destination || "";
      startI.value = trip.start_date || "";
      endI.value = trip.end_date || "";
      budgetI.value = trip.budget || "";
      notesI.value = trip.notes || "";

      [nameI, destI, startI, endI, budgetI, notesI].forEach(function (input) {
        input.addEventListener("change", function () {
          trip.name = nameI.value; trip.destination = destI.value;
          trip.start_date = startI.value; trip.end_date = endI.value;
          trip.budget = parseFloat(budgetI.value) || 0; trip.notes = notesI.value;
          persistTrip(trip);
        });
      });

      card.querySelector(".trip-remove").addEventListener("click", function () { removeTrip(trip.id); });
      wrap.appendChild(card);
    });

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-trip-btn";
    addBtn.textContent = "+ Add a trip";
    addBtn.addEventListener("click", addTrip);
    wrap.appendChild(addBtn);
  }

  // ==================== TEMPLATES ====================

  function applyTemplate(items) {
    items.forEach(function (name) { addHabit(name); });
  }

  function renderTemplatesTab() {
    var wrap = document.getElementById("templates-list");
    wrap.innerHTML = "";
    TEMPLATES.forEach(function (t) {
      var card = document.createElement("div");
      card.className = "template-card";
      card.innerHTML = "<h3>" + t.name + "</h3><p>" + t.desc + "</p>";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "template-apply-btn";
      btn.textContent = "Add to Daily";
      btn.addEventListener("click", function () { applyTemplate(t.items); goToPage("daily"); });
      card.appendChild(btn);
      wrap.appendChild(card);
    });
  }

  // ==================== ANALYTICS ====================

  // ==================== JOURNEY PATH ====================

  function dayCompletionPct(offset) {
    var habits = dailyHabits();
    if (habits.length === 0) return 0;
    var doneCount = habits.filter(function (h) { return isDone(h.id, offset); }).length;
    return (doneCount / habits.length) * 100;
  }

  function journeyStreak() {
    var offset = dayCompletionPct(0) >= 75 ? 0 : 1;
    if (offset === 1 && dayCompletionPct(1) < 75) return 0;
    var streak = 0;
    while (dayCompletionPct(offset) >= 75) { streak++; offset++; }
    return streak;
  }

  function showConfetti() {
    var layer = document.getElementById("confetti-layer");
    var colors = ["#4F46E5", "#FF6B4A", "#F59E0B", "#22C55E", "#818CF8"];
    for (var i = 0; i < 36; i++) {
      var piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (2 + Math.random() * 1.5) + "s";
      piece.style.animationDelay = (Math.random() * 0.4) + "s";
      layer.appendChild(piece);
      (function (el) { setTimeout(function () { el.remove(); }, 4200); })(piece);
    }
  }

  function showJourneyToast(title, sub) {
    var toast = document.getElementById("journey-toast");
    document.getElementById("journey-toast-title").textContent = title;
    document.getElementById("journey-toast-sub").textContent = sub;
    toast.classList.remove("hidden");
    requestAnimationFrame(function () { toast.classList.add("show"); });
    setTimeout(function () {
      toast.classList.remove("show");
      setTimeout(function () { toast.classList.add("hidden"); }, 400);
    }, 3200);
  }

  function openChestModal(title, sub) {
    var modal = document.getElementById("chest-modal");
    var video = document.getElementById("chest-video");
    document.getElementById("chest-modal-title").textContent = title;
    document.getElementById("chest-modal-sub").textContent = sub;
    modal.classList.remove("hidden");
    video.currentTime = 0;
    video.muted = true;
    document.getElementById("chest-modal-unmute").textContent = "Unmute";
    video.play().catch(function () { /* autoplay might be blocked — video still visible, user can tap play */ });
  }

  function closeChestModal() {
    var modal = document.getElementById("chest-modal");
    var video = document.getElementById("chest-video");
    video.pause();
    modal.classList.add("hidden");
  }

  function initChestModal() {
    document.getElementById("chest-modal-close").addEventListener("click", closeChestModal);
    document.getElementById("chest-modal").addEventListener("click", function (e) {
      if (e.target.id === "chest-modal") closeChestModal();
    });
    document.getElementById("chest-modal-unmute").addEventListener("click", function () {
      var video = document.getElementById("chest-video");
      video.muted = !video.muted;
      this.textContent = video.muted ? "Unmute" : "Mute";
    });
    document.getElementById("chest-video").addEventListener("ended", function () {
      setTimeout(closeChestModal, 600);
    });
  }

  function checkJourneyMilestone() {
    var streak = journeyStreak();
    if (streak > 0 && streak % 7 === 0 && streak > state.journeyMilestoneClaimed) {
      state.journeyMilestoneClaimed = streak;
      adjustCoins(250);
      showConfetti();
      openChestModal(streak + "-day streak!", "+250 coins");
      if (isGuest()) { saveGuestState(); return true; }
      supabaseClient.from("profiles").update({ journey_milestone_claimed: streak }).eq("id", state.session.user.id)
        .then(function (res) { if (res.error) console.error("Axis: journey milestone save failed", res.error); });
      return true;
    }
    return false;
  }

  var JOURNEY_ICONS = {
    lock: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" fill="#fff" fill-opacity="0.9"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#fff" stroke-width="2" fill="none"/><circle cx="12" cy="15.5" r="1.6" fill="#8A8070"/></svg>',
    gift: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><rect x="4" y="10" width="16" height="10" rx="1.5" fill="#fff" fill-opacity="0.95"/><rect x="4" y="7" width="16" height="4" rx="1" fill="#fff"/><rect x="11" y="7" width="2" height="13" fill="#F59E0B"/><path d="M12 7c-2-4-7-3-6 0s6 0 6 0zM12 7c2-4 7-3 6 0s-6 0-6 0z" fill="#fff"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M5 13l4 4 10-10" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7L2 9.2l7.1-.6z"/></svg>',
    dot: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><circle cx="12" cy="12" r="7"/></svg>',
    circle: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#B8AF95" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>'
  };

  var JOURNEY_MASCOT_SVG =
    '<svg viewBox="0 0 60 60" width="46" height="46"><ellipse cx="30" cy="52" rx="14" ry="4" fill="#00000012"/>' +
    '<circle cx="30" cy="28" r="20" fill="#4F46E5"/><circle cx="30" cy="28" r="20" fill="#fff" fill-opacity="0.08"/>' +
    '<circle cx="23" cy="26" r="4.2" fill="#fff"/><circle cx="37" cy="26" r="4.2" fill="#fff"/>' +
    '<circle cx="23" cy="26" r="2" fill="#23291F"/><circle cx="37" cy="26" r="2" fill="#23291F"/>' +
    '<path d="M24 36c2.5 2.4 9.5 2.4 12 0" stroke="#23291F" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<path d="M14 20c0-6 6-9 6-9M46 20c0-6-6-9-6-9" stroke="#4F46E5" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';

  function renderJourneyPath() {
    var streak = journeyStreak();
    document.getElementById("journey-streak-count").textContent = streak;

    var wrap = document.getElementById("journey-path");
    wrap.innerHTML = "";

    var nodeCount = 9; // 7 days of the current cycle + chest + one upcoming teaser
    var amplitude = 64;

    for (var i = 0; i < nodeCount; i++) {
      var isChestSlot = i === 7;
      var isTeaser = i === 8;
      var dayIndexInCycle = i; // 0..6 map to streak days 1..7

      var nodeWrap = document.createElement("div");
      nodeWrap.className = "journey-node-wrap";
      nodeWrap.style.transform = "translateX(" + Math.round(Math.sin(i * 0.85) * amplitude) + "px)";

      var node = document.createElement("div");
      node.className = "journey-node";
      var label = document.createElement("span");
      label.className = "journey-label";

      if (isTeaser) {
        node.classList.add("locked");
        node.innerHTML = JOURNEY_ICONS.lock;
        label.textContent = "Next up";
      } else if (isChestSlot) {
        var claimed = state.journeyMilestoneClaimed >= 7;
        var claimable = streak >= 7;
        node.classList.add("chest", claimed ? "claimed" : (claimable ? "claimable" : "locked"));
        node.innerHTML = claimed ? JOURNEY_ICONS.check : JOURNEY_ICONS.gift;
        label.textContent = claimed ? "Claimed" : "7-day chest";
      } else {
        var dayNum = dayIndexInCycle + 1;
        if (dayNum <= streak) {
          node.classList.add("completed");
          node.innerHTML = JOURNEY_ICONS.star;
        } else if (dayNum === streak + 1) {
          node.classList.add("current");
          node.innerHTML = JOURNEY_ICONS.dot;
        } else {
          node.classList.add("locked");
          node.innerHTML = JOURNEY_ICONS.circle;
        }
        label.textContent = "Day " + dayNum;
      }

      nodeWrap.appendChild(node);
      nodeWrap.appendChild(label);

      if (dayIndexInCycle === Math.min(streak, 6) && !isChestSlot && !isTeaser) {
        var mascot = document.createElement("span");
        mascot.className = "journey-mascot";
        mascot.innerHTML = JOURNEY_MASCOT_SVG;
        nodeWrap.appendChild(mascot);
      }

      wrap.appendChild(nodeWrap);
    }

    checkJourneyMilestone();
  }

  function renderAnalytics() {
    var habits = dailyHabits();
    var totalGoals = state.financialGoals.length + state.generalGoals.length;

    document.getElementById("analytics-stats").innerHTML =
      statCard(habits.length, "Habits tracked") +
      statCard(totalGoals, "Goals") +
      statCard(state.trips.length, "Trips");

    renderComboChart(document.getElementById("analytics-chart"), completionSeries(chartDayCount()));
    renderJourneyPath();
  }

  // ==================== SETTINGS ====================

  function renderSettings() {
    document.getElementById("settings-name-input").value = state.fullName || state.displayName;
    document.getElementById("settings-plan-label").textContent = state.plan === "premium" ? "Premium plan" : "Free plan";
    var emailInput = document.getElementById("settings-email-input");
    if (emailInput) emailInput.value = state.session ? state.session.user.email : "";
    var preview = document.getElementById("settings-avatar-preview");
    if (preview) {
      var initial = (state.fullName || state.displayName || "A").charAt(0).toUpperCase();
      if (state.avatarUrl) {
        preview.style.backgroundImage = "url(" + state.avatarUrl + ")";
        preview.textContent = "";
      } else {
        preview.style.backgroundImage = "none";
        preview.textContent = initial;
      }
    }
  }

  function flashNote(id, text, isError) {
    var el = document.getElementById(id);
    el.textContent = text;
    el.style.color = isError ? "var(--physical)" : "var(--mental)";
    el.classList.remove("hidden");
    setTimeout(function () { el.classList.add("hidden"); }, 3000);
  }

  function initSettings() {
    document.getElementById("settings-save-btn").addEventListener("click", function () {
      var name = document.getElementById("settings-name-input").value.trim();
      state.displayName = name;
      state.fullName = name;
      if (isGuest()) { saveGuestState(); renderTopbar(); renderProfile(); return; }
      supabaseClient.from("profiles").update({ display_name: name, full_name: name }).eq("id", state.session.user.id)
        .then(function (res) {
          if (res.error) { console.error("Axis: save name failed", res.error); return; }
          renderTopbar();
          renderProfile();
          var note = document.getElementById("settings-saved-note");
          note.classList.remove("hidden");
          setTimeout(function () { note.classList.add("hidden"); }, 2000);
        });
    });

    document.getElementById("upgrade-link").addEventListener("click", function (e) {
      e.preventDefault();
      alert("Payments aren't connected yet. This link will go to your Lemon Squeezy checkout once it's set up.");
    });

    // Avatar upload
    var fileInput = document.getElementById("avatar-file-input");
    document.getElementById("avatar-upload-btn").addEventListener("click", function () {
      if (isGuest()) { openAuthGate("settings"); return; }
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { alert("Please choose an image under 2MB."); return; }
      var userId = state.session.user.id;
      var path = userId + "/" + Date.now() + "-" + file.name.replace(/[^a-z0-9.]/gi, "_");
      supabaseClient.storage.from("avatars").upload(path, file, { upsert: true }).then(function (res) {
        if (res.error) { alert("Upload failed: " + res.error.message); return; }
        var publicUrl = supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
        state.avatarUrl = publicUrl;
        supabaseClient.from("profiles").update({ avatar_url: publicUrl }).eq("id", userId).then(function (r2) {
          if (r2.error) console.error("Axis: save avatar url failed", r2.error);
          renderSettings();
          renderProfile();
        });
      });
    });

    // Email update
    document.getElementById("settings-email-save-btn").addEventListener("click", function () {
      if (isGuest()) { openAuthGate("settings"); return; }
      var newEmail = document.getElementById("settings-email-input").value.trim();
      if (!newEmail) return;
      supabaseClient.auth.updateUser({ email: newEmail }).then(function (res) {
        if (res.error) { flashNote("settings-email-note", res.error.message, true); return; }
        flashNote("settings-email-note", "Check your new email to confirm the change.", false);
      });
    });

    // Password update
    document.getElementById("settings-password-save-btn").addEventListener("click", function () {
      if (isGuest()) { openAuthGate("settings"); return; }
      var pw = document.getElementById("settings-new-password").value;
      if (!pw || pw.length < 6) { flashNote("settings-password-note", "Password must be at least 6 characters.", true); return; }
      supabaseClient.auth.updateUser({ password: pw }).then(function (res) {
        if (res.error) { flashNote("settings-password-note", res.error.message, true); return; }
        document.getElementById("settings-new-password").value = "";
        flashNote("settings-password-note", "Password updated.", false);
      });
    });

    // Delete account (request — actual deletion requires a server-side admin function)
    document.getElementById("delete-account-btn").addEventListener("click", function () {
      if (isGuest()) { openAuthGate("settings"); return; }
      if (!confirm("Request account deletion? This can't be undone once processed.")) return;
      supabaseClient.from("profiles").update({ deletion_requested_at: new Date().toISOString() }).eq("id", state.session.user.id)
        .then(function (res) {
          if (res.error) { flashNote("delete-account-note", res.error.message, true); return; }
          flashNote("delete-account-note", "Deletion requested. You'll be logged out now.", false);
          setTimeout(function () { supabaseClient.auth.signOut(); }, 1800);
        });
    });
  }

  // ==================== AI COACH ====================

  function sendCoachMessage(text, addMessageFn) {
    if (!text.trim()) return;
    if (isGuest()) { openAuthGate("ai"); return; }

    addMessageFn(text, "user");

    var context = {
      dailyHabits: dailyHabits().map(function (h) { return { name: h.name, doneToday: isDone(h.id, 0), streak: habitStreak(h.id) }; }),
      financial: state.financial
    };

    fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, context: context })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { addMessageFn(data.reply || "Sorry, I couldn't generate a response.", "assistant"); })
      .catch(function () {
        addMessageFn("The coach isn't connected yet — deploy /api/coach.js to Vercel with a GEMINI_API_KEY to enable this.", "assistant");
      });
  }

  function initCoach() {
    var toggle = document.getElementById("coach-toggle");
    var panel = document.getElementById("coach-panel");
    var closeBtn = document.getElementById("coach-close");
    var form = document.getElementById("coach-form");
    var input = document.getElementById("coach-input");
    var messages = document.getElementById("coach-messages");

    toggle.addEventListener("click", function () { panel.classList.toggle("hidden"); });
    closeBtn.addEventListener("click", function () { panel.classList.add("hidden"); });

    function addMessage(text, role) {
      var div = document.createElement("div");
      div.className = "coach-msg coach-msg-" + role;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      sendCoachMessage(text, addMessage);
    });

    // Dashboard inline AI card — same coach, different entry point.
    var dashForm = document.getElementById("dash-ai-form");
    var dashInput = document.getElementById("dash-ai-input");
    if (dashForm) {
      dashForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var text = dashInput.value.trim();
        if (!text) return;
        dashInput.value = "";
        panel.classList.remove("hidden");
        sendCoachMessage(text, addMessage);
      });
    }
    document.querySelectorAll(".ai-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        panel.classList.remove("hidden");
        sendCoachMessage(chip.getAttribute("data-prompt"), addMessage);
      });
    });
  }

  // ==================== RENDER ALL ====================

  function renderProfile() {
    var isLoggedIn = !!state.session;
    var displayLabel = state.fullName || state.displayName;
    var initial = isLoggedIn
      ? (displayLabel || state.session.user.email || "A").charAt(0).toUpperCase()
      : "G";
    var fabEl = document.getElementById("profile-fab-initial");
    if (fabEl) fabEl.textContent = initial;
    var dashFabEl = document.getElementById("dash-profile-initial");
    if (dashFabEl) dashFabEl.textContent = initial;
    var avatarEl = document.getElementById("profile-page-avatar");
    if (avatarEl) {
      if (isLoggedIn && state.avatarUrl) {
        avatarEl.style.backgroundImage = "url(" + state.avatarUrl + ")";
        avatarEl.style.backgroundSize = "cover";
        avatarEl.style.backgroundPosition = "center";
        avatarEl.textContent = "";
      } else {
        avatarEl.style.backgroundImage = "none";
        avatarEl.textContent = initial;
      }
    }

    var nameEl = document.getElementById("profile-name");
    if (nameEl) nameEl.textContent = isLoggedIn ? (displayLabel || "Your name") : "Guest";
    var emailEl = document.getElementById("profile-email");
    if (emailEl) emailEl.textContent = isLoggedIn ? state.session.user.email : "Not signed in";
    var pillEl = document.getElementById("profile-plan-pill");
    if (pillEl) pillEl.textContent = !isLoggedIn ? "Guest" : (state.plan === "premium" ? "Premium" : "Free plan");

    var habits = dailyHabits();
    var bestStreak = habits.reduce(function (max, h) { return Math.max(max, habitStreak(h.id)); }, 0);
    var sv = document.getElementById("profile-streak-value");
    var cv = document.getElementById("profile-coins-value");
    var hv = document.getElementById("profile-habits-value");
    if (sv) sv.textContent = bestStreak;
    if (cv) cv.textContent = state.coins;
    if (hv) hv.textContent = habits.length;

    var logoutBtn = document.getElementById("profile-logout-btn");
    if (logoutBtn) {
      if (isLoggedIn) {
        logoutBtn.style.display = "";
        logoutBtn.textContent = "Log out";
      } else {
        logoutBtn.textContent = "Sign in / Sign up";
        logoutBtn.onclick = function () { openAuthGate("profile"); };
      }
    }
  }

  function initProfile() {
    // Logout/sign-in button behavior is set dynamically in renderProfile()
    // depending on guest vs logged-in state.
  }

  function renderAll() {
    renderTopbar();
    renderDaily();
    renderDashboard();
    renderFinancial();
    renderTrips();
    renderGeneralGoals();
    renderTemplatesTab();
    renderAnalytics();
    renderSettings();
    renderProfile();
    renderProjectsList(); renderProjectsPreview();
  }

  // ==================== PWA INSTALL ====================

  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    var btn = document.getElementById("install-btn");
    btn.classList.remove("hidden");
    btn.addEventListener("click", function () {
      btn.classList.add("hidden");
      deferredPrompt.prompt();
    });
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function (err) {
        console.error("Axis: service worker registration failed", err);
      });
    });
  }

  // ==================== INIT ====================

  function hideBootSkeleton() {
    var el = document.getElementById("boot-skeleton");
    if (el) el.classList.add("hidden");
  }

  function enterApp() {
    document.getElementById("auth-gate").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
    document.getElementById("bottom-nav").classList.remove("hidden");
    document.getElementById("coach-toggle").classList.remove("hidden");
    document.getElementById("mobile-new-project-btn").classList.remove("hidden");
  }

  function exitToAuth() {
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("bottom-nav").classList.add("hidden");
    document.getElementById("coach-toggle").classList.add("hidden");
    document.getElementById("coach-panel").classList.add("hidden");
    document.getElementById("mobile-new-project-btn").classList.add("hidden");
    document.getElementById("auth-gate").classList.remove("hidden");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var initializers = [
      initAuthGate, initResetFlow, initNav, initTheme, initFinancialCalculator,
      initDashboardToggle, initSettings, initCoach, initChestModal, initProfile,
      initStickyDashTopbar, initProjects, initFocusTimer, initDailyReflection, initDashPlanTabs,
      initProjectOfflineToggle, initOfflineEngine, initProjectCoverAndIcon
    ];
    initializers.forEach(function (fn) {
      try { fn(); } catch (e) { console.error("Axis: " + fn.name + " failed to init", e); }
    });

    supabaseClient.auth.onAuthStateChange(function (event, session) {
      state.session = session;
      if (session) {
        enterApp();
        loadAllData().then(function () {
          if (pendingOnboarding && !state.onboardingCompleted) {
            pendingOnboarding = false;
            startOnboarding();
          }
        });
      } else {
        exitToAuth();
      }
    });

    supabaseClient.auth.getSession().then(function (res) {
      state.session = res.data.session;
      hideBootSkeleton();
      if (state.session) {
        enterApp();
        loadAllData();
      } else {
        exitToAuth();
      }
    });
  });
})();
