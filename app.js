const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const app = express();
const axios = require('axios');
const { isUserReseller, addReseller, removeReseller, listResellersSync } = require('./modules/reseller');
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'bot-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'bot-combined.log' }),
  ],
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { 
  createssh
} = require('./modules/create');

const { 
  trialssh
} = require('./modules/trial');

const { 
  renewssh
} = require('./modules/renew');

const { 
  delssh
} = require('./modules/del');

const fsPromises = require('fs/promises');
const path = require('path');
const trialFile = path.join(__dirname, 'trial.db');
const resselFilePath = path.join(__dirname, 'ressel.db');

// Mengecek apakah user sudah pakai trial hari ini
async function checkTrialAccess(userId) {
  try {
    const data = await fsPromises.readFile(trialFile, 'utf8');
    const trialData = JSON.parse(data);
    const lastAccess = trialData[userId];

    const today = new Date().toISOString().slice(0, 10); // format YYYY-MM-DD
    return lastAccess === today;
  } catch (err) {
    return false; // anggap belum pernah pakai kalau file belum ada
  }
}

async function checkServerAccess(serverId, userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT is_reseller_only FROM Server WHERE id = ?', [serverId], async (err, row) => {
      if (err) return reject(err);
      // jika server tidak ada => tolak (caller menangani pesan)
      if (!row) return resolve({ ok: false, reason: 'not_found' });
      const flag = row.is_reseller_only === 1 || row.is_reseller_only === '1';
      if (!flag) return resolve({ ok: true }); // publik
      // jika reseller-only, cek apakah user terdaftar reseller
      try {
        const isR = await isUserReseller(userId);
        if (isR) return resolve({ ok: true });
        return resolve({ ok: false, reason: 'reseller_only' });
      } catch (e) {
        // fallback: tolak akses
        return resolve({ ok: false, reason: 'reseller_only' });
      }
    });
  });
}

// Menyimpan bahwa user sudah pakai trial hari ini
async function saveTrialAccess(userId) {
  let trialData = {};
  try {
    const data = await fsPromises.readFile(trialFile, 'utf8');
    trialData = JSON.parse(data);
  } catch (err) {
    // file belum ada, lanjut
  }

  const today = new Date().toISOString().slice(0, 10);
  trialData[userId] = today;
  await fsPromises.writeFile(trialFile, JSON.stringify(trialData, null, 2));
}


const fs = require('fs');
const vars = JSON.parse(fs.readFileSync('./.vars.json', 'utf8'));

const BOT_TOKEN = vars.BOT_TOKEN;
const port = vars.PORT || 6969;
const ADMIN = vars.USER_ID; 
const NAMA_STORE = vars.NAMA_STORE || '@ARI_VPN_STORE';
const DATA_QRIS = vars.DATA_QRIS;
const GROUP_ID = vars.GROUP_ID;
const APIKEY = vars.auth_paymet_getway;       // apikey gateway
const AUTH_USER = vars.auth_username_mutasi;  // username orderkuota
const AUTH_TOKEN = vars.auth_token_mutasi;    // token orderkuota
const WEB_MUTASI = vars.web_mutasi;           // https://app.orderkuota.com/api/v2/qris/mutasi/ACCOUNT_ID

const bot = new Telegraf(BOT_TOKEN);
let ADMIN_USERNAME = '@ARI_VPN_STORE';
const adminIds = ADMIN;
logger.info('Bot initialized');

(async () => {
  try {
    const adminId = Array.isArray(adminIds) ? adminIds[0] : adminIds;
    const chat = await bot.telegram.getChat(adminId);
    ADMIN_USERNAME = chat.username ? `@${chat.username}` : 'Admin';
    logger.info(`Admin username detected: ${ADMIN_USERNAME}`);
  } catch (e) {
    ADMIN_USERNAME = 'Admin';
    logger.warn('Tidak bisa ambil username admin otomatis.');
  }
})();
//
const db = new sqlite3.Database('./sellzivpn.db', (err) => {
  if (err) {
    logger.error('Kesalahan koneksi SQLite3:', err.message);
  } else {
    logger.info('Terhubung ke SQLite3');
  }
});

db.run(`CREATE TABLE IF NOT EXISTS pending_deposits (
  unique_code TEXT PRIMARY KEY,
  user_id INTEGER,
  amount INTEGER,
  original_amount INTEGER,
  timestamp INTEGER,
  status TEXT,
  qr_message_id INTEGER
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel pending_deposits:', err.message);
  }
});

db.run(`CREATE TABLE IF NOT EXISTS Server (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT,
  auth TEXT,
  harga INTEGER,
  nama_server TEXT,
  quota INTEGER,
  iplimit INTEGER,
  batas_create_akun INTEGER,
  total_create_akun INTEGER,
  is_reseller_only INTEGER DEFAULT 0
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel Server:', err.message);
  } else {
    logger.info('Server table created or already exists');
  }
});

db.run(
  `ALTER TABLE Server ADD COLUMN is_reseller_only INTEGER DEFAULT 0`,
  (err) => {
    if (err && !err.message.includes('duplicate column')) {
      logger.error('Gagal menambahkan kolom is_reseller_only:', err.message);
    } else if (!err) {
      logger.info('Kolom is_reseller_only berhasil ditambahkan');
    }
  }
);

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  saldo INTEGER DEFAULT 0,
  CONSTRAINT unique_user_id UNIQUE (user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel users:', err.message);
  } else {
    logger.info('Users table created or already exists');
  }
});

