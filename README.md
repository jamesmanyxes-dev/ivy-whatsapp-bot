# Ivy WhatsApp Bot 🌿

WhatsApp bot built with [Baileys](https://github.com/WhiskeySockets/Baileys) — pairs by scanning a QR (or entering a pairing code) on a web page.

## Pair

1. Start the server, open `http://<host>:<port>` in a browser.
2. **Scan:** WhatsApp → Settings → Linked Devices → Link a Device → scan the QR.
   **Or code:** type your number on the page, press *Get pairing code*, then enter the code on your phone (Linked Devices → Link with phone number).
3. Once connected, the session is saved in `auth/` — restarts stay logged in.

## Commands

`!ping` · `!menu` · `!owner` · `!echo <text>` — add more in `index.js` → `handleMessage`.

## Run on Pterodactyl

Use the generic **Node.js** egg:

- **Startup file:** `index.js`
- **Node version:** 20+
- **Environment variables (Startup tab):**
  - `PORT` — the panel usually sets this from the allocation automatically
  - `OWNER_NUMBER` — your WhatsApp number, digits only (e.g. `233501234567`)
- Upload the repo files (or point the egg at this GitHub), then **Start**.
- Open the allocation URL / port in your browser to pair.

## Run locally

```bash
npm install
PORT=3000 OWNER_NUMBER=233... npm start
```

## Files

- `index.js` — bot + web pairing UI + Express status endpoints
- Session state is stored on disk in `auth/` (add it to backups, never share it)

## Note

Baileys is an unofficial library. Automating WhatsApp can get the number banned — use it on a number you're okay risking, not your main one.
