import { Boom } from '@hapi/boom';
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import cron from 'node-cron';
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
  private configPath: string;

  constructor(configPath: string) {
    this.configPath = path.resolve(__dirname, configPath);
    this.config = this.readConfig();
  }

  private readConfig(): Config {
    if (!fs.existsSync(this.configPath)) {
      throw new Error('Файл конфігурації не знайдено.');
    }
    return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
  }

  private saveConfig(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  public async initialize(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.baileys(this.config.app_name),
      printQRInTerminal: true,
      keepAliveIntervalMs: 60000,
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log(`${this.config.highlightStart}Відскануйте QR-код для авторизації:${this.config.highlightEnd}\n${qr}`);
      }
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.error(`${this.config.errorHighlightStart}З’єднання закрито.${this.config.errorHighlightEnd}`, { shouldReconnect });
        if (shouldReconnect) {
          this.initialize();
        } else {
          process.exit(1);
        }
      } else if (connection === 'open') {
        this.scheduleMessage();
      }
    });

    this.sock.ev.on('creds.update', saveCreds);
  }

  private scheduleMessage(): void {
    const [hour, minute] = this.config.sendTime.split(':');
    // Запуск відправки щодня за розкладом
    cron.schedule(`${minute} ${hour} * * *`, async () => {
      const nextDay = new Date().getDate() + 1;
      if (!this.config.msgSentToday) {
        const sent = await this.sendMessage();
        this.config.msgSentToday = sent;
        this.saveConfig();
        console.log(`${this.config.highlightStart}Наступне повідомлення: ${nextDay}, ${this.config.highlightEnd} ${this.config.errorHighlightStart} ${hour}год. ${minute}хв.${this.config.errorHighlightEnd}`);
      }
    });
    // Щодня опівночі скидаємо прапорець msgSentToday
    cron.schedule('0 0 * * *', () => {
      this.config.msgSentToday = false;
      this.saveConfig();
    });
    // this.showCountdown(hour, minute);
    console.log(`${this.config.highlightStart}Наступне повідомлення о ${this.config.highlightEnd} ${this.config.errorHighlightStart} ${hour}год. ${minute}хв.${this.config.errorHighlightEnd}`);
  }

  private async sendMessage(): Promise<boolean> {
    if (!this.sock) return false;
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const groupMetadata = Object.values(groups).find((g: any) => g.subject === this.config.group);
      if (!groupMetadata) {
        console.error(`${this.config.errorHighlightStart}Група "${this.config.group}" не знайдена.${this.config.errorHighlightEnd}`);
        return false;
      }
      await this.sock.sendMessage(groupMetadata.id, { text: this.config.message });
      // process.stdout.clearLine(0);
      // process.stdout.cursorTo(0);
      console.log(`${this.config.highlightStart}Повідомлення відправлене у "${this.config.group}".${this.config.highlightEnd}`);
      return true;
    } catch (error) {
      console.error(`${this.config.errorHighlightStart}Помилка при відправленні повідомлення:${this.config.errorHighlightEnd}`, error);
      return false;
    }
  }

  /*private showCountdown(hour: string, minute: string): void {
    setInterval(() => {
      const now = new Date();
      let nextSend = new Date();
      nextSend.setHours(parseInt(hour), parseInt(minute), 0, 0);
      if (nextSend <= now) nextSend.setDate(nextSend.getDate() + 1);
      const diffMs = nextSend.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / 3600000);
      const diffMinutes = Math.floor((diffMs % 3600000) / 60000);
      const diffSeconds = Math.floor((diffMs % 60000) / 1000);
      const countdownText = `${this.config.highlightStart}Наступне повідомлення через${this.config.highlightEnd} ${this.config.errorHighlightStart} ${diffHours}год. ${diffMinutes}хв. ${diffSeconds}сек.${this.config.errorHighlightEnd}`;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(countdownText);
      if (diffMs <= 0) {
        process.stdout.write('\n');
      }
    }, 1000);
  }*/
}

const bot = new WhatsAppBot('./config.json');
bot.initialize().catch(console.error);