db.run(`CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  type TEXT,
  reference_id TEXT,
  timestamp INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel transactions:', err.message);
  } else {
    logger.info('Transactions table created or already exists');
    
    // Add reference_id column if it doesn't exist
    db.get("PRAGMA table_info(transactions)", (err, rows) => {
      if (err) {
        logger.error('Kesalahan memeriksa struktur tabel:', err.message);
        return;
      }
      
      db.get("SELECT * FROM transactions WHERE reference_id IS NULL LIMIT 1", (err, row) => {
        if (err && err.message.includes('no such column')) {
          // Column doesn't exist, add it
          db.run("ALTER TABLE transactions ADD COLUMN reference_id TEXT", (err) => {
            if (err) {
              logger.error('Kesalahan menambahkan kolom reference_id:', err.message);
            } else {
              logger.info('Kolom reference_id berhasil ditambahkan ke tabel transactions');
            }
          });
        } else if (row) {
          // Update existing transactions with reference_id
          db.all("SELECT id, user_id, type, timestamp FROM transactions WHERE reference_id IS NULL", [], (err, rows) => {
            if (err) {
              logger.error('Kesalahan mengambil transaksi tanpa reference_id:', err.message);
              return;
            }
            
            rows.forEach(row => {
              const referenceId = `account-${row.type}-${row.user_id}-${row.timestamp}`;
              db.run("UPDATE transactions SET reference_id = ? WHERE id = ?", [referenceId, row.id], (err) => {
                if (err) {
                  logger.error(`Kesalahan mengupdate reference_id untuk transaksi ${row.id}:`, err.message);
                } else {
                  logger.info(`Berhasil mengupdate reference_id untuk transaksi ${row.id}`);
                }
              });
            });
          });
        }
      });
    });
  }
});

const userState = {};
logger.info('User state initialized');

bot.command(['start', 'menu'], async (ctx) => {
  logger.info('Start or Menu command received');
  
  const userId = ctx.from.id;
  db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      logger.error('Kesalahan saat memeriksa user_id:', err.message);
      return;
    }

    if (row) {
      logger.info(`User ID ${userId} sudah ada di database`);
    } else {
      db.run('INSERT INTO users (user_id) VALUES (?)', [userId], (err) => {
        if (err) {
          logger.error('Kesalahan saat menyimpan user_id:', err.message);
        } else {
          logger.info(`User ID ${userId} berhasil disimpan`);
        }
      });
    }
  });

  await sendMainMenu(ctx);
});

bot.command('admin', async (ctx) => {
  logger.info('Admin menu requested');
  
  if (!adminIds.includes(ctx.from.id)) {
    await ctx.reply('🚫 Anda tidak memiliki izin untuk mengakses menu admin.');
    return;
  }

  await sendAdminMenu(ctx);
});
async function sendMainMenu(ctx) {
  // Ambil data user
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || '-';
  let saldo = 0;
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    saldo = row ? row.saldo : 0;
  } catch (e) { saldo = 0; }

  // Statistik user
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let userToday = 0, userWeek = 0, userMonth = 0;
  let globalToday = 0, globalWeek = 0, globalMonth = 0;
  try {
    userToday = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, todayStart], (err, row) => resolve(row ? row.count : 0));
    });
    userWeek = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, weekStart], (err, row) => resolve(row ? row.count : 0));
    });
    userMonth = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, monthStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalToday = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [todayStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalWeek = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [weekStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalMonth = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [monthStart], (err, row) => resolve(row ? row.count : 0));
    });
  } catch (e) {}

  // Jumlah pengguna bot
  let jumlahPengguna = 0;
  let isReseller = false;
if (fs.existsSync(resselFilePath)) {
  const resellerList = fs.readFileSync(resselFilePath, 'utf8').split('\n').map(x => x.trim());
  isReseller = resellerList.includes(userId.toString());
}
const statusReseller = isReseller ? 'Reseller' : 'Bukan Reseller';
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS count FROM users', (err, row) => { if (err) reject(err); else resolve(row); });
    });
    jumlahPengguna = row.count;
  } catch (e) { jumlahPengguna = 0; }

  // Latency (dummy, bisa diubah sesuai kebutuhan)
  const latency = (Math.random() * 0.1 + 0.01).toFixed(2);

  const messageText = `
╭─ <b>⚡ BOT ZIVPN UDP ${NAMA_STORE} ⚡</b>
├ Bot VPN UDP Premium dengan sistem otomatis
├ Pembelian layanan VPN UDP berkualitas tinggi
└ Akses internet cepat & aman dengan server terpercaya! 

<b>👋 Hai, Member <code>${userName}</code>!</b>
ID: <code>${userId}</code>
Saldo: <code>Rp ${saldo}</code>
Status: <code>${statusReseller}</code>

<blockquote>📊 <b>Statistik Anda</b>
• Hari Ini    : ${userToday} akun
• Minggu Ini  : ${userWeek} akun
• Bulan Ini   : ${userMonth} akun

🌐 <b>Statistik Global</b>
• Hari Ini    : ${globalToday} akun
• Minggu Ini  : ${globalWeek} akun
• Bulan Ini   : ${globalMonth} akun
</blockquote>

⚙️ <b>COMMAND</b>
• 🏠 Menu Utama   : /start
• 🔑 Menu Admin   : /admin
• 🛡️ Admin Panel  : /helpadmin

👨‍💻 <b>Owner:</b> @WintunelingVPNN
👥 <b>Pengguna BOT:</b> ${jumlahPengguna}
⏱️ <b>Latency:</b> ${latency} ms
──────────────────────────`;

let keyboard;
  keyboard = [
    [
      { text: '➕ Buat Akun', callback_data: 'service_create' },
      { text: '♻️ Perpanjang Akun', callback_data: 'service_renew' }
    ],
    [
      { text: '❌ Hapus Akun', callback_data: 'service_del' },
      { text: '📶 Cek Server', callback_data: 'cek_service' }
    ],
    [
     { text: '⌛ Trial Akun', callback_data: 'service_trial' },
      { text: '💰 TopUp Saldo', callback_data: 'topup_saldo' }
    ],
    [
      { text: '🤝 Jadi Reseller & Dapat Harga Spesial', callback_data: 'jadi_reseller' }
    ]
  ];
  try {
    if (ctx.updateType === 'callback_query') {
      try {
      await ctx.editMessageText(messageText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
      } catch (error) {
        // Jika error karena message sudah diedit/dihapus, abaikan
        if (error && error.response && error.response.error_code === 400 &&
            (error.response.description.includes('message is not modified') ||
             error.response.description.includes('message to edit not found') ||
             error.response.description.includes('message can\'t be edited'))
        ) {
          logger.info('Edit message diabaikan karena pesan sudah diedit/dihapus atau tidak berubah.');
    } else {
          logger.error('Error saat mengedit menu utama:', error);
        }
      }
    } else {
      try {
        await ctx.reply(messageText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
      } catch (error) {
        logger.error('Error saat mengirim menu utama:', error);
      }
    }
    logger.info('Main menu sent');
  } catch (error) {
    logger.error('Error umum saat mengirim menu utama:', error);
  }
}

bot.command('hapuslog', async (ctx) => {
  if (!adminIds.includes(ctx.from.id)) return ctx.reply('Tidak ada izin!');
  try {
    if (fs.existsSync('bot-combined.log')) fs.unlinkSync('bot-combined.log');
    if (fs.existsSync('bot-error.log')) fs.unlinkSync('bot-error.log');
    ctx.reply('Log berhasil dihapus.');
    logger.info('Log file dihapus oleh admin.');
  } catch (e) {
    ctx.reply('Gagal menghapus log: ' + e.message);
    logger.error('Gagal menghapus log: ' + e.message);
  }
});

bot.command('helpadmin', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
    return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

const helpMessage = `
*📋 Daftar Perintah Admin:*

1. /addsaldo - Menambahkan saldo ke akun pengguna.
2. /addserver - Menambahkan server baru.
3. /addressel - Menambahkan reseller baru.
4. /delressel - Menghapus ID reseller.
5. /listressel - Menampilkan daftar reseller.
6. /broadcast - Mengirim pesan siaran ke semua pengguna.
7. /editharga - Mengedit harga layanan.
8. /editauth - Mengedit auth server.
9. /editdomain - Mengedit domain server.
10. /editlimitcreate - Mengedit batas pembuatan akun server.
11. /editlimitip - Mengedit batas IP server.
12. /editlimitquota - Mengedit batas quota server.
13. /editnama - Mengedit nama server.
14. /edittotalcreate - Mengedit total pembuatan akun server.
15. /hapuslog - Menghapus log bot.
16. /backup - Menjalankan backup otomatis.

Gunakan perintah ini dengan format yang benar untuk menghindari kesalahan.
`;

  ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

bot.command('broadcast', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⛔ Anda tidak punya izin.');
  }

  const msg = ctx.message.reply_to_message 
      ? ctx.message.reply_to_message.text 
      : ctx.message.text.split(' ').slice(1).join(' ');

  if (!msg) {
      return ctx.reply('⚠️ Harap isi pesan broadcast.');
  }

  ctx.reply('📢 Broadcast dimulai...');

  db.all("SELECT user_id FROM users", [], async (err, rows) => {
      if (err) return ctx.reply('⚠️ Error ambil data user.');

      let sukses = 0;
      let gagal = 0;
      let dihapus = 0;

      const delay = 30; // aman biar ga kena limit (30 ms)

      for (const row of rows) {
          try {
              await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                  chat_id: row.user_id,
                  text: msg
              });

              sukses++;

          } catch (error) {
              const code = error.response?.status;

              gagal++;

              // AUTO DELETE USER MATI
              if (code === 400 || code === 403) {
                  db.run("DELETE FROM users WHERE user_id = ?", [row.user_id]);
                  dihapus++;
                  console.log(`🗑️ User invalid dihapus: ${row.user_id}`);
              }

              console.log(`❌ Gagal kirim ke ${row.user_id}: ${code}`);
          }

          // Anti limit Telegram
          await new Promise(r => setTimeout(r, delay));
      }

      ctx.reply(
          `📣 *Broadcast selesai!*\n\n` +
          `✔️ Berhasil: *${sukses}*\n` +
          `❌ Gagal: *${gagal}*\n` +
          `🗑️ User dihapus: *${dihapus}*`,
          { parse_mode: 'Markdown' }
      );
  });
});

bot.command('broadcastfoto', async (ctx) => {
    const userId = ctx.message.from.id;
    if (!adminIds.includes(userId)) {
        return ctx.reply('⛔ Anda tidak punya izin.');
    }

    const replyMsg = ctx.message.reply_to_message;

    // Cek apakah broadcast foto atau teks
    let isPhoto = false;
    let msgText = '';
    let photoFileId = '';

    if (replyMsg) {
        if (replyMsg.photo) {
            isPhoto = true;
            // Ambil versi terbesar foto
            photoFileId = replyMsg.photo[replyMsg.photo.length - 1].file_id;
            msgText = replyMsg.caption || '';
        } else if (replyMsg.text) {
            msgText = replyMsg.text;
        }
    } else {
        msgText = ctx.message.text.split(' ').slice(1).join(' ');
    }

    if (!msgText && !photoFileId) {
        return ctx.reply('⚠️ Harap isi pesan broadcast atau reply foto.');
    }

    ctx.reply('📢 Broadcast dimulai...');

    db.all("SELECT user_id FROM users", [], async (err, rows) => {
        if (err) return ctx.reply('⚠️ Error ambil data user.');

        let sukses = 0;
        let gagal = 0;
        let dihapus = 0;

        const delay = 30; // ms

        for (const row of rows) {
            try {
                if (isPhoto) {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                        chat_id: row.user_id,
                        photo: photoFileId,
                        caption: msgText
                    });
                } else {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: row.user_id,
                        text: msgText
                    });
                }

                sukses++;

            } catch (error) {
                const code = error.response?.status;
                gagal++;

                if (code === 400 || code === 403) {
                    db.run("DELETE FROM users WHERE user_id = ?", [row.user_id]);
                    dihapus++;
                    console.log(`🗑️ User invalid dihapus: ${row.user_id}`);
                }

                console.log(`❌ Gagal kirim ke ${row.user_id}: ${code}`);
            }

            await new Promise(r => setTimeout(r, delay));
        }

        ctx.reply(
            `📣 *Broadcast selesai!*\n\n` +
            `✔️ Berhasil: *${sukses}*\n` +
            `❌ Gagal: *${gagal}*\n` +
            `🗑️ User dihapus: *${dihapus}*`,
            { parse_mode: 'Markdown' }
        );
    });
});

bot.command('addsaldo', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/addsaldo <user_id> <jumlah>`', { parse_mode: 'Markdown' });
  }

  const targetUserId = parseInt(args[1]);
  const amount = parseInt(args[2]);

  if (isNaN(targetUserId) || isNaN(amount)) {
      return ctx.reply('⚠️ `user_id` dan `jumlah` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  if (/\s/.test(args[1]) || /\./.test(args[1]) || /\s/.test(args[2]) || /\./.test(args[2])) {
      return ctx.reply('⚠️ `user_id` dan `jumlah` tidak boleh mengandung spasi atau titik.', { parse_mode: 'Markdown' });
  }

  db.get("SELECT * FROM users WHERE user_id = ?", [targetUserId], (err, row) => {
      if (err) {
          logger.error('⚠️ Kesalahan saat memeriksa `user_id`:', err.message);
          return ctx.reply('⚠️ Kesalahan saat memeriksa `user_id`.', { parse_mode: 'Markdown' });
      }

      if (!row) {
          return ctx.reply('⚠️ `user_id` tidak terdaftar.', { parse_mode: 'Markdown' });
      }

      db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [amount, targetUserId], function(err) {
          if (err) {
              logger.error('⚠️ Kesalahan saat menambahkan saldo:', err.message);
              return ctx.reply('⚠️ Kesalahan saat menambahkan saldo.', { parse_mode: 'Markdown' });
          }

          if (this.changes === 0) {
              return ctx.reply('⚠️ Pengguna tidak ditemukan.', { parse_mode: 'Markdown' });
          }

          ctx.reply(`✅ Saldo sebesar \`${amount}\` berhasil ditambahkan untuk \`user_id\` \`${targetUserId}\`.`, { parse_mode: 'Markdown' });
      });
  });
});

bot.command('checkressel', async (ctx) => {
  const userId = ctx.from.id;
  console.log('[DEBUG] checkressel, userId:', userId);
  const isR = await isUserReseller(userId);
  console.log('[DEBUG] isReseller:', isR);
  ctx.reply(`ID ${userId} ${isR ? 'adalah reseller ✅' : 'bukan reseller ❌'}`);
});

bot.command('addserver_reseller', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 7) {
      return ctx.reply('⚠️ Format salah!\n\nGunakan:\n/addserver_reseller <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_akun>');
    }

    const [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun] = args;
    
    // ✅ TAMBAHKAN total_create_akun di VALUES
    db.run(`INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, is_reseller_only, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun],
      function (err) {
        if (err) {
          logger.error('❌ Gagal menambah server reseller:', err.message);
          return ctx.reply('❌ *Gagal menambah server reseller.*', { parse_mode: 'Markdown' });
        }
        ctx.reply('✅ *Server khusus reseller berhasil ditambahkan!*', { parse_mode: 'Markdown' });
      }
    );
  } catch (e) {
    logger.error('Error di /addserver_reseller:', e);
    ctx.reply('❌ *Terjadi kesalahan.*', { parse_mode: 'Markdown' });
  }
});

bot.command('addserver', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 8) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/addserver <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_account>`', { parse_mode: 'Markdown' });
  }

  const [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun] = args.slice(1);

  const numberOnlyRegex = /^\d+$/;
  if (!numberOnlyRegex.test(harga) || !numberOnlyRegex.test(quota) || !numberOnlyRegex.test(iplimit) || !numberOnlyRegex.test(batas_create_akun)) {
      return ctx.reply('⚠️ `harga`, `quota`, `iplimit`, dan `batas_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?)", 
      [domain, auth, parseInt(harga), nama_server, parseInt(quota), parseInt(iplimit), parseInt(batas_create_akun)], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat menambahkan server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat menambahkan server.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Server \`${nama_server}\` berhasil ditambahkan.`, { parse_mode: 'Markdown' });
  });
});
bot.command('editharga', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/editharga <domain> <harga>`', { parse_mode: 'Markdown' });
  }

  const [domain, harga] = args.slice(1);

  if (!/^\d+$/.test(harga)) {
      return ctx.reply('⚠️ `harga` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("UPDATE Server SET harga = ? WHERE domain = ?", [parseInt(harga), domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit harga server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit harga server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Harga server \`${domain}\` berhasil diubah menjadi \`${harga}\`.`, { parse_mode: 'Markdown' });
  });
});

bot.command('editnama', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/editnama <domain> <nama_server>`', { parse_mode: 'Markdown' });
  }

  const [domain, nama_server] = args.slice(1);

  db.run("UPDATE Server SET nama_server = ? WHERE domain = ?", [nama_server, domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit nama server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit nama server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Nama server \`${domain}\` berhasil diubah menjadi \`${nama_server}\`.`, { parse_mode: 'Markdown' });
  });
});

bot.command('editdomain', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/editdomain <old_domain> <new_domain>`', { parse_mode: 'Markdown' });
  }

  const [old_domain, new_domain] = args.slice(1);

  db.run("UPDATE Server SET domain = ? WHERE domain = ?", [new_domain, old_domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit domain server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit domain server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Domain server \`${old_domain}\` berhasil diubah menjadi \`${new_domain}\`.`, { parse_mode: 'Markdown' });
  });
});

bot.command('editauth', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/editauth <domain> <auth>`', { parse_mode: 'Markdown' });
  }

  const [domain, auth] = args.slice(1);

  db.run("UPDATE Server SET auth = ? WHERE domain = ?", [auth, domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit auth server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit auth server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Auth server \`${domain}\` berhasil diubah menjadi \`${auth}\`.`, { parse_mode: 'Markdown' });
  });
});

bot.command('editlimitquota', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/editlimitquota <domain> <quota>`', { parse_mode: 'Markdown' });
  }

  const [domain, quota] = args.slice(1);

  if (!/^\d+$/.test(quota)) {
      return ctx.reply('⚠️ `quota` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("UPDATE Server SET quota = ? WHERE domain = ?", [parseInt(quota), domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit quota server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit quota server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Quota server \`${domain}\` berhasil diubah menjadi \`${quota}\`.`, { parse_mode: 'Markdown' });
  });
});

bot.command('editlimitip', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/editlimitip <domain> <iplimit>`', { parse_mode: 'Markdown' });
  }

  const [domain, iplimit] = args.slice(1);

  if (!/^\d+$/.test(iplimit)) {
      return ctx.reply('⚠️ `iplimit` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("UPDATE Server SET iplimit = ? WHERE domain = ?", [parseInt(iplimit), domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit iplimit server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit iplimit server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Iplimit server \`${domain}\` berhasil diubah menjadi \`${iplimit}\`.`, { parse_mode: 'Markdown' });
  });
});

