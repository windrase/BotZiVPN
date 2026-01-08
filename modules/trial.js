const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');
const axios = require('axios');

async function trialssh(username, password, exp, iplimit, serverId) {
  console.log(`[TRIAL] Request Trial ${exp} Minutes on ServerID: ${serverId}`);

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) return resolve('❌ Server tidak ditemukan.');

      const domain = server.domain;
      const AUTH_TOKEN = server.auth;

      const curlCommand = `curl -s --connect-timeout 10 "http://${domain}:5888/trial/zivpn?exp=${exp}&auth=${AUTH_TOKEN}"`;

      exec(curlCommand, async (_, stdout, stderr) => {
        if (stderr && !stdout) return resolve('❌ Koneksi ke server gagal.');

        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          return resolve('❌ Respon server error.');
        }

        if (d.status !== "success") return resolve(`❌ Gagal Trial: ${d.message}`);

        // Data user dari API (user trial random)
        const userTrial = d.data ? d.data.user : 'unknown';

        try {
          // Update DB
          db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId]);

          // Fetch Info Server
          const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
          const ip = ipInfo.data.query || domain;
          const isp = ipInfo.data.isp || 'Unknown';
          const region = ipInfo.data.country || 'Unknown';

          // Hitung Expired (Menit)
          const expiredDate = new Date(Date.now() + parseInt(exp) * 60000);
          const options = { 
            timeZone: 'Asia/Jakarta', 
            day: 'numeric', month: 'short', year: 'numeric', 
            hour: '2-digit', minute: '2-digit', hour12: false 
          };
          const expStr = expiredDate.toLocaleString('en-GB', options).replace(',', '') + ' WIB';

          // Format Pesan
          const msg = `CREATE AKUN TRIAL ZIVPN
┌──────────────────────────┐
│ Host   : ${domain}
│ IP     : ${ip}
│ ISP    : ${isp}
│ Region : ${region}
│ Pass   : ${userTrial}
│ Expire : ${expStr}
└──────────────────────────┘
Terima kasih telah menggunakan layanan kami`;

          return resolve(msg);

        } catch (error) {
          return resolve(`✅ Trial berhasil: ${userTrial}, tapi format pesan gagal.`);
        }
      });
    });
  });
}

module.exports = { trialssh };
