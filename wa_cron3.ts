import makeWASocket, { Browsers, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import cron from 'node-cron';
import * as path from 'path';
import pino from 'pino';

interface Config {
  app_name: string;
  group: string;
  message: string;
  sendTime: string;
  alertSoundFile: string;
}

class MyWABot {
  config!: Config;
  sock: WASocket | null = null;
  authState: any = null;
  saveCreds: (() => Promise<void>) | null = null;

  async init() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('auth_info');
      this.authState = state;
      this.saveCreds = saveCreds;
      this.config = await this.readConfig();
      await this.connect();
      this.setupListeners();
      this.scheduleDailyMessage();
      console.log(`📅 Програма запущена. Повідомлення буде відправлено щодня о ${this.config.sendTime}.`);
    } catch (error) {
      console.error('Помилка ініціалізації:', error);
      setTimeout(() => this.init(), 5000);
    }
  }

  async readConfig(): Promise<Config> {
    const configPath = path.join(process.cwd(), 'config.json');
    const data = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(data);
  }

  async connect() {
    try {
      this.sock = makeWASocket({
        auth: this.authState,
        logger: pino({ level: 'silent' }),
        browser: Browsers.baileys(this.config.app_name),
        printQRInTerminal: true,
        keepAliveIntervalMs: 60000,
      });
      this.sock.ev.on('creds.update', this.saveCreds!);
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
          const error = lastDisconnect?.error as any;
          if (error?.output?.statusCode !== 401) {
            console.log('З\'єднання втрачено. Спроба перепідключення...');
            await this.connect();
          }
        }
      });
    } catch (error) {
      console.error('Помилка підключення:', error);
      setTimeout(() => this.connect(), 5000);
    }
  }

  scheduleDailyMessage() {
    const [hour, minute] = this.config.sendTime.split(':');
    const cronExpression = `${minute} ${hour} * * *`;
    cron.schedule(cronExpression, () => {
      console.log(`⏰Запланована відправка о ${this.config.sendTime}.`);
      this.sendMessageWithRetries();
    });
  }

  async sendMessageWithRetries() {
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000;
    let sent = false;
    while (Date.now() - startTime < timeout && !sent) {
      try {
        sent = await this.sendMessage();
        if (!sent) await this.delay(30000);
      } catch (error) {
        console.error('🔔Помилка при відправці:', error);
        await this.delay(30000);
      }
    }
    if (!sent) this.playErrorSound();
  }

  async sendMessage(): Promise<boolean> {
    try {
      if (!this.sock) throw new Error('Немає з’єднання');
      const groups = await this.sock.groupFetchAllParticipating();
      const groupMetadata = Object.values(groups).find((group: any) => group.subject === this.config.group);
      if (!groupMetadata) throw new Error('Групу не знайдено');
      await this.sock.sendMessage(groupMetadata.id, { text: this.config.message });
      console.log('✅Повідомлення відправлено');
      return true;
    } catch (error) {
      console.error('❌Не вдалося відправити повідомлення:', error);
      return false;
    }
  }

  delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  playErrorSound() {
    exec(`player-audio ${this.config.alertSoundFile}`, (error) => {
      if (error) console.error('▶️ Помилка при відтворенні звуку:', error);
    });
  }

  setupListeners() {
    // Додаткові слухачі за потребою
  }
}

const bot = new MyWABot();
bot.init();
