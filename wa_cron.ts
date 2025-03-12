import { Boom } from '@hapi/boom';
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import cron from 'node-cron';
import * as path from 'path';
import pino from 'pino';

interface Config {
  group: string;
  message: string;
  sendTime: string;
  highlightStart: string;
  highlightEnd: string;
  errorHighlightStart: string;
  errorHighlightEnd: string;
  app_name: string;
}

class WhatsAppBot {
  private sock: WASocket | null = null;
  private config: Config;
  private messageSent: boolean = false;
  constructor(configPath: string) {
    this.config = this.readConfig(configPath);
  }

  private readConfig(filePath: string): Config {
    const fullPath = path.resolve(__dirname, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Файл ${filePath} не знайдено.`);
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
        console.log(`${this.config.highlightStart}Відскануйте QR-код для авторизації:${this.config.highlightEnd}\n`, qr);
      }
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.error(`${this.config.errorHighlightStart}З’єднання закрито. Перезапуск...${this.config.errorHighlightEnd}`, shouldReconnect);
        if (shouldReconnect) {
          await this.initialize();
        } else {
          console.error(`${this.config.errorHighlightStart}Авторизацію не виконано. Завершення роботи.${this.config.errorHighlightEnd}`);
          process.exit(1);
        }
      } else if (connection === 'open') {
        console.log(`${this.config.highlightStart}Підключено до WhatsApp.${this.config.highlightEnd}`);
        this.scheduleMessage();
        await this.checkMissedMessage();
      }
    });
    this.sock.ev.on('creds.update', saveCreds);
  }

  private scheduleMessage() {
    const [hour, minute] = this.config.sendTime.split(':');
    cron.schedule(`${minute} ${hour} * * *`, async () => {
      await this.sendMessage();
      this.messageSent = true;
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
      this.messageSent = true;
      console.log(`\n${this.config.highlightStart}Повідомлення відправлене у \"${this.config.group}\".${this.config.highlightEnd}`);
    } catch (error) {
      console.error(`${this.config.errorHighlightStart}Помилка при відправці:${this.config.errorHighlightEnd}`, error);
    }
  }

  private async checkMissedMessage() {
    const [hour, minute] = this.config.sendTime.split(':');
    const scheduledTime = new Date();
    scheduledTime.setHours(parseInt(hour), parseInt(minute), 0, 0);
    const now = new Date();
    const diffMs = now.getTime() - scheduledTime.getTime();
    if (!this.messageSent && diffMs > 0 && diffMs <= 600000) { // 10 хвилин
      console.log(`${this.config.highlightStart}Виявлено пропущене повідомлення.${this.config.highlightEnd} ${this.config.errorHighlightStart}Відправляємо зараз...${this.config.errorHighlightEnd}`);
      await this.sendMessage();
    }
  }

  private showCountdown(hour: string, minute: string) {
    setInterval(() => {
      const now = new Date();
      const next = new Date();
      next.setHours(parseInt(hour), parseInt(minute), 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const diffMs = next.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / 3600000);
      const diffMinutes = Math.floor((diffMs % 3600000) / 60000);
      const diffSeconds = Math.floor((diffMs % 60000) / 1000);
      process.stdout.write(`\r${this.config.highlightStart}Наступне повідомлення через${this.config.highlightEnd} ${this.config.errorHighlightStart} ${diffHours}год. ${diffMinutes}хв. ${diffSeconds}сек.${this.config.errorHighlightEnd}`);
      if (diffMs <= 0) {
        process.stdout.write('\n');
      }
    }, 1000);
  }
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
