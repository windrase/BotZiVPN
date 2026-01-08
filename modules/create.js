const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');
const axios = require('axios'); // Pastikan axios terinstall

async function createssh(username, password, exp, iplimit, serverId) {
  console.log(`[CREATE] Creating Account: ${username}, Exp: ${exp}, ServerID: ${serverId}`);

  // Validasi karakter password/username
  if (!/^[a-z0-9-]+$/.test(password)) {
    return '❌ Password tidak valid. Gunakan huruf kecil dan angka saja.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        return resolve('❌ Server tidak ditemukan di database bot.');
      }

      const domain = server.domain;
      const AUTH_TOKEN = server.auth;

      // 1. Lakukan Request ke API Server (Setup.sh)
      const curlCommand = `curl -s --connect-timeout 10 "http://${domain}:5888/create/zivpn?password=${password}&exp=${exp}&auth=${AUTH_TOKEN}"`;

      exec(curlCommand, async (_, stdout, stderr) => {
        if (stderr && !stdout) return resolve('❌ Gagal menghubungi server (Connection Error).');

        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          return resolve('❌ Respon server tidak valid.');
        }

        if (d.status !== "success") {
          return resolve(`❌ Gagal: ${d.message}`);
        }

        // 2. Akun Berhasil Dibuat, Sekarang Ambil Detail Server & Hitung Expired
        try {
          // Update statistik DB
          db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId]);

          // Fetch Data IP/ISP dari ip-api.com
          const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
          const ip = ipInfo.data.query || domain;
          const isp = ipInfo.data.isp || 'Unknown';
          const region = ipInfo.data.country || ipInfo.data.city || 'Unknown';

          // Hitung Tanggal Expired (WIB / UTC+7)
          // exp dalam hari
          const expiredDate = new Date();
          expiredDate.setDate(expiredDate.getDate() + parseInt(exp));
          // Penyesuaian jam WIB (+7) secara manual untuk string formatting
          // Atau gunakan toLocaleString dengan timeZone
          const options = { 
            timeZone: 'Asia/Jakarta', 
            day: 'numeric', month: 'short', year: 'numeric', 
            hour: '2-digit', minute: '2-digit', hour12: false 
          };
          const expStr = expiredDate.toLocaleString('en-GB', options).replace(',', '') + ' WIB';

          // 3. Susun Pesan Format Kotak (HTML)
          const msg = `CREATE AKUN ZIVPN
┌──────────────────────────┐
│ Host   : ${domain}
│ IP     : ${ip}
│ ISP    : ${isp}
│ Region : ${region}
│ Pass   : ${password}
│ Expire : ${expStr}
└──────────────────────────┘
Terima kasih telah menggunakan layanan kami`;

          return resolve(msg);

        } catch (error) {
          console.error('Error formatting message:', error);
          return resolve('✅ Akun berhasil dibuat, namun gagal memuat detail pesan.');
        }
      });
    });
  });
}

module.exports = { createssh };
