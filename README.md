# Biber-Portal

Schülerinnen und Schüler melden sich mit ihrem **IServ-Konto (Single-Sign-On, OpenID Connect)** an, sehen ihre **Zugangsdaten für den Informatik-Biber** (Benutzername und Passwort, einzeln kopierbar) und kommen mit einem Klick zur **Anmeldung** bzw. zum **Schnupper-Biber**. Welche Weiterleitung im Vordergrund steht, ergibt sich automatisch aus den Wettbewerbsdaten oder wird manuell gesetzt.

## Funktionen

**Schüleransicht**
- Anmeldung nur über IServ; das IServ-Passwort sieht das Portal nie.
- Drei Schritte: Benutzername kopieren → Passwort kopieren (verdeckt, per Auge sichtbar) → „Zum Schnupper-Biber“ bzw. „Zum Wettbewerb anmelden“ (neuer Tab).
- Phasenkarte mit Countdown bis zu den Biberwochen und Zeitleiste; Zugangskarte druckbar.
- Ohne hinterlegte Daten erscheint ein freundlicher Hinweis an die Lehrkraft.

**Lehrkräfte** (Mitglieder der IServ-Gruppe „Lehrende“)
- Bereich **„Meine Gruppen.“**: alle eigenen IServ-Gruppen, zu denen Biber-Zugänge vorliegen.
- Pro Gruppe druckfertig als **Liste** (mit Spalte „Erhalten“) oder als **Karten zum Ausschneiden** (10 pro A4-Seite).
- Jeder Abruf wird im Protokoll der Verwaltung vermerkt.

**Verwaltung** (nur Accounts aus `ADMIN_ACCOUNTS`)
- Import des Biber-Exports als **CSV oder Excel (.xlsx)** mit zusätzlicher Spalte **`IServ`** (Accountname). Vorschau mit Prüfhinweisen, dann „Ergänzen“ oder „Ersetzen“.
- Tabelle mit Suche/Filter, Zuordnung per Accountname direkt nachtragen, Vorschau „als Schüler:in“, Abrufstatus.
- **Einzelne Zugänge per Formular** anlegen (Bereich „Einzeln.“, mit „Anlegen & nächster“ für mehrere hintereinander) und jeden Eintrag über das Stift-Symbol bearbeiten (Name, Klasse, Benutzername, Passwort, IServ-Account). Doppelte Benutzernamen oder IServ-Accounts werden abgewiesen; Abrufzähler bleiben beim Bearbeiten erhalten.
- Phase (automatisch/manuell), Termine, Ziel-Adressen, Hinweistext, Schalter „Zugangsdaten sichtbar“.
- Einstellungen für die Gruppenlisten der Lehrkräfte (siehe unten).
- Nach dem Wettbewerb: alle Zugangsdaten endgültig löschen.

## Ablauf für die Lehrkraft

1. In der Biber-Verwaltung (admin.informatik-biber.de) die Zugangsdaten als Excel oder CSV herunterladen.
2. Spalte **`IServ`** ergänzen und je Zeile den IServ-Accountnamen eintragen, z. B. `max.mustermann`. (Groß-/Kleinschreibung und ein angehängtes `@domain` werden ignoriert.)
3. Im Portal unter **Verwaltung → Import** hochladen, Vorschau prüfen, übernehmen.
4. Offene Zuordnungen in der Tabelle nachtragen. Über das Auge-Symbol die Ansicht einer Schülerin/eines Schülers prüfen.

Erkannte Spaltenköpfe (tolerant): `Benutzername`, `Passwort`, `IServ` / `IServ-Account` / `Account`, `Vorname`, `Nachname`, `Klassen-/Kursname` / `Klasse`, `Stufe`. Titelzeilen oberhalb der Kopfzeile, Semikolon/Komma/Tab sowie UTF-8 und Windows-1252 (Excel-CSV) werden erkannt. Eine Vorlage gibt es in der Verwaltung.

