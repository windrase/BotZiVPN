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

      // Request ke API Server (Setup.sh)
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

        // Renew Berhasil, Susun Pesan Format Kotak
        try {
          // Fetch Data IP/ISP dari ip-api.com
          const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
          const ip = ipInfo.data.query || domain;
          const isp = ipInfo.data.isp || 'Unknown';
          const region = ipInfo.data.country || ipInfo.data.city || 'Unknown';

          // Format Pesan
          // Karena setup.sh tidak membalas dengan tanggal expired baru, kita tampilkan jumlah hari yang ditambahkan.
          const msg = `RENEW AKUN ZIVPN
┌──────────────────────────┐
│ Host   : ${domain}
│ IP     : ${ip}
│ ISP    : ${isp}
│ Region : ${region}
│ Pass   : ${password}
│ Added  : ${exp} Days
└──────────────────────────┘
Terima kasih telah menggunakan layanan kami`;

          return resolve(msg);

        } catch (error) {
          console.error('Error formatting message:', error);
          return resolve('✅ Akun berhasil diperpanjang, namun gagal memuat detail pesan.');
        }
      });
    });
  });
}

module.exports = { renewssh };
