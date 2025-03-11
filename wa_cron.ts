import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, Browsers, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import cron from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import cliProgress from 'cli-progress';

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
  private progressBar: cliProgress.SingleBar;

  constructor(configPath: string) {
    this.config = this.readConfig(configPath);
    this.progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
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
        // якщо нема авторизації
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
      this.startProgressBar(hour, minute);
    });

    this.startProgressBar(hour, minute);
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
      console.error(`${this.config.errorHighlightStart}Помилка відправлення:${this.config.errorHighlightEnd}`, error);
    }
  }

  private startProgressBar(hour: string, minute: string) {
    const now = new Date();
    const next = new Date();
    next.setHours(parseInt(hour), parseInt(minute), 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const totalSeconds = Math.floor((next.getTime() - now.getTime()) / 1000);

    this.progressBar.start(totalSeconds, 0);

    const timer = setInterval(() => {
      const currentTime = new Date();
      const remainingSeconds = Math.floor((next.getTime() - currentTime.getTime()) / 1000);

      this.progressBar.update(totalSeconds - remainingSeconds);

      if (remainingSeconds <= 0) {
        clearInterval(timer);
        this.progressBar.stop();
      }
    }, 1000);
  }
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
