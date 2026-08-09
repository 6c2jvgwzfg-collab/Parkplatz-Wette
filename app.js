(function () {
  "use strict";

  var STORAGE_KEY = "parkplatzwette_entries_v1";
  var currencyFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

  function formatCurrency(value) {
    return currencyFmt.format(value);
  }

  function formatDate(isoDate) {
    var parts = isoDate.split("-");
    if (parts.length !== 3) return isoDate;
    return parts[2] + "." + parts[1] + "." + parts[0];
  }

  function todayIso() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function loadEntries() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Konnte Daten nicht laden", e);
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  var entries = loadEntries();

  function addEntry(datum, einsatz) {
    entries.push({
      id: makeId(),
      datum: datum,
      einsatz: einsatz,
      status: "offen",
      bussgeld: null,
      createdAt: Date.now()
    });
    saveEntries(entries);
    render();
  }

  function resolveWon(id) {
    var entry = entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    entry.status = "gewonnen";
    entry.bussgeld = null;
    saveEntries(entries);
    render();
  }

  function resolveLost(id, bussgeld) {
    var entry = entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    entry.status = "verloren";
    entry.bussgeld = bussgeld;
    saveEntries(entries);
    render();
  }

  function reopenEntry(id) {
    var entry = entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    entry.status = "offen";
    entry.bussgeld = null;
    saveEntries(entries);
    render();
  }

  function deleteEntry(id) {
    if (!confirm("Diese Wette wirklich löschen?")) return;
    entries = entries.filter(function (e) { return e.id !== id; });
    saveEntries(entries);
    render();
  }

  function computeSummary() {
    var gespart = 0;
    var bussgelder = 0;
    var gewonnenCount = 0;
    var verlorenCount = 0;
    entries.forEach(function (e) {
      if (e.status === "gewonnen") {
        gespart += e.einsatz;
        gewonnenCount++;
      } else if (e.status === "verloren") {
        bussgelder += e.bussgeld || 0;
        verlorenCount++;
      }
    });
    var resolvedCount = gewonnenCount + verlorenCount;
    var quote = resolvedCount > 0 ? Math.round((gewonnenCount / resolvedCount) * 100) : null;
    return {
      gespart: gespart,
      bussgelder: bussgelder,
      bilanz: gespart - bussgelder,
      quote: quote,
      resolvedCount: resolvedCount
    };
  }

  function renderSummary() {
    var s = computeSummary();
    document.getElementById("stat-saved").textContent = formatCurrency(s.gespart);
    document.getElementById("stat-fines").textContent = formatCurrency(s.bussgelder);
    document.getElementById("stat-bilanz").textContent = formatCurrency(s.bilanz);
    document.getElementById("stat-quote").textContent = s.quote === null ? "–" : s.quote + " %";

    var bilanzCard = document.getElementById("stat-bilanz-card");
    bilanzCard.classList.remove("positive", "negative");
    if (s.bilanz > 0) bilanzCard.classList.add("positive");
    if (s.bilanz < 0) bilanzCard.classList.add("negative");
  }

  function entrySortAsc(a, b) {
    if (a.datum !== b.datum) return a.datum < b.datum ? -1 : 1;
    return a.createdAt - b.createdAt;
  }

  function entrySortDesc(a, b) {
    if (a.datum !== b.datum) return a.datum > b.datum ? -1 : 1;
    return b.createdAt - a.createdAt;
  }

  function renderOffen() {
    var container = document.getElementById("list-offen");
    var offen = entries.filter(function (e) { return e.status === "offen"; }).sort(entrySortAsc);

    if (offen.length === 0) {
      container.innerHTML = '<div class="empty-hint">Keine offenen Wetten. Parkst du gerade schwarz? 😉</div>';
      return;
    }

    container.innerHTML = offen.map(function (e) {
      return (
        '<div class="entry entry--open" data-id="' + e.id + '">' +
          '<div class="entry-top">' +
            '<span class="entry-date">' + formatDate(e.datum) + '</span>' +
          '</div>' +
          '<div class="entry-amounts">Einsatz: ' + formatCurrency(e.einsatz) + '</div>' +
          '<div class="entry-actions">' +
            '<button class="btn-success" data-action="won" data-id="' + e.id + '">✅ Erfolg</button>' +
            '<button class="btn-danger" data-action="lost-toggle" data-id="' + e.id + '">❌ Bußgeld</button>' +
          '</div>' +
          '<div class="bussgeld-inline" id="bussgeld-inline-' + e.id + '">' +
            '<input type="number" inputmode="decimal" step="0.01" min="0" placeholder="Bußgeld in €" id="bussgeld-input-' + e.id + '" />' +
            '<button class="btn-danger" data-action="lost-confirm" data-id="' + e.id + '">Bestätigen</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderVerlauf() {
    var container = document.getElementById("list-verlauf");
    var verlauf = entries.filter(function (e) { return e.status !== "offen"; }).sort(entrySortDesc);

    if (verlauf.length === 0) {
      container.innerHTML = '<div class="empty-hint">Noch keine abgeschlossenen Wetten.</div>';
      return;
    }

    container.innerHTML = verlauf.map(function (e) {
      var won = e.status === "gewonnen";
      var resultClass = won ? "positive" : "negative";
      var resultText = won
        ? "+" + formatCurrency(e.einsatz)
        : "-" + formatCurrency(e.bussgeld || 0);
      var amountsText = won
        ? "Einsatz: " + formatCurrency(e.einsatz)
        : "Einsatz: " + formatCurrency(e.einsatz) + " · Bußgeld: " + formatCurrency(e.bussgeld || 0);

      return (
        '<div class="entry ' + (won ? "entry--won" : "entry--lost") + '" data-id="' + e.id + '">' +
          '<div class="entry-top">' +
            '<span class="entry-date">' + formatDate(e.datum) + '</span>' +
            '<span class="entry-result ' + resultClass + '">' + resultText + '</span>' +
          '</div>' +
          '<div class="entry-amounts">' + amountsText + '</div>' +
          '<div class="entry-actions">' +
            '<button class="btn-ghost" data-action="reopen" data-id="' + e.id + '">↺</button>' +
            '<button class="btn-ghost" data-action="delete" data-id="' + e.id + '">🗑</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function render() {
    renderSummary();
    renderOffen();
    renderVerlauf();
  }

  function handleListClick(evt) {
    var btn = evt.target.closest("button[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");

    if (action === "won") {
      resolveWon(id);
    } else if (action === "lost-toggle") {
      var inline = document.getElementById("bussgeld-inline-" + id);
      if (inline) {
        inline.classList.add("visible");
        var input = document.getElementById("bussgeld-input-" + id);
        if (input) input.focus();
      }
    } else if (action === "lost-confirm") {
      var bussgeldInput = document.getElementById("bussgeld-input-" + id);
      var value = bussgeldInput ? parseFloat(bussgeldInput.value.replace(",", ".")) : NaN;
      if (isNaN(value) || value < 0) {
        alert("Bitte einen gültigen Bußgeld-Betrag eingeben.");
        return;
      }
      resolveLost(id, value);
    } else if (action === "reopen") {
      reopenEntry(id);
    } else if (action === "delete") {
      deleteEntry(id);
    }
  }

  function handleFormSubmit(evt) {
    evt.preventDefault();
    var datumInput = document.getElementById("input-datum");
    var einsatzInput = document.getElementById("input-einsatz");
    var einsatz = parseFloat(einsatzInput.value.replace(",", "."));

    if (!datumInput.value || isNaN(einsatz) || einsatz < 0) {
      alert("Bitte Datum und einen gültigen Preis eingeben.");
      return;
    }

    addEntry(datumInput.value, einsatz);
    einsatzInput.value = "";
    datumInput.value = todayIso();
    einsatzInput.focus();
  }

  function handleExport() {
    var blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "parkplatzwette-backup-" + todayIso() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImportFile(evt) {
    var file = evt.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error("Ungültiges Format");
        var existingIds = new Set(entries.map(function (e) { return e.id; }));
        var added = 0;
        imported.forEach(function (e) {
          if (e && e.id && !existingIds.has(e.id)) {
            entries.push(e);
            added++;
          }
        });
        saveEntries(entries);
        render();
        alert(added + " Wette(n) importiert.");
      } catch (err) {
        alert("Import fehlgeschlagen: Datei ist keine gültige Sicherung.");
      }
      evt.target.value = "";
    };
    reader.readAsText(file);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("input-datum").value = todayIso();
    document.getElementById("form-neue-wette").addEventListener("submit", handleFormSubmit);
    document.getElementById("list-offen").addEventListener("click", handleListClick);
    document.getElementById("list-verlauf").addEventListener("click", handleListClick);
    document.getElementById("btn-export").addEventListener("click", handleExport);
    document.getElementById("btn-import").addEventListener("click", function () {
      document.getElementById("input-import").click();
    });
    document.getElementById("input-import").addEventListener("change", handleImportFile);

    render();

    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
      navigator.serviceWorker.register("sw.js").catch(function () {
        // Offline-Installation ist optional, ohne SW funktioniert die App weiterhin.
      });
    }
  });
})();
