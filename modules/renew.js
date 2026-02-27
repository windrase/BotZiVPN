const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');
const axios = require('axios');

async function renewssh(username, password, exp, limitip, serverId) {
  console.log(`[RENEW] Renewing Account: ${password}, Add Exp: ${exp}, ServerID: ${serverId}`);

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        return resolve('❌ Server tidak ditemukan di database bot.');
      }

      const domain = server.domain;
      const AUTH_TOKEN = server.auth;

      const isPotato = AUTH_TOKEN.toLowerCase().startsWith('potato');

      if (isPotato) {
        const curlCommand = `curl -sS -m 15 --connect-timeout 10 "http://${domain}:5888/renew/ssh?username=${password}&exp=${exp}&auth=${AUTH_TOKEN}"`;

        exec(curlCommand, async (_, stdout) => {
          stdout = stdout || "";
          if (stdout.includes("sukses") || stdout.includes(password) || stdout.includes("Account Renewed Successfully")) {
            try {
              const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
              const ip = ipInfo.data.query || domain;
              const isp = ipInfo.data.isp || 'Unknown';
              const region = ipInfo.data.country || 'Unknown';

            const msg = `RENEW AKUN ZIVPN\n` +
                        `┌──────────────────────────┐\n` +
                        `│ Host   : ${domain}\n` +
                        `│ IP     : ${ip}\n` +
                        `│ ISP    : ${isp}\n` +
                        `│ Region : ${region}\n` +
                        `│ Pass   : ${password}\n` +
                        `│ Added  : ${exp} Days\n` +
                        `└──────────────────────────┘\n` +
                        `Terima kasih telah menggunakan layanan kami`;
              return resolve(msg);
            } catch (error) {
              return resolve('✅ Akun berhasil diperpanjang, namun gagal memuat detail pesan.');
            }
          } else {
            return resolve(`❌ Gagal Renew. Server tidak merespon dengan benar.`);
          }
        });
      } else {
        const curlCommand = `curl -s --connect-timeout 10 "http://${domain}:5888/renew/zivpn?password=${password}&exp=${exp}&auth=${AUTH_TOKEN}"`;

        exec(curlCommand, async (_, stdout, stderr) => {
          if (stderr && !stdout) return resolve('❌ Gagal menghubungi server (Connection Error).');

          let d;
          try {
            d = JSON.parse(stdout);
          } catch (e) {
            return resolve('❌ Respon server tidak valid.');
          }

          if (d.status !== "success") {
            return resolve(`❌ Gagal Renew: ${d.message}`);
          }

          try {
            const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
            const ip = ipInfo.data.query || domain;
            const isp = ipInfo.data.isp || 'Unknown';
            const region = ipInfo.data.country || ipInfo.data.city || 'Unknown';

            const msg = `RENEW AKUN ZIVPN\n` +
                        `┌──────────────────────────┐\n` +
                        `│ Host   : ${domain}\n` +
                        `│ IP     : ${ip}\n` +
                        `│ ISP    : ${isp}\n` +
                        `│ Region : ${region}\n` +
                        `│ Pass   : ${password}\n` +
                        `│ Added  : ${exp} Days\n` +
                        `└──────────────────────────┘\n` +
                        `Terima kasih telah menggunakan layanan kami`;

            return resolve(msg);

          } catch (error) {
            console.error('Error formatting message:', error);
            return resolve('✅ Akun berhasil diperpanjang, namun gagal memuat detail pesan.');
          }
        });
      }
    });
  });
}

module.exports = { renewssh };
