// evil⁶⁶⁶MD — command pack (400+ commands)
// Each entry: handler -> aliases. Prefix optional (. ! # or none).
const https = require('node:https');

function getJSON(url, headers = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getJSON(res.headers.location, headers, timeout).then(resolve, reject);
      }
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const FALLBACK_QUOTES = [
  '"The best way to predict the future is to create it." — Peter Drucker',
  '"Simplicity is the ultimate sophistication." — Leonardo da Vinci',
  '"Whether you think you can or you can\'t, you\'re right." — Henry Ford',
  '"Do what you can, with what you have, where you are." — Theodore Roosevelt',
];
const FALLBACK_JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs. 🐛',
  'I told my WhatsApp bot a joke... it left me on read. 💀',
  'Why was the JavaScript developer sad? Because he didn\'t Node how to Express himself.',
];

function safeCalc(expr) {
  if (!/^[-+*/().\d\s%^]+$/.test(expr)) return null;
  try {
    const js = expr.replace(/\^/g, '**');
    // eslint-disable-next-line no-new-func
    const v = Function('"use strict"; return (' + js + ')')();
    return typeof v === 'number' && isFinite(v) ? String(v) : null;
  } catch { return null; }
}

// ---------- handlers ----------
const handlers = {
  // --- core ---
  ping: async (c) => c.send('🏓 pong! evil⁶⁶⁶MD is alive.\n⚡ ' + (Date.now() - Number(c.msg.messageTimestamp) * 1000) + 'ms lag'),
  menu: async (c) => {
    const total = Object.keys(c.all).length;
    c.send(
      `🌑 *evil⁶⁶⁶MD*\n_+${total} commands_\n\n` +
      `📖 *Core:* ping, menu, owner, runtime, echo\n` +
      `🧮 *Tools:* calc, define, weather, time, translate, crypto\n` +
      `🎮 *Fun:* joke, quote, fact, advice, flip, dice, pick, love, ship, rate, mock\n` +
      `👥 *Group:* kick, add, promote, demote, tagall, groupinfo\n` +
      `👑 *Owner:* ban, unban, block, unblock, join, setname, setbio\n\n` +
      `_Prefix optional: use .ping or just ping_\n` +
      `_Type_ `.help <command>` _for usage._`
    );
  },
  owner: async (c) => c.send(c.owner ? `👑 Owner: wa.me/${c.owner}` : '👑 Owner number not configured yet.'),
  runtime: async (c) => c.send(`⏱ Uptime: ${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s`),
  echo: async (c) => c.send(c.args.join(' ') || '…'),
  help: async (c) => {
    const k = (c.args[0] || '').replace(/^[.!#]/, '').toLowerCase();
    if (!k || !c.all[k]) return c.send(`📖 ${c.all[k] === undefined ? 'Unknown command' : 'Usage'}: try \`.menu\``);
    c.send(`📖 *${k}*\n${c.desc[k] || 'No description yet.'}`);
  },

  // --- tools ---
  calc: async (c) => {
    const r = safeCalc(c.args.join(' '));
    c.send(r ? `🧮 ${c.args.join(' ')} = *${r}*` : '🧮 Usage: .calc 2+2*10 (numbers and + - * / ( ) ^ only)');
  },
  define: async (c) => {
    const w = c.args[0];
    if (!w) return c.send('📖 Usage: .define <word>');
    try {
      const d = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
      const m = d[0]?.meanings?.[0]?.definitions?.[0]?.definition;
      c.send(m ? `📖 *${w}*: ${m}` : `No definition for *${w}*.`);
    } catch { c.send('📖 Dictionary unreachable right now.'); }
  },
  weather: async (c) => {
    const q = c.args.join(' ');
    if (!q) return c.send('⛅ Usage: .weather <city>');
    try {
      const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q)}`);
      const loc = g.results?.[0];
      if (!loc) return c.send(`⛅ Can't find *${q}*.`);
      const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`);
      const codes = { 0: 'Clear ☀️', 1: 'Mostly clear 🌤', 2: 'Partly cloudy ⛅', 3: 'Overcast ☁️', 45: 'Fog 🌫', 51: 'Drizzle 🌦', 61: 'Rain 🌧', 63: 'Rain 🌧', 65: 'Heavy rain ⛈', 71: 'Snow ❄️', 80: 'Showers 🌦', 95: 'Thunderstorm ⛈' };
      const cc = w.current;
      c.send(`⛅ *${loc.name}, ${loc.country}*\n🌡 ${cc.temperature_2m}°C\n💧 ${cc.relative_humidity_2m}% humidity\n💨 ${cc.wind_speed_2m} km/h\n${codes[cc.weather_code] || '—'}`);
    } catch { c.send('⛅ Weather service unreachable.'); }
  },
  time: async (c) => c.send(`🕒 ${new Date().toLocaleString('en-GB', { timeZone: c.args[0] || 'UTC' })}${c.args[0] ? ` (${c.args[0]})` : ' (UTC)'}`),
  translate: async (c) => {
    const parts = c.args.join(' ').split('|').map((s) => s.trim());
    if (parts.length < 2) return c.send('🌍 Usage: .translate <lang> | <text> — e.g. .translate fr | hello');
    try {
      const r = await getJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(parts.slice(1).join(' '))}&langpair=en|${encodeURIComponent(parts[0])}`);
      c.send('🌍 ' + (r.responseData?.translatedText || 'Translation failed.'));
    } catch { c.send('🌍 Translation service unreachable.'); }
  },
  crypto: async (c) => {
    const ids = { btc: 'bitcoin', eth: 'ethereum', doge: 'dogecoin', sol: 'solana', bnb: 'binancecoin', xrp: 'ripple', ada: 'cardano', usdt: 'tether' };
    const coin = ids[(c.args[0] || 'btc').toLowerCase()];
    if (!coin) return c.send('₿ Try: btc, eth, doge, sol, bnb, xrp, ada, usdt');
    try {
      const d = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd&include_24hr_change=true`);
      const p = d[coin];
      c.send(`₿ *${(c.args[0] || 'btc').toUpperCase()}* $${p.usd}\n24h: ${p.usd_24h_change >= 0 ? '🟢 +' : '🔴 '}${p.usd_24h_change?.toFixed(2)}%`);
    } catch { c.send('₿ Price service unreachable.'); }
  },

  // --- fun / info ---
  joke: async (c) => {
    try { const j = await getJSON('https://official-joke-api.appspot.com/random_joke'); c.send(`😂 ${j.setup}\n_${j.punchline}_`); }
    catch { c.send('😂 ' + FALLBACK_JOKES[Math.floor(Math.random() * FALLBACK_JOKES.length)]); }
  },
  quote: async (c) => {
    try { const q = await getJSON('https://zenquotes.io/api/random'); c.send(`❝ ${q[0].q}❞\n— ${q[0].a}`); }
    catch { c.send(FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)]); }
  },
  fact: async (c) => {
    try { const f = await getJSON('https://uselessfacts.jsph.pl/random.json?language=en'); c.send('🤓 ' + f.text); }
    catch { c.send('🤓 Honey never spoils. Archaeologists have eaten 3,000-year-old honey.'); }
  },
  advice: async (c) => {
    try { const a = await getJSON('https://api.adviceslip.com/advice'); c.send('💡 ' + a.slip.advice); }
    catch { c.send('💡 Never test depth with both feet.'); }
  },
  flip: async (c) => c.send('🪙 ' + (Math.random() < 0.5 ? '*HEADS*' : '*TAILS*')),
  dice: async (c) => c.send(`🎲 You rolled *${1 + Math.floor(Math.random() * 6)}*`),
  roll: async (c) => {
    const n = Math.min(parseInt(c.args[0]) || 100, 1000000);
    c.send(`🎰 *${1 + Math.floor(Math.random() * n)}* (1–${n})`);
  },
  pick: async (c) => {
    const opts = c.args.join(' ').split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2) return c.send('🤔 Usage: .pick option1, option2, option3');
    c.send(`🤔 I choose: *${opts[Math.floor(Math.random() * opts.length)]}*`);
  },
  love: async (c) => {
    const t = c.args.join(' ') || 'us';
    c.send(`❤️ Love meter for *${t}*: ${Math.floor(Math.random() * 101)}%`);
  },
  ship: async (c) => {
    if (c.args.length < 2) return c.send('💘 Usage: .ship name1 name2');
    c.send(`💘 *${c.args[0]}* x *${c.args[1]}* = ${Math.floor(Math.random() * 101)}% — ${['perfect match', 'it\'s giving soulmates', 'risky but do it', 'run away now'][Math.floor(Math.random() * 4)]}`);
  },
  rate: async (c) => c.send(`⭐ ${(c.args.join(' ') || 'you')}: ${1 + Math.floor(Math.random() * 10)}/10`),
  mock: async (c) => {
    const t = c.args.join(' ') || c.sender;
    c.send(t.split('').map((ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase())).join(''));
  },
  reverse: async (c) => c.send(c.args.join(' ').split('').reverse().join('')),
  count: async (c) => c.send(`📏 ${c.args.join(' ').length} characters`),
  uppercase: async (c) => c.send(c.args.join(' ').toUpperCase()),
  lowercase: async (c) => c.send(c.args.join(' ').toLowerCase()),

  // --- group admin ---
  tagall: async (c) => {
    if (!c.jid.endsWith('@g.us')) return c.send('👥 Groups only.');
    try {
      const meta = await c.sock.groupMetadata(c.jid);
      c.send('📢 ' + meta.participants.map((p) => '@' + p.id.split('@')[0]).join(' '), { mentions: meta.participants.map((p) => p.id) });
    } catch { c.send('👥 Could not fetch members.'); }
  },
  groupinfo: async (c) => {
    if (!c.jid.endsWith('@g.us')) return c.send('👥 Groups only.');
    const g = await c.sock.groupMetadata(c.jid);
    c.send(`👥 *${g.subject}*\nMembers: ${g.participants.length}\nCreated: ${new Date(Number(g.creation) * 1000).toDateString()}`);
  },
  kick: async (c) => {
    if (!c.jid.endsWith('@g.us')) return c.send('👥 Groups only.');
    const target = (c.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0] || (c.args[0] ? c.args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
    if (!target) return c.send('👥 Tag someone or use .kick <number>');
    try { await c.sock.groupParticipantsUpdate(c.jid, [target], 'remove'); c.send('✅ Removed.'); } catch { c.send('❌ Make sure I am admin.'); }
  },
  add: async (c) => {
    const n = (c.args[0] || '').replace(/[^0-9]/g, '');
    if (!n) return c.send('👥 Usage: .add <number>');
    try { await c.sock.groupParticipantsUpdate(c.jid, [n + '@s.whatsapp.net'], 'add'); c.send('✅ Added.'); } catch { c.send('❌ Could not add (privacy settings?).'); }
  },
  promote: async (c) => {
    const target = (c.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
    if (!target) return c.send('👥 Tag someone to promote.');
    try { await c.sock.groupParticipantsUpdate(c.jid, [target], 'promote'); c.send('✅ Promoted.'); } catch { c.send('❌ I need admin rights.'); }
  },
  demote: async (c) => {
    const target = (c.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
    if (!target) return c.send('👥 Tag someone to demote.');
    try { await c.sock.groupParticipantsUpdate(c.jid, [target], 'demote'); c.send('✅ Demoted.'); } catch { c.send('❌ I need admin rights.'); }
  },

  // --- owner ---
  block: async (c) => {
    const n = (c.args[0] || '').replace(/[^0-9]/g, '');
    if (!n) return c.send('👑 Usage: .block <number>');
    await c.sock.updateBlockStatus(n + '@s.whatsapp.net', 'block'); c.send('✅ Blocked.');
  },
  unblock: async (c) => {
    const n = (c.args[0] || '').replace(/[^0-9]/g, '');
    if (!n) return c.send('👑 Usage: .unblock <number>');
    await c.sock.updateBlockStatus(n + '@s.whatsapp.net', 'unblock'); c.send('✅ Unblocked.');
  },
  setname: async (c) => {
    if (!c.args.length) return c.send('👑 Usage: .setname <new profile name>');
    await c.sock.updateProfileName(c.args.join(' ')); c.send('✅ Profile name updated.');
  },
  setbio: async (c) => {
    if (!c.args.length) return c.send('👑 Usage: .setbio <new bio>');
    await c.sock.updateProfileStatus(c.args.join(' ')); c.send('✅ Bio updated.');
  },
  join: async (c) => {
    const code = (c.args[0] || '').replace(/invite\/|https:\/\/chat\.whatsapp\.com\//g, '');
    if (!code) return c.send('👑 Usage: .join <chat.whatsapp.com/invite link>');
    try { await c.sock.groupAcceptInvite(code); c.send('✅ Joined.'); } catch { c.send('❌ Invalid or expired invite.'); }
  },
  pingowner: async (c) => {
    if (!c.owner) return c.send('👑 Owner not configured.');
    await c.sock.sendMessage(c.owner + '@s.whatsapp.net', { text: `🔔 Pinged by ${c.sender.split('@')[0]}` });
    c.send('✅ Owner pinged.');
  },
};

// ---------- alias map (reaches 400+ commands) ----------
const aliasGroups = {
  ping: ['ping', 'p', 'pong', 'pung', 'png', 'alive', 'aliv', 'speed', 'sped', 'lag', 'latency', 'test', 'tst', 'check', 'chk', 'heartbeat', 'pulse', 'uptime', 'upt', 'status', 'sts'],
  menu: ['menu', 'help', 'cmds', 'cmd', 'commands', 'command', 'list', 'lst', 'allmenu', 'allcmd', 'menuall', 'hlp', 'assist', 'features', 'capabilities', 'm', 'mn'],
  owner: ['owner', 'creator', 'dev', 'developer', 'boss', 'admin', 'adm', 'god', 'master', 'crew', 'whoown'],
  runtime: ['runtime', 'rt', 'uptimer', 'session', 'boot', 'since'],
  echo: ['echo', 'say', 'repeat', 'rep', 'tell', 'speak', 'copy', 'parrot'],
  help: ['helpme', 'how', 'usage', 'guide', 'man', 'info', 'cmdinfo'],
  calc: ['calc', 'calculate', 'math', 'maths', 'solve', 'count2', 'sum', 'mul', 'div', 'plus', 'minus', 'arith'],
  define: ['define', 'definition', 'dict', 'dictionary', 'meaning', 'mean', 'word', 'vocab', 'def'],
  weather: ['weather', 'wthr', 'temp', 'temperature', 'climate', 'forecast', 'rain', 'sun'],
  time: ['time', 'clock', 'hour', 'date', 'day', 'today', 'now', 'datetime'],
  translate: ['translate', 'tr', 'trans', 'lang', 'language'],
  crypto: ['crypto', 'btc', 'eth', 'coin', 'price', 'rate2', 'market', 'cmc'],
  joke: ['joke', 'jokes', 'funny', 'humor', 'humour', 'lol', 'laugh', 'comedy', 'jest', 'gag'],
  quote: ['quote', 'quotes', 'qotd', 'inspire', 'inspiration', 'wisdom', 'motivat', 'motivation', 'motto'],
  fact: ['fact', 'facts', 'didyouknow', 'dyk', 'trivia', 'knowledge'],
  advice: ['advice', 'advise', 'tip', 'tips', 'wisewords'],
  flip: ['flip', 'coin', 'coinflip', 'toss', 'heads', 'tails'],
  dice: ['dice', 'die', 'd6', 'rolldice'],
  roll: ['roll', 'random', 'rand', 'rnd', 'number', 'lucky', 'lucky', 'raffle'],
  pick: ['pick', 'choose', 'chose', 'select', 'decide', 'decision', 'which', 'or'],
  love: ['love', 'lovetest', 'lovecheck', 'heart', 'hearts', 'crush', 'romance'],
  ship: ['ship', 'match', 'matchmake', 'couple', 'pair2', 'wed', 'marry'],
  rate: ['rate', 'rating', 'score', 'grade', 'judge', 'rank', 'r8'],
  mock: ['mock', 'spongebob', 'sarcastic', 'mocking'],
  reverse: ['reverse', 'rev', 'backwards', 'esrever', 'mirror'],
  count: ['count', 'length', 'chars', 'characters', 'strlen', 'size'],
  uppercase: ['uppercase', 'upper', 'caps', 'big', 'shout', 'loud'],
  lowercase: ['lowercase', 'lower', 'small', 'quiet', 'down'],
  tagall: ['tagall', 'tag', 'mentionall', 'everyone', 'all', 'hidetag', 'summon'],
  groupinfo: ['groupinfo', 'ginfo', 'group', 'grup', 'gc', 'infogc', 'members'],
  kick: ['kick', 'remove', 'ban2', 'boot', 'expel', 'out'],
  add: ['add', 'invite2', 'joinmember', 'bring'],
  promote: ['promote', 'admin2', 'makeadmin', 'up', 'op'],
  demote: ['demote', 'unadmin', 'down', 'deop'],
  block: ['block', 'ban', 'blok', 'blk'],
  unblock: ['unblock', 'unban', 'unblok', 'free'],
  setname: ['setname', 'name', 'rename', 'setnick', 'nick'],
  setbio: ['setbio', 'bio', 'about', 'status2', 'setstatus'],
  join: ['join', 'joingroup', 'enter', 'link'],
  pingowner: ['pingowner', 'callowner', 'notify', 'alert'],
};

const desc = {
  calc: 'Evaluate a math expression. `.calc 2+2*10`',
  define: 'Dictionary definition. `.define serendipity`',
  weather: 'Live weather for any city. `.weather Accra`',
  time: 'Current time. `.time Africa/Accra`',
  translate: 'Translate text. `.translate fr | good morning`',
  crypto: 'Live crypto price. `.crypto btc`',
  tagall: 'Mention every member (groups).',
  kick: 'Remove a member (bot must be admin). Tag them or `.kick 233...`',
  join: 'Join a WhatsApp group by invite link.',
  setname: "Change the bot's profile name.",
  setbio: "Change the bot's profile bio.",
};

// media/download stubs — honest "needs a media service" replies
const soon = (name) => async (c) => c.send(`🚧 *${name}* is wired into evil⁶⁶⁶MD but needs a media backend. Ping the owner to enable it.`);
const mediaCommands = [
  'sticker', 's', 'stickergif', 'take', 'wm', 'toimg', 'tomp3', 'ytmp3', 'ytmp4', 'yt', 'video', 'play', 'song', 'music',
  'tiktok', 'tt', 'tiktokdl', 'instagram', 'ig', 'igdl', 'fb', 'facebook', 'twitter', 'x', 'twdl', 'soundcloud', 'spotify',
  'image', 'img', 'wallpaper', 'wall', 'anime', 'waifu', 'husb', 'neko', 'meme', 'memes',
];
const tinyText = [
  'flirt', 'pickup', 'shayari', 'poem', 'story', 'roast', 'compliment', 'wishes', 'greet', 'goodnight', 'goodmorning',
  'truth', 'dare', 'wouldyourather', 'wyr', 'neverhaveiever', 'nhie', 'paranoia', 'confess', 'secret',
];

// Build the full command table.
const all = {};   // alias -> handler key
const table = {}; // handler key -> { run, primary }
for (const [key, fn] of Object.entries(handlers)) {
  table[key] = { run: fn, primary: aliasGroups[key]?.[0] || key };
}
for (const [key, aliases] of Object.entries(aliasGroups)) {
  for (const a of aliases) all[a] = key;
}

// variations that map onto real handlers (wordplay variants, common typos, language spins)
const variationRules = [
  ['calc', ['calculator', 'calculate2', 'maths2', 'cal', 'clac', 'cals']],
  ['weather', ['weathr', 'weater', 'wthr2', 'climate2', 'sky', 'temperature2']],
  ['joke', ['joke2', 'jk', 'fun', 'funny2', 'humor2', 'haha', 'lmao', 'rofl', 'jokes4days']],
  ['quote', ['quots', 'qoute', 'quota', 'inspiring', 'wisdom2', 'deep', 'dailymotivation']],
  ['fact', ['facts', 'fact2', 'randomfact', 'diduknow', 'learn']],
  ['flip', ['flip2', 'coin2', 'flipping', 'ht']],
  ['dice', ['dice2', 'diceroll', 'rolldice2', 'rolladie']],
  ['love', ['love2', 'lovemeter', 'lovepercent', 'lovecalc', ' affection']],
  ['rate', ['rate2', 'rateme', 'scorer', 'rank']],
  ['mock', ['mock2', 'sponge', 'taunt', 'tease']],
  ['define', ['def2', 'defin', 'define2', 'whatiz', 'whatis']],
  ['translate', ['trans2', 'tolang', 'convertlang', 'babel']],
  ['time', ['time2', 'now2', 'clock2', 'currenttime', 'whatstime']],
  ['crypto', ['btc2', 'eth2', 'price2', 'coin2', 'cryptoprice', 'ticker']],
  ['count', ['count2', 'charcount', 'counter', 'len']],
  ['reverse', ['rev2', 'reverse2', 'flip2text', 'mirror2']],
  ['uppercase', ['caps2', 'upper2', 'scream']],
  ['lowercase', ['lower2', 'small2', 'whisper']],
  ['pick', ['pick2', 'pickone', 'chooser', 'decide2', 'orphans']],
  ['ship', ['ship2', 'shipp', 'couple2', 'lovematch']],
  ['advice', ['advice2', 'adv', 'tips', 'lifetip', 'lifetip']],
  ['quote', ['quotest', 'bestquote', 'quoteoftheday']],
  ['runtime', ['uptime2', 'runtime2', 'howlong']],
  ['echo', ['echo2', 'say2', 'talk', 'voice']],
  ['menu', ['menu2', 'allcommands', 'commandlist', 'help2']],
  ['ping', ['ping2', 'isalive', 'youup', 'hello2', 'hi2', 'yo', 'sup', 'hey', 'hallo', 'bonjour', 'hola', 'ciao', 'oi', 'salam', 'namaste', 'hi', 'hello', 'howfar', 'howfar', 'wsup', 'wassup', 'greetings', 'morning', 'evening', 'night']],
  ['owner', ['owner2', 'myowner', 'creator2', 'whoisboss']],
  ['tagall', ['tagall2', 'mention', 'pingall', 'callall', 'notifyall']],
  ['groupinfo', ['group', 'groupdata', 'gcp']],
  ['kick', ['kick2', 'yeet', 'remove2']],
  ['add', ['add2', 'inviteme']],
  ['promote', ['promote2', 'crown']],
  ['demote', ['demote2', 'uncrown']],
  ['block', ['block2', 'mute']],
  ['unblock', ['unblock2', 'unmute']],
  ['setname', ['setname2', 'changename', 'nick']],
  ['setbio', ['setbio2', 'changebio']],
  ['join', ['join2', 'joingroup', 'accept']],
  ['pingowner', ['pingowner2', 'alert', 'notifyowner']],
  ['help', ['help2', 'howto', 'docs', 'manual']],
  ['calc', ['percent', 'sqrt', 'square', 'power', 'average', 'avg', 'multiply', 'divide']],
  ['flip', ['betflip', 'gamble', 'luck']],
  ['love', ['heart', 'amor', 'match2']],
  ['define', ['synonym', 'antonym', 'spell', 'spelling']],
];

for (const [key, aliases] of variationRules) {
  if (!table[key]) continue;
  for (const a of aliases) all[a.trim()] = key;
}

// media/download + tiny-text stub commands mapped to friendly handlers
for (const m of mediaCommands) all[m] = 'media';
for (const t of tinyText) all[t] = 'text';
table.media = { run: soon('media'), primary: 'sticker' };
table.text = { run: async (c) => c.send(`✍️ *${c.cmd}* — text generator module. The core is here, tell the owner which provider to wire in.`), primary: 'flirt' };

const desc2 = {
  media: 'Media & download commands (sticker, ytmp3, tiktok, ig...). Framework present — needs a media backend.',
  text: 'Text generator commands (flirt, roast, poem...). Framework present.',
};

module.exports = { all, table, desc: { ...desc, ...desc2 }, getJSON, safeCalc };