bot.command('editlimitcreate', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/editlimitcreate <domain> <batas_create_akun>`', { parse_mode: 'Markdown' });
  }

  const [domain, batas_create_akun] = args.slice(1);

  if (!/^\d+$/.test(batas_create_akun)) {
      return ctx.reply('⚠️ `batas_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("UPDATE Server SET batas_create_akun = ? WHERE domain = ?", [parseInt(batas_create_akun), domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit batas_create_akun server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit batas_create_akun server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Batas create akun server \`${domain}\` berhasil diubah menjadi \`${batas_create_akun}\`.`, { parse_mode: 'Markdown' });
  });
});
bot.command('edittotalcreate', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/edittotalcreate <domain> <total_create_akun>`', { parse_mode: 'Markdown' });
  }

  const [domain, total_create_akun] = args.slice(1);

  if (!/^\d+$/.test(total_create_akun)) {
      return ctx.reply('⚠️ `total_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("UPDATE Server SET total_create_akun = ? WHERE domain = ?", [parseInt(total_create_akun), domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit total_create_akun server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit total_create_akun server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Total create akun server \`${domain}\` berhasil diubah menjadi \`${total_create_akun}\`.`, { parse_mode: 'Markdown' });
  });
});
async function handleServiceAction(ctx, action) {
  let keyboard;
  if (action === 'create') {
    keyboard = [
      [{ text: 'Buat SSH UDP', callback_data: 'create_ssh' }],      
    ];
  } else if (action === 'trial') {
    keyboard = [
      [{ text: 'Trial SSH UDP', callback_data: 'trial_ssh' }],      
    ];
  } else if (action === 'renew') {
    keyboard = [
      [{ text: 'Perpanjang SSH UDP', callback_data: 'renew_ssh' }],      
    ];
  } else if (action === 'del') {
    keyboard = [
      [{ text: 'Hapus SSH UDP', callback_data: 'del_ssh' }],      
    ];
  } 
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: keyboard
    });
    logger.info(`${action} service menu sent`);
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      await ctx.reply(`Pilih jenis layanan yang ingin Anda ${action}:`, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
      logger.info(`${action} service menu sent as new message`);
    } else {
      logger.error(`Error saat mengirim menu ${action}:`, error);
    }
  }
}
async function sendAdminMenu(ctx) {
  const adminKeyboard = [
    [
  { text: ' Tambah Server Reseller', callback_data: 'addserver_reseller' }
    ],
    [
      { text: '➕ Tambah Server', callback_data: 'addserver' },
      { text: '❌ Hapus Server', callback_data: 'deleteserver' }
    ],
    [
      { text: '💲 Edit Harga', callback_data: 'editserver_harga' },
      { text: '📝 Edit Nama', callback_data: 'nama_server_edit' }
    ],
    [
      { text: '🌐 Edit Domain', callback_data: 'editserver_domain' },
      { text: '🔑 Edit Auth', callback_data: 'editserver_auth' }
    ],
    [
      { text: '📊 Edit Quota', callback_data: 'editserver_quota' },
      { text: '📶 Edit Limit IP', callback_data: 'editserver_limit_ip' }
    ],
    [
      { text: '🔢 Edit Batas Create', callback_data: 'editserver_batas_create_akun' },
      { text: '🔢 Edit Total Create', callback_data: 'editserver_total_create_akun' }
    ],
    [
      { text: '💵 Tambah Saldo', callback_data: 'addsaldo_user' },
      { text: '📋 List Server', callback_data: 'listserver' }
    ],
   [
    { text: '💳 Lihat Saldo User', callback_data: 'cek_saldo_user'},
    { text: '♻️ Restart bot', callback_data: 'restart_bot'}
    ],
    [
      { text: '♻️ Reset Server', callback_data: 'resetdb' },
      { text: 'ℹ️ Detail Server', callback_data: 'detailserver' }
    ],
    [
      { text: '🔙 Kembali', callback_data: 'send_main_menu' }
    ]
  ];

  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: adminKeyboard
    });
    logger.info('Admin menu sent');
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      await ctx.reply('Menu Admin:', {
        reply_markup: {
          inline_keyboard: adminKeyboard
        }
      });
      logger.info('Admin menu sent as new message');
    } else {
      logger.error('Error saat mengirim menu admin:', error);
    }
  }
}

bot.command('backup', async (ctx) => {
  try {
    const requesterId = ctx.from.id;

    // hanya admin yang boleh
    if (!adminIds.includes(requesterId)) {
      return ctx.reply('🚫 Anda tidak memiliki izin untuk menjalankan perintah ini.');
    }

    // konfirmasi start
    await ctx.reply('⚙️ Menjalankan backup... Mohon tunggu sebentar.');

    // jalankan script backup (jangan lewatkan path lengkap)
    // beri timeout 60s, dan buffer besar agar output panjang tercover
    exec('/usr/bin/backup_sellzivpn', { timeout: 60 * 1000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Error menjalankan backup:', err);
        // kirim pesan error ringkas ke admin (jangan kirim stacktrace panjang)
        const errMsg = (stderr || err.message || 'Unknown error').toString().slice(0, 1500);
        return ctx.reply(`❌ Backup gagal:\n\`\`\`\n${errMsg}\n\`\`\``, { parse_mode: 'Markdown' });
      }

      // bila sukses, kirim sebagian output (batasi panjang)
      const out = (stdout || 'Backup selesai tanpa output').toString().slice(0, 3500);
      return ctx.reply(`✅ Backup selesai.\n\`\`\`\n${out}\n\`\`\``, { parse_mode: 'Markdown' });
    });

  } catch (e) {
    console.error('❌ Exception di command /backup:', e);
    await ctx.reply('❌ Terjadi kesalahan internal saat memproses backup.');
  }
});

bot.command('addressel', async (ctx) => {
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply('🚫 Anda tidak memiliki izin untuk melakukan tindakan ini.');
    }

    // Ambil ID Telegram dari argumen
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('❌ Format salah. Gunakan perintah:\n/addressel <id_telegram_user>');
    }

    const targetId = args[1];

    // Baca file ressel.db jika ada, kalau tidak, buat file baru
    let resellerList = [];
    if (fs.existsSync(resselFilePath)) {
      const fileContent = fs.readFileSync(resselFilePath, 'utf8');
      resellerList = fileContent.split('\n').filter(line => line.trim() !== '');
    }

    // Cek apakah ID sudah ada
    if (resellerList.includes(targetId)) {
      return ctx.reply(`⚠️ User dengan ID ${targetId} sudah menjadi reseller.`);
    }

    // Tambahkan ID ke file
    fs.appendFileSync(resselFilePath, `${targetId}\n`);
    ctx.reply(`✅ User dengan ID ${targetId} berhasil dijadikan reseller.`);

  } catch (e) {
    logger.error('❌ Error di command /addressel:', e.message);
    ctx.reply('❌ Terjadi kesalahan saat menjalankan perintah.');
  }
});

bot.command('listressel', async (ctx) => {
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply('🚫 Anda tidak memiliki izin untuk melakukan tindakan ini.');
    }

    // Baca file ressel.db
    let resellerList = [];
    if (fs.existsSync(resselFilePath)) {
      const fileContent = fs.readFileSync(resselFilePath, 'utf8');
      resellerList = fileContent.split('\n').filter(line => line.trim() !== '');
    }

    if (resellerList.length === 0) {
      return ctx.reply('⚠️ Saat ini belum ada reseller yang terdaftar.');
    }

    // Buat pesan daftar reseller
    let message = '📋 *Daftar Reseller:* \n\n';
    resellerList.forEach((id, index) => {
      message += `${index + 1}. ID Telegram: ${id}\n`;
    });

    ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (e) {
    logger.error('❌ Error di command /listressel:', e.message);
    ctx.reply('❌ Terjadi kesalahan saat menampilkan daftar reseller.');
  }
});

bot.command('delressel', async (ctx) => {
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply('🚫 Anda tidak memiliki izin untuk melakukan tindakan ini.');
    }

    // Ambil ID Telegram dari argumen
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('❌ Format salah. Gunakan perintah:\n/delressel <id_telegram_user>');
    }

    const targetId = args[1];

    // Cek apakah file ressel.db ada
    if (!fs.existsSync(resselFilePath)) {
      return ctx.reply('📁 File reseller belum dibuat.');
    }

    // Baca file dan filter ulang tanpa targetId
    const fileContent = fs.readFileSync(resselFilePath, 'utf8');
    const resellerList = fileContent.split('\n').filter(line => line.trim() !== '' && line.trim() !== targetId);

    // Tulis ulang file dengan data yang sudah difilter
    fs.writeFileSync(resselFilePath, resellerList.join('\n') + (resellerList.length ? '\n' : ''));

    ctx.reply(`✅ User dengan ID ${targetId} berhasil dihapus dari daftar reseller.`);

  } catch (e) {
    logger.error('❌ Error di command /delressel:', e.message);
    ctx.reply('❌ Terjadi kesalahan saat menjalankan perintah.');
  }
});

bot.action('jadi_reseller', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from.id;

  await ctx.reply(
    `📩 Hubungi admin ${ADMIN_USERNAME} untuk menjadi Reseller.\n\n` +
    `💰 <b>Minimal deposit:</b> Rp100,000\n\n` +
    `Kirim pesan ke admin dengan format:\n` +
    `<code>Mau jadi reseller ${userId}</code>`,
    { parse_mode: 'HTML' }
  );
});

bot.action('addserver_reseller', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  userState[ctx.chat.id] = { step: 'addserver_reseller' };
  await ctx.reply(
    '🪄 Silakan kirim data server reseller dengan format:\n\n' +
    '/addserver_reseller <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_akun>'
  );
});
bot.action('service_trial2', async (ctx) => {
  try {
    await ctx.answerCbQuery(); // hapus loading di tombol

    await ctx.reply(
      `📩 <b>Silakan chat admin untuk request Trial</b>\n\n` +
      `👤 Admin: <a href="https://t.me/ARI_VPN_STORE">@ARI_VPN_STORE</a>\n` +
      `💬 Kirim pesan: "Minta Trial UDP ZIVPN bang"`,
      { parse_mode: "HTML" }
    );

  } catch (error) {
    console.error("service_trial error:", error);
    await ctx.reply("❌ Terjadi kesalahan, silakan coba lagi.");
  }
});

bot.action('service_trial', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await handleServiceAction(ctx, 'trial');
});

bot.action('service_create', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await handleServiceAction(ctx, 'create');
});

bot.action('service_renew', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await handleServiceAction(ctx, 'renew');
});

bot.action('service_del', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await handleServiceAction(ctx, 'del');
});

const { exec } = require('child_process');

bot.action('cek_service', async (ctx) => {
  try {
    const message = await ctx.reply('⏳ Sedang mengecek status server...');

    exec('chmod +x cek-port.sh && bash cek-port.sh', (error, stdout, stderr) => {
      if (error) {
        console.error(error);
        return ctx.reply('❌ Terjadi kesalahan saat menjalankan pengecekan.');
      }

      const cleanOutput = stdout.replace(/\x1b\[[0-9;]*m/g, '');

      ctx.reply(`📡 *Hasil Cek Port:*\n\n\`\`\`\n${cleanOutput}\n\`\`\``, {
        parse_mode: 'Markdown'
      });
    });
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Gagal menjalankan pengecekan server.');
  }
});

bot.action('send_main_menu', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await sendMainMenu(ctx);
});


bot.action('trial_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'trial', 'ssh');
});

bot.action('create_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'create', 'ssh');
});

//DELETE SSH
bot.action('del_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'ssh');
});

//DELETE BREAK
bot.action('renew_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'renew', 'ssh');
});

