(function () {
  "use strict";

  var STORAGE_KEY = "axis-data";

  var DIMENSIONS = [
    { id: "physical", label: "PHYSICAL" },
    { id: "mental", label: "MENTAL" },
    { id: "social", label: "SOCIAL" },
    { id: "spiritual", label: "SPIRITUAL" }
  ];

  function loadData() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!raw) throw new Error("empty");
      if (!raw.habits) raw.habits = [];
      if (!raw.entries) raw.entries = {};
      return raw;
    } catch (e) {
      return { habits: [], entries: {} };
    }
  }

  function saveData() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { console.error("Axis: could not save data", e); }
  }

  var data = loadData();

  function dateStr(offsetDays) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function isDone(habitId, offsetDays) {
    var day = data.entries[dateStr(offsetDays)];
    return !!(day && day[habitId]);
  }

  function setDone(habitId, done) {
    var key = dateStr(0);
    if (!data.entries[key]) data.entries[key] = {};
    if (done) data.entries[key][habitId] = true;
    else delete data.entries[key][habitId];
  }

  function habitStreak(habitId) {
    var offset = isDone(habitId, 0) ? 0 : 1;
    if (offset === 1 && !isDone(habitId, 1)) return 0;
    var streak = 0;
    while (isDone(habitId, offset)) { streak++; offset++; }
    return streak;
  }

  function habitsFor(dimensionId) {
    return data.habits.filter(function (h) { return h.dimension === dimensionId; });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- actions ----------

  function addHabit(dimensionId, name) {
    if (!name.trim()) return;
    data.habits.push({ id: uid(), dimension: dimensionId, name: name.trim() });
    saveData();
    render();
  }

  function removeHabit(habitId) {
    data.habits = data.habits.filter(function (h) { return h.id !== habitId; });
    saveData();
    render();
  }

  function toggleHabit(habitId) {
    setDone(habitId, !isDone(habitId, 0));
    saveData();
    render();
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

        row.querySelector(".habit-check").addEventListener("click", function () {
          toggleHabit(h.id);
        });
        row.querySelector(".habit-remove").addEventListener("click", function () {
          removeHabit(h.id);
        });

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
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") submit();
      });

      module.appendChild(addRow);
      wrap.appendChild(module);
    });

    // animate bars in after paint
    requestAnimationFrame(function () {
      document.querySelectorAll(".bar-fill").forEach(function (el) {
        var target = el.getAttribute("data-target");
        setTimeout(function () { el.style.width = target + "%"; }, 50);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", render);
})();
