// Axis Offline Engine — local-first storage and sync queue
// Uses idb (loaded via CDN in index.html) for IndexedDB access

var AxisOffline = (function () {
  "use strict";

  var DB_NAME = "axis-local";
  var DB_VERSION = 1;
  var db = null;

  // ── DB init ────────────────────────────────────────────────────────────────
  function openDB() {
    if (db) return Promise.resolve(db);
    return idb.openDB(DB_NAME, DB_VERSION, {
      upgrade: function (database) {
        // Core data stores — keyed by id
        ["projects", "blocks", "habits", "habit_entries",
         "notes", "goals", "trips", "transactions"].forEach(function (name) {
          if (!database.objectStoreNames.contains(name)) {
            var store = database.createObjectStore(name, { keyPath: "id" });
            store.createIndex("user_id", "user_id");
            if (name === "habit_entries") store.createIndex("entry_date", "entry_date");
            if (name === "projects") store.createIndex("offline_enabled", "offline_enabled");
          }
        });

        // Pending sync queue — mutations waiting to be flushed to Supabase
        if (!database.objectStoreNames.contains("sync_queue")) {
          var sq = database.createObjectStore("sync_queue", { keyPath: "queue_id", autoIncrement: true });
          sq.createIndex("status", "status");
          sq.createIndex("created_at", "created_at");
        }

        // Offline project registry
        if (!database.objectStoreNames.contains("offline_projects")) {
          database.createObjectStore("offline_projects", { keyPath: "project_id" });
        }

        // Reflection journal (device-local, never synced)
        if (!database.objectStoreNames.contains("reflections")) {
          database.createObjectStore("reflections", { keyPath: "date" });
        }

        // App settings
        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "key" });
        }
      }
    }).then(function (d) { db = d; return d; });
  }

  // ── Generic CRUD helpers ───────────────────────────────────────────────────
  function put(storeName, record) {
    return openDB().then(function (d) {
      return d.put(storeName, record);
    });
  }

  function get(storeName, key) {
    return openDB().then(function (d) { return d.get(storeName, key); });
  }

  function getAll(storeName) {
    return openDB().then(function (d) { return d.getAll(storeName); });
  }

  function del(storeName, key) {
    return openDB().then(function (d) { return d.delete(storeName, key); });
  }

  function clearStore(storeName) {
    return openDB().then(function (d) { return d.clear(storeName); });
  }

  // ── Sync queue ────────────────────────────────────────────────────────────
  // Every mutation is pushed here first, then flushed when online.
  function enqueue(operation) {
    // operation: { table, type: 'upsert'|'delete', payload, id, updated_at }
    return openDB().then(function (d) {
      return d.add("sync_queue", Object.assign({
        status: "pending",
        created_at: new Date().toISOString(),
        retry_count: 0
      }, operation));
    });
  }

  function getPendingQueue() {
    return openDB().then(function (d) {
      return d.getAllFromIndex("sync_queue", "status", "pending");
    });
  }

  function markSynced(queue_id) {
    return openDB().then(function (d) {
      return d.delete("sync_queue", queue_id);
    });
  }

  function markFailed(queue_id, reason) {
    return openDB().then(function (d) {
      return d.get("sync_queue", queue_id).then(function (item) {
        if (!item) return;
        item.status = item.retry_count >= 3 ? "failed" : "pending";
        item.retry_count = (item.retry_count || 0) + 1;
        item.last_error = reason;
        return d.put("sync_queue", item);
      });
    });
  }

  function getPendingCount() {
    return getPendingQueue().then(function (items) { return items.length; });
  }

  // ── Offline project registry ───────────────────────────────────────────────
  function enableProjectOffline(projectId) {
    return put("offline_projects", {
      project_id: projectId,
      enabled_at: new Date().toISOString(),
      last_synced: null,
      sync_status: "idle"
    });
  }

  function disableProjectOffline(projectId) {
    return del("offline_projects", projectId);
  }

  function getOfflineProjects() {
    return getAll("offline_projects");
  }

  function isProjectOffline(projectId) {
    return get("offline_projects", projectId).then(function (r) { return !!r; });
  }

  function updateProjectSyncStatus(projectId, status, lastSynced) {
    return get("offline_projects", projectId).then(function (rec) {
      if (!rec) return;
      rec.sync_status = status;
      if (lastSynced) rec.last_synced = lastSynced;
      return put("offline_projects", rec);
    });
  }

  // ── Snapshot: copy Supabase data into IndexedDB for a project ──────────────
  function snapshotProject(projectId, projectData, blocks, relatedNotes, relatedHabits) {
    return openDB().then(function (d) {
      var tx = d.transaction(["projects", "notes", "habits"], "readwrite");
      var promises = [];
      if (projectData) {
        projectData.offline_enabled = true;
        promises.push(tx.objectStore("projects").put(projectData));
      }
      (blocks || []).forEach(function (b) { promises.push(tx.objectStore("projects").put(b)); });
      (relatedNotes || []).forEach(function (n) { promises.push(tx.objectStore("notes").put(n)); });
      (relatedHabits || []).forEach(function (h) { promises.push(tx.objectStore("habits").put(h)); });
      return Promise.all(promises.concat([tx.done]));
    }).then(function () {
      return updateProjectSyncStatus(projectId, "synced", new Date().toISOString());
    });
  }

  // ── Reflection (always local) ──────────────────────────────────────────────
  function saveReflection(date, text) {
    return put("reflections", { date: date, text: text, updated_at: new Date().toISOString() });
  }

  function getReflection(date) {
    return get("reflections", date);
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  function getSetting(key) { return get("settings", key).then(function (r) { return r ? r.value : null; }); }
  function setSetting(key, value) { return put("settings", { key: key, value: value }); }

  // ── Full sync flush ───────────────────────────────────────────────────────
  // Call this when online. Flushes the queue to Supabase one item at a time.
  function flush(supabaseClient) {
    if (!navigator.onLine) return Promise.resolve({ flushed: 0, failed: 0 });
    return getPendingQueue().then(function (items) {
      var flushed = 0, failed = 0;
      return items.reduce(function (chain, item) {
        return chain.then(function () {
          var op;
          if (item.type === "upsert") {
            op = supabaseClient.from(item.table).upsert(item.payload, { onConflict: "id" });
          } else if (item.type === "delete") {
            op = supabaseClient.from(item.table).delete().eq("id", item.id);
          } else {
            return markSynced(item.queue_id).then(function () { flushed++; });
          }
          return op.then(function (res) {
            if (res.error) {
              console.warn("Axis sync: failed to sync item", item.table, res.error.message);
              failed++;
              return markFailed(item.queue_id, res.error.message);
            }
            flushed++;
            return markSynced(item.queue_id);
          }).catch(function (err) {
            failed++;
            return markFailed(item.queue_id, err.message);
          });
        });
      }, Promise.resolve()).then(function () { return { flushed: flushed, failed: failed }; });
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    open: openDB,
    put: put, get: get, getAll: getAll, del: del, clearStore: clearStore,
    enqueue: enqueue, getPendingQueue: getPendingQueue, getPendingCount: getPendingCount,
    flush: flush,
    enableProjectOffline: enableProjectOffline,
    disableProjectOffline: disableProjectOffline,
    getOfflineProjects: getOfflineProjects,
    isProjectOffline: isProjectOffline,
    updateProjectSyncStatus: updateProjectSyncStatus,
    snapshotProject: snapshotProject,
    saveReflection: saveReflection, getReflection: getReflection,
    getSetting: getSetting, setSetting: setSetting
  };
})();