async function startSelectServer(ctx, action, type, page = 0) {
  try {
    const isR = await isUserReseller(ctx.from.id);
    const query = 'SELECT * FROM Server';

    db.all(query, [], (err, servers) => {
      if (err) {
        logger.error('⚠️ Error fetching servers:', err.message);
        return ctx.reply('⚠️ Tidak ada server yang tersedia saat ini.', { parse_mode: 'HTML' });
      }

      // ==== FILTER RESSELLER-ONLY ====
const filteredServers = servers.filter(server => {
  const isResellerOnly = Number(server.is_reseller_only) === 1;

  // Jika server hanya untuk reseller
  if (isResellerOnly && !isR) {
    logger.info(`Menyembunyikan server ${server.nama_server} untuk user biasa ${ctx.from.id}`);
    return false;
  }

  // Jika server publik dan user adalah reseller (optional: sembunyikan server publik untuk reseller)
  if (!isResellerOnly && isR) {
    logger.info(`Menyembunyikan server publik ${server.nama_server} untuk reseller ${ctx.from.id}`);
    return false;
  }

  return true;
});


      logger.info(`User ${ctx.from.id} melihat ${filteredServers.length} server dari ${servers.length} total`);

      // ==== Pagination & render ====
      const serversPerPage = 10;
      const totalPages = Math.ceil(filteredServers.length / serversPerPage);
      const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
      const start = currentPage * serversPerPage;
      const end = start + serversPerPage;
      const currentServers = filteredServers.slice(start, end);

      const keyboard = [];
      for (let i = 0; i < currentServers.length; i += 2) {
        const row = [];
        row.push({ text: currentServers[i].nama_server, callback_data: `${action}_username_${type}_${currentServers[i].id}` });
        if (currentServers[i + 1]) {
          row.push({ text: currentServers[i + 1].nama_server, callback_data: `${action}_username_${type}_${currentServers[i + 1].id}` });
        }
        keyboard.push(row);
      }

      const navButtons = [];
      if (totalPages > 1) {
        if (currentPage > 0) navButtons.push({ text: '⬅️ Back', callback_data: `navigate_${action}_${type}_${currentPage - 1}` });
        if (currentPage < totalPages - 1) navButtons.push({ text: '➡️ Next', callback_data: `navigate_${action}_${type}_${currentPage + 1}` });
      }
      if (navButtons.length) keyboard.push(navButtons);
      keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);

      const serverList = currentServers.map(server => {
        const hargaPer30Hari = server.harga * 30;
        const isFull = server.total_create_akun >= server.batas_create_akun;
        return `🌐 *${server.nama_server}*\n` +
               `💰 Harga per hari: Rp${server.harga}\n` +
               `📅 Harga per 30 hari: Rp${hargaPer30Hari}\n` +
               `📊 Quota: ${server.quota}GB\n` +
               `🔢 Limit IP: ${server.iplimit} IP\n` +
               (isFull ? `⚠️ *Server Penuh*` : `👥 Total Create Akun: ${server.total_create_akun}/${server.batas_create_akun}`);
      }).join('\n\n');

      if (ctx.updateType === 'callback_query') {
        ctx.editMessageText(`📋 *List Server (Halaman ${currentPage + 1} dari ${totalPages})*\n\n${serverList}`, {
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: 'Markdown'
        });
      } else {
        ctx.reply(`📋 *List Server (Halaman ${currentPage + 1} dari ${totalPages})*\n\n${serverList}`, {
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: 'Markdown'
        });
      }

      userState[ctx.chat.id] = { step: `${action}_username_${type}`, page: currentPage };
    });

  } catch (error) {
    logger.error(`❌ Error saat memulai proses ${action} untuk ${type}:`, error);
    await ctx.reply(`❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan.`, { parse_mode: 'Markdown' });
  }
}

bot.action(/navigate_(\w+)_(\w+)_(\d+)/, async (ctx) => {
  const [, action, type, page] = ctx.match;
  await startSelectServer(ctx, action, type, parseInt(page, 10));
});

bot.action(/(create)_username_(ssh)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const type = ctx.match[2];
  const serverId = ctx.match[3];

  // Ambil atau buat state user
  if (!userState[ctx.chat.id]) userState[ctx.chat.id] = {};
  const state = userState[ctx.chat.id];

  state.step = `username_${action}_${type}`;
  state.serverId = serverId;
  state.type = type;
  state.action = action;

  db.get('SELECT batas_create_akun, total_create_akun FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) {
      logger.error('⚠️ Error fetching server details:', err.message);
      return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
    }

    if (!server) {
      return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
    }

    const batasCreateAkun = server.batas_create_akun;
    const totalCreateAkun = server.total_create_akun;

    if (totalCreateAkun >= batasCreateAkun) {
      return ctx.reply('❌ *Server penuh. Tidak dapat membuat akun baru di server ini.*', { parse_mode: 'Markdown' });
    }

    // ✅ Assign username otomatis
    state.username = `zi${Date.now()}`;

    if (action === 'create') {
      if (type === 'ssh') {
        state.step = `password_${state.action}_${state.type}`;
        await ctx.reply(`🔑 Masukkan password:`, { parse_mode: 'Markdown' });
      } else {
        state.step = `exp_${state.action}_${state.type}`;
        await ctx.reply(`⏳ Masukkan masa aktif (hari):`, { parse_mode: 'Markdown' });
      }
    } else if (action === 'renew') {
      state.step = `password_${state.action}_${state.type}`;
      await ctx.reply(`🔑 Masukkan password akun yang akan di-renew:`, { parse_mode: 'Markdown' });
    } else {
        state.step = `exp_${state.action}_${state.type}`;
        await ctx.reply(`⏳ Masukkan masa aktif (hari):`, { parse_mode: 'Markdown' });
      }
  });
});

bot.action(/(renew)_username_(ssh)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const type = ctx.match[2];
  const serverId = ctx.match[3];

  // Ambil atau buat state user
  if (!userState[ctx.chat.id]) userState[ctx.chat.id] = {};
  const state = userState[ctx.chat.id];

  state.step = `username_${action}_${type}`;
  state.serverId = serverId;
  state.type = type;
  state.action = action;

  db.get('SELECT batas_create_akun, total_create_akun FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) {
      logger.error('⚠️ Error fetching server details:', err.message);
      return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
    }

    if (!server) {
      return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
    }

    // ✅ Assign username otomatis
    state.username = `zi${Date.now()}`;

    if (action === 'create') {
      if (type === 'ssh') {
        state.step = `password_${state.action}_${state.type}`;
        await ctx.reply(`🔑 Masukkan password:`, { parse_mode: 'Markdown' });
      } else {
        state.step = `exp_${state.action}_${state.type}`;
        await ctx.reply(`⏳ Masukkan masa aktif (hari):`, { parse_mode: 'Markdown' });
      }
    } else if (action === 'renew') {
      state.step = `password_${state.action}_${state.type}`;
      await ctx.reply(`🔑 Masukkan password akun yang akan di-renew:`, { parse_mode: 'Markdown' });
    } else {
        state.step = `exp_${state.action}_${state.type}`;
        await ctx.reply(`⏳ Masukkan masa aktif (hari):`, { parse_mode: 'Markdown' });
      }
  });
});



// === HANDLER TRIAL ===
bot.action(/(trial)_username_(ssh)_(.+)/, async (ctx) => {
  try {
    if (ctx.answerCbQuery) await ctx.answerCbQuery();

    const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];
    const idUser = ctx.from.id.toString().trim();
    const resselDbPath = './ressel.db';

    // === Cek reseller ===
    let isRessel = false;
    try {
      const data = fs.readFileSync(resselDbPath, 'utf8');
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);
      isRessel = resselList.includes(idUser);
    } catch (err) {
      console.error('❌ Gagal membaca file ressel.db:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      return;
    }

    // === Kalau bukan reseller, cek limit trial harian ===
    if (!isRessel) {
      const sudahPakai = await checkTrialAccess(ctx.from.id);
      if (sudahPakai) {
        return ctx.reply('❌ *Anda sudah menggunakan fitur trial hari ini. Silakan coba lagi besok.*', { parse_mode: 'Markdown' });
      }
      await saveTrialAccess(ctx.from.id); // simpan tanggal trial
    }

  // === Jika lolos, lanjut buat akun trial ===
const username = 'trial-' + Math.random().toString(36).substring(2, 7); // contoh: trial-drsfd
const password = 'none';
const exp = '90';
const exp1 = '90 Menit';
const quota = '0';
const quota1 = '0';
const iplimit = '2';

userState[ctx.chat.id] = { username, password, type, serverId, action, trial: true };

await ctx.reply(
  `⚙️ Membuat *TRIAL ${type.toUpperCase()}* untuk server *${serverId}*...`,
  { parse_mode: 'Markdown' }
);

logger.info(`✅ Trial ${type} dibuat oleh ${ctx.from.id}`);
const maskedUsername = username.length > 3 
  ? `${username.slice(0, 3)}${'x'.repeat(username.length - 3)}` 
  : username; // Kalau kurang dari 3 char, tampilkan tanpa masking
await bot.telegram.sendMessage(
  GROUP_ID,
  `<blockquote>
⌛ <b>Trial Account Created</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name} (${ctx.from.id})
🧾 <b>Type:</b> ${type.toUpperCase()}
📛 <b>Username:</b> ${maskedUsername}
📆 <b>Expired:</b> ${exp1 || '-'}
💾 <b>Quota:</b> ${quota1 || '-'}
🌐 <b>Server ID:</b> ${serverId}
━━━━━━━━━━━━━━━━━━━━
</blockquote>`,
  { parse_mode: 'HTML' }
);

    const trialFunctions = {
      ssh: trialssh
    };

    const func = trialFunctions[type];
    if (!func) throw new Error(`Fungsi trial untuk tipe ${type} tidak ditemukan`);

    const msg = await func(username, password, exp, iplimit, serverId);
    await ctx.reply(msg, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error('❌ Error handler trial:', err);
    await ctx.reply('❌ Terjadi kesalahan saat membuat trial. Coba lagi nanti.');
  }
});


