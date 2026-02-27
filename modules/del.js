const axios = require('axios');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');

async function delssh(username, password, exp, iplimit, serverId) {
  console.log(`Delete SSH account for ${username} with expiry ${exp} days, IP limit ${iplimit}, and password ${password}`);

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

      const isPotato = AUTH_TOKEN.toLowerCase().startsWith('potato');

      if (isPotato) {
        const curlCommand = `curl -sS -m 15 --connect-timeout 10 "http://${domain}:5888/delete/ssh?username=${username}&auth=${AUTH_TOKEN}"`;

        exec(curlCommand, (_, stdout) => {
          stdout = stdout || "";
          if (stdout.includes("berhasil") || stdout.includes("deleted") || stdout.includes("Successfully") || stdout.includes("Account Deleted Successfully")) {
            db.run('UPDATE Server SET total_create_akun = total_create_akun - 1 WHERE id = ?', [serverId]);
            return resolve(`✅ Akun **${username}** berhasil dihapus.`);
          } else {
            return resolve(`❌ Gagal hapus akun. Respon server tidak dikenali.\nOutput: ${stdout.substring(0, 50)}`);
          }
        });
      } else {
        const curlCommand = `curl "http://${domain}:5888/delete/zivpn?password=${username}&auth=${AUTH_TOKEN}"`;

        exec(curlCommand, (_, stdout) => {
          let d;
          try {
            d = JSON.parse(stdout);
            console.log("⚠️ FULL DATA:", JSON.stringify(d, null, 2));
          } catch (e) {
            console.error('❌ Gagal parsing JSON:', e.message);
            console.error('🪵 Output:', stdout);
            return resolve('❌ Format respon dari server tidak valid.');
          }

          if (d.status !== "success") {
            console.error('❌ Respons error:', d);
            return resolve(`❌ ${d.message}`);
          }

          db.run(
            'UPDATE Server SET total_create_akun = total_create_akun - 1 WHERE id = ?',
            [serverId],
            (err) => {
              if (err) console.error('⚠️ Gagal update total_create_akun:', err.message);
            }
          );

          const msg = `${d.message}`;
          return resolve(msg);
        });
      }
    });
  });
}
  
module.exports = { delssh };
