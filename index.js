// evil⁶⁶⁶MD — WhatsApp bot (Baileys) with web pairing + Telegram control
// Pair by NUMBER: open the web page, enter your number, get a real pairing code.
// Telegram: /pair <number> in the bot chat also returns a pairing code.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
} = require('baileys');
const cmd = require('./commands');

const PORT = Number(process.env.PORT || 3000);
const AUTH_DIR = path.join(__dirname, 'auth');
const OWNER = process.env.OWNER_NUMBER || '';
const NAME = 'evil⁶⁶⁶MD';
const PREFIXES = ['.', '!', '#'];

// optional local secrets (uploaded to the panel, never committed)
let TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8617770803:AAEnnBH-hWoJsIgPnFaneoaV8f5bg4Dv2FU';
try {
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'secrets.json'), 'utf8'));
  if (s.telegramToken) TELEGRAM_TOKEN = s.telegramToken;
} catch {}


// ---- log tee: everything the console prints also goes to bot.log ----
const LOG_PATH = path.join(__dirname, 'bot.log');
const origLog = console.log.bind(console), origErr = console.error.bind(console);
function teeLog(fn, args) {
  try { fs.appendFileSync(LOG_PATH, args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n'); } catch {}
  fn(...args);
}
console.log = (...a) => teeLog(origLog, a);
console.error = (...a) => teeLog(origErr, a);
process.on('uncaughtException', (e) => { console.error('[uncaught]', e.stack || e.message); });
process.on('unhandledRejection', (e) => { console.error('[unhandled]', (e && e.stack) || String(e)); });

const app = express();
app.use(express.json());

let sock = null;
let state = { connected: false, pairingCode: null, pairedFor: null, user: null, lastError: null, busy: false };
let restarts = 0;
let pairingResolve = null; // resolves when a pairing code is issued for a number

console.log(`┌─────────────────────────────────┐`);
console.log(`│   ${NAME}   │`);
console.log(`└─────────────────────────────────┘`);

// ================= WHATSAPP =================
async function startBot() {
  if (state.busy) return;
  state.busy = true;
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, {
        get: () => undefined, set: () => {}, del: () => {}, clear: () => {},
      }),
    },
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), // pairing codes need a desktop browser pair
    syncFullHistory: false,
    markOnlineOnConnect: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;

    if (connection === 'open') {
      state.connected = true;
      state.busy = false;
      state.pairingCode = null; state.pairedFor = null; state.lastError = null;
      state.user = sock.user?.id ? sock.user.id.split(':')[0] : null;
      restarts = 0;
      console.log('[WA] connected as', state.user);
      try { sock.sendMessage(sock.user.id, { text: `🌑 ${NAME} online! Type .menu` }); } catch {}
    }

    if (connection === 'close') {
      state.connected = false;
      state.busy = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      state.lastError = `${lastDisconnect?.error?.message || 'closed'} (code ${code})`;
      console.log('[WA] closed:', code, state.lastError);
      if (code === DisconnectReason.loggedOut) {
        console.log('[WA] logged out — wiping session');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
      if (code !== DisconnectReason.loggedOut && restarts < 12) {
        restarts++;
        setTimeout(startBot, Math.min(restarts * 2000, 15000));
      }
    }
  });

  sock.ev.on('messages.upsert', onMessage);
}

function parseCommand(text) {
  let body = text.trim();
  let usedPrefix = '';
  if (PREFIXES.includes(body[0])) { usedPrefix = body[0]; body = body.slice(1); }
  const sp = body.indexOf(' ');
  const name = (sp === -1 ? body : body.slice(0, sp)).toLowerCase();
  const args = sp === -1 ? [] : body.slice(sp + 1).trim().split(/\s+/);
  return { name: name.toLowerCase(), args, usedPrefix };
}

async function onMessage({ messages }) {
  const msg = messages[0];
  if (!msg.message || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  const text = msg.message.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
  if (!text) return;

  const { name, args } = parseCommand(text);
  const key = cmd.all[name];
  if (!key) return;

  console.log(`[cmd] ${jid} -> ${name}`);
  const c = {
    jid, msg, sender: msg.key.participant || jid, sock, args, all: cmd.all, desc: cmd.desc,
    cmd: name, owner: OWNER,
    send: (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg }),
  };
  try { await cmd.table[key].run(c); }
  catch (e) { console.error('[cmd] error', name, e.message); try { c.send('⚠️ ' + e.message); } catch {} }
}