bot.action(/(del)_username_(ssh)_(.+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  userState[ctx.chat.id] = {
    step: `username_${action}_${type}`,
    serverId, type, action
  };
  await ctx.reply('👤 *Masukkan Password yang ingin dihapus:*', { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
  const state = userState[ctx.chat.id];

  if (!state) return; 
    const text = ctx.message.text.trim();
//
  if (state.step === 'cek_saldo_userid') {
    const targetId = ctx.message.text.trim();
    db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err, row) => {
      if (err) {
        logger.error('❌ Gagal mengambil saldo:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengambil data saldo.');
      }

      if (!row) {
        return ctx.reply(`⚠️ User dengan ID ${targetId} belum terdaftar di database.`);
      }

      ctx.reply(`💰 Saldo user ${targetId}: Rp${row.saldo.toLocaleString()}`);
      logger.info(`Admin ${ctx.from.id} mengecek saldo user ${targetId}: Rp${row.saldo}`);
      delete userState[ctx.from.id];
    });
  }
//
// DELETE USERNAME
//
  if (state.step?.startsWith('username_del_')) {
    const username = text;
    // Validasi username (hanya huruf kecil dan angka, 3-20 karakter)
   if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
  return ctx.reply(
    '❌ *Username tidak valid. Gunakan huruf (A–Z / a–z) dan angka (3–20 karakter).*',
    { parse_mode: 'Markdown' }
  );
}
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        logger.error('❌ Gagal membaca file ressel.db:', err.message);
        return ctx.reply('❌ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);

      console.log('🧪 ID Pengguna:', idUser);
      console.log('📂 Daftar Ressel:', resselList);

      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('❌ *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
      }
  //izin ressel saja
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

    let msg = 'none';
    try {
      const password = 'none', exp = 'none', iplimit = 'none';

      const delFunctions = {
        ssh: delssh
      };

      if (delFunctions[type]) {
        msg = await delFunctions[type](username, password, exp, iplimit, serverId);
        //await recordAccountTransaction(ctx.from.id, type);
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.info(`✅ Akun ${type} berhasil dihapus oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('❌ Gagal hapus akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
if (state.step?.startsWith('password_')) {
  state.password = ctx.message.text.trim();

  if (!state.password) {
    return ctx.reply('❌ *Password tidak valid. Masukkan password yang valid.*', { parse_mode: 'Markdown' });
  }
  if (state.password.length < 3) {
    return ctx.reply('❌ *Password harus minimal 3 karakter.*', { parse_mode: 'Markdown' });
  }
  if (/[^a-zA-Z0-9]/.test(state.password)) {
    return ctx.reply('❌ *Password tidak boleh mengandung karakter khusus atau spasi.*', { parse_mode: 'Markdown' });
  }

  state.step = `exp_${state.action}_${state.type}`;
  await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
  } else if (state.step?.startsWith('exp_')) {
    const expInput = ctx.message.text.trim();
    if (!/^\d+$/.test(expInput)) {
      return ctx.reply('❌ *Masa aktif tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
    }
// Cek hanya angka
if (!/^\d+$/.test(expInput)) {
  return ctx.reply('❌ *Masa aktif hanya boleh angka, contoh: 30*', { parse_mode: 'Markdown' });
}

const exp = parseInt(expInput, 10);

if (isNaN(exp) || exp <= 0) {
  return ctx.reply('❌ *Masa aktif tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
}

if (exp > 365) {
  return ctx.reply('❌ *Masa aktif tidak boleh lebih dari 365 hari.*', { parse_mode: 'Markdown' });
}
    state.exp = exp;

    db.get('SELECT quota, iplimit FROM Server WHERE id = ?', [state.serverId], async (err, server) => {
      if (err) {
        logger.error('⚠️ Error fetching server details:', err.message);
        return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
      }

      if (!server) {
        return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
      }

      state.quota = server.quota;
      state.iplimit = server.iplimit;

      const { username, password, exp, quota, iplimit, serverId, type, action } = state;
      let msg;

      db.get('SELECT harga FROM Server WHERE id = ?', [serverId], async (err, server) => {
        if (err) {
          logger.error('⚠️ Error fetching server price:', err.message);
          return ctx.reply('❌ *Terjadi kesalahan saat mengambil harga server.*', { parse_mode: 'Markdown' });
        }

        if (!server) {
          return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
        }

        const harga = server.harga;
        const totalHarga = harga * state.exp; 
        db.get('SELECT saldo FROM users WHERE user_id = ?', [ctx.from.id], async (err, user) => {
          if (err) {
            logger.error('⚠️ Kesalahan saat mengambil saldo pengguna:', err.message);
            return ctx.reply('❌ *Terjadi kesalahan saat mengambil saldo pengguna.*', { parse_mode: 'Markdown' });
          }

          if (!user) {
            return ctx.reply('❌ *Pengguna tidak ditemukan.*', { parse_mode: 'Markdown' });
          }

          const saldo = user.saldo;
          if (saldo < totalHarga) {
            return ctx.reply('❌ *Saldo Anda tidak mencukupi untuk melakukan transaksi ini.*', { parse_mode: 'Markdown' });
          }
          if (action === 'create') {
            if (type === 'ssh') {
              msg = await createssh(username, password, exp, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'ssh');
            }
            logger.info(`Account created and transaction recorded for user ${ctx.from.id}, type: ${type}`);
const maskedpassword = password.length > 3 
  ? `${password.slice(0, 3)}${'x'.repeat(password.length - 3)}` 
  : password; // Kalau kurang dari 3 char, tampilkan tanpa masking

// 🔔 Kirim notifikasi ke grup
await bot.telegram.sendMessage(
  GROUP_ID,
  `<blockquote>
📢 <b>Account Created</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name} (${ctx.from.id})
🧾 <b>Type:</b> ${type.toUpperCase()}
📛 <b>Password:</b> ${maskedpassword}
📆 <b>Expired:</b> ${exp || '0'}
💾 <b>Quota:</b> ${quota || '0'}
🌐 <b>Server ID:</b> ${serverId}
━━━━━━━━━━━━━━━━━━━━
</blockquote>`,
  { parse_mode: 'HTML' }
);
          } else if (action === 'renew') {
            if (type === 'ssh') {
              msg = await renewssh(username, password, exp, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'ssh');
            }
            logger.info(`Account renewed and transaction recorded for user ${ctx.from.id}, type: ${type}`);
const maskedpassword = password.length > 3 
  ? `${password.slice(0, 3)}${'x'.repeat(password.length - 3)}` 
  : password; // Kalau kurang dari 3 char, tampilkan tanpa masking
// 🔔 Kirim notifikasi ke grup
await bot.telegram.sendMessage(
  GROUP_ID,
  `<blockquote>
♻️ <b>Account Renewed</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name} (${ctx.from.id})
🧾 <b>Type:</b> ${type.toUpperCase()}
📛 <b>Password:</b> ${maskedpassword}
📆 <b>New Expiry:</b> ${exp || '0'}
💾 <b>Quota:</b> ${quota || '0'}
🌐 <b>Server ID:</b> ${serverId}
━━━━━━━━━━━━━━━━━━━━
</blockquote>`,
  { parse_mode: 'HTML' }
);
}
//SALDO DATABES
// setelah bikin akun (create/renew), kita cek hasilnya
if (msg.includes('❌')) {
  logger.error(`🔄 Rollback saldo user ${ctx.from.id}, type: ${type}, server: ${serverId}, respon: ${msg}`);
  return ctx.reply(msg, { parse_mode: 'Markdown' });
}

// kalau sampai sini artinya tidak ada ❌, transaksi sukses
logger.info(`✅ Transaksi sukses untuk user ${ctx.from.id}, type: ${type}, server: ${serverId}`);

db.run('UPDATE users SET saldo = saldo - ? WHERE user_id = ?', [totalHarga, ctx.from.id], (err) => {
  if (err) {
    logger.error('⚠️ Kesalahan saat mengurangi saldo pengguna:', err.message);
    return ctx.reply('❌ *Terjadi kesalahan saat mengurangi saldo pengguna.*', { parse_mode: 'Markdown' });
  }
});

await ctx.reply(msg, { parse_mode: 'Markdown' });
delete userState[ctx.chat.id];
//SALDO DATABES
          });
        });
      });
    } 
  else if (state.step === 'addserver') {
    const domain = ctx.message.text.trim();
    if (!domain) {
      await ctx.reply('⚠️ *Domain tidak boleh kosong.* Silakan masukkan domain server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_auth';
    state.domain = domain;
    await ctx.reply('🔑 *Silakan masukkan auth server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_auth') {
    const auth = ctx.message.text.trim();
    if (!auth) {
      await ctx.reply('⚠️ *Auth tidak boleh kosong.* Silakan masukkan auth server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_nama_server';
    state.auth = auth;
    await ctx.reply('🏷️ *Silakan masukkan nama server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_nama_server') {
    const nama_server = ctx.message.text.trim();
    if (!nama_server) {
      await ctx.reply('⚠️ *Nama server tidak boleh kosong.* Silakan masukkan nama server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_quota';
    state.nama_server = nama_server;
    await ctx.reply('📊 *Silakan masukkan quota server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_quota') {
    const quota = parseInt(ctx.message.text.trim(), 10);
    if (isNaN(quota)) {
      await ctx.reply('⚠️ *Quota tidak valid.* Silakan masukkan quota server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_iplimit';
    state.quota = quota;
    await ctx.reply('🔢 *Silakan masukkan limit IP server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_iplimit') {
    const iplimit = parseInt(ctx.message.text.trim(), 10);
    if (isNaN(iplimit)) {
      await ctx.reply('⚠️ *Limit IP tidak valid.* Silakan masukkan limit IP server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_batas_create_akun';
    state.iplimit = iplimit;
    await ctx.reply('🔢 *Silakan masukkan batas create akun server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_batas_create_akun') {
    const batas_create_akun = parseInt(ctx.message.text.trim(), 10);
    if (isNaN(batas_create_akun)) {
      await ctx.reply('⚠️ *Batas create akun tidak valid.* Silakan masukkan batas create akun server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_harga';
    state.batas_create_akun = batas_create_akun;
    await ctx.reply('💰 *Silakan masukkan harga server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_harga') {
    const harga = parseFloat(ctx.message.text.trim());
    if (isNaN(harga) || harga <= 0) {
      await ctx.reply('⚠️ *Harga tidak valid.* Silakan masukkan harga server yang valid.', { parse_mode: 'Markdown' });
      return;
    }
    const { domain, auth, nama_server, quota, iplimit, batas_create_akun } = state;

    try {
      db.run('INSERT INTO Server (domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, 0], function(err) {
        if (err) {
          logger.error('Error saat menambahkan server:', err.message);
          ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
        } else {
          ctx.reply(`✅ *Server baru dengan domain ${domain} telah berhasil ditambahkan.*\n\n📄 *Detail Server:*\n- Domain: ${domain}\n- Auth: ${auth}\n- Nama Server: ${nama_server}\n- Quota: ${quota}\n- Limit IP: ${iplimit}\n- Batas Create Akun: ${batas_create_akun}\n- Harga: Rp ${harga}`, { parse_mode: 'Markdown' });
        }
      });
    } catch (error) {
      logger.error('Error saat menambahkan server:', error);
      await ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
  }
  // === 🏷️ TAMBAH SERVER UNTUK RESELLER ===
if (state && state.step === 'reseller_domain') {
  state.domain = text;
  state.step = 'reseller_auth';
  return ctx.reply('🔑 Masukkan auth server:');
}

if (state && state.step === 'reseller_auth') {
  state.auth = text;
  state.step = 'reseller_harga';
  return ctx.reply('💰 Masukkan harga server (angka):');
}

if (state && state.step === 'reseller_harga') {
  state.harga = text;
  state.step = 'reseller_nama';
  return ctx.reply('📝 Masukkan nama server:');
}

if (state && state.step === 'reseller_nama') {
  state.nama_server = text;
  state.step = 'reseller_quota';
  return ctx.reply('📊 Masukkan quota (GB):');
}

if (state && state.step === 'reseller_quota') {
  state.quota = text;
  state.step = 'reseller_iplimit';
  return ctx.reply('📶 Masukkan IP limit:');
}

if (state && state.step === 'reseller_iplimit') {
  state.iplimit = text;
  state.step = 'reseller_batas';
  return ctx.reply('🔢 Masukkan batas create akun:');
}

if (state && state.step === 'reseller_batas') {
  state.batas_create_akun = text;

  db.run(
    `INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, total_create_akun, is_reseller_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
    [
      state.domain,
      state.auth,
      parseInt(state.harga),
      state.nama_server,
      parseInt(state.quota),
      parseInt(state.iplimit),
      parseInt(state.batas_create_akun),
    ],
    (err) => {
      if (err) {
        logger.error('❌ Gagal menambah server reseller:', err.message);
        ctx.reply('❌ Gagal menambah server reseller.');
      } else {
        ctx.reply(
          `✅ Server reseller *${state.nama_server}* berhasil ditambahkan!`,
          { parse_mode: 'Markdown' }
        );
      }
      delete userState[ctx.chat.id];
    }
  );
  return;
}
// === 💰 TAMBAH SALDO (LANGKAH 1: INPUT USER ID) ===
if (state && state.step === 'addsaldo_userid') {
  state.targetId = text.trim();
  state.step = 'addsaldo_amount';
  return ctx.reply('💰 Masukkan jumlah saldo yang ingin ditambahkan:');
}

// === 💰 TAMBAH SALDO (LANGKAH 1: INPUT USER ID) ===
if (state && state.step === 'addsaldo_userid') {
  state.targetId = text.trim();
  state.step = 'addsaldo_amount';
  return ctx.reply('💰 Masukkan jumlah saldo yang ingin ditambahkan:');
}

// === 💰 TAMBAH SALDO (LANGKAH 2: INPUT JUMLAH SALDO) ===
if (state && state.step === 'addsaldo_amount') {
  const amount = parseInt(text.trim());
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('⚠️ Jumlah saldo harus berupa angka dan lebih dari 0.');
  }

  const targetId = state.targetId;

// Tambahkan saldo
db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, targetId], (err) => {
  if (err) {
    logger.error('❌ Gagal menambah saldo:', err.message);
    return ctx.reply('❌ Gagal menambah saldo ke user.');
  }

  // Ambil saldo terbaru
  db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err2, updated) => {
    if (err2 || !updated) {
      ctx.reply(`✅ Saldo sebesar Rp${amount} berhasil ditambahkan ke user ${targetId}.`);
      logger.info(`Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId}.`);
    } else {
      ctx.reply(`✅ Saldo sebesar Rp${amount} berhasil ditambahkan ke user ${targetId}.\n💳 Saldo sekarang: Rp${updated.saldo}`);
      logger.info(`Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId} (Saldo akhir: Rp${updated.saldo}).`);
    }
  });

  delete userState[ctx.from.id];
});

  return;
}
});
//

// === 💳 CEK SALDO USER ===
bot.action('cek_saldo_user', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery();
  await ctx.reply('🔍 Masukkan ID Telegram user yang ingin dicek saldonya:');
  userState[adminId] = { step: 'cek_saldo_userid' };
});
//

