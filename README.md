# 1. WWS-Herren BeachCup

Eine offline nutzbare Web-App für ein Beachvolleyballturnier mit 12 Spielern, 6 Teams und zwei Gruppen.

## Start

Öffne `index.html` direkt im Browser. Es ist keine Installation und kein Server nötig.

## Kostenlos auf GitHub Pages hosten

Dieses Projekt ist eine reine statische Website. Es braucht fuer GitHub Pages keinen Build-Schritt, keinen Server und keinen kostenpflichtigen Dienst.

1. Repository zu GitHub pushen.
2. In GitHub unter `Settings` -> `Pages` als Source `GitHub Actions` auswaehlen.
3. Auf `main` pushen oder den Workflow `Deploy to GitHub Pages` manuell starten.
4. Die App wird aus dem Repository-Root veroeffentlicht.

## Funktionen

- Teilnehmer manuell erfassen
- Selbstanmeldung über einen gespeicherten Formular-Link
- Mehrere eigene Turniere pro Browserprofil verwalten
- Turniertitel und Logo pro Turnier anpassen
- Geteilte Online-Lobbys mit Supabase und Bearbeitungslink
- Zufällige Team- und Gruppenauslosung
- Teamnamen nach der Auslosung bearbeiten
- Gruppenphase mit Tabellen nach Siegen, Punktedifferenz, erzielten Punkten und direktem Vergleich
- Automatische KO-Phase mit Halbfinals, Platz 5, Platz 3 und Finale als Best-of-3
- Live-Spielplan mit aktuellem und nächstem Spiel
- Endplatzierung
- CSV-, PDF- und Backup-Export
- Druckansicht, Beamer-Modus und Dunkelmodus
- Speicherung im Local Storage

## Hinweise

Alle Daten bleiben lokal im Browser. Über `Backup exportieren` kann ein Turnierstand als JSON gespeichert und später wieder importiert werden.

## Speicherung pro Host

Beim ersten Öffnen erzeugt die App eine zufällige Host-ID und speichert sie dauerhaft im `localStorage` des aktuellen Browserprofils. Alle Turniere werden darunter getrennt gespeichert:

```json
{
  "hosts": {
    "<host-id>": {
      "tournaments": {
        "<tournament-id>": {}
      },
      "activeTournamentId": "..."
    }
  }
}
```

Die Daten sind pro Browserprofil bzw. Gerät lokal getrennt. GitHub Pages liefert nur statische Dateien aus und bietet ohne Backend keine gemeinsame Live-Synchronisation zwischen unterschiedlichen Geräten. Zwei Nutzer können daher parallel unabhängig Turniere hosten, sehen aber nicht automatisch die Daten des jeweils anderen.

Ältere Daten aus dem früheren globalen Speicher werden beim ersten Start in den Bereich des aktuellen Hosts migriert.

Der im Feld `Turniername` gespeicherte Name wird als sichtbarer Turniertitel und Browser-Titel verwendet. Pro Turnier kann außerdem ein alternatives Logo per Link oder Bilddatei gesetzt werden. Ohne eigenes Logo nutzt die App weiter das lokale Standardlogo `assets/wilde-wespen-logo.jpeg`.

## Shared Lobbies

Die App unterstützt zwei Modi:

- `Lokales Turnier`: bleibt vollständig im `localStorage` des aktuellen Browserprofils.
- `Shared Lobby`: wird in Supabase gespeichert, per Link geöffnet und per Supabase Realtime synchronisiert.

Der Share-Link sieht so aus:

```text
https://<github-pages-domain>/<projektname>/#lobby=<share_code>
```

Alte Links mit `?lobby=<share_code>` werden weiterhin gelesen und nach dem Oeffnen automatisch auf die neue Hash-Form umgestellt. Die Hash-Form ist fuer statische Hosts wie GitHub Pages robuster, weil sie keine Serverroute benoetigt.

Der Link ist ein Bearbeitungslink. Wer ihn erhält, kann die Lobby vollständig verändern, inklusive Teilnehmer, Ergebnisse, Einstellungen, Spielplan und Löschen. Teile ihn nur mit vertrauenswürdigen Personen.

### Supabase einrichten

1. Supabase-Projekt erstellen.
2. Unter Auth die Anonymous Sign-ins aktivieren. Ohne diese Einstellung kann kein Browser einer Lobby beitreten.
3. Die SQL-Migration `supabase/migrations/001_shared_tournaments.sql` im SQL Editor oder per Supabase CLI ausführen.
4. Realtime für die Tabelle `shared_tournaments` ist in der Migration enthalten.
5. `.env.example` als Orientierung nutzen:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Da diese App ohne Build-Schritt direkt über GitHub Pages laufen kann, trägt die statische Seite die öffentlichen Werte in `scripts/supabase-config.js` ein:

