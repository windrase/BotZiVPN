const axios = require('axios');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');
const dns = require('dns'); // Modul untuk ubah Domain ke IP

async function createssh(username, password, exp, iplimit, serverId) {
  console.log(`Creating Account: Pass=${password}, Exp=${exp}`);

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) {
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const AUTH_TOKEN = server.auth;

      // --- LOGIKA BARU: Ubah Domain jadi IP Angka ---
      dns.lookup(domain, (err, address) => {
        // Jika berhasil resolve, pakai IP angka. Jika gagal, pakai domain.
        const final_ip = address ? address : (server.ip || domain);

        // API Call ke VPS
        const curlCommand = `curl -s "http://${domain}:5888/create/zivpn?password=${password}&exp=${exp}&auth=${AUTH_TOKEN}"`;

        exec(curlCommand, (_, stdout) => {
          let d;
          try {
            d = JSON.parse(stdout);
          } catch (e) {
            console.error('❌ JSON Error:', e.message);
            return resolve('❌ Gagal menghubungi server atau respon tidak valid.');
          }

          if (d.status !== "success") {
            return resolve(`❌ ${d.message}`);
          }

          // Update database bot
          if (exp >= 1 && exp <= 135) {
            db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId]);
          }

          // Format Tanggal
          const date = new Date();
          date.setDate(date.getDate() + parseInt(exp));
          const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
          const expStr = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} ${("0" + date.getHours()).slice(-2)}:${("0" + date.getMinutes()).slice(-2)}`;

          // Pesan Output dengan IP yang sudah berupa Angka
          const msg = `CREATE AKUN ZIVPN
┌────────────────────────┐
│ Host   : ${domain}
│ IP     : ${final_ip}
│ Pass   : ${password}
│ Expire : ${expStr}
└────────────────────────┘
Terima kasih telah menggunakan layanan kami`;

          return resolve(msg);
        });
      });
    });
  });
}

module.exports = { createssh };

