const axios = require('axios');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');

async function trialssh(username, password, exp, iplimit, serverId) {
  // Note: username & password di sini biasanya kosong/abaikan untuk trial random
  
  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) {
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const AUTH_TOKEN = server.auth;

      // Endpoint trial
      const curlCommand = `curl "http://${domain}:5888/trial/zivpn?exp=${exp}&auth=${AUTH_TOKEN}"`;

      exec(curlCommand, (_, stdout) => {
        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          return resolve('❌ Format respon dari server tidak valid.');
        }

        if (d.status !== "success") {
          return resolve(`❌ ${d.message}`);
        }

        // UPDATE total create akun
        if (exp >= 1 && exp <= 135) {
          db.run(
            'UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?',
            [serverId]
          );
        }

        // Pesan trial harus datang dari server (d.message) 
        // karena password digenerate di server.
        // Pastikan setup.sh di VPS sudah diupdate.
        const msg = `${d.message}`; 

        return resolve(msg);
      });
    });
  });
}

module.exports = { trialssh };
