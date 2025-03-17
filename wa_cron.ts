import { Boom } from '@hapi/boom';
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
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
  private configPath: string;
  private config: Config;

  constructor(configPath: string) {
    this.configPath = path.resolve(__dirname, configPath);
    this.config = this.readConfig();
  }

  private readConfig(): Config {
    if (!fs.existsSync(this.configPath)) {
      throw new Error("Файл конфігурації не знайдено.");
    }
    return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
  }

  private saveConfig(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  private isSentTime(): boolean {
    const [hour, minute] = this.config.sendTime.split(':').map(Number);
    const now = new Date();
    const scheduledTime = new Date(now);
    scheduledTime.setHours(hour, minute, 0, 0);
    this.config = this.readConfig();
    return (
      !this.config.msgSentToday &&
      now >= scheduledTime &&
      now <= new Date(scheduledTime.getTime() + 10 * 60000) // 10 хвилин
    );
  }

  async initialize(): Promise<void> {
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
        if (shouldReconnect) {
          await this.initialize();
        } else {
          console.error(`${this.config.errorHighlightStart}Авторизацію не виконано. Завершення роботи.${this.config.errorHighlightEnd}`);
          process.exit(1);
        }
      } else if (connection === 'open') {
        if (this.isSentTime()) {
          await this.trySendMessage();
        }
        this.scheduleMessage();
      }
    });
    this.sock.ev.on('creds.update', saveCreds);
    cron.schedule('0 0 * * *', () => {
      this.config.msgSentToday = false;
      this.saveConfig();
    });
  }

  private scheduleMessage(): void {
    const [hour, minute] = this.config.sendTime.split(':');
    cron.schedule(`${minute} ${hour} * * *`, async () => {
      await this.trySendMessage();
    });
    this.showCountdown(hour, minute);
  }

  private async trySendMessage(): Promise<void> {
    while (this.isSentTime()) {
      const sent = await this.sendMessage();
      if (sent) {
        this.config.msgSentToday = true;
        this.saveConfig();
        break;
      }
      await new Promise(r => setTimeout(r, 60000)); // повторити спробу через 1 хв.
    }
  }

  private async sendMessage(): Promise<boolean> {
    if (!this.sock) return false;
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const groupMetadata = Object.values(groups).find(g => g.subject === this.config.group);
      if (!groupMetadata) {
        console.error(`${this.config.errorHighlightStart}Група "${this.config.group}" не знайдена.${this.config.errorHighlightEnd}`);
        return false;
      }
      await this.sock.sendMessage(groupMetadata.id, { text: this.config.message });
      console.log(`\n${this.config.highlightStart}Повідомлення відправлене у "${this.config.group}".${this.config.highlightEnd}`);
      return true;
    } catch (error) {
      console.error(`${this.config.errorHighlightStart}Помилка при відправці:${this.config.errorHighlightEnd}`, error);
      return false;
    }
  }

  private showCountdown(hour: string, minute: string): void {
    setInterval(() => {
      const now = new Date();
      const next = new Date();
      next.setHours(parseInt(hour), parseInt(minute), 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const diffMs = next.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / 3600000);
      const diffMinutes = Math.floor((diffMs % 3600000) / 60000);
      const diffSeconds = Math.floor((diffMs % 60000) / 1000);
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`${this.config.highlightStart}Наступне повідомлення через:${this.config.highlightEnd} ${this.config.errorHighlightStart}${diffHours}год. ${diffMinutes}хв. ${diffSeconds}сек.${this.config.errorHighlightEnd}`);
      // process.stdout.uncork();
    }, 1000);
  }
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
