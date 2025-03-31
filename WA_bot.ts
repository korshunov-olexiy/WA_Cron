import makeWASocket, { Browsers, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as fs from 'fs/promises';
import * as path from 'path';

interface Config {
  group: string;
  message: string;
  sendTime: string;
  alertSoundFile: string;
  successSoundFile: string;
  app_name: string;
}

class WhatsAppBot {
  private config: Config;
  private sock: any;
  private targetJid: string | null = null;
  private isConnected = false;
  private sent = false;
  private attempts = 0;
  private maxAttempts: number;
  private deadline: Date;

  constructor(config: Config) {
    this.config = config;
    if (!this.config.app_name) this.config.app_name = "WA_bot";
    this.maxAttempts = Math.ceil((5 * 60 * 1000) / 30000);
    const now = new Date();
    const [sendHour, sendMinute] = this.config.sendTime.split(':').map(Number);
    const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sendHour, sendMinute, 0);
    this.deadline = new Date(scheduled.getTime() + 5 * 60000);
  }

  public async start() {
    try {
      await this.connectToWhatsApp();
      this.trySendMessage();
    } catch (error) {
      console.error("Помилка старту WhatsAppBot:", error);
      await this.writeStatus(false);
      process.exit(1);
    }
  }

  private async connectToWhatsApp() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('auth_info');
      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.baileys(this.config.app_name),
        printQRInTerminal: true,
        keepAliveIntervalMs: 60000,
      });
      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
          this.isConnected = true;
          console.log('📶Підключення до WhatsApp успішне');
          if (!this.targetJid && this.config.group) {
            try {
              const groups = await this.sock.groupFetchAllParticipating();
              for (const [jid, groupInfo] of Object.entries(groups)) {
                if ((groupInfo as any).subject === this.config.group) {
                  this.targetJid = jid;
                  break;
                }
              }
              if (!this.targetJid) {
                console.error(`❌Група "${this.config.group}" не знайдена.`);
                await this.writeStatus(false);
                process.exit(1);
              }
            } catch (err) {
              console.error('Помилка отримання груп:', err);
              await this.writeStatus(false);
              process.exit(1);
            }
          }
        } else if (connection === 'close') {
          this.isConnected = false;
          const error = lastDisconnect?.error;
          const shouldReconnect = !(error && (error instanceof Boom) && error.output?.statusCode === 401);
          console.warn('З\'єднання розірвано:', error?.message || error, '| Перепідключення:', shouldReconnect);
          if (shouldReconnect) {
            setTimeout(() => {
              this.connectToWhatsApp();
            }, 5000);
          } else {
            console.error('❌Користувач вийшов із WhatsApp.');
            await this.writeStatus(false);
            process.exit(1);
          }
        }
      });
    } catch (err) {
      console.error('📴Помилка підключення до WhatsApp:', err);
      await this.writeStatus(false);
      process.exit(1);
    }
  }

  private trySendMessage() {
    const intervalId = setInterval(async () => {
      this.attempts++;
      try {
        if (this.isConnected && this.targetJid) {
          await this.sock.sendMessage(this.targetJid, { text: this.config.message });
          this.sent = true;  // успішна відправка повідомлення
          clearInterval(intervalId);
          await this.writeStatus(true);
          process.exit(0);
        } else {
          console.log('Очікування підключення або отримання targetJid...');
        }
        if (new Date() >= this.deadline) {
          clearInterval(intervalId);
          if (!this.sent) {
            console.error('❌Не вдалося відправити повідомлення протягом 5 хвилин.');
            await this.writeStatus(false);
            process.exit(1);
          }
        }
      } catch (err) {
        console.error('❌Помилка при спробі відправлення:', err);
      }
    }, 30000);
  }

  private async writeStatus(sent: boolean) {
    const status = {
      date: new Date().toISOString().split('T')[0],
      sent
    };
    try {
      await fs.writeFile(path.join(__dirname, 'send_status.json'), JSON.stringify(status));
    } catch (err) {
      console.error('❌Помилка запису статусу:', err);
    }
  }
}

(async () => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const configData = await fs.readFile(configPath, 'utf-8');
    const config: Config = JSON.parse(configData);
    const bot = new WhatsAppBot(config);
    await bot.start();
  } catch (err) {
    console.error('❌Помилка ініціалізації бота:', err);
    process.exit(1);
  }
})();
