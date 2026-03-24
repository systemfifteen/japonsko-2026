# CLAUDE.md — Deployment: japonsko-2026

## Úloha

Nasadiť statickú HTML stránku (`index.html`) ako verejný web cez GitHub + Coolify.

Tento projekt je **čistá statická stránka** — žiaden build krok, žiadne závislosti.
Stačí servírovať `index.html` z rootu repozitára.

---

## Kontext projektu

```
japonsko-web/
├── index.html      # celá aplikácia — jeden súbor, self-contained
├── nginx.conf      # voliteľný nginx config (Coolify ho môže ignorovať)
├── README.md
└── CLAUDE.md       # tento súbor
```

---

## Krok 1 — GitHub: vytvor repo a pushni súbory

> Predpoklad: `gh` CLI je nainštalované a autentifikované (`gh auth status`).
> Ak nie, použi `gh auth login` pred pokračovaním.

```bash
# Skontroluj či si v správnom adresári (musí obsahovať index.html)
ls index.html || { echo "ERROR: index.html nenájdený"; exit 1; }

# Vytvor GitHub repo (zmeň owner ak treba)
gh repo create japonsko-2026 \
  --public \
  --description "Cestovny sprievodca Japonsko 2026" \
  --source=. \
  --remote=origin \
  --push

# Overiť že push prebehol
gh repo view --web 2>/dev/null || echo "Repo vytvorené: https://github.com/$(gh api user -q .login)/japonsko-2026"
```

**Ak repo už existuje:**
```bash
git remote set-url origin https://github.com/$(gh api user -q .login)/japonsko-2026.git
git add -A
git commit -m "deploy: japonsko-2026 cestovny sprievodca" --allow-empty
git push -u origin main
```

**Výstup ktorý potrebuješ pre ďalší krok:**
- GitHub repo URL: `https://github.com/<username>/japonsko-2026`

---

## Krok 2 — Coolify: nasadenie aplikácie

> Predpoklad: Coolify je dostupné a máš API token.
> API token nájdeš v Coolify → Keys & Tokens → API Tokens.

### 2a. Získaj potrebné IDs cez Coolify API

```bash
# Nastav svoje hodnoty:
COOLIFY_URL="https://coolify.system15.win"   # URL tvojho Coolify (uprav ak treba)
COOLIFY_TOKEN="<tvoj-api-token>"              # z Coolify → Keys & Tokens

# Zisti dostupné teams/projects
curl -s "$COOLIFY_URL/api/v1/teams" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '.[] | {id, name}'

# Zisti dostupné servery
curl -s "$COOLIFY_URL/api/v1/servers" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '.[] | {id, name, ip}'

# Zisti dostupné projekty
curl -s "$COOLIFY_URL/api/v1/projects" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '.[] | {id, name, uuid}'
```

### 2b. Vytvor novú aplikáciu v Coolify

```bash
# Nastav hodnoty podľa výstupu z 2a:
PROJECT_UUID="<uuid-projektu>"     # z výstupu vyššie
SERVER_UUID="<uuid-servera>"       # z výstupu vyššie
GITHUB_REPO="https://github.com/$(gh api user -q .login)/japonsko-2026"
SUBDOMAIN="japonsko"               # výsledná URL: japonsko.system15.win

# Vytvor statickú aplikáciu
curl -s -X POST "$COOLIFY_URL/api/v1/applications/public" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_uuid\": \"$PROJECT_UUID\",
    \"server_uuid\": \"$SERVER_UUID\",
    \"environment_name\": \"production\",
    \"git_repository\": \"$GITHUB_REPO\",
    \"git_branch\": \"main\",
    \"build_pack\": \"static\",
    \"publish_directory\": \"/\",
    \"name\": \"japonsko-2026\",
    \"domains\": \"https://${SUBDOMAIN}.system15.win\",
    \"instant_deploy\": true
  }" | jq '{uuid: .uuid, url: .url, status: .status}'
```

### 2c. Overiť deploy

```bash
APP_UUID="<uuid-z-predošlého-kroku>"

# Počkaj na dokončenie deployu (max 2 minúty)
for i in {1..12}; do
  STATUS=$(curl -s "$COOLIFY_URL/api/v1/applications/$APP_UUID" \
    -H "Authorization: Bearer $COOLIFY_TOKEN" | jq -r '.status')
  echo "Status ($i/12): $STATUS"
  [ "$STATUS" = "running" ] && break
  sleep 10
done

echo "Aplikácia dostupná na: https://japonsko.system15.win"
```

---

## Krok 3 — DNS (ak treba)

Ak subdoména ešte neexistuje, pridaj A záznam na DNS:

```
Typ:    A
Názov:  japonsko
Hodnota: <IP tvojho servera>
TTL:    300
```

> Coolify s Let's Encrypt certifikátom zvládne HTTPS automaticky.

Skontrolovať po ~5 minútach:
```bash
curl -I https://japonsko.system15.win
```

---

## Fallback: manuálny deploy cez Coolify UI

Ak API nefunguje, urob to cez webové rozhranie:

1. Coolify → **New Resource** → **Application**
2. **GitHub** → vyber repo `japonsko-2026`
3. Build pack: **Static**
4. Publish directory: `.` alebo `/`
5. Domain: `https://japonsko.system15.win`
6. **Deploy** → počkaj na zelený status

---

## Aktualizácia obsahu (budúcnosť)

Keď chceš updatovať stránku (nové miesta, zmeny itineráru):

```bash
# Uprav index.html, potom:
git add index.html
git commit -m "update: <čo si zmenil>"
git push

# Coolify auto-deploy by mal spustiť nový build
# Ak nie, manuálne: curl -X POST "$COOLIFY_URL/api/v1/applications/$APP_UUID/restart" ...
```

---

## Čo NEROBIŤ

- **Neinštaluj** npm, node, webpack ani žiadny build tooling — `index.html` je self-contained
- **Nemeň** štruktúru súborov — Coolify static build očakáva `index.html` v roote
- **Necommituj** API tokeny ani heslá do repozitára

---

## Definícia úspechu

Agent môže skončiť keď:
- [ ] `gh repo view japonsko-2026` vracia existujúce repo s `index.html`
- [ ] `curl -s https://japonsko.system15.win | grep -q "Japonsko"` vracia match
- [ ] Stránka sa načíta v prehliadači a zobrazuje 4 taby (Itinerár, Miesta, Checklist, Tipy)
