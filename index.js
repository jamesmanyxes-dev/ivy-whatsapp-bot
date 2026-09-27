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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>evil\u2076\u2076\u2076MD — Pair</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>\u263e</text></svg>">
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
:root{--bg:#050507;--card:rgba(16,16,22,.72);--line:rgba(255,255,255,.08);--txt:#f2f3f7;--mut:#9aa0ae;--acc:#a78bfa;--acc2:#7c3aed;--ok:#34d399;--warn:#fbbf24}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Space Grotesk',system-ui,sans-serif;background:var(--bg);color:var(--txt);min-height:100dvh;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
/* aurora background */
.aurora{position:fixed;inset:-40%;z-index:0;filter:blur(90px);opacity:.5;background:
 radial-gradient(40% 40% at 20% 30%,#7c3aed55 0%,transparent 60%),
 radial-gradient(35% 35% at 80% 20%,#2563eb44 0%,transparent 60%),
 radial-gradient(45% 45% at 70% 80%,#db277733 0%,transparent 60%),
 radial-gradient(30% 30% at 30% 85%,#06b6d433 0%,transparent 60%);
 animation:drift 22s ease-in-out infinite alternate}
@keyframes drift{0%{transform:rotate(0deg) scale(1)}50%{transform:rotate(8deg) scale(1.15)}100%{transform:rotate(-6deg) scale(1.05)}}
.grain{position:fixed;inset:0;z-index:1;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.6'/%3E%3C/svg%3E")}
.card{position:relative;z-index:2;width:min(94vw,400px);background:var(--card);backdrop-filter:blur(24px);border:1px solid var(--line);border-radius:26px;padding:34px 28px 28px;text-align:center;box-shadow:0 30px 80px -20px rgba(124,58,237,.25),inset 0 1px 0 rgba(255,255,255,.06);animation:rise .8s cubic-bezier(.2,.9,.3,1) both}
@keyframes rise{from{opacity:0;transform:translateY(26px) scale(.97)}to{opacity:1;transform:none}}
.logo{width:74px;height:74px;margin:0 auto 16px;border-radius:22px;display:grid;place-items:center;font-size:34px;background:linear-gradient(135deg,#7c3aed,#2563eb 60%,#db2777);box-shadow:0 10px 30px -6px rgba(124,58,237,.6);position:relative;animation:float 5s ease-in-out infinite}
.logo::after{content:'';position:absolute;inset:-6px;border-radius:26px;border:1px solid rgba(167,139,250,.35);animation:pulse 2.6s ease-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes pulse{0%{opacity:.9;transform:scale(1)}70%,100%{opacity:0;transform:scale(1.25)}}
h1{font-size:25px;font-weight:700;letter-spacing:.5px;margin-bottom:4px}
h1 span{background:linear-gradient(90deg,#a78bfa,#60a5fa,#f472b6);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--mut);font-size:13.5px;margin-bottom:20px}
.badge{display:inline-flex;align-items:center;gap:7px;padding:6px 14px;border-radius:999px;font-size:12.5px;font-weight:600;margin-bottom:18px;background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--mut);transition:all .3s}
.badge .dot{width:7px;height:7px;border-radius:50%;background:var(--warn);animation:blink 1.6s infinite}
@keyframes blink{50%{opacity:.3}}
.badge.ok{color:var(--ok);border-color:rgba(52,211,153,.3)}.badge.ok .dot{background:var(--ok);animation:none}
.badge.err{color:#f87171;border-color:rgba(248,113,113,.3)}.badge.err .dot{background:#f87171;animation:none}
input{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--txt);border-radius:14px;padding:12px 14px;font-size:15px;outline:none;text-align:center;letter-spacing:1px;transition:border .25s,box-shadow .25s}
input:focus{border-color:var(--acc);box-shadow:0 0 0 4px rgba(124,58,237,.18)}
input::placeholder{color:#5b6070;font-size:13.5px}
button{width:100%;margin-top:12px;padding:13px;border:0;border-radius:14px;font:600 15px 'Space Grotesk',sans-serif;cursor:pointer;color:#fff;background:linear-gradient(135deg,#7c3aed,#4f46e5);box-shadow:0 8px 24px -8px rgba(124,58,237,.7);transition:transform .15s,box-shadow .15s,opacity .2s}
button:hover{transform:translateY(-2px);box-shadow:0 12px 28px -8px rgba(124,58,237,.85)}
button:active{transform:translateY(0)}
button:disabled{opacity:.5;cursor:wait;transform:none}
.code{font-family:ui-monospace,monospace;font-size:34px;letter-spacing:10px;font-weight:700;color:#fff;background:linear-gradient(135deg,rgba(124,58,237,.25),rgba(59,130,246,.2));border:1px solid rgba(167,139,250,.4);border-radius:16px;padding:16px 6px;margin:16px 0 6px;text-shadow:0 0 24px rgba(167,139,250,.8);animation:glow 2.2s ease-in-out infinite}
@keyframes glow{0%,100%{box-shadow:0 0 18px rgba(124,58,237,.25)}50%{box-shadow:0 0 34px rgba(124,58,237,.55)}}
.code .ch{display:inline-block;animation:flip .5s cubic-bezier(.2,.9,.3,1) both}
@keyframes flip{from{opacity:0;transform:translateY(-14px) rotateX(80deg)}to{opacity:1;transform:none}}
.steps{margin-top:16px;text-align:left;color:var(--mut);font-size:12.8px;line-height:2;animation:rise .6s .2s both}
.steps b{color:var(--txt)}
.tg{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--mut)}
.tg a{color:var(--acc);text-decoration:none;font-weight:600}
.spin{width:16px;height:16px;border:2px solid rgba(167,139,250,.25);border-top-color:var(--acc);border-radius:50%;display:inline-block;animation:sp .8s linear infinite;vertical-align:-3px;margin-right:8px}
@keyframes sp{to{transform:rotate(360deg)}}
footer{position:fixed;bottom:14px;left:0;right:0;text-align:center;font-size:11px;color:#4b4f5c;z-index:2}
</style></head><body>
<div class="aurora"></div><div class="grain"></div>
<div class="card">
 <div class="logo">\u263e</div>
 <h1>evil<span>\u2076\u2076\u2076MD</span></h1>
 <div class="sub">WhatsApp pairing portal</div>
 <div class="badge" id="badge"><span class="dot"></span><span id="btxt">connecting\u2026</span></div>
 <div id="box"></div>
 <div class="tg">Prefer Telegram? Open <a href="https://t.me/Gojo_saturo_evil_bot">@Gojo_saturo_evil_bot</a> and send /pair</div>
</div>
<footer>evil\u2076\u2076\u2076MD \u00b7 powered by Baileys</footer>
<script>
var code=null;
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function codeHTML(c){return '<div class="code">'+c.split('').map(function(ch,i){return '<span class="ch" style="animation-delay:'+(i*60)+'ms">'+esc(ch)+'</span>'}).join('')+'</div><div class="steps" style="display:block"><b>1.</b> WhatsApp \u2192 <b>Settings \u2192 Linked Devices</b> \u2192 Link a Device<br><b>2.</b> Tap <b>\u201cLink with phone number instead\u201d</b><br><b>3.</b> Type the code above \u2014 done \u2728</div>'}
function form(){return '<input id="num" inputmode="numeric" maxlength="15" placeholder="your number, e.g. 233 50 123 4567"><button id="go">Get pairing code</button>'}
async function pair(){
 var n=document.getElementById('num').value.replace(/[^0-9]/g,'');
 if(!n){shake();return}
 var b=document.getElementById('go');b.disabled=true;b.innerHTML='<span class="spin"></span>Requesting\u2026';
 var r=await fetch('/pair?number='+n);var j=await r.json();
 if(j.error){b.disabled=false;b.textContent='Get pairing code';setBadge('err',j.error);return}
 code=j.code;render();
}
function shake(){var e=document.getElementById('num');e.style.borderColor='#f87171';e.style.animation='none';e.offsetHeight;e.style.animation='shake .4s'}
function setBadge(t,txt){var b=document.getElementById('badge');b.className='badge '+(t||'');document.getElementById('btxt').textContent=txt}
function render(){
 var box=document.getElementById('box');
 if(code){box.innerHTML=codeHTML(code);setBadge('ok','code ready \u2014 expires in ~2 min');return}
 box.innerHTML=form();
 document.getElementById('go').onclick=pair;
 document.getElementById('num').addEventListener('keydown',function(e){if(e.key==='Enter')pair()});
}
async function refresh(){
 try{
  var s=await (await fetch('/status')).json();
  if(s.connected){setBadge('ok','connected as +'+s.user);document.getElementById('box').innerHTML='<div class="steps" style="text-align:center;font-size:14px;line-height:1.8">\u2705 Bot is live!<br>Open WhatsApp and type <b>.menu</b></div>';return}
  if(s.pairingCode){code=s.pairingCode;render();setBadge('ok','code ready \u2014 expires in ~2 min');return}
  if(s.lastError&&s.lastError.indexOf('401')>-1){setBadge('err','fresh session \u2014 enter your number');}
  else setBadge('','waiting for pairing\u2026');
  if(!code)render();
 }catch(e){setBadge('err','connection lost \u2014 retrying\u2026')}
}
render();refresh();setInterval(refresh,4000);
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
