const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellzivpn.db');
const axios = require('axios');

async function createssh(username, password, exp, iplimit, serverId) {
  console.log(`[CREATE] Creating Account: ${username}, Exp: ${exp}, ServerID: ${serverId}`);

  if (!/^[a-z0-9-]+$/.test(password) && !/^[a-z0-9-]+$/.test(username)) {
    return '❌ Password/Username tidak valid. Gunakan huruf kecil dan angka saja.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        return resolve('❌ Server tidak ditemukan di database bot.');
      }

      const domain = server.domain;
      const AUTH_TOKEN = server.auth;

      const isPotato = AUTH_TOKEN.toLowerCase().startsWith('potato');

      if (isPotato) {
        const randomPasswordSSH = Math.random().toString(36).substring(2, 8);
        const web_URL = `http://${domain}/vps/sshvpn`;
        const curlCommand = `curl -sS -X POST "${web_URL}" -H "Authorization: ${AUTH_TOKEN}" -H "Content-Type: application/json" -H "Accept: application/json" -d '{"expired":${exp},"kuota":"0","limitip":"${iplimit}","password":"${randomPasswordSSH}","username":"${username}"}'`;

        exec(curlCommand, async (_, stdout, stderr) => {
          if (stderr && !stdout) return resolve(`❌ Koneksi ke server gagal.\nError: ${stderr}`);

          try {
            const d = JSON.parse(stdout);
            if (d?.meta?.code !== 200 || !d.data) return resolve(`❌ Respons error:\n${d?.message || d?.meta?.message || "Gagal membuat akun"}`);
            
            const s = d.data;
            db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId]);
            
            const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
            const ip = ipInfo.data.query || domain;
            const isp = ipInfo.data.isp || 'Unknown';
            const region = ipInfo.data.country || 'Unknown';
            
            const userAkun = s.username; 
            const expStr = s.time ? `${s.exp} ${s.time}` : `${exp} Hari`;

            const msg = `CREATE AKUN ZIVPN\n` +
                        `┌──────────────────────────┐\n` +
                        `│ Host   : ${domain}\n` +
                        `│ IP     : ${ip}\n` +
                        `│ ISP    : ${isp}\n` +
                        `│ Region : ${region}\n` +
                        `│ Pass   : ${password}\n` +
                        `│ Expire : ${expStr}\n` +
                        `└──────────────────────────┘\n` +
                        `Terima kasih telah menggunakan layanan kami`;
            return resolve(msg);
          } catch (e) {
            return resolve(`❌ Format respon dari server tidak valid.\nOutput:\n${stdout.substring(0, 150)}`);
          }
        });
      } else {
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

          try {
            db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId]);

            const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
            const ip = ipInfo.data.query || domain;
            const isp = ipInfo.data.isp || 'Unknown';
            const region = ipInfo.data.country || ipInfo.data.city || 'Unknown';

            const expiredDate = new Date();
            expiredDate.setDate(expiredDate.getDate() + parseInt(exp));
            const options = { 
              timeZone: 'Asia/Jakarta', 
              day: 'numeric', month: 'short', year: 'numeric', 
              hour: '2-digit', minute: '2-digit', hour12: false 
            };
            const expStr = expiredDate.toLocaleString('en-GB', options).replace(',', '') + ' WIB';

            const msg = `CREATE AKUN ZIVPN\n` +
                        `┌──────────────────────────┐\n` +
                        `│ Host   : ${domain}\n` +
                        `│ IP     : ${ip}\n` +
                        `│ ISP    : ${isp}\n` +
                        `│ Region : ${region}\n` +
                        `│ Pass   : ${password}\n` +
                        `│ Expire : ${expStr}\n` +
                        `└──────────────────────────┘\n` +
                        `Terima kasih telah menggunakan layanan kami`;

            return resolve(msg);

          } catch (error) {
            console.error('Error formatting message:', error);
            return resolve('✅ Akun berhasil dibuat, namun gagal memuat detail pesan.');
          }
        });
      }
    });
  });
}

module.exports = { createssh };
