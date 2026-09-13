(function () {
  "use strict";

  var STORAGE_KEY = "parkplatzwette_entries_v1";
  var ZONES_KEY = "parkplatzwette_zonen_v1";
  var SETTINGS_KEY = "parkplatzwette_settings_v1";
  var currencyFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

  function formatCurrency(value) {
    return currencyFmt.format(value);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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

  function loadZones() {
    try {
      var raw = localStorage.getItem(ZONES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Konnte Zonen nicht laden", e);
      return [];
    }
  }

  function saveZones(zones) {
    localStorage.setItem(ZONES_KEY, JSON.stringify(zones));
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return {
        gebuehrFix: typeof parsed.gebuehrFix === "number" ? parsed.gebuehrFix : 0,
        gebuehrProzent: typeof parsed.gebuehrProzent === "number" ? parsed.gebuehrProzent : 0
      };
    } catch (e) {
      console.error("Konnte Einstellungen nicht laden", e);
      return { gebuehrFix: 0, gebuehrProzent: 0 };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  var entries = loadEntries();
  var zones = loadZones();
  var settings = loadSettings();

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
    entry.eingezahlt = false;
    saveEntries(entries);
    render();
  }

  function toggleEingezahlt(id) {
    var entry = entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    entry.eingezahlt = !entry.eingezahlt;
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
    entry.eingezahlt = false;
    saveEntries(entries);
    render();
  }

  function deleteEntry(id) {
    if (!confirm("Diese Wette wirklich löschen?")) return;
    entries = entries.filter(function (e) { return e.id !== id; });
    saveEntries(entries);
    render();
  }

  function addZone(name, preis, withLocation) {
    var zone = { id: makeId(), name: name, preis: preis, lat: null, lng: null };
    zones.push(zone);
    saveZones(zones);
    renderZones();
    renderZoneSelect();
    if (withLocation) captureZoneLocation(zone.id);
  }

  function deleteZone(id) {
    if (!confirm("Diese Zone wirklich löschen?")) return;
    zones = zones.filter(function (z) { return z.id !== id; });
    saveZones(zones);
    renderZones();
    renderZoneSelect();
  }

  function captureZoneLocation(id) {
    if (!("geolocation" in navigator)) {
      alert("Standortzugriff wird von diesem Browser nicht unterstützt.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var zone = zones.find(function (z) { return z.id === id; });
        if (!zone) return;
        zone.lat = pos.coords.latitude;
        zone.lng = pos.coords.longitude;
        saveZones(zones);
        renderZones();
      },
      function (err) {
        alert("Standort konnte nicht ermittelt werden: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function findNearestZone(lat, lng) {
    var withCoords = zones.filter(function (z) { return typeof z.lat === "number" && typeof z.lng === "number"; });
    if (withCoords.length === 0) return null;
    var nearest = null;
    var minDist = Infinity;
    withCoords.forEach(function (z) {
      var d = haversineMeters(lat, lng, z.lat, z.lng);
      if (d < minDist) {
        minDist = d;
        nearest = z;
      }
    });
    return { zone: nearest, distance: minDist };
  }

  function computePrice(zone, minutes) {
    var stunden = minutes / 60;
    var tarif = zone.preis * stunden;
    var gebuehr = settings.gebuehrFix + tarif * (settings.gebuehrProzent / 100);
    return tarif + gebuehr;
  }

  function computeSummary() {
    var gespart = 0;
    var bussgelder = 0;
    var eingezahlt = 0;
    var ausstehend = 0;
    var gewonnenCount = 0;
    var verlorenCount = 0;
    entries.forEach(function (e) {
      if (e.status === "gewonnen") {
        gespart += e.einsatz;
        gewonnenCount++;
        if (e.eingezahlt) {
          eingezahlt += e.einsatz;
        } else {
          ausstehend += e.einsatz;
        }
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
      resolvedCount: resolvedCount,
      eingezahlt: eingezahlt,
      ausstehend: ausstehend
    };
  }

  function renderSummary() {
    var s = computeSummary();
    document.getElementById("stat-saved").textContent = formatCurrency(s.gespart);
    document.getElementById("stat-fines").textContent = formatCurrency(s.bussgelder);
    document.getElementById("stat-bilanz").textContent = formatCurrency(s.bilanz);
    document.getElementById("stat-quote").textContent = s.quote === null ? "–" : s.quote + " %";
    document.getElementById("stat-eingezahlt").textContent = formatCurrency(s.eingezahlt);
    document.getElementById("stat-ausstehend").textContent = formatCurrency(s.ausstehend);

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
      var eingezahltButton = won
        ? '<button class="btn-deposit ' + (e.eingezahlt ? "is-deposited" : "") + '" data-action="toggle-eingezahlt" data-id="' + e.id + '">' +
            (e.eingezahlt ? "💰 Eingezahlt" : "○ Noch nicht eingezahlt") +
          '</button>'
        : "";

      return (
        '<div class="entry ' + (won ? "entry--won" : "entry--lost") + '" data-id="' + e.id + '">' +
          '<div class="entry-top">' +
            '<span class="entry-date">' + formatDate(e.datum) + '</span>' +
            '<span class="entry-result ' + resultClass + '">' + resultText + '</span>' +
          '</div>' +
          '<div class="entry-amounts">' + amountsText + '</div>' +
          eingezahltButton +
          '<div class="entry-actions">' +
            '<button class="btn-ghost" data-action="reopen" data-id="' + e.id + '">↺</button>' +
            '<button class="btn-ghost" data-action="delete" data-id="' + e.id + '">🗑</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderZones() {
    var container = document.getElementById("zone-list");
    if (!container) return;
    if (zones.length === 0) {
      container.innerHTML = '<div class="empty-hint">Noch keine Zonen gespeichert.</div>';
      return;
    }
    container.innerHTML = zones.map(function (z) {
      var hasLocation = typeof z.lat === "number" && typeof z.lng === "number";
      return (
        '<div class="zone-item" data-id="' + z.id + '">' +
          '<div class="zone-info">' +
            '<span class="zone-name">' + escapeHtml(z.name) + '</span>' +
            '<span class="zone-price">' + formatCurrency(z.preis) + '/Std' + (hasLocation ? ' · 📍' : '') + '</span>' +
          '</div>' +
          '<button type="button" class="btn-ghost" data-action="delete-zone" data-id="' + z.id + '">🗑</button>' +
        '</div>'
      );
    }).join("");
  }

  function renderZoneSelect() {
    var select = document.getElementById("select-zone");
    if (!select) return;
    var current = select.value;
    if (zones.length === 0) {
      select.innerHTML = '<option value="">Keine Zonen gespeichert</option>';
      select.disabled = true;
    } else {
      select.disabled = false;
      select.innerHTML = zones.map(function (z) {
        return '<option value="' + z.id + '">' + escapeHtml(z.name) + ' (' + formatCurrency(z.preis) + '/Std)</option>';
      }).join("");
      if (zones.some(function (z) { return z.id === current; })) select.value = current;
    }
    updateCalcResult();
  }

  function updateCalcResult() {
    var select = document.getElementById("select-zone");
    var dauerInput = document.getElementById("input-dauer");
    var resultEl = document.getElementById("calc-result");
    if (!select || !dauerInput || !resultEl) return;
    var zone = zones.find(function (z) { return z.id === select.value; });
    var minutes = parseFloat(dauerInput.value);
    if (!zone || isNaN(minutes) || minutes <= 0) {
      resultEl.textContent = "—";
      return;
    }
    resultEl.textContent = formatCurrency(computePrice(zone, minutes));
  }

  function render() {
    renderSummary();
    renderOffen();
    renderVerlauf();
    renderZones();
    renderZoneSelect();
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
    } else if (action === "toggle-eingezahlt") {
      toggleEingezahlt(id);
    } else if (action === "reopen") {
      reopenEntry(id);
    } else if (action === "delete") {
      deleteEntry(id);
    }
  }

  function handleZoneListClick(evt) {
    var btn = evt.target.closest("button[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    if (action === "delete-zone") {
      deleteZone(id);
    }
  }

  function handleZoneFormSubmit(evt) {
    evt.preventDefault();
    var nameInput = document.getElementById("input-zone-name");
    var preisInput = document.getElementById("input-zone-preis");
    var standortCheckbox = document.getElementById("input-zone-standort");
    var name = nameInput.value.trim();
    var preis = parseFloat(preisInput.value.replace(",", "."));

    if (!name || isNaN(preis) || preis < 0) {
      alert("Bitte einen Namen und einen gültigen Preis pro Stunde eingeben.");
      return;
    }

    addZone(name, preis, standortCheckbox.checked);
    nameInput.value = "";
    preisInput.value = "";
  }

  function handleSettingsChange() {
    var fixInput = document.getElementById("input-gebuehr-fix");
    var prozentInput = document.getElementById("input-gebuehr-prozent");
    var fix = parseFloat(fixInput.value.replace(",", "."));
    var prozent = parseFloat(prozentInput.value.replace(",", "."));
    settings.gebuehrFix = isNaN(fix) ? 0 : fix;
    settings.gebuehrProzent = isNaN(prozent) ? 0 : prozent;
    saveSettings(settings);
    updateCalcResult();
  }

  function handleToggleCalc() {
    var panel = document.getElementById("calc-panel");
    var btn = document.getElementById("btn-toggle-calc");
    if (!panel || !btn) return;
    panel.hidden = !panel.hidden;
    btn.textContent = panel.hidden ? "🧮 Preis berechnen" : "🧮 Preisrechner ausblenden";
    if (!panel.hidden) updateCalcResult();
  }

  function handleUseLocation() {
    var suggestionEl = document.getElementById("location-suggestion");
    if (!suggestionEl) return;
    if (!("geolocation" in navigator)) {
      suggestionEl.textContent = "Standortzugriff wird von diesem Browser nicht unterstützt.";
      return;
    }
    suggestionEl.textContent = "Standort wird ermittelt …";
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var match = findNearestZone(pos.coords.latitude, pos.coords.longitude);
        if (!match) {
          suggestionEl.textContent = "Keine gespeicherte Zone mit Standort in der Nähe gefunden.";
          return;
        }
        var select = document.getElementById("select-zone");
        if (select) select.value = match.zone.id;
        suggestionEl.textContent =
          "Vorschlag: " + match.zone.name + " (" + Math.round(match.distance) + " m entfernt)";
        updateCalcResult();
      },
      function (err) {
        suggestionEl.textContent = "Standort konnte nicht ermittelt werden: " + err.message;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function handleApplyCalc() {
    var select = document.getElementById("select-zone");
    var dauerInput = document.getElementById("input-dauer");
    var einsatzInput = document.getElementById("input-einsatz");
    var zone = zones.find(function (z) { return z.id === select.value; });
    var minutes = parseFloat(dauerInput.value);
    if (!zone || isNaN(minutes) || minutes <= 0) {
      alert("Bitte eine Zone und eine gültige Parkdauer wählen.");
      return;
    }
    einsatzInput.value = computePrice(zone, minutes).toFixed(2);
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

    document.getElementById("input-gebuehr-fix").value = settings.gebuehrFix || "";
    document.getElementById("input-gebuehr-prozent").value = settings.gebuehrProzent || "";
    document.getElementById("input-gebuehr-fix").addEventListener("change", handleSettingsChange);
    document.getElementById("input-gebuehr-prozent").addEventListener("change", handleSettingsChange);
    document.getElementById("zone-list").addEventListener("click", handleZoneListClick);
    document.getElementById("form-neue-zone").addEventListener("submit", handleZoneFormSubmit);
    document.getElementById("btn-toggle-calc").addEventListener("click", handleToggleCalc);
    document.getElementById("btn-use-location").addEventListener("click", handleUseLocation);
    document.getElementById("btn-apply-calc").addEventListener("click", handleApplyCalc);
    document.getElementById("select-zone").addEventListener("change", updateCalcResult);
    document.getElementById("input-dauer").addEventListener("input", updateCalcResult);

    render();

    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
      navigator.serviceWorker.register("sw.js").catch(function () {
        // Offline-Installation ist optional, ohne SW funktioniert die App weiterhin.
      });
    }
  });
})();