// === 🔄 RESTART BOT ===
bot.action('restart_bot', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery();
  await ctx.reply('♻️ Restarting bot, Please wait...');

  exec("pm2 restart all", (error, stdout, stderr) => {
    if (error) {
      return ctx.reply(`❌ Gagal restart bot:\n${error.message}`);
    }
    ctx.reply("✅ Bot berhasil direstart!");
  });
});
bot.action('addserver', async (ctx) => {
  try {
    logger.info('📥 Proses tambah server dimulai');
    await ctx.answerCbQuery();
    await ctx.reply('🌐 *Silakan masukkan domain/ip server:*', { parse_mode: 'Markdown' });
    userState[ctx.chat.id] = { step: 'addserver' };
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses tambah server:', error);
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});
bot.action('detailserver', async (ctx) => {
  try {
    logger.info('📋 Proses detail server dimulai');
    await ctx.answerCbQuery();
    
    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil detail server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil detail server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      logger.info('⚠️ Tidak ada server yang tersedia');
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
    }

    const buttons = [];
    for (let i = 0; i < servers.length; i += 2) {
      const row = [];
      row.push({
        text: `${servers[i].nama_server}`,
        callback_data: `server_detail_${servers[i].id}`
      });
      if (i + 1 < servers.length) {
        row.push({
          text: `${servers[i + 1].nama_server}`,
          callback_data: `server_detail_${servers[i + 1].id}`
        });
      }
      buttons.push(row);
    }

    await ctx.reply('📋 *Silakan pilih server untuk melihat detail:*', {
      reply_markup: { inline_keyboard: buttons },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('⚠️ Kesalahan saat mengambil detail server:', error);
    await ctx.reply('⚠️ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
  }
});

bot.action('listserver', async (ctx) => {
  try {
    logger.info('📜 Proses daftar server dimulai');
    await ctx.answerCbQuery();
    
    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      logger.info('⚠️ Tidak ada server yang tersedia');
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
    }

    let serverList = '📜 *Daftar Server* 📜\n\n';
    servers.forEach((server, index) => {
      serverList += `🔹 ${index + 1}. ${server.domain}\n`;
    });

    serverList += `\nTotal Jumlah Server: ${servers.length}`;

    await ctx.reply(serverList, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('⚠️ Kesalahan saat mengambil daftar server:', error);
    await ctx.reply('⚠️ *Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' });
  }
});
bot.action('resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('🚨 *PERHATIAN! Anda akan menghapus semua server yang tersedia. Apakah Anda yakin?*', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Ya', callback_data: 'confirm_resetdb' }],
          [{ text: '❌ Tidak', callback_data: 'cancel_resetdb' }]
        ]
      },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Error saat memulai proses reset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('confirm_resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM Server', (err) => {
        if (err) {
          logger.error('❌ Error saat mereset tabel Server:', err.message);
          return reject('❗️ *PERHATIAN! Terjadi KESALAHAN SERIUS saat mereset database. Harap segera hubungi administrator!*');
        }
        resolve();
      });
    });
    await ctx.reply('🚨 *PERHATIAN! Database telah DIRESET SEPENUHNYA. Semua server telah DIHAPUS TOTAL.*', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('❌ Error saat mereset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('cancel_resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('❌ *Proses reset database dibatalkan.*', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('❌ Error saat membatalkan reset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('deleteserver', async (ctx) => {
  try {
    logger.info('🗑️ Proses hapus server dimulai');
    await ctx.answerCbQuery();
    
    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) {
        logger.error('⚠️ Kesalahan saat mengambil daftar server:', err.message);
        return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' });
      }

      if (servers.length === 0) {
        logger.info('⚠️ Tidak ada server yang tersedia');
        return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
      }

      const keyboard = servers.map(server => {
        return [{ text: server.nama_server, callback_data: `confirm_delete_server_${server.id}` }];
      });
      keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'kembali_ke_menu' }]);

      ctx.reply('🗑️ *Pilih server yang ingin dihapus:*', {
        reply_markup: {
          inline_keyboard: keyboard
        },
        parse_mode: 'Markdown'
      });
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses hapus server:', error);
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});


const getUsernameById = async (userId) => {
  try {
    const telegramUser = await bot.telegram.getChat(userId);
    return telegramUser.username || telegramUser.first_name;
  } catch (err) {
    logger.error('❌ Kesalahan saat mengambil username dari Telegram:', err.message);
    throw new Error('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil username dari Telegram.*');
  }
};

