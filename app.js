(function () {
  "use strict";

  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var DIMENSIONS = [
    { id: "physical", label: "PHYSICAL" },
    { id: "mental", label: "MENTAL" },
    { id: "social", label: "SOCIAL" },
    { id: "spiritual", label: "SPIRITUAL" }
  ];

  var state = {
    session: null,
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

    document.getElementById("logout-btn").addEventListener("click", function () {
      supabaseClient.auth.signOut();
    });
  }

  function showAuthScreen() {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("app-content").classList.add("hidden");
  }

  function showApp() {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("app-content").classList.remove("hidden");
  }

  // ---------- data loading ----------

  function loadAllData() {
    var userId = state.session.user.id;
    var since = dateStr(60);

    var habitsQuery = supabaseClient.from("habits")
      .select("*").eq("user_id", userId).eq("is_active", true).order("created_at");

    var entriesQuery = supabaseClient.from("habit_entries")
      .select("habit_id, entry_date").eq("user_id", userId).gte("entry_date", since);

    return Promise.all([habitsQuery, entriesQuery]).then(function (results) {
      var habitsRes = results[0];
      var entriesRes = results[1];

      if (habitsRes.error) { console.error("Axis: habits fetch failed", habitsRes.error); return; }
      if (entriesRes.error) { console.error("Axis: entries fetch failed", entriesRes.error); return; }

      state.habits = habitsRes.data || [];
      state.entriesByHabit = {};
      (entriesRes.data || []).forEach(function (row) {
        if (!state.entriesByHabit[row.habit_id]) state.entriesByHabit[row.habit_id] = {};
        state.entriesByHabit[row.habit_id][row.entry_date] = true;
      });

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

  function habitsFor(dimensionId) {
    return state.habits.filter(function (h) { return h.dimension === dimensionId; });
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

  // ---------- render ----------

  function render() {
    var wrap = document.getElementById("modules");
    wrap.innerHTML = "";

    DIMENSIONS.forEach(function (dim) {
      var habits = habitsFor(dim.id);
      var doneCount = habits.filter(function (h) { return isDone(h.id, 0); }).length;
      var pct = habits.length ? Math.round((doneCount / habits.length) * 100) : 0;

      var module = document.createElement("div");
      module.className = "module " + dim.id;

      var header = document.createElement("div");
      header.className = "module-header";
      header.innerHTML =
        '<span class="module-label">' + dim.label + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:0%" data-target="' + pct + '"></div></div>' +
        '<span class="module-count">' + doneCount + '/' + habits.length + '</span>';
      module.appendChild(header);

      var list = document.createElement("div");
      list.className = "habit-list";

      if (habits.length === 0) {
        var note = document.createElement("p");
        note.className = "empty-note";
        note.textContent = "Nothing tracked here yet — add the first thing below.";
        list.appendChild(note);
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

      module.appendChild(list);

      var addRow = document.createElement("div");
      addRow.className = "add-habit-row";
      addRow.innerHTML =
        '<input type="text" placeholder="Add something to track…" maxlength="60">' +
        '<button type="button">Add</button>';

      var input = addRow.querySelector("input");
      var button = addRow.querySelector("button");

      function submit() {
        addHabit(dim.id, input.value);
        input.value = "";
      }

      button.addEventListener("click", submit);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });

      module.appendChild(addRow);
      wrap.appendChild(module);
    });

    requestAnimationFrame(function () {
      document.querySelectorAll(".bar-fill").forEach(function (el) {
        var target = el.getAttribute("data-target");
        setTimeout(function () { el.style.width = target + "%"; }, 50);
      });
    });
  }

  // ---------- init ----------

  document.addEventListener("DOMContentLoaded", function () {
    initAuthUI();

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
