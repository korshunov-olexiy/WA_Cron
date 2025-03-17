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
  }

  private formattedTime(date: Date): string {
    return date.toLocaleString('uk-UA', {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private async readConfig(): Promise<Config> {
    const data = await fs.readFile(this.configPath, 'utf-8');
    return JSON.parse(data);
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
    this.config = await this.readConfig();
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
    this.printNextSchedule(hour, minute);
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
        console.log(`${this.config!.highlightStart}Відправлено у "${this.config!.group}".${this.config!.highlightEnd}`);
        const [hour, minute] = this.config!.sendTime.split(':');
        this.printNextSchedule(hour, minute);
        break;
      } catch (error) {
        console.error(`${this.config!.errorHighlightStart}Помилка відправки. Повторна спроба через 15 сек...${this.config!.errorHighlightEnd}`);
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }
  }

  private printNextSchedule(hour: string, minute: string) {
    const nextTime = new Date();
    nextTime.setHours(Number(hour), Number(minute), 0, 0);
    if (nextTime <= new Date()) nextTime.setDate(nextTime.getDate() + 1);
    console.log(`${this.config!.highlightStart}Відправка: ${this.formattedTime(nextTime)}${this.config!.highlightEnd}`);
  }
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
