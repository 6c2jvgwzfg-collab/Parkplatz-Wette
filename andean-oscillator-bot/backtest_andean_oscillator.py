"""
Backtesting-Skript: Andean Oscillator Scalping Strategie
Markt: BTC/USDT | Zeitrahmen: 5 Minuten | Zeitraum: letzte 30 Tage

Diese Datei ist komplett eigenstaendig. Sie laedt historische Kursdaten
per ccxt von einer Boerse, berechnet den Andean Oscillator und den ADX(14)
selbst (keine externen Trading-Frameworks), erzeugt Long-/Short-Signale
und simuliert die Trades mit festem Stop-Loss (1%) und Take-Profit (1.5%).

Am Ende wird eine Statistik ausgegeben (Anzahl Trades, Win-Rate,
Gesamtgewinn/-verlust) und alle Einzeltrades werden zusaetzlich in
"backtest_trades.csv" gespeichert.

--------------------------------------------------------------------
SICHERHEITSHINWEISE FUER DEN SPAETEREN LIVE-/PAPER-TRADING-BOT
--------------------------------------------------------------------
Dieses Skript ist NUR ein Backtest (keine echten Orders, keine API-Keys
noetig). Sobald daraus ein Bot wird, der wirklich Orders an eine Boerse
schickt, MUESSEN zusaetzlich folgende Punkte umgesetzt werden:

1) API-Schluessel-Absicherung (Einstellung auf der Boersen-Webseite,
   NICHT im Code): Beim Erstellen des API-Keys nur "Read" und "Trade"
   aktivieren, "Withdraw" (Auszahlung) IMMER deaktiviert lassen.
   Zusaetzlich IP-Whitelisting auf die feste IP-Adresse des Servers
   einschraenken, auf dem der Bot laeuft.

2) Risikomanagement im Code: fester Stop-Loss/Take-Profit (siehe unten)
   UND striktes, risikobasiertes Position Sizing (siehe RISIKO_PRO_TRADE_PCT).

3) Technische Absicherung: Circuit Breaker bei mehreren Verlusten in
   Folge (siehe MAX_VERLUSTE_IN_FOLGE) sowie - im Live-Betrieb - eine
   Ueberwachung der Boersenverbindung, die den Bot bei Verbindungsabbruch
   sofort stoppt und offene Positionen schliesst.

Punkte 2 und 3 sind unten bereits in die Backtest-Logik eingebaut, damit
du ihre Wirkung schon jetzt siehst. Punkt 1 betrifft die Kontoeinstellungen
bei der Boerse und kommt erst in der Live-/Paper-Trading-Version dran.
"""

import ccxt
import numpy as np
import pandas as pd

# ============================================================
# EINSTELLUNGEN (hier kannst du alles anpassen)
# ============================================================
EXCHANGE_ID = "binance"        # Boerse fuer historische Daten (z.B. "binance", "kraken", "bybit")
SYMBOL = "BTC/USDT"            # Handelspaar
TIMEFRAME = "5m"               # Zeitrahmen der Kerzen
DAYS_BACK = 30                 # Anzahl Tage in die Vergangenheit

ANDEAN_LENGTH = 50              # Glaettungslaenge des Andean Oscillator
ANDEAN_SIGNAL_LENGTH = 9        # Laenge der Signal-Linie (EMA)
ADX_LENGTH = 14                 # Laenge des ADX (Trendstaerke-Filter)
ADX_SCHWELLE = 20               # Mindest-Trendstaerke fuer einen Einstieg

STOP_LOSS_PCT = 0.01             # 1% Stop-Loss vom Einstiegskurs
TAKE_PROFIT_PCT = 0.015          # 1.5% Take-Profit vom Einstiegskurs (CRV 1:1.5)
GEBUEHR_PCT = 0.001               # 0.1% Handelsgebuehr pro Order (Kauf und Verkauf je einmal)