// issues a pairing code for a phone number; resolves when the code arrives
async function requestPairingCode(number) {
  if (!sock) throw new Error('Bot is still starting — try again in a few seconds');
  if (state.connected) throw new Error('Already paired! The session is live.');
  if (state.pairingCode && state.pairedFor === number) return state.pairingCode;
  pairingResolve = null;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pairing timed out — try again')), 30000);
    pairingResolve = (code) => { clearTimeout(timer); resolve(code); };
  });
  const code = await sock.requestPairingCode(number); // real code from WhatsApp
  state.pairingCode = code;
  state.pairedFor = number;
  if (pairingResolve) pairingResolve(code);
  return promise.catch((e) => { throw e; });
}

// ================= WEB =================
app.use(express.json());
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>evil⁶⁶⁶MD — Pair</title>
<style>
body{background:#050608;color:#e8edf4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100dvh;margin:0}
.card{background:#0d1117;border:1px solid #232b38;border-radius:20px;padding:30px;max-width:420px;text-align:center;width:92%}
h1{font-size:22px;margin:0 0 2px} .sub{color:#8b96a8;font-size:13px;margin-bottom:14px}
.pill{display:inline-block;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:600;margin-bottom:10px}
.ok{background:rgba(52,211,153,.15);color:#34d399}.warn{background:rgba(234,179,8,.12);color:#fde68a}.err{background:rgba(244,63,94,.12);color:#fda4af}
input{width:100%;box-sizing:border-box;background:#161d27;border:1px solid #232b38;color:#e8edf4;border-radius:12px;padding:13px;font-size:16px;margin:10px 0}
button{background:#34d399;color:#04120c;border:0;border-radius:12px;padding:12px 22px;font-weight:700;cursor:pointer;font-size:15px;width:100%}
button:disabled{opacity:.4}
.code{font-family:monospace;font-size:34px;letter-spacing:8px;background:#050608;border:1px solid #34d39955;border-radius:14px;padding:18px 8px;margin:14px 0;color:#34d399;font-weight:700}
.steps{text-align:left;color:#8b96a8;font-size:13px;line-height:1.9;margin-top:14px}
.tg{margin-top:14px;font-size:12.5px;color:#8b96a8}
a{color:#34d399}
.spin{display:inline-block;width:14px;height:14px;border:2px solid #34d39955;border-top-color:#34d399;border-radius:50%;animation:sp 1s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes sp{to{transform:rotate(360deg)}}
</style></head><body><div class="card">
<h1>🌑 evil⁶⁶⁶MD</h1>
<div class="sub">WhatsApp pairing — by number, no QR</div>
<div id="box"><span class="spin"></span>Connecting…</div>
<div class="steps" id="steps" style="display:none">
1. WhatsApp → <b>Settings → Linked Devices → Link a Device</b><br>
2. Tap <b>“Link with phone number instead”</b><br>
3. Type the code above.
</div>
<div class="tg">You can also pair from Telegram: open the evil⁶⁶⁶MD bot on Telegram and send <b>/pair your-number</b>.</div>
</div>
<script>
async function pair(){
  const n = document.getElementById('num').value.trim().replace(/[^0-9]/g,'');
  if(!n) return alert('Enter your number with country code, e.g. 233501234567');
  const b=document.querySelector('button'); b.disabled=true; b.textContent='Getting code…';
  const r=await fetch('/pair?number='+n); const j=await r.json(); b.disabled=false; b.textContent='Get pairing code';
  if(j.error){alert(j.error); return;}
  render(j.code);
}
function render(code){
  document.getElementById('box').innerHTML = code
    ? '<div>📱 Your pairing code:</div><div class="code">'+code+'</div>'
    : '<div id="numwrap"><input id="num" placeholder="Number with country code e.g. 233501234567"><button onclick="pair()">Get pairing code</button></div>';
  if(code) document.getElementById('steps').style.display='block';
}
async function refresh(){
  try{
    const s=await (await fetch('/status')).json();
    if(s.connected){document.getElementById('box').innerHTML='<span class="pill ok">✅ Connected as +'+s.user+'</span><div style="margin-top:8px">Bot is live. Type .menu on WhatsApp.</div>';return;}
    if(s.pairingCode){render(s.pairingCode);return;}
    document.getElementById('box').innerHTML='<span class="pill warn">⏳ Waiting for pairing…</span><div id="numwrap"><input id="num" placeholder="Number with country code e.g. 233501234567"><button onclick="pair()">Get pairing code</button></div>';
  }catch(e){document.getElementById('box').innerHTML='<span class="pill err">Server unreachable — retrying…</span>';}
}
refresh(); setInterval(refresh,4000);
</script></body></html>`);
});

app.get('/status', (req, res) => res.json(state));
app.get('/pair', async (req, res) => {
  const number = String(req.query.number || '').replace(/[^0-9]/g, '');
  if (!number || number.length < 7) return res.status(400).json({ error: 'Number with country code, e.g. 233501234567' });
  try { const code = await requestPairingCode(number); res.json({ code }); }
  catch (e) { res.status(409).json({ error: e.message }); }
});
app.get('/health', (req, res) => res.json({ ok: true, connected: state.connected }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${NAME}] web pair UI on port ${PORT}`);
  startBot();
  if (TELEGRAM_TOKEN) startTelegram(); else console.log('[TG] no token — Telegram pairing disabled');
});

// ================= TELEGRAM =================
let tgOffset = 0;
async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return r.json();
}

async function startTelegram() {
  const me = await tg('getMe');
  if (!me.ok) return console.error('[TG] bad token:', me.description);
  console.log('[TG] evil⁶⁶⁶MD Telegram bot live as @' + me.result.username);
  const menu = { commands: [
    { command: 'start', description: 'Start / intro' },
    { command: 'pair', description: 'Pair WhatsApp: /pair 2335xxxxxxx' },
    { command: 'status', description: 'WhatsApp connection status' },
    { command: 'menu', description: 'List command categories' },
  ] };
  await tg('setMyCommands', menu);

  for (;;) {
    try {
      const r = await tg('getUpdates', { offset: tgOffset + 1, timeout: 25 });
      for (const u of r.result || []) {
        tgOffset = u.update_id;
        const m = u.message; if (!m?.text) continue;
        const chatId = m.chat.id;
        const reply = (t) => tg('sendMessage', { chat_id: chatId, text: t, parse_mode: 'Markdown' });
        const [c, ...rest] = m.text.trim().split(/\s+/);
        const name = c.replace(/^\//, '').toLowerCase();
        try {
          if (name === 'start' || name === 'help') {
            await reply(`🌑 *${NAME}*\n\nPair your WhatsApp:\n\`/pair 2335xxxxxxx\`\n\nThen on WhatsApp → Linked Devices → Link with phone number, and type the code.\n\n/status — connection status\n/menu — command list`);
          } else if (name === 'pair') {
            const n = rest.join('').replace(/[^0-9]/g, '');
            if (!n) await reply('Send your number: `/pair 2335xxxxxxx`');
            else {
              await reply('📲 Requesting pairing code for +' + n + '…');
              try { const code = await requestPairingCode(n); await reply(`✅ *Pairing code:* \`${code}\`\n\nOn the phone: WhatsApp → Linked Devices → Link a Device → **Link with phone number instead** → type this code.`); }
              catch (e) { await reply('⚠️ ' + e.message); }
            }
          } else if (name === 'status') {
            await reply(state.connected ? `✅ Connected as +${state.user}` : `⏳ Not paired. Use /pair <number>${state.lastError ? `\n⚠️ ${state.lastError}` : ''}`);
          } else if (name === 'menu') {
            await reply(`🌑 *${NAME}* — ${Object.keys(cmd.all).length}+ WhatsApp commands:\ncore (ping, menu) • tools (calc, weather, define, translate, crypto) • fun (joke, quote, ship, love) • group (tagall, kick, promote) • owner (setname, setbio, block)`);
          } else if (name === 'ping') {
            await reply('🏓 pong');
          } else {
            await reply('Unknown command. Try /start');
          }
        } catch (e) { console.error('[TG]', e.message); }
      }
    } catch (e) { console.error('[TG] poll error:', e.message); await new Promise((r2) => setTimeout(r2, 3000)); }
  }
}