## Gruppenlisten für Lehrkräfte

IServ übermittelt beim Login (Scope `iserv:groups`) nur die Gruppen der **angemeldeten Person** – eine Schnittstelle „Mitglieder einer Gruppe“ gibt es nicht. Das Portal ermittelt die Zugänge einer Gruppe deshalb aus zwei Quellen:

| Quelle | Funktionsweise | Stärke |
|---|---|---|
| **Klasse** | Klassen-/Kursname aus dem Biber-Export ↔ Name/Kürzel der IServ-Gruppe. „7b“, „Klasse 7b“, „klasse.7b“, „Kl. 07b“ gelten als gleich (Vergleich nur, wenn der Name eine Ziffer enthält). | Sofort vollständig, auch ohne vorherige Anmeldung der Schüler:innen. |
| **Anmeldung** | Meldet sich eine Schülerin/ein Schüler **mit Biber-Zugang** an, speichert das Portal deren IServ-Gruppen. | Erfasst auch Kursgruppen („Informatik 11“), wird mit jeder Anmeldung vollständiger. |

**Schutzregeln** (in der Verwaltung einstellbar):

- **Mindestens** 3 Zugänge – blendet Gruppen ohne Schüler:innen aus (Fachschaften, Gremien …).
- **Höchstens** 40 Zugänge – keine Massenlisten.
- **Höchstens 3 verschiedene Klassen** je Gruppe – schützt vor Gruppen wie „Alle“, die über die Quelle „Anmeldung“ langsam wachsen und anfangs unter der Höchstzahl liegen.
- **Immer ausblenden** (Standard: `Alle, Schüler, Schülerinnen und Schüler, Eltern`); die Lehrkräfte-Gruppe selbst ist immer ausgeblendet.

Ausgeblendete Gruppen sieht die Lehrkraft mit Begründung („keine Zugänge“, „mehr als 40“ …). Druckseiten werden bei jedem Aufruf gegen die **aktuelle** IServ-Mitgliedschaft der Lehrkraft geprüft; fremde Gruppen sind nicht abrufbar. Gespeicherte Gruppenzuordnungen werden mit „Alles löschen“ entfernt.

## IServ einrichten (Single-Sign-On)

In IServ als Administrator: **Verwaltung → System → Single-Sign-On → Hinzufügen** (OAuth/OpenID Connect):

| Feld | Wert |
|---|---|
| Name | Biber-Portal |
| Client-ID / Client-Geheimnis | frei wählen bzw. übernehmen → in `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` |
| Weiterleitungs-URI | `https://<Ihre-Portal-Adresse>/auth/callback` |
| Grant-Typ | Authorization Code |
| Scopes | `openid`, `profile`, `email`, **`iserv:groups`** (für die Gruppenlisten der Lehrkräfte) |
| Vertrauenswürdig | ja (dann entfällt die Zustimmungsabfrage) |
| Beschränkung auf Gruppen/Rollen | optional, z. B. nur Schüler:innen + Informatik-Lehrkräfte |

Die Nutzer:innen brauchen in IServ das Recht **„OAuth verwenden“**. Das Portal liest die Endpunkte automatisch aus `https://<iserv>/.well-known/openid-configuration`, prüft das ID-Token (Signatur, Aussteller, Zielgruppe, Nonce), nutzt PKCE und ordnet über den Claim `preferred_username` (= IServ-Accountname) zu.

## Deployment mit CapRover

### 1. App einrichten

1. In CapRover eine neue App anlegen (z. B. `biber`).
2. **HTTP Settings:** Domain verbinden (z. B. `biber.ihre-domain.de`), **HTTPS aktivieren** und **„Force HTTPS“** einschalten.
3. **App Configs → Container HTTP Port:** `80`.
4. **App Configs → Persistent Directories:** Path in App `/app/data` (Label z. B. `biber-data`). Ohne dieses Verzeichnis sind importierte Zugangsdaten nach jedem Deploy weg.