STARTKAPITAL = 1000.0             # nur zur Veranschaulichung der Kapitalkurve
RISIKO_PRO_TRADE_PCT = 0.01       # Risikomanagement: max. 1% des Kapitals darf pro Trade verloren gehen
MAX_VERLUSTE_IN_FOLGE = 3         # Circuit Breaker: Bot stoppt nach so vielen Verlusten in Folge


# ============================================================
# 1. HISTORISCHE DATEN LADEN
# ============================================================
def lade_historische_daten(exchange_id, symbol, timeframe, days_back):
    """Laedt OHLCV-Kerzendaten per ccxt, mit Pagination fuer laengere Zeitraeume."""
    print(f"Lade historische Daten von '{exchange_id}' fuer {symbol} ({timeframe}, {days_back} Tage)...")

    exchange_klasse = getattr(ccxt, exchange_id)
    exchange = exchange_klasse({"enableRateLimit": True})

    timeframe_ms = exchange.parse_timeframe(timeframe) * 1000
    since = exchange.milliseconds() - days_back * 24 * 60 * 60 * 1000

    alle_kerzen = []
    while True:
        kerzen = exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=since, limit=1000)
        if not kerzen:
            break
        alle_kerzen += kerzen
        letzter_zeitstempel = kerzen[-1][0]
        since = letzter_zeitstempel + timeframe_ms
        if since >= exchange.milliseconds():
            break

    if not alle_kerzen:
        raise RuntimeError("Es konnten keine Kursdaten geladen werden. Bitte Symbol/Boerse pruefen.")

    df = pd.DataFrame(alle_kerzen, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df.drop_duplicates(subset="timestamp", inplace=True)
    df.sort_values("timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)

    print(f"{len(df)} Kerzen geladen. Zeitraum: {df['timestamp'].iloc[0]} bis {df['timestamp'].iloc[-1]}")
    return df


# ============================================================
# 2. ANDEAN OSCILLATOR (Bull-, Bear- und Signal-Linie)
# ============================================================
def berechne_andean_oscillator(df, length, sig_length):
    """
    Berechnet den Andean Oscillator komplett von Hand.

    Idee: Es werden zwei rekursiv geglaettete "Huellkurven" des Preises
    verfolgt - eine obere ("up") und eine untere ("dn") - jeweils fuer
    den Preis selbst und fuer den Preis zum Quadrat. Aus der Differenz
    zwischen dem quadrierten Mittelwert und dem quadrierten Wert der
    Huellkurve ergibt sich eine Art gleitende Standardabweichung, die
    als Bull- bzw. Bear-Linie verwendet wird.
    """
    close = df["close"].to_numpy(dtype=float)
    n = len(close)
    alpha = 2.0 / (length + 1)

    up1 = np.zeros(n)
    up2 = np.zeros(n)
    dn1 = np.zeros(n)
    dn2 = np.zeros(n)

    up1[0] = close[0]
    up2[0] = close[0] ** 2
    dn1[0] = close[0]
    dn2[0] = close[0] ** 2

    for i in range(1, n):
        preis = close[i]
        preis_quadrat = preis ** 2

        up1[i] = max(preis, up1[i - 1] - (up1[i - 1] - preis) * alpha)
        up2[i] = max(preis_quadrat, up2[i - 1] - (up2[i - 1] - preis_quadrat) * alpha)

        dn1[i] = min(preis, dn1[i - 1] + (preis - dn1[i - 1]) * alpha)
        dn2[i] = min(preis_quadrat, dn2[i - 1] + (preis_quadrat - dn2[i - 1]) * alpha)

    bear = np.sqrt(np.maximum(up2 - up1 ** 2, 0.0))
    bull = np.sqrt(np.maximum(dn2 - dn1 ** 2, 0.0))

    df["bull"] = bull
    df["bear"] = bear

    hoeherer_wert = np.where(bull > bear, bull, bear)
    df["signal"] = pd.Series(hoeherer_wert).ewm(span=sig_length, adjust=False).mean().to_numpy()

    return df


# ============================================================
# 3. ADX(14) - Trendstaerke-Filter
# ============================================================
def berechne_adx(df, length):
    """Berechnet den ADX nach der klassischen Wilder-Methode, komplett von Hand."""
    high = df["high"]
    low = df["low"]
    close = df["close"]

    vorheriger_high = high.shift(1)
    vorheriger_low = low.shift(1)
    vorheriger_close = close.shift(1)

    plus_bewegung = high - vorheriger_high
    minus_bewegung = vorheriger_low - low

    plus_dm = np.where((plus_bewegung > minus_bewegung) & (plus_bewegung > 0), plus_bewegung, 0.0)
    minus_dm = np.where((minus_bewegung > plus_bewegung) & (minus_bewegung > 0), minus_bewegung, 0.0)

    tr1 = high - low
    tr2 = (high - vorheriger_close).abs()
    tr3 = (low - vorheriger_close).abs()
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    # Wilder-Glaettung entspricht einem EWM mit alpha = 1/length
    atr = true_range.ewm(alpha=1 / length, adjust=False).mean()
    plus_di = 100 * pd.Series(plus_dm, index=df.index).ewm(alpha=1 / length, adjust=False).mean() / atr
    minus_di = 100 * pd.Series(minus_dm, index=df.index).ewm(alpha=1 / length, adjust=False).mean() / atr

    di_summe = (plus_di + minus_di).replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / di_summe
    adx = dx.ewm(alpha=1 / length, adjust=False).mean()

    df["adx"] = adx.fillna(0.0)
    return df


# ============================================================
# 4. EIN-/AUSSTIEGSSIGNALE ERZEUGEN
# ============================================================
def erzeuge_signale(df, adx_schwelle):
    bull_vorher = df["bull"].shift(1)
    bear_vorher = df["bear"].shift(1)
    signal_vorher = df["signal"].shift(1)

    bull_kreuzt_ueber_signal = (bull_vorher <= signal_vorher) & (df["bull"] > df["signal"])
    bear_kreuzt_ueber_signal = (bear_vorher <= signal_vorher) & (df["bear"] > df["signal"])

    df["long_einstieg"] = bull_kreuzt_ueber_signal & (df["bull"] > df["bear"]) & (df["adx"] > adx_schwelle)
    df["short_einstieg"] = bear_kreuzt_ueber_signal & (df["bear"] > df["bull"]) & (df["adx"] > adx_schwelle)

    df["long_einstieg"] = df["long_einstieg"].fillna(False)
    df["short_einstieg"] = df["short_einstieg"].fillna(False)

    return df


# ============================================================
# 5. BACKTEST-SIMULATION
# ============================================================
def backtest_durchfuehren(df, sl_pct, tp_pct, gebuehr_pct, startkapital,
                           risiko_pro_trade_pct, max_verluste_in_folge):
    """
    Simuliert die Trades chronologisch, Kerze fuer Kerze.
    Es ist immer nur eine Position gleichzeitig offen. Ein Stop-Loss
    oder Take-Profit gilt als getroffen, wenn das Hoch bzw. Tief der
    jeweiligen Kerze den Wert erreicht. Treffen SL und TP in derselben
    Kerze zu, wird zur vorsichtigen Betrachtung der Stop-Loss angenommen.

    Vereinfachung: Der Einstieg erfolgt zum Schlusskurs der Signal-Kerze.
    In der Realitaet wuerde der Einstieg erst auf der naechsten Kerze
    moeglich sein - das Ergebnis ist also eine leicht optimistische
    Naeherung.

    Risikomanagement:
    - Position Sizing: Die Positionsgroesse wird so berechnet, dass beim
      Treffen des Stop-Loss maximal "risiko_pro_trade_pct" des aktuellen
      Kapitals verloren geht (z.B. 1%), unabhaengig vom SL-Abstand in %.
    - Circuit Breaker: Nach "max_verluste_in_folge" Verlusten in Folge
      wird die Strategie fuer den Rest des Backtest-Zeitraums gestoppt,
      es werden keine neuen Trades mehr eroeffnet.
    """
    kapital = startkapital
    trades = []

    in_position = False
    richtung = None
    einstiegspreis = None
    einstiegszeit = None
    stop_loss = None
    take_profit = None
    einsatz = None

    verluste_in_folge = 0
    circuit_breaker_aktiv = False
    circuit_breaker_zeitpunkt = None

    for zeile in df.itertuples():
        if in_position:
            if richtung == "long":
                sl_getroffen = zeile.low <= stop_loss
                tp_getroffen = zeile.high >= take_profit
            else:
                sl_getroffen = zeile.high >= stop_loss
                tp_getroffen = zeile.low <= take_profit

            ausstiegspreis = None
            ergebnis = None

            if sl_getroffen:
                ausstiegspreis = stop_loss
                ergebnis = "Verlust"
            elif tp_getroffen:
                ausstiegspreis = take_profit
                ergebnis = "Gewinn"

            if ausstiegspreis is not None:
                if richtung == "long":
                    rendite_pct = (ausstiegspreis - einstiegspreis) / einstiegspreis
                else:
                    rendite_pct = (einstiegspreis - ausstiegspreis) / einstiegspreis

                rendite_pct -= 2 * gebuehr_pct  # Gebuehr fuer Einstieg und Ausstieg

                gewinn_verlust = einsatz * rendite_pct
                kapital += gewinn_verlust

                if ergebnis == "Verlust":
                    verluste_in_folge += 1
                else:
                    verluste_in_folge = 0

                trades.append({
                    "einstiegszeit": einstiegszeit,
                    "ausstiegszeit": zeile.timestamp,
                    "richtung": richtung,
                    "einstiegspreis": einstiegspreis,
                    "ausstiegspreis": ausstiegspreis,
                    "einsatz": einsatz,
                    "rendite_pct": rendite_pct * 100,
                    "gewinn_verlust": gewinn_verlust,
                    "kapital_danach": kapital,
                    "ergebnis": ergebnis,
                    "verluste_in_folge_danach": verluste_in_folge,
                })

                in_position = False
                richtung = None

                if verluste_in_folge >= max_verluste_in_folge:
                    circuit_breaker_aktiv = True
                    circuit_breaker_zeitpunkt = zeile.timestamp
                    break

        if not in_position:
            if zeile.long_einstieg or zeile.short_einstieg:
                # Risikobasiertes Position Sizing: Einsatz so waehlen,
                # dass ein Stop-Loss-Treffer (SL-Abstand plus Gebuehren
                # fuer Ein- und Ausstieg) genau risiko_pro_trade_pct des
                # aktuellen Kapitals kostet.
                risiko_betrag = kapital * risiko_pro_trade_pct
                verlust_pct_bei_sl = sl_pct + 2 * gebuehr_pct
                einsatz = risiko_betrag / verlust_pct_bei_sl
                einsatz = min(einsatz, kapital)  # nie mehr einsetzen als vorhanden ist

                if zeile.long_einstieg:
                    richtung = "long"
                    einstiegspreis = zeile.close
                    stop_loss = einstiegspreis * (1 - sl_pct)
                    take_profit = einstiegspreis * (1 + tp_pct)
                else:
                    richtung = "short"
                    einstiegspreis = zeile.close
                    stop_loss = einstiegspreis * (1 + sl_pct)
                    take_profit = einstiegspreis * (1 - tp_pct)

                einstiegszeit = zeile.timestamp
                in_position = True

    if circuit_breaker_aktiv:
        print(f"\n[CIRCUIT BREAKER] Nach {max_verluste_in_folge} Verlusten in Folge "
              f"wurde der Handel am {circuit_breaker_zeitpunkt} gestoppt.")

    return pd.DataFrame(trades), kapital, circuit_breaker_aktiv


# ============================================================
# 6. STATISTIK AUSGEBEN
# ============================================================
def zeige_statistik(trades_df, startkapital, endkapital, circuit_breaker_aktiv):
    print("\n" + "=" * 55)
    print("BACKTEST-ERGEBNIS: Andean Oscillator Scalping Strategie")
    print("=" * 55)

    anzahl_trades = len(trades_df)
    if anzahl_trades == 0:
        print("Im gewaehlten Zeitraum wurden keine Trades ausgeloest.")
        print("Tipp: Parameter (ANDEAN_LENGTH, ADX_SCHWELLE) oder Zeitraum anpassen.")
        return

    gewinn_trades = trades_df[trades_df["gewinn_verlust"] > 0]
    verlust_trades = trades_df[trades_df["gewinn_verlust"] <= 0]

    win_rate = len(gewinn_trades) / anzahl_trades * 100
    gesamt_gewinn_verlust = trades_df["gewinn_verlust"].sum()
    gesamt_rendite_pct = (endkapital - startkapital) / startkapital * 100

    durchschnitt_gewinn = gewinn_trades["gewinn_verlust"].mean() if len(gewinn_trades) > 0 else 0.0
    durchschnitt_verlust = verlust_trades["gewinn_verlust"].mean() if len(verlust_trades) > 0 else 0.0

    long_trades = trades_df[trades_df["richtung"] == "long"]
    short_trades = trades_df[trades_df["richtung"] == "short"]

    print(f"Anzahl Trades gesamt:        {anzahl_trades}")
    print(f"  davon Long-Trades:         {len(long_trades)}")
    print(f"  davon Short-Trades:        {len(short_trades)}")
    print(f"Gewinn-Trades:               {len(gewinn_trades)}")
    print(f"Verlust-Trades:              {len(verlust_trades)}")
    print(f"Win-Rate:                    {win_rate:.2f} %")
    print(f"Startkapital:                {startkapital:.2f} USDT")
    print(f"Endkapital:                  {endkapital:.2f} USDT")
    print(f"Gesamtgewinn/-verlust:       {gesamt_gewinn_verlust:.2f} USDT ({gesamt_rendite_pct:.2f} %)")
    print(f"Durchschnittlicher Gewinn:   {durchschnitt_gewinn:.2f} USDT")
    print(f"Durchschnittlicher Verlust:  {durchschnitt_verlust:.2f} USDT")
    if circuit_breaker_aktiv:
        print("Hinweis:                     Circuit Breaker hat den Handel vorzeitig gestoppt!")
    print("=" * 55)

    dateiname = "backtest_trades.csv"
    trades_df.to_csv(dateiname, index=False)
    print(f"\nAlle Einzeltrades wurden zusaetzlich in '{dateiname}' gespeichert.")


# ============================================================
# HAUPTPROGRAMM
# ============================================================
def main():
    df = lade_historische_daten(EXCHANGE_ID, SYMBOL, TIMEFRAME, DAYS_BACK)

    df = berechne_andean_oscillator(df, ANDEAN_LENGTH, ANDEAN_SIGNAL_LENGTH)
    df = berechne_adx(df, ADX_LENGTH)

    # Einschwingzeit der Indikatoren ueberspringen, damit die ersten
    # Signale nicht auf unfertigen Indikatorwerten basieren.
    einschwingzeit = max(ANDEAN_LENGTH, ADX_LENGTH) * 3
    df = df.iloc[einschwingzeit:].reset_index(drop=True)

    df = erzeuge_signale(df, ADX_SCHWELLE)

    trades_df, endkapital, circuit_breaker_aktiv = backtest_durchfuehren(
        df, STOP_LOSS_PCT, TAKE_PROFIT_PCT, GEBUEHR_PCT, STARTKAPITAL,
        RISIKO_PRO_TRADE_PCT, MAX_VERLUSTE_IN_FOLGE
    )

    zeige_statistik(trades_df, STARTKAPITAL, endkapital, circuit_breaker_aktiv)


if __name__ == "__main__":
    main()
