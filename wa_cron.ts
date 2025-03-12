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
}

class WhatsAppBot {
  private sock: WASocket | null = null;
  private config: Config;

  constructor(configPath: string) {
    this.config = this.readConfig(configPath);
  }

  private readConfig(filePath: string): Config {
    const fullPath = path.resolve(__dirname, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`${this.config.errorHighlightStart}Файл ${filePath} не знайдено.${this.config.errorHighlightEnd}`);
    }
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  }

  async initialize() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.baileys(this.config.app_name),
      printQRInTerminal: true,
      keepAliveIntervalMs: 60000,
    });
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log(`${this.config.highlightStart}Відскануйте QR-код для авторизації:${this.config.highlightEnd}`, qr);
      }
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.error(`${this.config.errorHighlightStart}З’єднання закрито. Перезапуск...${this.config.errorHighlightEnd}`, shouldReconnect);
        if (shouldReconnect) {
          this.initialize();
        } else {
          console.error(`${this.config.errorHighlightStart}Авторизацію не виконано. Завершення роботи.${this.config.errorHighlightEnd}`);
          process.exit(1);
        }
      } else if (connection === 'open') {
        console.log(`${this.config.highlightStart}Підключено до WhatsApp.${this.config.highlightEnd}`);
        this.scheduleMessage();
      }
    });
    this.sock.ev.on('creds.update', saveCreds);
  }

  private scheduleMessage() {
    const [hour, minute] = this.config.sendTime.split(':');
    cron.schedule(`${minute} ${hour} * * *`, async () => {
      await this.sendMessage();
      this.showCountdown(hour, minute);
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
        console.error(`${this.config.errorHighlightStart}Група \"${this.config.group}\" не знайдена.${this.config.errorHighlightEnd}`);
        return;
      }
      await this.sock.sendMessage(groupMetadata.id, { text: this.config.message });
      console.log(`${this.config.highlightStart}Повідомлення відправлене у \"${this.config.group}\".${this.config.highlightEnd}`);
    } catch (error) {
      console.error(`${this.config.errorHighlightStart}Помилка при відправці: ${this.config.errorHighlightEnd}`, error);
    }
  }

  private showCountdown(hour: string, minute: string) {
    const updateInterval = setInterval(() => {
      const now = new Date();
      const next = new Date();
      next.setHours(parseInt(hour), parseInt(minute), 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const diffMs = next.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / 3600000);
      const diffMinutes = Math.floor((diffMs % 3600000) / 60000);
      const diffSeconds = Math.floor((diffMs % 60000) / 1000);
      process.stdout.write(`\r${this.config.highlightStart}Наступне повідомлення через${this.config.highlightEnd} ${this.config.errorHighlightStart}${diffHours}год. ${diffMinutes}хв. ${diffSeconds}сек.${this.config.errorHighlightEnd}  `);
      if (diffHours === 0 && diffMinutes === 0 && diffSeconds <= 0) {
        clearInterval(updateInterval);
        process.stdout.write('\n');
      }
    }, 1000);
  }
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