bot.action('addsaldo_user', async (ctx) => {
  try {
    logger.info('Add saldo user process started');
    await ctx.answerCbQuery();

    const users = await new Promise((resolve, reject) => {
      db.all('SELECT user_id FROM users LIMIT 20', [], (err, users) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar user:', err.message);
          reject(err);
        } else {
        resolve(users);
        }
      });
    });

    const totalUsers = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat menghitung total user:', err.message);
          reject(err);
        } else {
        resolve(row.count);
        }
      });
    });

    const keyboard = [];
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      const username1 = await getUsernameById(users[i].user_id);
      row.push({
        text: username1 || users[i].user_id,
        callback_data: `add_saldo_${users[i].user_id}`
      });
      if (i + 1 < users.length) {
        const username2 = await getUsernameById(users[i + 1].user_id);
        row.push({
          text: username2 || users[i + 1].user_id,
          callback_data: `add_saldo_${users[i + 1].user_id}`
        });
      }
      keyboard.push(row);
    }

    const currentPage = 0;
    const replyMarkup = {
      inline_keyboard: [...keyboard]
    };

    if (totalUsers > 20) {
      replyMarkup.inline_keyboard.push([{
        text: '➡️ Next',
        callback_data: `next_users_${currentPage + 1}`
      }]);
    }

    await ctx.reply('📊 *Silakan pilih user untuk menambahkan saldo:*', {
      reply_markup: replyMarkup,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses tambah saldo user:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action(/next_users_(\d+)/, async (ctx) => {
  const currentPage = parseInt(ctx.match[1]);
  const offset = currentPage * 20;

  try {
    logger.info(`Next users process started for page ${currentPage + 1}`);
    await ctx.answerCbQuery();

    const users = await new Promise((resolve, reject) => {
      db.all(`SELECT user_id FROM users LIMIT 20 OFFSET ${offset}`, [], (err, users) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar user.*');
        }
        resolve(users);
      });
    });

    const totalUsers = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat menghitung total user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat menghitung total user.*');
        }
        resolve(row.count);
      });
    });

    const keyboard = [];
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      const username1 = await getUsernameById(users[i].user_id);
      row.push({
        text: username1 || users[i].user_id,
        callback_data: `add_saldo_${users[i].user_id}`
      });
      if (i + 1 < users.length) {
        const username2 = await getUsernameById(users[i + 1].user_id);
        row.push({
          text: username2 || users[i + 1].user_id,
          callback_data: `add_saldo_${users[i + 1].user_id}`
        });
      }
      keyboard.push(row);
    }

    const replyMarkup = {
      inline_keyboard: [...keyboard]
    };

    const navigationButtons = [];
    if (currentPage > 0) {
      navigationButtons.push([{
        text: '⬅️ Back',
        callback_data: `prev_users_${currentPage - 1}`
      }]);
    }
    if (offset + 20 < totalUsers) {
      navigationButtons.push([{
        text: '➡️ Next',
        callback_data: `next_users_${currentPage + 1}`
      }]);
    }

    replyMarkup.inline_keyboard.push(...navigationButtons);

    await ctx.editMessageReplyMarkup(replyMarkup);
  } catch (error) {
    logger.error('❌ Kesalahan saat memproses next users:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action(/prev_users_(\d+)/, async (ctx) => {
  const currentPage = parseInt(ctx.match[1]);
  const offset = (currentPage - 1) * 20; 

  try {
    logger.info(`Previous users process started for page ${currentPage}`);
    await ctx.answerCbQuery();

    const users = await new Promise((resolve, reject) => {
      db.all(`SELECT user_id FROM users LIMIT 20 OFFSET ${offset}`, [], (err, users) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar user.*');
        }
        resolve(users);
      });
    });

    const totalUsers = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat menghitung total user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat menghitung total user.*');
        }
        resolve(row.count);
      });
    });

    const keyboard = [];
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      const username1 = await getUsernameById(users[i].user_id);
      row.push({
        text: username1 || users[i].user_id,
        callback_data: `add_saldo_${users[i].user_id}`
      });
      if (i + 1 < users.length) {
        const username2 = await getUsernameById(users[i + 1].user_id);
        row.push({
          text: username2 || users[i + 1].user_id,
          callback_data: `add_saldo_${users[i + 1].user_id}`
        });
      }
      keyboard.push(row);
    }

    const replyMarkup = {
      inline_keyboard: [...keyboard]
    };

    const navigationButtons = [];
    if (currentPage > 0) {
      navigationButtons.push([{
        text: '⬅️ Back',
        callback_data: `prev_users_${currentPage - 1}`
      }]);
    }
    if (offset + 20 < totalUsers) {
      navigationButtons.push([{
        text: '➡️ Next',
        callback_data: `next_users_${currentPage}`
      }]);
    }

    replyMarkup.inline_keyboard.push(...navigationButtons);

    await ctx.editMessageReplyMarkup(replyMarkup);
  } catch (error) {
    logger.error('❌ Kesalahan saat memproses previous users:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_limit_ip', async (ctx) => {
  try {
    logger.info('Edit server limit IP process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_limit_ip_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('📊 *Silakan pilih server untuk mengedit limit IP:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit limit IP server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_batas_create_akun', async (ctx) => {
  try {
    logger.info('Edit server batas create akun process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_batas_create_akun_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('📊 *Silakan pilih server untuk mengedit batas create akun:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit batas create akun server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_total_create_akun', async (ctx) => {
  try {
    logger.info('Edit server total create akun process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_total_create_akun_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('📊 *Silakan pilih server untuk mengedit total create akun:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit total create akun server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_quota', async (ctx) => {
  try {
    logger.info('Edit server quota process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_quota_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('📊 *Silakan pilih server untuk mengedit quota:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit quota server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_auth', async (ctx) => {
  try {
    logger.info('Edit server auth process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_auth_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('🌐 *Silakan pilih server untuk mengedit auth:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit auth server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('editserver_harga', async (ctx) => {
  try {
    logger.info('Edit server harga process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_harga_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('💰 *Silakan pilih server untuk mengedit harga:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit harga server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('editserver_domain', async (ctx) => {
  try {
    logger.info('Edit server domain process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_domain_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('🌐 *Silakan pilih server untuk mengedit domain:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit domain server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('nama_server_edit', async (ctx) => {
  try {
    logger.info('Edit server nama process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_nama_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('🏷️ *Silakan pilih server untuk mengedit nama:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit nama server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('topup_saldo', async (ctx) => {
  try {
    await ctx.answerCbQuery(); 
    const userId = ctx.from.id;
    logger.info(`🔍 User ${userId} memulai proses top-up saldo.`);
    

    if (!global.depositState) {
      global.depositState = {};
    }
    global.depositState[userId] = { action: 'request_amount', amount: '' };
    
    logger.info(`🔍 User ${userId} diminta untuk memasukkan jumlah nominal saldo.`);
    

    const keyboard = keyboard_nomor();
    
    await ctx.editMessageText('💰 *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*', {
      reply_markup: {
        inline_keyboard: keyboard
      },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses top-up saldo:', error);
    await ctx.editMessageText('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});

bot.action(/edit_harga_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit harga server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_harga', serverId: serverId };

  await ctx.reply('💰 *Silakan masukkan harga server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/add_saldo_(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk menambahkan saldo user dengan ID: ${userId}`);
  userState[ctx.chat.id] = { step: 'add_saldo', userId: userId };

  await ctx.reply('📊 *Silakan masukkan jumlah saldo yang ingin ditambahkan:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_batas_create_akun_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit batas create akun server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_batas_create_akun', serverId: serverId };

  await ctx.reply('📊 *Silakan masukkan batas create akun server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_total_create_akun_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit total create akun server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_total_create_akun', serverId: serverId };

  await ctx.reply('📊 *Silakan masukkan total create akun server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_limit_ip_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit limit IP server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_limit_ip', serverId: serverId };

  await ctx.reply('📊 *Silakan masukkan limit IP server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_quota_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit quota server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_quota', serverId: serverId };

  await ctx.reply('📊 *Silakan masukkan quota server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_auth_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit auth server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_auth', serverId: serverId };

  await ctx.reply('🌐 *Silakan masukkan auth server baru:*', {
    reply_markup: { inline_keyboard: keyboard_full() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_domain_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit domain server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_domain', serverId: serverId };

  await ctx.reply('🌐 *Silakan masukkan domain server baru:*', {
    reply_markup: { inline_keyboard: keyboard_full() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_nama_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit nama server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_nama', serverId: serverId };

  await ctx.reply('🏷️ *Silakan masukkan nama server baru:*', {
    reply_markup: { inline_keyboard: keyboard_abc() },
    parse_mode: 'Markdown'
  });
});
bot.action(/confirm_delete_server_(\d+)/, async (ctx) => {
  try {
    db.run('DELETE FROM Server WHERE id = ?', [ctx.match[1]], function(err) {
      if (err) {
        logger.error('Error deleting server:', err.message);
        return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat menghapus server.*', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
        logger.info('Server tidak ditemukan');
        return ctx.reply('⚠️ *PERHATIAN! Server tidak ditemukan.*', { parse_mode: 'Markdown' });
      }

      logger.info(`Server dengan ID ${ctx.match[1]} berhasil dihapus`);
      ctx.reply('✅ *Server berhasil dihapus.*', { parse_mode: 'Markdown' });
    });
  } catch (error) {
    logger.error('Kesalahan saat menghapus server:', error);
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});
bot.action(/server_detail_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  try {
    const server = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil detail server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil detail server.*');
        }
        resolve(server);
      });
    });

    if (!server) {
      logger.info('⚠️ Server tidak ditemukan');
      return ctx.reply('⚠️ *PERHATIAN! Server tidak ditemukan.*', { parse_mode: 'Markdown' });
    }

    const serverDetails = `📋 *Detail Server* 📋\n\n` +
      `🌐 *Domain:* \`${server.domain}\`\n` +
      `🔑 *Auth:* \`${server.auth}\`\n` +
      `🏷️ *Nama Server:* \`${server.nama_server}\`\n` +
      `📊 *Quota:* \`${server.quota}\`\n` +
      `📶 *Limit IP:* \`${server.iplimit}\`\n` +
      `🔢 *Batas Create Akun:* \`${server.batas_create_akun}\`\n` +
      `📋 *Total Create Akun:* \`${server.total_create_akun}\`\n` +
      `💵 *Harga:* \`Rp ${server.harga}\`\n\n`;

    await ctx.reply(serverDetails, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('⚠️ Kesalahan saat mengambil detail server:', error);
    await ctx.reply('⚠️ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
  }
});

bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  const userStateData = userState[ctx.chat.id];

  if (global.depositState && global.depositState[userId] && global.depositState[userId].action === 'request_amount') {
    await handleDepositState(ctx, userId, data);
  } else if (userStateData) {
    switch (userStateData.step) {
      case 'add_saldo':
        await handleAddSaldo(ctx, userStateData, data);
        break;
      case 'edit_batas_create_akun':
        await handleEditBatasCreateAkun(ctx, userStateData, data);
        break;
      case 'edit_limit_ip':
        await handleEditiplimit(ctx, userStateData, data);
        break;
      case 'edit_quota':
        await handleEditQuota(ctx, userStateData, data);
        break;
      case 'edit_auth':
        await handleEditAuth(ctx, userStateData, data);
        break;
      case 'edit_domain':
        await handleEditDomain(ctx, userStateData, data);
        break;
      case 'edit_harga':
        await handleEditHarga(ctx, userStateData, data);
        break;
      case 'edit_nama':
        await handleEditNama(ctx, userStateData, data);
        break;
      case 'edit_total_create_akun':
        await handleEditTotalCreateAkun(ctx, userStateData, data);
        break;
    }
  }
});

async function handleDepositState(ctx, userId, data) {
  // Cek apakah user reseller
  const isReseller = await isUserReseller(userId);
  const statusReseller = isReseller ? 'Reseller' : 'Bukan Reseller';
  const minDeposit = isReseller ? 100000 : 1000; // 100k untuk reseller, 1k untuk user biasa

  let currentAmount = global.depositState[userId].amount || '';

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    const amount = Number(currentAmount) || 0;

    if (amount === 0) {
      return await ctx.answerCbQuery('⚠️ Jumlah tidak boleh kosong!', { show_alert: true });
    }
    if (amount < minDeposit) {
      return await ctx.answerCbQuery(
        `⚠️ Jumlah minimal deposit untuk ${statusReseller} adalah Rp${minDeposit.toLocaleString()}!`,
        { show_alert: true }
      );
    }

    global.depositState[userId].action = 'confirm_amount';
    await processDeposit(ctx, currentAmount);
    return;
  } else {
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('⚠️ Jumlah maksimal adalah 12 digit!', { show_alert: true });
    }
  }

  global.depositState[userId].amount = currentAmount;
  const newMessage = `💰 Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:\n\nJumlah saat ini: Rp${currentAmount || '0'}`;

  try {
    if (newMessage !== ctx.callbackQuery.message.text) {
      await ctx.editMessageText(newMessage, {
        reply_markup: { inline_keyboard: keyboard_nomor() },
        parse_mode: 'HTML'
      });
    } else {
      await ctx.answerCbQuery();
    }
  } catch (error) {
    await ctx.answerCbQuery();
    logger.error('Error editing message:', error);
  }
}


async function handleAddSaldo(ctx, userStateData, data) {
  let currentSaldo = userStateData.saldo || '';

  if (data === 'backspace') {
    currentSaldo = currentSaldo.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentSaldo.length === 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo tidak boleh kosong!*', { show_alert: true });
    }

    try {
      await updateUserBalance(userStateData.userId, currentSaldo);
      ctx.reply(`✅ *Saldo user berhasil ditambahkan.*\n\n📄 *Detail Saldo:*\n- Jumlah Saldo: *Rp ${currentSaldo}*`, { parse_mode: 'Markdown' });
    } catch (error) {
      ctx.reply('❌ *Terjadi kesalahan saat menambahkan saldo user.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else if (data === 'cancel') {
    delete userState[ctx.chat.id];
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo tidak valid!*', { show_alert: true });
  } else {
    if (currentSaldo.length < 10) {
      currentSaldo += data;
    } else {
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo maksimal adalah 10 karakter!*', { show_alert: true });
    }
  }

  userStateData.saldo = currentSaldo;
  const newMessage = `📊 *Silakan masukkan jumlah saldo yang ingin ditambahkan:*\n\nJumlah saldo saat ini: *${currentSaldo}*`;
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
}

async function handleEditBatasCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'batasCreateAkun', 'batas create akun', 'UPDATE Server SET batas_create_akun = ? WHERE id = ?');
}

async function handleEditTotalCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'totalCreateAkun', 'total create akun', 'UPDATE Server SET total_create_akun = ? WHERE id = ?');
}

async function handleEditiplimit(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'iplimit', 'limit IP', 'UPDATE Server SET limit_ip = ? WHERE id = ?');
}

async function handleEditQuota(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'quota', 'quota', 'UPDATE Server SET quota = ? WHERE id = ?');
}

async function handleEditAuth(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'auth', 'auth', 'UPDATE Server SET auth = ? WHERE id = ?');
}

async function handleEditDomain(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'domain', 'domain', 'UPDATE Server SET domain = ? WHERE id = ?');
}

async function handleEditHarga(ctx, userStateData, data) {
  let currentAmount = userStateData.amount || '';

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentAmount.length === 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah tidak boleh kosong!*', { show_alert: true });
    }
    const hargaBaru = parseFloat(currentAmount);
    if (isNaN(hargaBaru) || hargaBaru <= 0) {
      return ctx.reply('❌ *Harga tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
    }
    try {
      await updateServerField(userStateData.serverId, hargaBaru, 'UPDATE Server SET harga = ? WHERE id = ?');
      ctx.reply(`✅ *Harga server berhasil diupdate.*\n\n📄 *Detail Server:*\n- Harga Baru: *Rp ${hargaBaru}*`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply('❌ *Terjadi kesalahan saat mengupdate harga server.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^\d+$/.test(data)) {
      return await ctx.answerCbQuery('⚠️ *Hanya angka yang diperbolehkan!*', { show_alert: true });
    }
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('⚠️ *Jumlah maksimal adalah 12 digit!*', { show_alert: true });
    }
  }

  userStateData.amount = currentAmount;
  const newMessage = `💰 *Silakan masukkan harga server baru:*\n\nJumlah saat ini: *Rp ${currentAmount}*`;
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
  }
}

async function handleEditNama(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'name', 'nama server', 'UPDATE Server SET nama_server = ? WHERE id = ?');
}

async function handleEditField(ctx, userStateData, data, field, fieldName, query) {
  let currentValue = userStateData[field] || '';

  if (data === 'delete') {
    currentValue = currentValue.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentValue.length === 0) {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} tidak boleh kosong!*`, { show_alert: true });
    }
    try {
      await updateServerField(userStateData.serverId, currentValue, query);
      ctx.reply(`✅ *${fieldName} server berhasil diupdate.*\n\n📄 *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}: *${currentValue}*`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`❌ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^[a-zA-Z0-9.-]+$/.test(data)) {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} tidak valid!*`, { show_alert: true });
    }
    if (currentValue.length < 253) {
      currentValue += data;
    } else {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} maksimal adalah 253 karakter!*`, { show_alert: true });
    }
  }

  userStateData[field] = currentValue;
  const newMessage = `📊 *Silakan masukkan ${fieldName} server baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${currentValue}*`;
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
  }
}
async function updateUserSaldo(userId, saldo) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [saldo, userId], function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat menambahkan saldo user:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function updateServerField(serverId, value, query) {
  return new Promise((resolve, reject) => {
    db.run(query, [value, serverId], function (err) {
      if (err) {
        logger.error(`⚠️ Kesalahan saat mengupdate ${fieldName} server:`, err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function generateRandomAmount(baseAmount) {
  const random = Math.floor(Math.random() * 99) + 1;
  return baseAmount + random;
}

global.depositState = {};
global.pendingDeposits = {};
let lastRequestTime = 0;
const requestInterval = 1000; 

db.all('SELECT * FROM pending_deposits WHERE status = "pending"', [], (err, rows) => {
  if (err) {
    logger.error('Gagal load pending_deposits:', err.message);
    return;
  }
  rows.forEach(row => {
    global.pendingDeposits[row.unique_code] = {
      amount: row.amount,
      originalAmount: row.original_amount,
      userId: row.user_id,
      timestamp: row.timestamp,
      status: row.status,
      qrMessageId: row.qr_message_id
    };
  });
  logger.info('Pending deposit loaded:', Object.keys(global.pendingDeposits).length);
});

function generateRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function processDeposit(ctx, amount) {
  const currentTime = Date.now();

  if (currentTime - lastRequestTime < requestInterval) {
    await ctx.editMessageText('⚠️ *Terlalu banyak permintaan. Silakan tunggu sebentar sebelum mencoba lagi.*', { parse_mode: 'Markdown' });
    return;
  }

  lastRequestTime = currentTime;
  const userId = ctx.from.id;
  const uniqueCode = `user-${userId}-${Date.now()}`;

  // Generate final amount with random suffix
  const finalAmount = Number(amount) + generateRandomNumber(1, 300);
  const adminFee = finalAmount - Number(amount)
  try {
    const urlQr = DATA_QRIS; // QR destination
    const auth_apikey = APIKEY; // QR destination
   // console.log('🔍 CEK DATA_QRIS:', urlQr);
    const axios = require('axios');
//const sharp = require('sharp'); // opsional kalau mau resize

const bayar = await axios.get(`https://api.rajaserverpremium.web.id/orderkuota/createpayment?apikey=${auth_apikey}&amount=${finalAmount}&codeqr=${urlQr}`);
const get = bayar.data;

if (get.status !== 'success') {
  throw new Error('Gagal membuat QRIS: ' + JSON.stringify(get));
}

const qrImageUrl = get.result.imageqris?.url;

if (!qrImageUrl || qrImageUrl.includes('undefined')) {
  throw new Error('URL QRIS tidak valid: ' + qrImageUrl);
}

// Download gambar QR
const qrResponse = await axios.get(qrImageUrl, { responseType: 'arraybuffer' });
const qrBuffer = Buffer.from(qrResponse.data);

    const caption =
      `📝 *Detail Pembayaran:*\n\n` +
                  `💰 Jumlah: Rp ${finalAmount}\n` +
      `- Nominal Top Up: Rp ${amount}\n` +
      `- Admin Fee : Rp ${adminFee}\n` +
                  `⚠️ *Penting:* Mohon transfer sesuai nominal\n` +
      `⏱️ Waktu: 5 menit\n\n` +
                  `⚠️ *Catatan:*\n` +
                  `- Pembayaran akan otomatis terverifikasi\n` +
      `- Jika pembayaran berhasil, saldo akan otomatis ditambahkan`;

    const qrMessage = await ctx.replyWithPhoto({ source: qrBuffer }, {
      caption: caption,
          parse_mode: 'Markdown'
        }); 
    // Hapus pesan input nominal setelah QR code dikirim
    try {
      await ctx.deleteMessage();
    } catch (e) {
      logger.error('Gagal menghapus pesan input nominal:', e.message);
    }

        global.pendingDeposits[uniqueCode] = {
          amount: finalAmount,
          originalAmount: amount,
          userId,
          timestamp: Date.now(),
      status: 'pending',
      qrMessageId: qrMessage.message_id
    };

    db.run(
      `INSERT INTO pending_deposits (unique_code, user_id, amount, original_amount, timestamp, status, qr_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uniqueCode, userId, finalAmount, amount, Date.now(), 'pending', qrMessage.message_id],
      (err) => {
        if (err) logger.error('Gagal insert pending_deposits:', err.message);
      }
    );
        delete global.depositState[userId];

  } catch (error) {
    logger.error('❌ Kesalahan saat memproses deposit:', error);
    await ctx.editMessageText('❌ *GAGAL! Terjadi kesalahan saat memproses pembayaran. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
    delete global.depositState[userId];
    delete global.pendingDeposits[uniqueCode];
    db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode], (err) => {
      if (err) logger.error('Gagal hapus pending_deposits (error):', err.message);
    });
  }
}

const SOCKS_POOL = [
  'aristore:1447@idnusa.rajaserverpremium.web.id:1080',
  'aristore:1447@biznet.rajaserverpremium.web.id:1080',
];

function getRandomProxy() {
  return SOCKS_POOL[Math.floor(Math.random() * SOCKS_POOL.length)];
}

function parseSocks(proxyStr) {
  // "user:pass@host:port"
  const [auth, hostport] = proxyStr.split('@');
  const [user, pass] = auth.split(':');
  return { hostport, user, pass };
}

// ===== CEK QRIS (ORDERKUOTA – VIA CURL SIMPLE) =====
function cekQRISOrderKuota() {
  return new Promise((resolve, reject) => {
    const { hostport, user, pass } = parseSocks(getRandomProxy());

    const curlCmd = `
curl --silent --compressed \
  --connect-timeout 10 --max-time 20 \
  --socks5-hostname '${hostport}' \
  --proxy-user '${user}:${pass}' \
  -X POST '${WEB_MUTASI}' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Accept-Encoding: gzip' \
  -H 'User-Agent: okhttp/4.12.0' \
  --data-urlencode 'requests[qris_history][page]=1' \
  --data-urlencode 'auth_username=${AUTH_USER}' \
  --data-urlencode 'auth_token=${AUTH_TOKEN}'
`.trim();

    exec(curlCmd, { maxBuffer: 1024 * 1024 * 5 }, (err, stdout) => {
      const out = (stdout || '').trim();

      // kalau ada output, coba parse dulu (anggap sukses walau err)
      if (out) {
        try {
          return resolve(JSON.parse(out));
        } catch (e) {
          // output ada tapi bukan JSON
          return reject(new Error(`Invalid JSON: ${out.slice(0, 200)}`));
        }
      }

      // stdout kosong => baru anggap gagal
      return reject(err || new Error('Empty response from curl'));
    });
  });
}

// ===== AMBIL TX BY KREDIT (AMOUNT) =====
function findTxByKredit(qrisData, amount) {
  const list = qrisData?.qris_history?.results || [];
  const target = Number(amount);

  return list.find((tx) => {
    const kredit = Number(String(tx.kredit || '0').replace(/\./g, ''));
    return kredit === target && String(tx.status || '').toUpperCase() === 'IN';
  }) || null;
}

// ===== LOOP CEK QRIS =====
async function checkQRISStatus() {
  try {
    const pendingDeposits = Object.entries(global.pendingDeposits);

    for (const [uniqueCode, deposit] of pendingDeposits) {
      if (deposit.status !== 'pending') continue;

      const depositAge = Date.now() - deposit.timestamp;
      if (depositAge > 5 * 60 * 1000) {
        try {
          if (deposit.qrMessageId) {
            await bot.telegram.deleteMessage(deposit.userId, deposit.qrMessageId);
          }
          await bot.telegram.sendMessage(
            deposit.userId,
            '❌ *Pembayaran Expired*\n\nWaktu pembayaran telah habis. Silakan klik Top Up lagi untuk mendapatkan QR baru.',
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          logger.error('Error deleting expired payment messages:', err);
        }

        delete global.pendingDeposits[uniqueCode];
        db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode], (err) => {
          if (err) logger.error('Gagal hapus pending_deposits (expired):', err.message);
        });
        continue;
      }

      try {
        const expectedAmount = Number(deposit.amount);

        // ✅ ambil mutasi orderkuota (via curl + proxy)
        const qrisData = await cekQRISOrderKuota();

        if (!qrisData?.success || !qrisData?.qris_history?.success) {
          logger.warn(`OrderKuota invalid for ${uniqueCode}: ${JSON.stringify(qrisData)}`);
          continue;
        }

        const matchedTx = findTxByKredit(qrisData, expectedAmount);

        if (!matchedTx) {
          logger.info(`⏳ Payment pending for ${uniqueCode} (amount=${expectedAmount})`);
          continue;
        }

        const success = await processMatchingPayment(deposit, matchedTx, uniqueCode);
        if (success) {
          logger.info(`✅ Payment processed successfully for ${uniqueCode}`);

          delete global.pendingDeposits[uniqueCode];
          db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode], (err) => {
            if (err) logger.error('Gagal hapus pending_deposits (success):', err.message);
          });
        }
      } catch (error) {
        logger.error(`Error checking payment status for ${uniqueCode}:`, error?.message || error);
      }
    }
  } catch (error) {
    logger.error('Error in checkQRISStatus:', error?.message || error);
  }
}

function keyboard_abc() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({
      text: char,
      callback_data: char
    }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);
  return buttons;
}

function keyboard_nomor() {
  const alphabet = '1234567890';
  const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({
      text: char,
      callback_data: char
    }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);
  return buttons;
}

function keyboard_full() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({
      text: char,
      callback_data: char
    }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);
  return buttons;
}

global.processedTransactions = new Set();
async function updateUserBalance(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [amount, userId], function(err) {
        if (err) {
        logger.error('⚠️ Kesalahan saat mengupdate saldo user:', err.message);
          reject(err);
      } else {
        resolve();
        }
    });
  });
}

async function getUserBalance(userId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT saldo FROM users WHERE user_id = ?", [userId], function(err, row) {
        if (err) {
        logger.error('⚠️ Kesalahan saat mengambil saldo user:', err.message);
          reject(err);
      } else {
        resolve(row ? row.saldo : 0);
        }
    });
  });
}

async function sendPaymentSuccessNotification(userId, deposit, currentBalance) {
  try {
    // Hitung admin fee
    const adminFee = deposit.amount - deposit.originalAmount;
    await bot.telegram.sendMessage(userId,
      `✅ *Pembayaran Berhasil!*\n\n` +
      `💰 Jumlah Deposit: Rp ${deposit.originalAmount}\n` +
      `💰 Biaya Admin: Rp ${adminFee}\n` +
      `💰 Total Pembayaran: Rp ${deposit.amount}\n` +
      `💳 Saldo Sekarang: Rp ${currentBalance}`,
      { parse_mode: 'Markdown' }
    );
    return true;
  } catch (error) {
    logger.error('Error sending payment notification:', error);
    return false;
  }
}

async function processMatchingPayment(deposit, matchingTransaction, uniqueCode) {
  const transactionKey = `${matchingTransaction.reference_id || uniqueCode}_${matchingTransaction.amount}`;
  // Use a database transaction to ensure atomicity
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      // First check if transaction was already processed
      db.get('SELECT id FROM transactions WHERE reference_id = ? AND amount = ?', 
        [matchingTransaction.reference_id || uniqueCode, matchingTransaction.amount], 
        (err, row) => {
          if (err) {
            db.run('ROLLBACK');
            logger.error('Error checking transaction:', err);
            reject(err);
            return;
          }
          if (row) {
            db.run('ROLLBACK');
    logger.info(`Transaction ${transactionKey} already processed, skipping...`);
            resolve(false);
            return;
          }
          // Update user balance
          db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', 
            [deposit.originalAmount, deposit.userId], 
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                logger.error('Error updating balance:', err);
                reject(err);
                return;
              }
    // Record the transaction
      db.run(
                'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
                [deposit.userId, deposit.originalAmount, 'deposit', matchingTransaction.reference_id || uniqueCode, Date.now()],
        (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    logger.error('Error recording transaction:', err);
                    reject(err);
                    return;
                  }
                  // Get updated balance
                  db.get('SELECT saldo FROM users WHERE user_id = ?', [deposit.userId], async (err, user) => {
                    if (err) {
                      db.run('ROLLBACK');
                      logger.error('Error getting updated balance:', err);
                      reject(err);
                      return;
                    }
                    // Send notification using sendPaymentSuccessNotification
    const notificationSent = await sendPaymentSuccessNotification(
      deposit.userId,
      deposit,
                      user.saldo
                    );
                    // Delete QR code message after payment success
                    if (deposit.qrMessageId) {
                      try {
                        await bot.telegram.deleteMessage(deposit.userId, deposit.qrMessageId);
                      } catch (e) {
                        logger.error("Gagal menghapus pesan QR code:", e.message);
                      }
                    }
    if (notificationSent) {
      // Notifikasi ke grup untuk top up
      try {
        // Pada notifikasi ke grup (top up dan pembelian/renew), ambil info user:
        let userInfo;
        try {
          userInfo = await bot.telegram.getChat(deposit ? deposit.userId : (ctx ? ctx.from.id : ''));
        } catch (e) {
          userInfo = {};
        }
        const username = userInfo.username ? `@${userInfo.username}` : (userInfo.first_name || (deposit ? deposit.userId : (ctx ? ctx.from.id : '')));
        const userDisplay = userInfo.username
          ? `${username} (${deposit ? deposit.userId : (ctx ? ctx.from.id : '')})`
          : `${username}`;
        await bot.telegram.sendMessage(
          GROUP_ID,
          `<blockquote>
✅ <b>Top Up Berhasil</b>
👤 User: ${userDisplay}
💰 Nominal: <b>Rp ${deposit.originalAmount}</b>
🏦 Saldo Sekarang: <b>Rp ${user.saldo}</b>
🕒 Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
</blockquote>`,
          { parse_mode: 'HTML' }
        );
      } catch (e) { logger.error('Gagal kirim notif top up ke grup:', e.message); }
      // Hapus semua file di receipts setelah pembayaran sukses
      try {
        const receiptsDir = path.join(__dirname, 'receipts');
        if (fs.existsSync(receiptsDir)) {
          const files = fs.readdirSync(receiptsDir);
          for (const file of files) {
            fs.unlinkSync(path.join(receiptsDir, file));
          }
        }
      } catch (e) { logger.error('Gagal menghapus file di receipts:', e.message); }
      db.run('COMMIT');
      global.processedTransactions.add(transactionKey);
      delete global.pendingDeposits[uniqueCode];
      db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode]);
      resolve(true);
    } else {
      db.run('ROLLBACK');
      reject(new Error('Failed to send payment notification.'));
    }
                  });
                }
              );
            }
          );
        }
      );
    });
  });
}

setInterval(checkQRISStatus, 10000);

async function recordAccountTransaction(userId, type) {
  return new Promise((resolve, reject) => {
    const referenceId = `account-${type}-${userId}-${Date.now()}`;
    db.run(
      'INSERT INTO transactions (user_id, type, reference_id, timestamp) VALUES (?, ?, ?, ?)',
      [userId, type, referenceId, Date.now()],
      (err) => {
        if (err) {
          logger.error('Error recording account transaction:', err.message);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

app.listen(port, () => {
  bot.launch().then(() => {
      logger.info('Bot telah dimulai');
  }).catch((error) => {
      logger.error('Error saat memulai bot:', error);
  });
  logger.info(`Server berjalan di port ${port}`);
});
