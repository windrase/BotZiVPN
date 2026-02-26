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

      const isPotato = AUTH_TOKEN.toLowerCase().startsWith('potato');

      if (isPotato) {
        if (!/^[a-z0-9-]+$/.test(username)) {
          return resolve('❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.');
        }

        const web_URL = `http://${domain}/vps/trialsshvpn`;
        const curlCommand = `curl -sS -X POST "${web_URL}" -H "Authorization: ${AUTH_TOKEN}" -H "Content-Type: application/json" -H "Accept: application/json" -d '{"timelimit":"1h"}'`;

        exec(curlCommand, async (_, stdout, stderr) => {
          if (stderr && !stdout) return resolve(`❌ Koneksi ke server gagal.\nError: ${stderr}`);

          try {
            const d = JSON.parse(stdout);
            if (d?.meta?.code !== 200 || !d.data) {
              return resolve(`❌ Respons error:\n${d?.message || d?.meta?.message || "Gagal Trial"}`);
            }
            const s = d.data;
            db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId]);

            const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
            const ip = ipInfo.data.query || domain;
            const isp = ipInfo.data.isp || 'Unknown';
            const region = ipInfo.data.country || 'Unknown';
            
            const userTrial = s.username; 
            const expStr = s.time ? `${s.exp} ${s.time}` : '1 Jam';

            const msg = `CREATE AKUN TRIAL ZIVPN\n` +
                        `┌──────────────────────────┐\n` +
                        `│ Host   : ${domain}\n` +
                        `│ IP     : ${ip}\n` +
                        `│ ISP    : ${isp}\n` +
                        `│ Region : ${region}\n` +
                        `│ Pass   : ${userTrial}\n` +
                        `│ Expire : ${expStr}\n` +
                        `└──────────────────────────┘\n` +
                        `Terima kasih telah menggunakan layanan kami`;
            return resolve(msg);
          } catch (e) {
            return resolve(`❌ Format respon dari server tidak valid.\nOutput:\n${stdout.substring(0, 150)}`);
          }
        });

      } else {
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

          const userTrial = d.data ? d.data.user : 'unknown';

          try {
            db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId]);

            const ipInfo = await axios.get(`http://ip-api.com/json/${domain}`).catch(() => ({ data: {} }));
            const ip = ipInfo.data.query || domain;
            const isp = ipInfo.data.isp || 'Unknown';
            const region = ipInfo.data.country || 'Unknown';

            const expiredDate = new Date(Date.now() + parseInt(exp) * 60000);
            const options = { 
              timeZone: 'Asia/Jakarta', 
              day: 'numeric', month: 'short', year: 'numeric', 
              hour: '2-digit', minute: '2-digit', hour12: false 
            };
            const expStr = expiredDate.toLocaleString('en-GB', options).replace(',', '') + ' WIB';

            const msg = `CREATE AKUN TRIAL ZIVPN\n` +
                        `┌──────────────────────────┐\n` +
                        `│ Host   : ${domain}\n` +
                        `│ IP     : ${ip}\n` +
                        `│ ISP    : ${isp}\n` +
                        `│ Region : ${region}\n` +
                        `│ Pass   : ${userTrial}\n` +
                        `│ Expire : ${expStr}\n` +
                        `└──────────────────────────┘\n` +
                        `Terima kasih telah menggunakan layanan kami`;

            return resolve(msg);

          } catch (error) {
            return resolve(`✅ Trial berhasil: ${userTrial}, tapi format pesan gagal.`);
          }
        });
      }
    });
  });
}

module.exports = { trialssh };
