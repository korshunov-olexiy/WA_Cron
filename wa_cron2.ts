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
  private config!: Config;

  constructor(configPath: string) {
    this.configPath = path.resolve(__dirname, configPath);
  }

  private async readConfig(): Promise<void> {
    const data = await fs.readFile(this.configPath, 'utf-8');
    this.config = JSON.parse(data);
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  private isSentTime(): boolean {
    const [hour, minute] = this.config.sendTime.split(':').map(Number);
    const now = new Date();
    const scheduled = new Date(now);
    scheduled.setHours(hour, minute, 0, 0);
    return (
      !this.config.msgSentToday &&
      now >= scheduled &&
      now <= new Date(scheduled.getTime() + 10 * 60000)
    );
  }

  private async resetDailyFlag() {
    this.config.msgSentToday = false;
    await this.saveConfig();
    console.log('Прапорець відправки повідомлення скинуто.');
  }

  async initialize() {
    await this.readConfig();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'error' }),
      browser: Browsers.baileys(this.config.app_name),
      printQRInTerminal: true,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 10000,
    });
    this.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log(`${this.config.highlightStart}Відскануйте QR-код:${this.config.highlightEnd}\n${qr}`);
      }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) {
          console.warn('Втрачено зʼєднання, повторне підключення...');
          setTimeout(() => this.initialize(), 5000);
        } else {
          console.error('Авторизацію втрачено назавжди.');
          process.exit(1);
        }
      }
      if (connection === 'open') {
        console.log('Зʼєднання встановлено.');
        if (this.isSentTime()) await this.sendMessage();
      }
    });
    this.sock.ev.on('creds.update', saveCreds);
    cron.schedule('0 0 * * *', () => this.resetDailyFlag());
    cron.schedule('* * * * *', async () => {
      if (this.isSentTime()) await this.sendMessage();
    });
    console.log('Планувальник запущено.');
  }

  private async sendMessage() {
    if (!this.sock) return;
    while (this.isSentTime()) {
      try {
        const groups = await this.sock.groupFetchAllParticipating();
        const group = Object.values(groups).find(g => g.subject === this.config.group);
        if (!group) {
          console.error(`Групу "${this.config.group}" не знайдено.`);
          return;
        }
        await this.sock.sendMessage(group.id, { text: this.config.message });
        this.config.msgSentToday = true;
        await this.saveConfig();
        console.log(`${this.config.highlightStart}Повідомлення відправлено успішно.${this.config.highlightEnd}`);
        break;
      } catch (error) {
        console.error(`${this.config.errorHighlightStart}Помилка: ${error}. Повтор через 15 сек.${this.config.errorHighlightEnd}`);
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  }
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
