// evil⁶⁶⁶MD — command pack: fancy categorized menu, DP commands, AI chat, owner cmds
const https = require('node:https');

function getJSON(url, headers = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getJSON(res.headers.location, headers, timeout).then(resolve, reject);
      }
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
function getBuffer(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getBuffer(res.headers.location, timeout).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function safeCalc(expr) {
  if (!/^[-+*/().\d\s%^]+$/.test(expr)) return null;
  try {
    const v = Function('"use strict"; return (' + expr.replace(/\^/g, '**') + ')')();
    return typeof v === 'number' && isFinite(v) ? String(v) : null;
  } catch { return null; }
}

const FALLBACK_QUOTES = [
  '"The best way to predict the future is to create it." — Peter Drucker',
  '"Simplicity is the ultimate sophistication." — Leonardo da Vinci',
];
const FALLBACK_JOKES = ['Why do programmers prefer dark mode? Because light attracts bugs. 🐛'];

// ---------- image handlers ----------
async function sendGirlDP(c, note) {
  const n = 1 + Math.floor(Math.random() * 99);
  await c.sendImage(`https://randomuser.me/api/portraits/women/${n}.jpg`, note || `❦ Girl DP #${n} — evil⁶⁶⁶MD`);
}
async function sendBoyDP(c, note) {
  const n = 1 + Math.floor(Math.random() * 99);
  await c.sendImage(`https://randomuser.me/api/portraits/men/${n}.jpg`, note || `❦ Boy DP #${n} — evil⁶⁶⁶MD`);
}
async function sendAnimeGirl(c, note) {
  try {
    const j = await getJSON('https://nekos.best/api/v2/waifu');
    const u = j.results?.[0]?.url;
    await c.sendImage(u, (note || '') + `\n🎨 by ${j.results?.[0]?.artist_name || 'unknown'}`);
  } catch { await c.send('⚠️ Anime image service down, try again.'); }
}

// ---------- handlers ----------
const handlers = {
  ping: async (c) => {
    const lat = Date.now() - Number(c.msg.messageTimestamp) * 1000;
    c.send(`🏓 *evil⁶⁶⁶MD is alive*\n⚡ Speed: ${lat > 0 ? lat : 0}ms\n⏱ Uptime: ${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s`);
  },
  menu: async (c) => {
    const upm = Math.floor(process.uptime() / 60);
    const box = (title, items) =>
      `╭─❏ 『 ${title} 』\n` + items.map((i) => `│ ◈ ${i}`).join('\n') + '\n╰───────────────⳹';
    const total = Object.keys(c.all).length;
    const body = [
      `╭━❮ 🌑 𝗘𝗩𝗜𝗟⁶𝟲𝟲𝗠𝗗 ❯━⳹`,
      `│ 🤖 Bot: evil⁶⁶⁶MD`,
      `│ 👑 Owner: ${c.owner ? 'wa.me/' + c.owner : 'not set'}`,
      `│ 📚 Commands: ${total}+`,
      `│ ⏱ Uptime: ${upm}m`,
      `│ 🤖 Chatbot: ${c.chatbotOn() ? 'ON ✅' : 'OFF ❌'}`,
      `╰───────────────⳹`,
      box('🅰️ AI', ['AI <text>', 'CHATBOT ON/OFF']),
      box('🖼 DP / IMAGES', ['GIRLDP1-22', 'BOYDP1-22', 'ANIMEGIRL1-3', 'ANIME', 'WAIFU']),
      box('🧰 UTILITY', ['PING', 'ALIVE', 'UPTIME', 'CALC', 'DEFINE', 'WEATHER', 'TIME', 'TRANSLATE', 'CRYPTO', 'ECHO']),
      box('🎮 FUN', ['JOKE', 'QUOTE', 'FACT', 'ADVICE', 'FLIP', 'DICE', 'PICK', 'LOVE', 'SHIP', 'RATE', 'MOCK']),
      box('👥 GROUP', ['TAGALL', 'KICK', 'ADD', 'PROMOTE', 'DEMOTE', 'GROUPINFO']),
      box('👑 OWNER', ['CHATBOT ON/OFF', 'SETPP', 'SETNAME', 'SETBIO', 'BLOCK', 'UNBLOCK', 'JOIN', 'BC', 'BAN', 'UNBAN']),
      ``,
      `│ © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗘𝗩𝗜𝗟⁶𝟲𝟲𝗠𝗗`,
    ].join('\n');
    c.send(body);
  },
  owner: async (c) => c.send(`👑 Owner: wa.me/${c.owner || 'not set'}\n🤖 evil⁶⁶⁶MD`),

  // DP commands — numbered like GIRLDP1..22 all map here
  girldp: (c) => sendGirlDP(c),
  boydp: (c) => sendBoyDP(c),
  animegirl: (c) => sendAnimeGirl(c, '❦ Anime girl'),
  anime: (c) => sendAnimeGirl(c, '❦ Anime'),
  waifu: (c) => sendAnimeGirl(c, '❦ Waifu'),

  // AI — direct chat
  ai: async (c) => {
    const q = c.args.join(' ');
    if (!q) return c.send('🤖 Usage: .ai <your message>\nOr turn on auto-replies: .chatbot on');
    await c.send('🤖 thinking…');
    try { await c.send(c.chat(q)); }
    catch (e) { c.send('🤖 ⚠️ ' + e.message); }
  },
  chatbot: async (c) => {
    const mode = (c.args[0] || '').toLowerCase();
    if (mode === 'on' || mode === 'off') {
      const r = c.setChatbot(mode === 'on');
      c.send(`🤖 Chatbot is now *${mode.toUpperCase()}*.\n${mode === 'on' ? "I'll reply to messages that tag/reply to me (and all DMs)." : 'Auto-replies disabled.'}\n${r}`);
    } else c.send(`🤖 Chatbot: *${c.chatbotOn() ? 'ON' : 'OFF'}*\nUsage: .chatbot on / .chatbot off`);
  },

  // owner
  setpp: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    try {
      await sendAnimeGirl(c, '🖼 Setting this as my profile picture…');
      const j = await getJSON('https://nekos.best/api/v2/waifu');
      const buf = await getBuffer(j.results[0].url);
      await c.sock.updateProfilePicture(c.sock.user.id, buf);
      c.send('✅ Profile picture updated.');
    } catch (e) { c.send('⚠️ ' + e.message); }
  },
  setname: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    if (!c.args.length) return c.send('👑 Usage: .setname <name>');
    await c.sock.updateProfileName(c.args.join(' ')); c.send('✅ Name updated.');
  },
  setbio: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    if (!c.args.length) return c.send('👑 Usage: .setbio <bio>');
    await c.sock.updateProfileStatus(c.args.join(' ')); c.send('✅ Bio updated.');
  },
  block: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    const n = (c.args[0] || '').replace(/[^0-9]/g, '');
    if (!n) return c.send('👑 Usage: .block <number>');
    await c.sock.updateBlockStatus(n + '@s.whatsapp.net', 'block'); c.send('✅ Blocked.');
  },
  unblock: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    const n = (c.args[0] || '').replace(/[^0-9]/g, '');
    if (!n) return c.send('👑 Usage: .unblock <number>');
    await c.sock.updateBlockStatus(n + '@s.whatsapp.net', 'unblock'); c.send('✅ Unblocked.');
  },
  join: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    const code = (c.args[0] || '').replace(/invite\/|https:\/\/chat\.whatsapp\.com\//g, '');
    if (!code) return c.send('👑 Usage: .join <chat.whatsapp.com/...>');
    try { await c.sock.groupAcceptInvite(code); c.send('✅ Joined.'); } catch { c.send('❌ Invalid/expired invite.'); }
  },
  bc: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    const text = c.args.join(' ');
    if (!text) return c.send('👑 Usage: .bc <message — broadcast to all chats>');
    const chats = new Set();
    for (const id of Object.keys(await c.sock.chats ? {} : {})) {} // noop
    try {
      const all = await c.sock.groupFetchAllParticipating();
      for (const g of Object.keys(all)) chats.add(g);
    } catch {}
    c.send(`📢 Broadcasting to ${chats.size} groups…`);
    for (const jid of chats) { await c.sock.sendMessage(jid, { text: `📢 *BROADCAST*\n\n${text}` }).catch(() => {}); await new Promise((r) => setTimeout(r, 500)); }
  },
  ban: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    const n = ((c.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0] || (c.args[0] ? c.args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : ''));
    if (!n) return c.send('👑 Tag user or .ban <number>');
    c.banUser(n, true); c.send('🚫 User banned from using the bot.');
  },
  unban: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    const n = ((c.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0] || (c.args[0] ? c.args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : ''));
    if (!n) return c.send('👑 Tag user or .unban <number>');
    c.banUser(n, false); c.send('✅ User unbanned.');
  },

  // tools
  calc: async (c) => { const r = safeCalc(c.args.join(' ')); c.send(r ? `🧮 = *${r}*` : '🧮 Usage: .calc 2+2*10'); },
  define: async (c) => {
    const w = c.args[0]; if (!w) return c.send('📖 Usage: .define <word>');
    try { const d = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${w}`); c.send(`📖 *${w}*: ${d[0]?.meanings?.[0]?.definitions?.[0]?.definition || 'not found'}`); }
    catch { c.send('📖 Dictionary unreachable.'); }
  },
  weather: async (c) => {
    const q = c.args.join(' '); if (!q) return c.send('⛅ Usage: .weather <city>');
    try {
      const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q)}`);
      const loc = g.results?.[0]; if (!loc) return c.send(`⛅ Can't find *${q}*.`);
      const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`);
      const cc = w.current;
      c.send(`⛅ *${loc.name}, ${loc.country}*\n🌡 ${cc.temperature_2m}°C\n💧 ${cc.relative_humidity_2m}%\n💨 ${cc.wind_speed_10m} km/h`);
    } catch { c.send('⛅ Weather unreachable.'); }
  },
  time: async (c) => c.send(`🕒 ${new Date().toLocaleString('en-GB', { timeZone: c.args[0] || 'UTC' })}`),
  translate: async (c) => {
    const p = c.args.join(' ').split('|').map((s) => s.trim());
    if (p.length < 2) return c.send('🌍 Usage: .translate fr | hello');
    try { const r = await getJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(p.slice(1).join(' '))}&langpair=en|${p[0]}`); c.send('🌍 ' + (r.responseData?.translatedText || 'failed')); }
    catch { c.send('🌍 Translate unreachable.'); }
  },
  crypto: async (c) => {
    const ids = { btc: 'bitcoin', eth: 'ethereum', doge: 'dogecoin', sol: 'solana', bnb: 'binancecoin', xrp: 'ripple', ada: 'cardano' };
    const coin = ids[(c.args[0] || 'btc').toLowerCase()]; if (!coin) return c.send('₿ Try: btc eth doge sol bnb xrp ada');
    try { const d = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd&include_24hr_change=true`); const p = d[coin]; c.send(`₿ *${(c.args[0] || 'btc').toUpperCase()}* $${p.usd} (${p.usd_24h_change >= 0 ? '🟢+' : '🔴'}${p.usd_24h_change?.toFixed(2)}%)`); }
    catch { c.send('₿ Price unreachable.'); }
  },
  echo: async (c) => c.send(c.args.join(' ') || '…'),
  uptime: async (c) => c.send(`⏱ ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`),

  // fun
  joke: async (c) => { try { const j = await getJSON('https://official-joke-api.appspot.com/random_joke'); c.send(`😂 ${j.setup}\n_${j.punchline}_`); } catch { c.send('😂 ' + FALLBACK_JOKES[0]); } },
  quote: async (c) => { try { const q = await getJSON('https://zenquotes.io/api/random'); c.send(`❝ ${q[0].q}❞\n— ${q[0].a}`); } catch { c.send(FALLBACK_QUOTES[0]); } },
  fact: async (c) => { try { const f = await getJSON('https://uselessfacts.jsph.pl/random.json?language=en'); c.send('🤓 ' + f.text); } catch { c.send('🤓 Honey never spoils.'); } },
  advice: async (c) => { try { const a = await getJSON('https://api.adviceslip.com/advice'); c.send('💡 ' + a.slip.advice); } catch { c.send('💡 Never test depth with both feet.'); } },
  flip: async (c) => c.send('🪙 ' + (Math.random() < 0.5 ? '*HEADS*' : '*TAILS*')),
  dice: async (c) => c.send(`🎲 *${1 + Math.floor(Math.random() * 6)}*`),
  pick: async (c) => { const o = c.args.join(' ').split(/[,|]/).filter(Boolean); if (o.length < 2) return c.send('🤔 Usage: .pick a, b, c'); c.send(`🤔 *${o[Math.floor(Math.random() * o.length)].trim()}*`); },
  love: async (c) => c.send(`❤️ *${c.args.join(' ') || 'us'}*: ${Math.floor(Math.random() * 101)}%`),
  ship: async (c) => { if (c.args.length < 2) return c.send('💘 .ship name1 name2'); c.send(`💘 *${c.args[0]} x ${c.args[1]}* = ${Math.floor(Math.random() * 101)}%`); },
  rate: async (c) => c.send(`⭐ ${(c.args.join(' ') || 'you')}: ${1 + Math.floor(Math.random() * 10)}/10`),
  mock: async (c) => c.send((c.args.join(' ') || 'hi').split('').map((ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase())).join('')),

  // group
  tagall: async (c) => {
    if (!c.jid.endsWith('@g.us')) return c.send('👥 Groups only.');
    const meta = await c.sock.groupMetadata(c.jid);
    c.send('📢 *Attention everyone!*\n' + meta.participants.map((p) => '@' + p.id.split('@')[0]).join(' '), { mentions: meta.participants.map((p) => p.id) });
  },
  groupinfo: async (c) => {
    if (!c.jid.endsWith('@g.us')) return c.send('👥 Groups only.');
    const g = await c.sock.groupMetadata(c.jid);
    c.send(`👥 *${g.subject}*\nMembers: ${g.participants.length}`);
  },
  kick: async (c) => {
    if (!c.isOwner) return c.send('👑 Owner only.');
    const t = (c.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
    if (!t) return c.send('👥 Tag someone to kick.');
    try { await c.sock.groupParticipantsUpdate(c.jid, [t], 'remove'); c.send('✅ Removed.'); } catch { c.send('❌ I need admin.'); }
  },
  add: async (c) => {
    const n = (c.args[0] || '').replace(/[^0-9]/g, ''); if (!n) return c.send('👥 .add <number>');
    try { await c.sock.groupParticipantsUpdate(c.jid, [n + '@s.whatsapp.net'], 'add'); c.send('✅ Added.'); } catch { c.send('❌ Could not add.'); }
  },
  promote: async (c) => {
    const t = (c.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0]; if (!t) return c.send('👥 Tag someone.');
    try { await c.sock.groupParticipantsUpdate(c.jid, [t], 'promote'); c.send('✅ Promoted.'); } catch { c.send('❌ I need admin.'); }
  },
  demote: async (c) => {
    const t = (c.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0]; if (!t) return c.send('👥 Tag someone.');
    try { await c.sock.groupParticipantsUpdate(c.jid, [t], 'demote'); c.send('✅ Demoted.'); } catch { c.send('❌ I need admin.'); }
  },
};

// ---------- aliases ----------
const aliasGroups = {
  ping: ['ping', 'p', 'alive', 'test', 'speed', 'pong'],
  menu: ['menu', 'help', 'cmds', 'cmd', 'commands', 'list', 'all', 'm'],
  owner: ['owner', 'creator', 'dev', 'boss'],
  uptime: ['uptime', 'runtime', 'rt', 'upt'],
  echo: ['echo', 'say', 'repeat'],
  girldp: Array.from({ length: 30 }, (_, i) => 'girldp' + (i + 1)).concat(['girldp', 'girldpimage', 'girlpic', 'girlphoto', 'beauty', 'cute', 'girl']),
  boydp: Array.from({ length: 30 }, (_, i) => 'boydp' + (i + 1)).concat(['boydp', 'boy', 'man', 'boy pic', 'boyphoto']),
  animegirl: ['animegirl', 'animegirl1', 'animegirl2', 'animegirl3', 'animegirl4', 'animegirl5', 'waifu2', 'waifupic', 'animepic'],
  anime: ['anime', 'animepic2', 'animes', 'manga'],
  waifu: ['waifu', 'w', 'waifus'],
  ai: ['ai', 'gpt', 'chatgpt', 'claude', 'ask', 'brain', 'genius'],
  chatbot: ['chatbot', 'autoreply', 'botmode'],
  calc: ['calc', 'calculate', 'math', 'solve'],
  define: ['define', 'dict', 'meaning', 'def'],
  weather: ['weather', 'temp', 'climate', 'forecast'],
  time: ['time', 'clock', 'now', 'date'],
  translate: ['translate', 'tr', 'trans'],
  crypto: ['crypto', 'btc', 'eth', 'price', 'coin'],
  joke: ['joke', 'funny', 'lol', 'humor'],
  quote: ['quote', 'quotes', 'inspire', 'motivation'],
  fact: ['fact', 'facts', 'trivia'],
  advice: ['advice', 'tip', 'tips'],
  flip: ['flip', 'coin', 'toss'],
  dice: ['dice', 'die', 'roll'],
  pick: ['pick', 'choose', 'select', 'decide'],
  love: ['love', 'heart', 'crush'],
  ship: ['ship', 'match', 'couple'],
  rate: ['rate', 'score', 'rank', 'r8'],
  mock: ['mock', 'spongebob', 'sarcastic'],
  tagall: ['tagall', 'tag', 'everyone', 'mention', 'all2'],
  groupinfo: ['groupinfo', 'ginfo', 'gc', 'group'],
  kick: ['kick', 'remove', 'boot'],
  add: ['add', 'invite'],
  promote: ['promote', 'op'],
  demote: ['demote', 'deop'],
  setpp: ['setpp', 'setdp', 'setpfp', 'pp'],
  setname: ['setname', 'name', 'rename'],
  setbio: ['setbio', 'bio', 'about'],
  block: ['block', 'ban2'],
  unblock: ['unblock', 'unban2'],
  join: ['join', 'link', 'enter'],
  bc: ['bc', 'broadcast', 'announce'],
  ban: ['ban', 'blacklist'],
  unban: ['unban', 'whitelist'],
};

const all = {};
for (const [key, aliases] of Object.entries(aliasGroups)) for (const a of aliases) all[a.trim()] = key;

const table = {};
for (const [key, fn] of Object.entries(handlers)) table[key] = { run: fn };
const desc = {};

module.exports = { all, table, desc, getJSON, getBuffer, safeCalc };