### 2. Umgebungsvariablen anlegen

Unter **App Configs → Environmental Variables** (am schnellsten über **„Bulk Edit“**) eintragen und mit **„Save & Update“** speichern:

```dotenv
NODE_ENV=production
BASE_URL=https://biber.ihre-domain.de
ISERV_URL=https://ihre-iserv-domain.de
OIDC_CLIENT_ID=<aus IServ>
OIDC_CLIENT_SECRET=<aus IServ>
ADMIN_ACCOUNTS=vorname.nachname
SESSION_SECRET=<zufällig, mind. 32 Zeichen>
DATA_KEY=<zufällig, mind. 32 Zeichen – nie wieder ändern>
```

**Pflicht**

| Variable | Wert / Bedeutung |
|---|---|
| `NODE_ENV` | `production` – aktiviert sichere Cookies und strenge Prüfungen. Ohne diesen Wert startet das Portal im Entwicklungsmodus (u. a. `localhost` als Rücksprung-Adresse). |
| `BASE_URL` | Öffentliche Adresse des Portals mit `https://`, **ohne** Schrägstrich am Ende. Daraus entsteht die Weiterleitungs-URI für IServ: `BASE_URL/auth/callback`. |
| `ISERV_URL` | Adresse des Schul-IServ (nur Domain, ohne `/iserv`). Muss dem `issuer` unter `https://<iserv>/.well-known/openid-configuration` entsprechen. |
| `OIDC_CLIENT_ID` | Client-ID des Single-Sign-On-Clients in IServ. |
| `OIDC_CLIENT_SECRET` | Client-Geheimnis des Single-Sign-On-Clients in IServ. |
| `ADMIN_ACCOUNTS` | IServ-Accountnamen mit Zugriff auf die Verwaltung, kommagetrennt (z. B. `andre.bodendiek,kollegin.name`). |
| `SESSION_SECRET` | Zufallswert (≥ 32 Zeichen) zum Signieren der Sitzungen. Ändern meldet alle ab. |
| `DATA_KEY` | Zufallswert (≥ 32 Zeichen), mit dem die Zugangsdaten verschlüsselt gespeichert werden (AES-256-GCM). **Nach dem ersten Start nie ändern** – sonst sind die gespeicherten Daten nicht mehr lesbar. Zusätzlich sicher aufbewahren (z. B. Passwortmanager). |

Geheimnisse erzeugen: `./build.sh secrets` (oder `openssl rand -base64 48`).

**Optional**

| Variable | Standard | Wofür |
|---|---|---|
| `SCHOOL_NAME` | `Johann-Beckmann-Gymnasium Hoya` | Schulname in der Fußzeile |
| `IMPRESSUM_URL` | leer | Link „Impressum“ in der Fußzeile |
| `DATENSCHUTZ_URL` | leer | Link „Datenschutz“ in der Fußzeile |
| `TRUST_PROXY` | `1` (in Produktion) | Anzahl vertrauenswürdiger Proxys; hinter CapRover/nginx passt `1` |
| `OIDC_SCOPE` | `openid profile email iserv:groups` | Angefragte Scopes (`iserv:groups` wird für die Gruppenlisten benötigt) |
| `TEACHER_GROUPS` | `lehrende` | IServ-Gruppe(n) der Lehrkräfte (Kürzel oder Name, kommagetrennt) |
| `OIDC_ACCOUNT_CLAIM` | `preferred_username` | Claim, der den IServ-Accountnamen enthält |
| `OIDC_TOKEN_AUTH_METHOD` | automatisch | `client_secret_basic` oder `client_secret_post` – nur setzen, wenn der Token-Abruf scheitert |
| `OIDC_PKCE` | `true` | Auf `false`, falls IServ PKCE ablehnt |

`PORT` (80) und `DATA_DIR` (`/app/data`) setzt bereits das Dockerfile – nicht anlegen.

### 3. Deployen

