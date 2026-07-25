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
    coins: 0,
    journeyMilestoneClaimed: 0,
    habits: [],
    entriesByHabit: {},
    financial: { income: 0, outcome: 0 },
    transactions: [],
    financialGoals: [],
    generalGoals: [],
    trips: []
  };

  var TEMPLATES = [
    { name: "Morning Foundation", desc: "A simple physical + mental start to the day.", items: ["Drink a glass of water", "10 minutes of movement", "Write 3 priorities for today"] },
    { name: "Deep Focus", desc: "Protect a block of real, undistracted work.", items: ["No phone for first hour", "One 90-minute focus block", "Review tomorrow's top task"] },
    { name: "Faith & Reflection", desc: "Small consistent spiritual habits.", items: ["5 minutes of quiet reflection", "Read something meaningful", "One act of kindness"] },
    { name: "Evening Reset", desc: "Close the day with intention.", items: ["Tidy your workspace", "Plan tomorrow", "Screens off 30 min before bed"] }
  ];

  var QUICKLINKS = [
    { page: "daily", title: "Daily", sub: "View all tasks", icon: 'rect x="3" y="4" width="18" height="18" rx="2"' },
    { page: "analytics", title: "Analytics", sub: "Track your growth", icon: 'circle cx="12" cy="12" r="9"' },
    { page: "financial", title: "Finance", sub: "Manage finance", icon: 'path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" fill="none"' },
    { page: "goals", title: "Goal", sub: "Set your targets", icon: 'circle cx="12" cy="12" r="9"' },
    { page: "trip", title: "Trip Plan", sub: "Plan your trips", icon: 'circle cx="12" cy="10" r="3"' },
    { page: "templates", title: "Templates", sub: "Ready-made sets", icon: 'path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"' }
  ];

  var RECOMMENDED = [
    { title: "Templates", sub: "Start with a ready-made set", page: "templates" },
    { title: "Goals", sub: "Set a target to work toward", page: "goals" },
    { title: "Trip Plan", sub: "Plan your next trip", page: "trip" }
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

  var PROTECTED_PAGES = ["settings", "profile"];
  var gateAuthMode = "signup";

  function openAuthGate(context) {
    var gate = document.getElementById("auth-gate");
    var title = document.getElementById("auth-gate-title");
    var sub = document.getElementById("auth-gate-sub");
    var submitBtn = document.getElementById("gate-submit");
    var toggleBtn = document.getElementById("gate-toggle");

    var contextMessages = {
      ai: ["Unlock your AI coach", "Sign up to chat with your personal coaching AI."],
      profile: ["Create your profile", "Sign up to save your progress across devices."],
      settings: ["Account required", "Sign up to save your preferences and data."],
      default: ["Create your account", "Sign up to sync your data across devices."]
    };
    var msg = contextMessages[context] || contextMessages.default;
    title.textContent = msg[0];
    sub.textContent = msg[1];
    gateAuthMode = "signup";
    submitBtn.textContent = "Create account";
    toggleBtn.textContent = "Already have an account? Log in";
    document.getElementById("gate-error").classList.add("hidden");
    gate.classList.remove("hidden");
  }

  function closeAuthGate() {
    document.getElementById("auth-gate").classList.add("hidden");
  }

  function initAuthGate() {
    var form = document.getElementById("auth-gate-form");
    var toggle = document.getElementById("gate-toggle");
    var submitBtn = document.getElementById("gate-submit");

    toggle.addEventListener("click", function () {
      gateAuthMode = gateAuthMode === "signup" ? "login" : "signup";
      submitBtn.textContent = gateAuthMode === "signup" ? "Create account" : "Log in";
      document.getElementById("auth-gate-title").textContent = gateAuthMode === "signup" ? "Create your account" : "Welcome back";
      toggle.textContent = gateAuthMode === "signup" ? "Already have an account? Log in" : "Don't have an account? Sign up";
      document.getElementById("gate-error").classList.add("hidden");
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("gate-email").value.trim();
      var password = document.getElementById("gate-password").value;
      if (!email || !password) return;

      submitBtn.disabled = true;
      var action = gateAuthMode === "login"
        ? supabaseClient.auth.signInWithPassword({ email: email, password: password })
        : supabaseClient.auth.signUp({ email: email, password: password });

      action.then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          document.getElementById("gate-error").textContent = res.error.message;
          document.getElementById("gate-error").classList.remove("hidden");
          return;
        }
        if (gateAuthMode === "signup" && !res.data.session) {
          document.getElementById("gate-error").textContent = "Check your email to confirm, then log in.";
          document.getElementById("gate-error").classList.remove("hidden");
          return;
        }
        closeAuthGate();
      });
    });

    document.getElementById("auth-gate-close").addEventListener("click", closeAuthGate);
    document.getElementById("auth-gate").addEventListener("click", function (e) {
      if (e.target.id === "auth-gate") closeAuthGate();
    });

    var logoutBtns = ["logout-btn"];
    logoutBtns.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", function () { supabaseClient.auth.signOut(); });
    });
  }

  // ==================== NAVIGATION ====================

  function isGuest() { return !state.session; }

  function goToPage(pageId) {
    if (PROTECTED_PAGES.indexOf(pageId) !== -1 && isGuest()) {
      openAuthGate(pageId);
      return;
    }
    document.querySelectorAll(".page").forEach(function (el) {
      el.classList.toggle("hidden", el.getAttribute("data-page") !== pageId);
    });
    document.querySelectorAll(".nav-item").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-page") === pageId);
    });
    document.querySelectorAll(".bottom-nav-item[data-page]").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-page") === pageId);
    });
    window.scrollTo(0, 0);
  }

  function initNav() {
    document.querySelectorAll("[data-page]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        goToPage(el.getAttribute("data-page"));
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
    var el = document.getElementById("coin-count");
    if (el) el.textContent = state.coins;
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
    var streakEl = document.getElementById("streak-count");
    if (streakEl) streakEl.textContent = bestStreak;
    var coinEl = document.getElementById("coin-count");
    if (coinEl) coinEl.textContent = state.coins;

    var remaining = habits.filter(function (h) { return !isDone(h.id, 0); }).length;
    var mobileBadge = document.getElementById("mobile-notif-badge");
    if (mobileBadge) {
      mobileBadge.textContent = remaining;
      mobileBadge.classList.toggle("hidden", remaining === 0);
    }

    var emailEl = document.getElementById("dash-user-email");
    if (emailEl) emailEl.textContent = state.session ? state.session.user.email : "Guest — sign up to save your data";
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
      supabaseClient.from("profiles").select("plan, display_name, coins, journey_milestone_claimed").eq("id", userId).single(),
      supabaseClient.from("habits").select("*").eq("user_id", userId).eq("is_active", true).order("created_at"),
      supabaseClient.from("habit_entries").select("habit_id, entry_date").eq("user_id", userId).gte("entry_date", since),
      supabaseClient.from("financial_state").select("*").eq("user_id", userId).maybeSingle(),
      supabaseClient.from("transactions").select("*").eq("user_id", userId).order("entry_date", { ascending: false }).limit(30),
      supabaseClient.from("goals").select("*").eq("user_id", userId).order("created_at"),
      supabaseClient.from("trips").select("*").eq("user_id", userId).order("created_at")
    ];

    return Promise.all(calls).then(function (results) {
      var profileRes = results[0], habitsRes = results[1], entriesRes = results[2],
          finRes = results[3], txRes = results[4], goalsRes = results[5], tripsRes = results[6];

      if (profileRes.data) {
        state.plan = profileRes.data.plan || "free";
        state.displayName = profileRes.data.display_name || "";
        state.coins = profileRes.data.coins || 0;
        state.journeyMilestoneClaimed = profileRes.data.journey_milestone_claimed || 0;
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
      renderDaily(); renderHome(); renderDashboard(); renderTemplatesTab();
      return;
    }
    var userId = state.session.user.id;
    supabaseClient.from("habits").insert({ user_id: userId, dimension: "daily", name: name.trim() })
      .select().single()
      .then(function (res) {
        if (res.error) { console.error("Axis: add habit failed", res.error); return; }
        state.habits.push(res.data);
        renderDaily(); renderHome(); renderDashboard(); renderTemplatesTab();
      });
  }

  function removeHabit(habitId) {
    state.habits = state.habits.filter(function (h) { return h.id !== habitId; });
    renderDaily(); renderHome(); renderDashboard();
    if (isGuest()) { saveGuestState(); return; }
    supabaseClient.from("habits").delete().eq("id", habitId).then(function (res) {
      if (res.error) console.error("Axis: remove habit failed", res.error);
    });
  }

  function toggleHabit(habitId) {
    var today = dateStr(0);
    var currentlyDone = isDone(habitId, 0);

    if (!state.entriesByHabit[habitId]) state.entriesByHabit[habitId] = {};
    if (currentlyDone) delete state.entriesByHabit[habitId][today];
    else state.entriesByHabit[habitId][today] = true;

    adjustCoins(currentlyDone ? -1 : 1);
    renderDaily(); renderHome(); renderDashboard(); renderAnalytics(); renderTopbar();

    if (isGuest()) { saveGuestState(); return; }

    var userId = state.session.user.id;
    var query = currentlyDone
      ? supabaseClient.from("habit_entries").delete().eq("habit_id", habitId).eq("entry_date", today)
      : supabaseClient.from("habit_entries").insert({ user_id: userId, habit_id: habitId, entry_date: today, completed: true });

    query.then(function (res) { if (res.error) console.error("Axis: toggle entry failed", res.error); });
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

  function renderHome() {
    var habits = dailyHabits();
    var doneCount = habits.filter(function (h) { return isDone(h.id, 0); }).length;

    document.getElementById("home-progress-count").textContent = doneCount + "/" + habits.length;
    var pct = habits.length ? (doneCount / habits.length) * 100 : 0;
    document.getElementById("home-progress-fill").style.width = pct + "%";

    var listWrap = document.getElementById("home-daily-list");
    listWrap.innerHTML = "";
    listWrap.appendChild(buildHabitListEl(habits));
    listWrap.appendChild(buildAddRow(addHabit, "Add task"));

    var grid = document.getElementById("quicklink-grid");
    grid.innerHTML = "";
    QUICKLINKS.forEach(function (q) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "quicklink-card";
      card.setAttribute("data-page-link", q.page);
      card.innerHTML =
        '<div class="quicklink-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + q.icon + '</svg></div>' +
        '<span class="quicklink-title">' + q.title + '</span>' +
        '<span class="quicklink-sub">' + q.sub + '</span>';
      grid.appendChild(card);
    });
    // re-bind since these are newly created
    grid.querySelectorAll("[data-page-link]").forEach(function (el) {
      el.addEventListener("click", function () { goToPage(el.getAttribute("data-page-link")); });
    });
  }

  function renderRecommended() {
    var wrap = document.getElementById("recommended-list");
    wrap.innerHTML = "";
    RECOMMENDED.forEach(function (r) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recommended-item";
      btn.setAttribute("data-page-link", r.page);
      btn.innerHTML =
        '<span class="recommended-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span>' +
        '<span><span class="recommended-title">' + r.title + '</span><br><span class="recommended-sub">' + r.sub + '</span></span>';
      wrap.appendChild(btn);
    });
    wrap.querySelectorAll("[data-page-link]").forEach(function (el) {
      el.addEventListener("click", function () { goToPage(el.getAttribute("data-page-link")); });
    });
  }

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

  function renderTrackerTable() {
    var habits = dailyHabits();
    var table = document.getElementById("tracker-table");
    var days = 7;

    var dayLabels = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      dayLabels.push({ offset: i, label: "D" + (days - i) });
    }

    var head = "<tr><th>Task</th>" + dayLabels.map(function (d) { return "<th>" + d.label + "</th>"; }).join("") + "</tr>";

    var rows = habits.map(function (h) {
      var cells = dayLabels.map(function (d) {
        var done = isDone(h.id, d.offset);
        var editable = d.offset === 0;
        return '<td><span class="tracker-check' + (done ? " done" : "") + (editable ? " editable" : "") + '" data-habit="' + h.id + '" data-editable="' + editable + '"></span></td>';
      }).join("");
      return "<tr><td>" + h.name + "</td>" + cells + "</tr>";
    }).join("");

    if (habits.length === 0) {
      table.innerHTML = head + '<tr><td colspan="' + (days + 1) + '" class="empty-note">Add habits on the Daily tab to see them here.</td></tr>';
      return;
    }

    table.innerHTML = head + rows;
    table.querySelectorAll(".tracker-check.editable").forEach(function (el) {
      el.addEventListener("click", function () { toggleHabit(el.getAttribute("data-habit")); });
    });
  }

  function renderTripSummary() {
    var wrap = document.getElementById("dash-trip-summary");
    var today = dateStr(0);
    var upcoming = state.trips
      .filter(function (t) { return !t.start_date || t.start_date >= today; })
      .sort(function (a, b) { return (a.start_date || "9999").localeCompare(b.start_date || "9999"); });

    if (upcoming.length === 0) {
      wrap.innerHTML =
        '<div class="trip-summary-empty">' +
        '<div class="trip-summary-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg></div>' +
        '<p style="margin:0.6rem 0 0.9rem;">No upcoming trips</p>' +
        '<button type="button" class="calc-btn" data-page-link="trip">+ Add Trip Plan</button>' +
        '</div>';
    } else {
      var t = upcoming[0];
      wrap.innerHTML =
        '<p style="font-weight:700;margin:0 0 0.3rem;">' + (t.name || "Untitled trip") + '</p>' +
        '<p style="color:var(--text-muted);font-size:0.85rem;margin:0 0 0.6rem;">' + (t.destination || "No destination set") +
        (t.start_date ? " · " + t.start_date : "") + '</p>' +
        '<button type="button" class="calc-btn" data-page-link="trip">View all trips</button>';
    }
    wrap.querySelectorAll("[data-page-link]").forEach(function (el) {
      el.addEventListener("click", function () { goToPage(el.getAttribute("data-page-link")); });
    });
  }

  function renderGoalDonut() {
    var goals = state.financialGoals.concat(state.generalGoals).filter(function (g) { return g.target > 0; });
    var pct = 0;
    if (goals.length > 0) {
      var sum = goals.reduce(function (acc, g) { return acc + Math.min(g.current / g.target, 1); }, 0);
      pct = Math.round((sum / goals.length) * 100);
    }
    var donut = document.getElementById("dash-donut");
    donut.style.background = "conic-gradient(var(--accent) " + pct + "%, var(--surface-2) " + pct + "%)";
    document.getElementById("dash-donut-value").textContent = pct + "%";
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
  }

  function renderDashboardChart() {
    var series = dashRange === "weekly" ? completionSeries(28).filter(function (_, i) { return i % 4 === 0; }) : completionSeries(7);
    renderComboChart(document.getElementById("dash-chart"), series);
  }

  function renderDashboard() {
    renderTopbar();
    renderDashboardChart();
    renderTrackerTable();
    renderTripSummary();
    renderGoalDonut();
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
        renderGoalDonut();
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
        renderGoalDonut();
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
      renderGoalDonut();
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
        renderGoalDonut();
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
      renderTripSummary();
      saveGuestState();
      return;
    }
    var userId = state.session.user.id;
    supabaseClient.from("trips").insert({ user_id: userId, name: "New trip" }).select().single()
      .then(function (res) {
        if (res.error) { console.error("Axis: add trip failed", res.error); return; }
        state.trips.push(res.data);
        renderTrips();
        renderTripSummary();
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
    renderTripSummary();
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
          renderTripSummary();
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
    document.getElementById("settings-name-input").value = state.displayName;
    document.getElementById("settings-plan-label").textContent = state.plan === "premium" ? "Premium plan" : "Free plan";
  }

  function initSettings() {
    document.getElementById("settings-save-btn").addEventListener("click", function () {
      var name = document.getElementById("settings-name-input").value.trim();
      state.displayName = name;
      supabaseClient.from("profiles").update({ display_name: name }).eq("id", state.session.user.id)
        .then(function (res) {
          if (res.error) { console.error("Axis: save name failed", res.error); return; }
          renderTopbar();
          var note = document.getElementById("settings-saved-note");
          note.classList.remove("hidden");
          setTimeout(function () { note.classList.add("hidden"); }, 2000);
        });
    });

    document.getElementById("upgrade-link").addEventListener("click", function (e) {
      e.preventDefault();
      alert("Payments aren't connected yet. This link will go to your Lemon Squeezy checkout once it's set up.");
    });
  }

  // ==================== AI COACH ====================

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

      if (isGuest()) { openAuthGate("ai"); return; }

      addMessage(text, "user");
      input.value = "";

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
        .then(function (data) { addMessage(data.reply || "Sorry, I couldn't generate a response.", "assistant"); })
        .catch(function () {
          addMessage("The coach isn't connected yet — deploy /api/coach.js to Vercel with a GEMINI_API_KEY to enable this.", "assistant");
        });
    });
  }

  // ==================== RENDER ALL ====================

  function renderProfile() {
    var isLoggedIn = !!state.session;
    var initial = isLoggedIn
      ? (state.displayName || state.session.user.email || "A").charAt(0).toUpperCase()
      : "G";
    var fabEl = document.getElementById("profile-fab-initial");
    if (fabEl) fabEl.textContent = initial;
    var avatarEl = document.getElementById("profile-page-avatar");
    if (avatarEl) avatarEl.textContent = initial;

    var nameEl = document.getElementById("profile-name");
    if (nameEl) nameEl.textContent = isLoggedIn ? (state.displayName || "Your name") : "Guest";
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
    renderHome();
    renderRecommended();
    renderDaily();
    renderDashboard();
    renderFinancial();
    renderTrips();
    renderGeneralGoals();
    renderTemplatesTab();
    renderAnalytics();
    renderSettings();
    renderProfile();
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

  document.addEventListener("DOMContentLoaded", function () {
    var initializers = [
      initAuthGate, initNav, initTheme, initFinancialCalculator,
      initDashboardToggle, initSettings, initCoach, initChestModal, initProfile
    ];
    initializers.forEach(function (fn) {
      try { fn(); } catch (e) { console.error("Axis: " + fn.name + " failed to init", e); }
    });

    // Guest-first: render local data immediately so the app is usable with no account.
    loadGuestData();

    supabaseClient.auth.onAuthStateChange(function (event, session) {
      state.session = session;
      if (session) { loadAllData(); }
    });

    supabaseClient.auth.getSession().then(function (res) {
      state.session = res.data.session;
      if (state.session) { loadAllData(); }
    });
  });
})();
