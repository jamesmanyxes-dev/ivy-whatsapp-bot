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

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const AUTH_DIR = path.join(__dirname, 'auth');
const OWNER = process.env.OWNER_NUMBER || '';
const NAME = 'evil⁶⁶⁶MD';
const PREFIXES = ['.', '!', '#'];

// optional local secrets (uploaded to the panel, never committed)
let TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8617770803:AAEnnBH-hWoJsIgPnFaneoaV8f5bg4Dv2FU';
let ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
try {
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'secrets.json'), 'utf8'));
  if (s.telegramToken) TELEGRAM_TOKEN = s.telegramToken;
  if (s.anthropicKey) ANTHROPIC_KEY = s.anthropicKey;
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

// full logger interface Baileys expects (all no-ops)
function silentLogger() {
  const noop = () => undefined;
  const obj = { level: 'silent', child: () => obj, trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, traceObj: noop, debugObj: noop };
  return obj;
}

let sock = null;
let state = { connected: false, pairingCode: null, pairedFor: null, user: null, lastError: null, busy: false };
let restarts = 0;
let pairingResolve = null;
const botState = {
  chatbotOn: false,
  chatHistories: new Map(), // jid -> [{role, content}]
  bans: new Set(),
  owner: null, // resolved after connect
  ppSet: false,
}; // resolves when a pairing code is issued for a number

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
      keys: makeCacheableSignalKeyStore(authState.keys, silentLogger()),
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
      botState.owner = OWNER || state.user;
      restarts = 0;
      console.log('[WA] connected as', state.user, '(owner:', botState.owner + ')');
      // AI girl profile picture + name on first connect
      if (!botState.ppSet) {
        botState.ppSet = true;
        (async () => {
          try {
            const j = await JSON.parse(JSON.stringify(await (await fetch('https://nekos.best/api/v2/waifu')).json()));
            const buf = await (await fetch(j.results[0].url)).arrayBuffer();
            await sock.updateProfilePicture(sock.user.id, Buffer.from(buf));
            await sock.updateProfileName('evil⁶⁶⁶MD');
            console.log('[WA] AI girl profile picture set');
          } catch (e) { console.log('[WA] profile pic:', e.message); }
        })();
      }
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
      if (code !== DisconnectReason.loggedOut && restarts < 20) {
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
  const sender = msg.key.participant || jid;
  if (botState.bans.has(sender)) return;

  const key = cmd.all[name];
  if (!key) {
    // ---- chatbot mode: reply when the bot is tagged/replied (or in DMs) when ON
    if (botState.chatbotOn) {
      const botJid = sock.user?.id;
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
      const isReplyToBot = quoted && botJid && quoted.split(':')[0] === botJid.split(':')[0];
      const isTagged = mentioned.some((m) => botJid && m.split(':')[0] === botJid.split(':')[0]);
      const isDM = jid.endsWith('@s.whatsapp.net');
      if (isTagged || isReplyToBot || isDM) {
        const clean = text.replace(/@\d+/g, '').trim();
        if (clean.length > 1) {
          console.log(`[chat] ${jid} -> ${clean.slice(0, 60)}`);
          const reply = await chatWithClaude(jid, clean);
          if (reply) await sock.sendMessage(jid, { text: reply }, { quoted: msg });
        }
      }
    }
    return;
  }

  console.log(`[cmd] ${jid} -> ${name}`);
  const c = {
    jid, msg, sender, sock, args, all: cmd.all, desc: cmd.desc,
    cmd: name, owner: botState.owner, isOwner: sender.split('@')[0] === (botState.owner || '').split('@')[0] || sender.split('@')[0] === state.user,
    chatbotOn: () => botState.chatbotOn,
    setChatbot: (v) => { botState.chatbotOn = v; return ANTHROPIC_KEY ? '' : '⚠️ No Claude API key set yet — ask the owner to add it to secrets.json.'; },
    banUser: (n, on) => { if (on) botState.bans.add(n); else botState.bans.delete(n); },
    chat: (q) => chatWithClaude(jid, q, true),
    send: (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg }),
    sendImage: async (url, caption) => {
      const buf = await cmd.getBuffer(url);
      await sock.sendMessage(jid, { image: buf, caption: caption || '' }, { quoted: msg });
    },
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

// ================= CLAUDE CHATBOT =================
const PERSONA = "You are evil⁶⁶⁶MD, a WhatsApp bot with attitude: confident, playful, a little dangerous, but helpful and never boring. You reply like a friend on WhatsApp — short, casual, emojis ok. If asked who made you: your owner/developer. Never say you are made by Anthropic.";
async function chatWithClaude(jid, text, oneShot = false) {
  if (!ANTHROPIC_KEY) return '🤖 ⚠️ Claude API key not configured yet (secrets.json → anthropicKey).';
  const hist = oneShot ? [] : (botState.chatHistories.get(jid) || []);
  hist.push({ role: 'user', content: text });
  if (hist.length > 20) hist.splice(0, hist.length - 20);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, system: PERSONA, messages: hist }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); console.error('[claude]', r.status, t.slice(0, 150)); return '🤖 ⚠️ Claude error ' + r.status + (r.status === 401 ? ' — bad API key.' : ''); }
    const d = await r.json();
    const reply = (d.content || []).map((b) => b.text || '').join('').trim() || '🤖 …';
    hist.push({ role: 'assistant', content: reply });
    if (!oneShot) botState.chatHistories.set(jid, hist);
    return reply;
  } catch (e) { console.error('[claude]', e.message); return '🤖 ⚠️ Could not reach Claude: ' + e.message; }
}

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
