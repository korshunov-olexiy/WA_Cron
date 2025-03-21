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
}

class WhatsAppBot {
  private sock: WASocket | null = null;
  private configPath: string;
  private config!: Config;
  private msgSentToday: boolean|null = false;

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

  private async isSentTime(): Promise<boolean> {
    this.config = await this.readConfig();
    const [hour, minute] = this.config.sendTime.split(':').map(Number);
    const currentDate = new Date();
    const scheduledTime = new Date(currentDate);
    scheduledTime.setHours(hour, minute, 0, 0);
    return (
      !this.msgSentToday &&
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
        console.log(`${this.config.highlightStart}Відскануйте QR-код:${this.config.highlightEnd}\n${qr}`);
      }
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          // console.log(`${this.config.errorHighlightStart}Перепідключення...${this.config.errorHighlightEnd}`);
          await this.initialize();
        } else {
          console.error(`${this.config.errorHighlightStart}Авторизацію не виконано. Вихід.${this.config.errorHighlightEnd}`);
          process.exit(1);
        }
      } else if (connection === 'open') {
        // console.log(`${this.config.highlightStart}Підключено до WhatsApp.${this.config.highlightEnd}`);
        while (await this.isSentTime()) {
          try {
            await this.sendMessage();
          } catch (error) {
            console.error(`${this.config.errorHighlightStart}Помилка. відправки через 15 сек.${this.config.errorHighlightEnd}`);
            await new Promise((res) => setTimeout(res, 15000));
          }
        }
        this.scheduleMessage();
      }
    });
    // скидаємо прапорець в 00:00
    this.sock.ev.on('creds.update', saveCreds);
    cron.schedule('0 0 * * *', async () => {
      this.config = await this.readConfig();
      this.msgSentToday = false;
    });
  }

  private scheduleMessage() {
    const [hour, minute] = this.config.sendTime.split(':');
    cron.schedule(`${minute} ${hour} * * *`, async () => {
      //console.log(`${this.config.highlightStart}Настав час відправки повідомлення.${this.config.highlightEnd}`);
      while (await this.isSentTime()) {
        try {
          const sent = await this.sendMessage();
          await new Promise((res) => setTimeout(res, 1000));
          if (sent) {
            break; // якщо повідомлення успішно відправлено, виходимо з циклу
          }
        } catch (error) {
          console.error(`${this.config.errorHighlightStart}Помилка, відправка через 15 секунд...${this.config.errorHighlightEnd}`);
          await new Promise((res) => setTimeout(res, 15000)); // чекаємо 15 секунд перед повторною спробою
        }
      }
    });
    this.printNextSchedule(hour, minute);
  }

  private async sendMessage() {
    if (!this.sock) return;
    while (await this.isSentTime()) {
      try {
        const groups = await this.sock.groupFetchAllParticipating();
        const groupMetadata = Object.values(groups).find((group) => group.subject === this.config.group);
        if (!groupMetadata) {
          console.error(`${this.config.errorHighlightStart}Група "${this.config.group}" не знайдена.${this.config.errorHighlightEnd}`);
          return process.exit(1);
        }
        await this.sock.sendMessage(groupMetadata.id, { text: this.config.message });
        this.msgSentToday = true;
        console.log(`${this.config.highlightStart}Відправлено у "${this.config.group}".${this.config.highlightEnd}`);
        const [hour, minute] = this.config.sendTime.split(':');
        this.printNextSchedule(hour, minute);
        break;
      } catch (error) {
        return false;
      }
    }
  }

  private printNextSchedule(hour: string, minute: string) {
    const nextTime = new Date();
    nextTime.setHours(Number(hour), Number(minute), 0, 0);
    if (nextTime <= new Date()) nextTime.setDate(nextTime.getDate() + 1);
    console.log(`${this.config!.highlightStart}Наступна відправка:${this.config!.highlightEnd} ${this.formattedTime(nextTime)}`);
  }
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(err => {
  console.error("Помилка при ініціалізації:", err);
  process.exit(1);
});
