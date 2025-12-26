const axios = require('axios');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');

async function trialssh(username, password, exp, iplimit, serverId) {
  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) return resolve('❌ Server tidak ditemukan.');

      const domain = server.domain;
      const ip = server.ip || domain;
      const AUTH_TOKEN = server.auth;

      // Endpoint trial
      const curlCommand = `curl -s "http://${domain}:5888/trial/zivpn?exp=${exp}&auth=${AUTH_TOKEN}"`;

      exec(curlCommand, (_, stdout) => {
        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          return resolve('❌ Format respon server error.');
        }

        if (d.status !== "success") return resolve(`❌ ${d.message}`);

        // Ambil data user/pass yang digenerate server
        // Pastikan setup.sh VPS sudah versi terbaru (yang me-return object data)
        const userTrial = d.data ? d.data.user : "trial";
        const passTrial = d.data ? d.data.pass : "trial";
        
        // Hitung waktu expire (dalam menit)
        const date = new Date();
        date.setMinutes(date.getMinutes() + parseInt(exp));
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const expStr = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} ${("0" + date.getHours()).slice(-2)}:${("0" + date.getMinutes()).slice(-2)}`;

        const msg = `CREATE AKUN TRIAL ZIVPN
┌────────────────────────┐
│ Host   : ${domain}
│ IP     : ${ip}
│ Pass   : ${passTrial}
│ Expire : ${expStr} (${exp} Min)
└────────────────────────┘
Terima kasih telah menggunakan layanan kami`;

        return resolve(msg);
      });
    });
  });
}

module.exports = { trialssh };
