import * as fs from 'fs';
import { exec } from 'child_process';
import cron from 'node-cron';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

interface Config {
  groupName: string;
  messageText: string;
  sendTime: string;
  alertSoundFile?: string;
}
let config: Config;
try {
  const configData = fs.readFileSync('config.json', 'utf-8');
  config = JSON.parse(configData) as Config;
} catch (e) {
  console.error('Failed to load config.json:', e);
  config = { groupName: '', messageText: '', sendTime: '' };
}

let cronExpression: string;
if (config.sendTime && /^\d{1,2}:\d{2}$/.test(config.sendTime)) {
  const [h, m] = config.sendTime.split(':');
  cronExpression = `${parseInt(m, 10)} ${parseInt(h, 10)} * * *`;
} else {
  cronExpression = config.sendTime || '0 9 * * *';
}

let sock: any;
let isConnected: boolean = false;
let targetJid: string | undefined;
let lastSentDate: string | null = null;

try {
  const lastData = fs.readFileSync('last_sent.json', 'utf-8');
  const obj = JSON.parse(lastData);
  if (obj && obj.lastSent) lastSentDate = obj.lastSent;
} catch {}

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        isConnected = true;
        console.log('✅ WhatsApp connected');
        if (!targetJid && config.groupName) {
          try {
            const groups = await sock.groupFetchAllParticipating();
            for (const [jid, groupInfo] of Object.entries(groups)) {
              if ((groupInfo as any).subject === config.groupName) {
                targetJid = jid;
                break;
              }
            }
            if (targetJid) console.log(`Target group found: ${targetJid}`);
            else console.error(`Group "${config.groupName}" not found`);
          } catch (err) {
            console.error('Failed to fetch groups:', err);
          }
        }
      } else if (connection === 'close') {
        isConnected = false;
        const error = lastDisconnect?.error;
        const shouldReconnect = (error instanceof Boom ? error.output.statusCode : 0) !== DisconnectReason.loggedOut;
        console.warn('Connection closed. Reason:', error?.message || error);
        if (shouldReconnect) {
          connectToWhatsApp().catch(err => console.error('Reconnect failed:', err));
        } else {
          console.log('Logged out. No reconnection.');
        }
      }
    });
  } catch (err) {
    console.error('connectToWhatsApp error:', err);
  }
}

connectToWhatsApp().catch(err => console.error('Initial connection error:', err));

function updateLastSentToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  lastSentDate = `${yyyy}-${mm}-${dd}`;
  const data = JSON.stringify({ lastSent: lastSentDate });
  try {
    fs.writeFileSync('last_sent.json', data);
  } catch (e) {
    console.error('Failed to write last_sent.json:', e);
  }
}

cron.schedule(cronExpression, async () => {
  const todayStr = (() => {
    const d = new Date();
    const yy = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${m}-${dd}`;
  })();
  if (lastSentDate === todayStr) {
    console.log('Already sent today.');
    return;
  }

  const messageContent = { text: config.messageText || '' };
  let sent = false;
  let attempts = 0;
  const maxAttempts = 10;

  console.log(`⏰ Scheduled send triggered at ${todayStr} ${config.sendTime}`);

  const intervalId = setInterval(async () => {
    attempts++;
    try {
      let destinationJid = targetJid;
      if (!destinationJid && isConnected) {
        try {
          const groups = await sock.groupFetchAllParticipating();
          for (const [jid, groupInfo] of Object.entries(groups)) {
            if ((groupInfo as any).subject === config.groupName) {
              destinationJid = jid;
              targetJid = jid;
              break;
            }
          }
        } catch (err) {
          console.error('Group fetch failed:', err);
        }
      }

      if (isConnected && destinationJid) {
        await sock.sendMessage(destinationJid, messageContent);
        console.log('✔️ Message sent.');
        sent = true;
        updateLastSentToday();
      }

      if (sent) clearInterval(intervalId);
      if (attempts >= maxAttempts && !sent) {
        clearInterval(intervalId);
        console.error('❌ Failed to send after 5 minutes.');
        if (config.alertSoundFile) {
          exec(`termux-media-player play "${config.alertSoundFile}"`, (err) => {
            if (err) console.error('Sound playback failed:', err);
            else console.log('🔔 Sound played.');
          });
        }
      }
    } catch (err) {
      console.error('Send attempt error:', err);
    }
  }, 30000);
}, {
  timezone: 'Europe/Kyiv'
});
