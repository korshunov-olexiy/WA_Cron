import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, Browsers, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import cron from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';

interface Config {
  app_name: string;
  group: string;
  message: string;
  sendTime: string;
  highlightStart: string;
  highlightEnd: string;
  errorHighlightStart: string;
  errorHighlightEnd: string;
  msgSentToday: boolean;
}

class WhatsAppBot {
  private sock: WASocket | null = null;
  private config: Config;

  constructor(private configPath: string) {
    this.config = this.readConfig(configPath);
  }

  private readConfig(filePath: string): Config {
    const fullPath = path.resolve(__dirname, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`${this.config.errorHighlightStart}Файл ${filePath} не знайдено.${this.config.errorHighlightEnd}`);
    }
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  }

  private saveConfig() {
    fs.writeFileSync(path.resolve(__dirname, this.configPath), JSON.stringify(this.config, null, 2));
  }

  async initialize() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    this.sock = makeWASocket({
      auth: state,
      browser: Browsers.baileys(this.config.app_name),
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      keepAliveIntervalMs: 60000,
    });
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log(`\n${this.config.highlightStart}Відскануйте QR-код для авторизації:${this.config.highlightEnd}`, qr);
      }
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.error(`\n${this.config.errorHighlightStart}З’єднання закрито. Перезапуск...${this.config.errorHighlightEnd}`, shouldReconnect);
        if (shouldReconnect) {
          this.initialize();
        } else {
          console.error(`\n${this.config.errorHighlightStart}Авторизацію не виконано. Завершення роботи.${this.config.errorHighlightEnd}`);
          process.exit(1);
        }
      } else if (connection === 'open') {
        console.log(`\n${this.config.highlightStart}Підключено до WhatsApp.${this.config.highlightEnd}`);
        this.scheduleMessage();
      }
    });
    this.sock.ev.on('creds.update', saveCreds);
  }

  private scheduleMessage() {
    const [hour, minute] = this.config.sendTime.split(':');
    cron.schedule(`${minute} ${hour} * * *`, async () => {
      if (!this.config.msgSentToday) {
        await this.sendMessage();
      }
      this.showCountdown(hour, minute);
    });
    cron.schedule('0 0 * * *', () => {
      this.config.msgSentToday = false;
      this.saveConfig();
    });
    this.showCountdown(hour, minute);
  }

  private async sendMessage() {
    if (!this.sock) return;
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const groupMetadata = Object.values(groups).find(
        (group) => group.subject === this.config.group
      );
      if (!groupMetadata) {
        console.error(`\n${this.config.errorHighlightStart}Група \"${this.config.group}\" не знайдена.${this.config.errorHighlightEnd}`);
        this.config.msgSentToday = false;
        this.saveConfig();
        return;
      }
      await this.sock.sendMessage(groupMetadata.id, { text: this.config.message });
      this.config.msgSentToday = true;
      this.saveConfig();
      console.log(`\n${this.config.highlightStart}Повідомлення відправлене у \"${this.config.group}\".${this.config.highlightEnd}`);
    } catch (error) {
      this.config.msgSentToday = false;
      this.saveConfig();
      console.error(`\n${this.config.errorHighlightStart}Помилка при відправленні повідомлення:${this.config.errorHighlightEnd}`, error);
    }
  }

  private showCountdown(hour: string, minute: string) {
    setInterval(() => {
      const now = new Date();
      const next = new Date();
      next.setHours(parseInt(hour), parseInt(minute), 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
        this.config.msgSentToday = false;
        this.saveConfig();
      }
      const diffMs = next.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / 3600000);
      const diffMinutes = Math.floor((diffMs % 3600000) / 60000);
      const diffSeconds = Math.floor((diffMs % 60000) / 1000);
      process.stdout.write(`\r${this.config.highlightStart}Наступне повідомлення через${this.config.highlightEnd} ${diffHours}:${diffMinutes}:${diffSeconds}`);
    }, 1000);
  }

}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
