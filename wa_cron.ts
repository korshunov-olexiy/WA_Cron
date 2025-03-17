import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, Browsers, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import cron from 'node-cron';
import * as fs from 'fs/promises';
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
  private config?: Config;

  constructor(configPath: string) {
    this.configPath = path.resolve(__dirname, configPath);
    this.config = undefined;
  }

  private async readConfig(): Promise<Config> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      throw new Error("Файл конфігурації не знайдено або пошкоджено.");
    }
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  private async isSentTime(): Promise<boolean> {
    this.config = await this.readConfig();
    const [hour, minute] = this.config.sendTime.split(':').map(Number);
    const currentDate = new Date();
    const scheduledTime = new Date(currentDate);
    scheduledTime.setHours(hour, minute, 0, 0);
    return (
      !this.config.msgSentToday &&
      currentDate >= scheduledTime &&
      currentDate <= new Date(scheduledTime.getTime() + 10 * 60000)
    );
  }

  async initialize() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.baileys((await this.readConfig()).app_name),
      printQRInTerminal: true,
      keepAliveIntervalMs: 60000,
    });
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log(`${this.config!.highlightStart}Відскануйте QR-код для авторизації:${this.config!.highlightEnd}\n${qr}`);
      }
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          await this.initialize();
        } else {
          console.error(`${this.config!.errorHighlightStart}Авторизацію не виконано. Завершення роботи.${this.config!.errorHighlightEnd}`);
          process.exit(1);
        }
      } else if (connection === 'open') {
        if (await this.isSentTime()) {
          await this.sendMessage();
        }
        this.scheduleMessage();
      }
    });

    this.sock.ev.on('creds.update', saveCreds);
    cron.schedule('0 0 * * *', async () => {
      this.config = await this.readConfig();
      this.config.msgSentToday = false;
      await this.saveConfig();
    });
  }

  private scheduleMessage() {
    const [hour, minute] = this.config!.sendTime.split(':');
    cron.schedule(`${minute} ${hour} * * *`, async () => {
      await this.sendMessage();
    });
    this.showCountdown(hour, minute);
  }

  private async sendMessage() {
    if (!this.sock) return;
    while (await this.isSentTime()) {
      try {
        const groups = await this.sock.groupFetchAllParticipating();
        const groupMetadata = Object.values(groups).find((group) => group.subject === this.config!.group);
        if (!groupMetadata) {
          console.error(`${this.config!.errorHighlightStart}Група "${this.config!.group}" не знайдена.${this.config!.errorHighlightEnd}`);
          return;
        }
        await this.sock.sendMessage(groupMetadata.id, { text: this.config!.message });
        this.config!.msgSentToday = true;
        await this.saveConfig();
        console.log(`\n${this.config!.highlightStart}Повідомлення відправлене у "${this.config!.group}".${this.config!.highlightEnd}`);
        break;
      } catch (error) {
        console.error(`${this.config!.errorHighlightStart}Помилка відправки. Повторна спроба...${this.config!.errorHighlightEnd}`);
        await new Promise((resolve) => setTimeout(resolve, 15000)); // пауза перед повторною спробою
      }
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
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`${this.config!.highlightStart}Наступне повідомлення через:${this.config!.highlightEnd}${this.config!.errorHighlightStart} ${diffHours}год. ${diffMinutes}хв. ${diffSeconds}сек.${this.config!.errorHighlightEnd}`);
    }, 1000);
  }
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
