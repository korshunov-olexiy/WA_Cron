import makeWASocket, { Browsers, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import * as fs from 'fs/promises';
import cron from 'node-cron';
import * as path from 'path';
import pino from 'pino';

interface Config {
  app_name: string;  // ім'я програми
  group: string;     // ім'я групи
  message: string;   // текст повідомлення
  sendTime: string;  // час, коли треба відправити повідомлення
}

class WhatsAppBot {
  private sock: WASocket | null = null;
  private config!: Config;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  async init() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    this.config = await this.readConfig();
    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.baileys(this.config.app_name),
      printQRInTerminal: true,
      keepAliveIntervalMs: 60000,
    });
    this.sock.ev.on('connection.update', (update) => {
      if (update.qr) {
        console.log('QR код:', update.qr);
      } else if (update.connection === 'close') {
        this.reconnect();
      }
    });
    this.scheduleSendMessage();
  }

  private async readConfig() {
    const configFile = await fs.readFile(path.join(__dirname, 'config.json'), 'utf8');
    return JSON.parse(configFile) as Config;
  }

  private scheduleSendMessage() {
    const [hour, minute] = this.config.sendTime.split(':');
    cron.schedule(`0 ${minute} ${hour} * * *`, async () => {
      await this.sendMessage();
    });
  }

  private async reconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.init();
      } catch (error) {
        console.error('Помилка при перепідключенні:', error);
        this.reconnect();
      }
    }, 30000); // перепідключення через 30 секунд
  }

  private async sendMessage() {
    if (!this.sock) {
      console.error('З\'єднання не встановлено.');
      return;
    }
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const groupMetadata = Object.values(groups).find((group) => group.subject === this.config.group);
      if (!groupMetadata) {
        console.error(`Група "${this.config.group}" не знайдена.`);
        return;
      }
      await this.sock.sendMessage(groupMetadata.id, { text: this.config.message });
      console.log(`Повідомлення відправлено в групу "${this.config.group}"`);
    } catch (error) {
      console.error('Помилка при відправці повідомлення:', error);
    }
  }
}

const bot = new WhatsAppBot();
bot.init();