```js
window.WWS_SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT.supabase.co",
  anonKey: "YOUR_PUBLIC_SUPABASE_ANON_KEY",
};
```

Der Supabase Anon-Key ist öffentlich nutzbar. Niemals den Service-Role-Key in dieses Projekt, in GitHub Pages oder in den Browser schreiben.

### Supabase-Fehler beheben

GitHub Pages hostet nur HTML, CSS und JavaScript. Es fuehrt keine SQL-Migrationen in Supabase aus. Wenn beim Oeffnen eines Shared-Links diese Meldung erscheint:

```text
column reference "share_code" is ambiguous
```

dann laeuft in Supabase noch die alte Version der Funktion `join_shared_lobby`. Fuehre im Supabase SQL Editor den Inhalt von `supabase/migrations/002_fix_join_shared_lobby_ambiguity.sql` aus. Danach die Seite neu laden und den Shared-Link erneut im Inkognito-Fenster testen.

### Datenmodell und Zugriff

Die Shared-Lobby nutzt bewusst einen serialisierten Turnierzustand pro Lobby:

- `shared_tournaments`
  - `id`
  - `share_code`
  - `name`
  - `config`
  - `status`
  - `state`
  - `version`
  - `created_at`
  - `updated_at`
- `shared_lobby_members`
  - `id`
  - `tournament_id`
  - `user_id`
  - `joined_at`

`create_shared_lobby(...)` erstellt eine Lobby und trägt `auth.uid()` als Mitglied ein. `join_shared_lobby(share_code)` prüft den Bearbeitungslink und trägt den anonym angemeldeten Browser als Mitglied der passenden Lobby ein.

RLS erlaubt Lesen, Bearbeiten und Löschen nur für Turniere, bei denen `auth.uid()` Mitglied genau dieser `tournament_id` ist. Es gibt absichtlich keine Rollen: jedes Mitglied hat volle Bearbeitungsrechte.

### Lokales Turnier veröffentlichen

Bei lokalen Turnieren erscheint die Aktion `Lokales Turnier veröffentlichen`. Dabei wird eine Online-Kopie in Supabase erstellt. Das lokale Original bleibt unverändert erhalten.

### Akzeptanztests

Test A: Gemeinsame Bearbeitung

1. Browser A erstellt eine Shared Lobby `Turnier A` und kopiert Link A.
2. Browser B öffnet Link A.
3. Browser A fügt einen Teilnehmer hinzu.
4. Browser B sieht die Änderung ohne Neuladen.
5. Browser B trägt ein Ergebnis ein.
6. Browser A sieht die Änderung ohne Neuladen.
7. Browser B ändert Turniername, Logo oder Spielplan.

Test B: Zwei getrennte Shared Lobbies

1. Browser A erstellt `Turnier A` mit Link A.
2. Browser C erstellt `Turnier B` mit Link B.
3. Browser B öffnet Link A.
4. Browser D öffnet Link B.
5. Änderungen in Turnier A erscheinen nur bei A und B.
6. Änderungen in Turnier B erscheinen nur bei C und D.
7. Daten werden nicht vermischt, weil jede Abfrage und jedes Realtime-Abo nach `tournament_id` getrennt ist.

Test C: Lokale Turniere

1. Lokales Turnier erstellen.
2. Seite in einem anderen Browserprofil öffnen.
3. Das lokale Turnier ist dort nicht sichtbar.
4. Erst `Lokales Turnier veröffentlichen` erzeugt eine Shared Lobby und einen Share-Link.

## Test mit getrennten Browserprofilen

1. Öffne die Website in Browserprofil A und notiere die angezeigte Host-ID.
2. Lege dort ein Turnier an, füge Beispielspieler hinzu und benenne ein Team um.
3. Öffne dieselbe Website in Browserprofil B, einem privaten Fenster mit getrenntem Speicher oder einem anderen Browser.
4. Prüfe, dass eine andere Host-ID angezeigt wird und die Daten aus Profil A nicht sichtbar sind.
5. Lege in Profil B ein eigenes Turnier an und lade beide Profile neu.
6. Prüfe, dass jedes Profil weiterhin nur die eigenen Turniere sieht.

## Selbstanmeldung

Kostenlos und nur per Link klappt am einfachsten mit Google Forms:

1. Neues Formular erstellen.
2. Eine Pflichtfrage `Name` anlegen.
3. Bei den Einstellungen keine Anmeldung erzwingen.
4. Den Formularlink nur an die Spieler senden.
5. Angemeldete Spieler manuell in die Teilnehmerliste übernehmen.

Der Link ist nicht öffentlich gelistet, aber kein Passwortschutz. Wer den Link weitergeleitet bekommt, kann sich ebenfalls eintragen.
