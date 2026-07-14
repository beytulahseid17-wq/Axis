(function () {
  "use strict";

  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var state = {
    session: null,
    plan: "free",
    habits: [],
    entriesByHabit: {} // habitId -> { "YYYY-MM-DD": true }
  };

  function dateStr(offsetDays) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString().slice(0, 10);
  }

  // ---------- auth ----------

  function showAuthError(message) {
    var el = document.getElementById("auth-error");
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function clearAuthError() {
    document.getElementById("auth-error").classList.add("hidden");
  }

  var authMode = "login";

  function initAuthUI() {
    var form = document.getElementById("auth-form");
    var toggle = document.getElementById("auth-toggle");
    var title = document.getElementById("auth-title");
    var submitBtn = document.getElementById("auth-submit");

    toggle.addEventListener("click", function () {
      authMode = authMode === "login" ? "signup" : "login";
      title.textContent = authMode === "login" ? "Log in" : "Sign up";
      submitBtn.textContent = authMode === "login" ? "Log in" : "Sign up";
      toggle.textContent = authMode === "login"
        ? "Don't have an account? Sign up"
        : "Already have an account? Log in";
      clearAuthError();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearAuthError();
      var email = document.getElementById("auth-email").value.trim();
      var password = document.getElementById("auth-password").value;
      if (!email || !password) return;

      submitBtn.disabled = true;
      var action = authMode === "login"
        ? supabaseClient.auth.signInWithPassword({ email: email, password: password })
        : supabaseClient.auth.signUp({ email: email, password: password });

      action.then(function (res) {
        submitBtn.disabled = false;
        if (res.error) { showAuthError(res.error.message); return; }
        if (authMode === "signup" && !res.data.session) {
          showAuthError("Check your email to confirm your account, then log in.");
        }
      });
    });

    function logout() { supabaseClient.auth.signOut(); }
    document.getElementById("logout-btn").addEventListener("click", logout);
    document.getElementById("more-logout").addEventListener("click", logout);
  }

  function showAuthScreen() {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("app-shell").classList.add("hidden");
  }

  function showApp() {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
  }

  // ---------- navigation ----------

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
    closeMoreSheet();
  }

  function initNav() {
    document.querySelectorAll(".nav-item, .bottom-nav-item[data-page], .more-item[data-page]").forEach(function (el) {
      el.addEventListener("click", function () { goToPage(el.getAttribute("data-page")); });
    });

    document.getElementById("more-btn").addEventListener("click", function () {
      document.getElementById("more-sheet").classList.toggle("open");
    });
  }

  function closeMoreSheet() {
    document.getElementById("more-sheet").classList.remove("open");
  }

  // ---------- ad rail ----------

  function updateAdRail() {
    var rail = document.getElementById("ad-rail");
    var shouldShow = state.plan !== "premium" && navigator.onLine;
    rail.classList.toggle("hidden", !shouldShow);
  }

  window.addEventListener("online", updateAdRail);
  window.addEventListener("offline", updateAdRail);

  // ---------- data loading ----------

  function loadAllData() {
    var userId = state.session.user.id;
    var since = dateStr(60);

    var profileQuery = supabaseClient.from("profiles").select("plan").eq("id", userId).single();
    var habitsQuery = supabaseClient.from("habits")
      .select("*").eq("user_id", userId).eq("is_active", true).order("created_at");
    var entriesQuery = supabaseClient.from("habit_entries")
      .select("habit_id, entry_date").eq("user_id", userId).gte("entry_date", since);

    return Promise.all([profileQuery, habitsQuery, entriesQuery]).then(function (results) {
      var profileRes = results[0], habitsRes = results[1], entriesRes = results[2];

      if (profileRes.data) state.plan = profileRes.data.plan || "free";
      if (habitsRes.error) { console.error("Axis: habits fetch failed", habitsRes.error); return; }
      if (entriesRes.error) { console.error("Axis: entries fetch failed", entriesRes.error); return; }

      state.habits = habitsRes.data || [];
      state.entriesByHabit = {};
      (entriesRes.data || []).forEach(function (row) {
        if (!state.entriesByHabit[row.habit_id]) state.entriesByHabit[row.habit_id] = {};
        state.entriesByHabit[row.habit_id][row.entry_date] = true;
      });

      updateAdRail();
      render();
    });
  }

  // ---------- derived helpers ----------

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

  // ---------- actions ----------

  function addHabit(dimensionId, name) {
    if (!name.trim()) return;
    var userId = state.session.user.id;
    supabaseClient.from("habits")
      .insert({ user_id: userId, dimension: dimensionId, name: name.trim() })
      .select().single()
      .then(function (res) {
        if (res.error) { console.error("Axis: add habit failed", res.error); return; }
        state.habits.push(res.data);
        render();
      });
  }

  function removeHabit(habitId) {
    state.habits = state.habits.filter(function (h) { return h.id !== habitId; });
    render();
    supabaseClient.from("habits").delete().eq("id", habitId).then(function (res) {
      if (res.error) console.error("Axis: remove habit failed", res.error);
    });
  }

  function toggleHabit(habitId) {
    var userId = state.session.user.id;
    var today = dateStr(0);
    var currentlyDone = isDone(habitId, 0);

    if (!state.entriesByHabit[habitId]) state.entriesByHabit[habitId] = {};
    if (currentlyDone) delete state.entriesByHabit[habitId][today];
    else state.entriesByHabit[habitId][today] = true;
    render();

    var query = currentlyDone
      ? supabaseClient.from("habit_entries").delete().eq("habit_id", habitId).eq("entry_date", today)
      : supabaseClient.from("habit_entries").insert({ user_id: userId, habit_id: habitId, entry_date: today, completed: true });

    query.then(function (res) {
      if (res.error) console.error("Axis: toggle entry failed", res.error);
    });
  }

  // ---------- render: shared habit list ----------

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
      var done = isDone(h.id, 0);
      if (done) row.classList.add("done");

      row.querySelector(".habit-name").textContent = h.name;
      var streak = habitStreak(h.id);
      row.querySelector(".habit-streak").textContent = streak > 0 ? streak + "d streak" : "";

      row.querySelector(".habit-check").addEventListener("click", function () { toggleHabit(h.id); });
      row.querySelector(".habit-remove").addEventListener("click", function () { removeHabit(h.id); });

      list.appendChild(row);
    });

    return list;
  }

  function buildAddRow(dimensionId) {
    var addRow = document.createElement("div");
    addRow.className = "add-habit-row";
    addRow.innerHTML =
      '<input type="text" placeholder="Add something to track…" maxlength="60">' +
      '<button type="button">Add</button>';

    var input = addRow.querySelector("input");
    var button = addRow.querySelector("button");

    function submit() {
      addHabit(dimensionId, input.value);
      input.value = "";
    }

    button.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });

    return addRow;
  }

  // ---------- render: Daily page ----------

  function renderDaily() {
    var habits = dailyHabits();
    var doneCount = habits.filter(function (h) { return isDone(h.id, 0); }).length;
    var bestStreak = habits.reduce(function (max, h) { return Math.max(max, habitStreak(h.id)); }, 0);

    var analyticsEl = document.getElementById("daily-analytics");
    analyticsEl.innerHTML =
      '<div class="stat-card"><span class="stat-value">' + doneCount + '/' + habits.length + '</span><span class="stat-label">Done today</span></div>' +
      '<div class="stat-card"><span class="stat-value">' + bestStreak + '</span><span class="stat-label">Best streak</span></div>' +
      '<div class="stat-card"><span class="stat-value">' + habits.length + '</span><span class="stat-label">Tracked</span></div>';

    var listWrap = document.getElementById("daily-list");
    listWrap.innerHTML = "";
    listWrap.appendChild(buildHabitListEl(habits));
    listWrap.appendChild(buildAddRow("daily"));
  }

  // ---------- render: Dashboard overview ----------

  function renderDashboard() {
    var habits = dailyHabits();
    var doneCount = habits.filter(function (h) { return isDone(h.id, 0); }).length;
    var bestStreak = habits.reduce(function (max, h) { return Math.max(max, habitStreak(h.id)); }, 0);

    var wrap = document.getElementById("dashboard-summary");
    wrap.innerHTML =
      '<div class="daily-analytics">' +
      '<div class="stat-card"><span class="stat-value">' + doneCount + '/' + habits.length + '</span><span class="stat-label">Daily done</span></div>' +
      '<div class="stat-card"><span class="stat-value">' + bestStreak + '</span><span class="stat-label">Best streak</span></div>' +
      '<div class="stat-card"><span class="stat-value">' + habits.length + '</span><span class="stat-label">Tracked</span></div>' +
      '</div>';
  }

  function render() {
    renderDashboard();
    renderDaily();
  }

  // ---------- init ----------

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

  document.addEventListener("DOMContentLoaded", function () {
    initAuthUI();
    initNav();

    supabaseClient.auth.onAuthStateChange(function (event, session) {
      state.session = session;
      if (session) { showApp(); loadAllData(); }
      else { showAuthScreen(); }
    });

    supabaseClient.auth.getSession().then(function (res) {
      state.session = res.data.session;
      if (state.session) { showApp(); loadAllData(); }
      else { showAuthScreen(); }
    });
  });
})();
