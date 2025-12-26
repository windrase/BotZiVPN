const axios = require('axios');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');

async function createssh(username, password, exp, iplimit, serverId) {
  console.log(`Creating SSH account for ${username} with expiry ${exp} days, IP limit ${iplimit}, and password ${password}`);

  // Validasi username
  if (!/^[a-z0-9-]+$/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const AUTH_TOKEN = server.auth;

      const curlCommand = `curl "http://${domain}:5888/create/zivpn?password=${password}&exp=${exp}&auth=${AUTH_TOKEN}"`;

      exec(curlCommand, (_, stdout) => {
        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          console.error('❌ Gagal parsing JSON:', e.message);
          return resolve('❌ Format respon dari server tidak valid.');
        }

        if (d.status !== "success") {
          console.error('❌ Respons error:', d);
          return resolve(`❌ ${d.message}`);
        }

        // UPDATE total create akun
        if (exp >= 1 && exp <= 135) {
          db.run(
            'UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?',
            [serverId]
          );
        }

        // --- BAGIAN INI DIMODIFIKASI AGAR MENAMPILKAN DETAIL ---
        // Bot menyusun pesan sendiri karena bot sudah tau user/pass/exp/domain
        const msg = `
✅ **Account Created Successfully**
━━━━━━━━━━━━━━━━━━━━
<b>Domain:</b> <code>${domain}</code>
<b>Username:</b> <code>${username}</code>
<b>Password:</b> <code>${password}</code>
<b>Expired:</b> <code>${exp} Days</code>
━━━━━━━━━━━━━━━━━━━━
`;
        return resolve(msg);
      });
    });
  });
}

module.exports = { createssh };