```bash
./build.sh deploy            # App interaktiv auswählen
./build.sh deploy biber      # direkt in die App „biber“
```

Alternativ `./build.sh` ausführen und `dist/biber-portal.tar` in CapRover unter **Deployment → „Upload tar file“** hochladen.

### Häufige Fehler

| Meldung | Ursache |
|---|---|
| IServ: „Redirect-URI ist ungültig“ | Weiterleitungs-URI in IServ ≠ `BASE_URL/auth/callback`, oder `BASE_URL`/`NODE_ENV` fehlen (dann wird `localhost` gesendet). |
| Log: `Login-Start fehlgeschlagen … ConnectTimeoutError` | Der Server erreicht IServ nicht (Firewall/Länder- oder IP-Sperre in IServ, falsche `ISERV_URL`). Test auf dem Server: `curl https://<iserv>/.well-known/openid-configuration`. |
| Start bricht ab: „Datenspeicher konnte nicht entschlüsselt werden“ | `DATA_KEY` wurde geändert. Alten Schlüssel wieder eintragen. |
| Start bricht ab: „Umgebungsvariable … fehlt“ | Pflichtvariable nicht gesetzt (siehe Tabelle oben). |

## build.sh

```bash
./build.sh            # prüfen (Syntax, Tests) und dist/biber-portal.tar bauen
./build.sh dev        # lokal: Portal :3000 + Test-IServ :4000
./build.sh deploy     # bauen und per CapRover-CLI deployen (App interaktiv wählen)
./build.sh deploy biber   # direkt in die CapRover-App „biber“
./build.sh secrets    # SESSION_SECRET und DATA_KEY erzeugen
./build.sh docker     # Docker-Image lokal bauen und starten
./build.sh help       # alle Befehle
```

## Lokal testen (ohne echtes IServ)

```bash
npm install
npm run mock-iserv            # Test-IServ auf Port 4000 mit Beispielkonten
NODE_ENV=development npm start  # Portal auf http://localhost:3000
npm test                      # Unit- und Ende-zu-Ende-Tests
```

Im Mock-IServ gibt es u. a. `max.mustermann`, `erika.musterfrau`, `lena.ohnedaten` und den Admin `andre.bodendiek`.

## Datenschutz und Sicherheit

- Gespeichert werden nur: Biber-Benutzername, Biber-Passwort, IServ-Accountname, Name/Klasse aus dem Export sowie Abrufzeitpunkte. IServ-Tokens werden nicht gespeichert.
- Datenspeicher vollständig verschlüsselt; Sitzungscookie signiert, `HttpOnly`, `SameSite=Lax`, `Secure` unter HTTPS; CSRF-Schutz für alle Formulare; strikte Content-Security-Policy; Seiten mit Zugangsdaten werden nicht zwischengespeichert (`no-store`).
- Nach dem Wettbewerb lassen sich alle Zugangsdaten in der Verwaltung mit einem Schritt löschen.
- Eine automatische Anmeldung beim Informatik-Biber (Zugangsdaten an fremde Seite senden) ist bewusst nicht eingebaut – das Portal zeigt die Daten und leitet weiter.

## Projektstruktur

```
server.js            Routen, Sitzung, Sicherheit
lib/oidc.js          IServ-OpenID-Connect-Client (Code-Flow + PKCE)
lib/store.js         verschlüsselter Datenspeicher
lib/importer.js      CSV/XLSX-Import mit Spaltenerkennung
lib/phase.js         Phasenlogik (Europe/Berlin)
lib/groups.js        IServ-Gruppen: Lehrende erkennen, Zugänge je Gruppe, Schutzregeln
lib/teacher-views.js Lehrkräfte: „Meine Gruppen“, Druckliste und Karten
lib/views.js         Start- und Schüleransicht
lib/admin-views.js   Verwaltung und Import-Vorschau
public/              CSS (Aurora/Glas), JS, Favicon
tools/mock-iserv.js  lokaler Test-IServ
test/                node:test (Unit + E2E)
```
