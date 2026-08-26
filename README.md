# Parkplatzwette 🅿️🎲

Eine kleine Web-App fürs Handy, um die persönliche „Parkplatzwette“ zu tracken:
Du parkst ohne Parkschein, schaust bei EasyPark nach, was der Parkschein
gekostet hätte, brichst die Buchung aber ab. Am Ende des Tages trägst du ein,
ob die Wette aufgegangen ist (kein Strafzettel) oder ob ein Bußgeld fällig
wurde. Die App summiert automatisch, wie viel du dadurch insgesamt gespart
hast und rechnet das gegen die gezahlten Bußgelder gegen.

Kein Server, kein Login – alles läuft direkt im Browser und die Daten
bleiben ausschließlich auf deinem Gerät.

## Benutzung

1. **Neue Wette starten**: Wenn du parkst, öffne die App, gib den in
   EasyPark angezeigten voraussichtlichen Preis ein (die Buchung selbst
   brichst du ja ab) und speichere die Wette. Sie erscheint unter
   „Offene Wetten“.
2. **Wette auflösen**: Wenn du zum Auto zurückkommst (oder spätestens am
   Ende des Tages) und keinen Zettel an der Scheibe hattest, tippe auf
   „✅ Erfolg“. Falls doch ein Bußgeld fällig wurde, tippe auf
   „❌ Bußgeld“ und trage den Betrag ein.
3. **Bilanz im Blick**: Oben siehst du jederzeit die Summe der gesparten
   Beträge, die Summe der Bußgelder, die daraus resultierende Nettobilanz
   sowie deine Erfolgsquote.
4. **Einzahlung tracken**: Bei jeder gewonnenen Wette erscheint im Verlauf
   ein Button „○ Noch nicht eingezahlt“. Sobald du das gesparte Geld
   tatsächlich auf dein Sparkonto o. Ä. überwiesen hast, tippe darauf –
   er wechselt zu „💰 Eingezahlt“. Oben zeigen „Bereits eingezahlt“ und
   „Noch einzuzahlen“ den Stand.
5. Einträge im Verlauf lassen sich per ↺ wieder öffnen (z. B. bei
   Fehleingaben) oder per 🗑 löschen.

## Nutzung auf dem Handy

Die App ist eine installierbare Progressive Web App (PWA):

- **Direkt öffnen**: `index.html` lässt sich auch offline im Browser
  öffnen – Eingaben und Bilanz funktionieren dann sofort per lokalem
  Speicher (`localStorage`).
- **Als App installieren** (empfohlen für vollen Offline-Betrieb inkl.
  Service Worker): Die Seite über GitHub Pages hosten (Settings → Pages →
  Deploy from branch, z. B. `main` / `/root`) und auf dem Handy im Browser
  öffnen. Dort dann:
  - **iPhone (Safari)**: Teilen-Symbol → „Zum Home-Bildschirm“.
  - **Android (Chrome)**: Menü (⋮) → „App installieren“ bzw.
    „Zum Startbildschirm hinzufügen“.

## Daten & Backup

Alle Wetten werden nur lokal im Browser gespeichert (`localStorage`) –
es gibt keine Cloud-Synchronisation. Über die Buttons „Sichern“ und
„Wiederherstellen“ am Ende der Seite kannst du die Daten als JSON-Datei
exportieren bzw. eine Sicherung wieder einspielen (z. B. beim Wechsel des
Geräts oder Browsers).

## Dateien

- `index.html` – Struktur der App
- `style.css` – Mobile-first-Layout, hell/dunkel automatisch
- `app.js` – Logik (Speichern, Bilanz berechnen, Rendering)
- `manifest.json` / `sw.js` / `icon.svg` – PWA-Installierbarkeit &
  Offline-Cache
