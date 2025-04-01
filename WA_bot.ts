import makeWASocket, { Browsers, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface Config {
  group: string;
  message: string;
  sendTime: string;
  alertSoundFile: string;
  successSoundFile: string;
  app_name: string;
}

export class WhatsAppBot {
  private config: Config;
  private sock: any;
  private targetJid: string | null = null;
  private isConnected = false;
  private sent = false;
  private attempts = 0;
  private maxAttempts: number;
  private deadline: Date;
  private sentOkPath: string;
  private finished = false;
  private saveCreds: any;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;

  constructor(config: Config) {
    this.config = config;
    if (!this.config.app_name) this.config.app_name = "WA_bot";
    this.maxAttempts = Math.ceil((5 * 60 * 1000) / 30000);
    const now = new Date();
    const [sendHour, sendMinute] = this.config.sendTime.split(':').map(Number);
    const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sendHour, sendMinute, 0);
    this.deadline = new Date(scheduled.getTime() + 5 * 60000);
    this.sentOkPath = path.join(__dirname, 'sent_ok');
  }

  public async run(): Promise<boolean> {
    try {
      await this.connectToWhatsApp();
      const result = await this.trySendMessage();
      return result;
    } catch (error) {
      console.error("Помилка роботи WhatsAppBot:", error);
      await this.cleanup();
      return false;
    }
  }

  private connectionUpdateHandler = async (update: any) => {
    if (this.finished) return;
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      this.isConnected = true;
      console.log('✅ Підключення до WhatsApp успішне');
      if (!this.targetJid && this.config.group) {
        try {
          const groups = await this.sock.groupFetchAllParticipating();
          for (const [jid, groupInfo] of Object.entries(groups)) {
            if ((groupInfo as any).subject === this.config.group) {
              this.targetJid = jid;
              break;
            }
          }
          if (!this.targetJid) {
            console.error(`⚠ Група "${this.config.group}" не знайдена.`);
          }
        } catch (err) {
          console.error('Помилка отримання груп:', err);
        }
      }
    } else if (connection === 'close') {
      this.isConnected = false;
      const error = lastDisconnect?.error;
      const shouldReconnect = !(error && (error instanceof Boom) && error.output?.statusCode === 401);
      console.warn('З\'єднання розірвано:', error?.message || error, '| Перепідключення:', shouldReconnect);
      if (shouldReconnect) {
        this.reconnectTimeoutId = setTimeout(() => {
          if (!this.finished) {
            this.connectToWhatsApp().catch(err => {
              console.error('Не вдалося перепідключитись:', err);
            });
          }
        }, 5000);
      } else {
        console.error('Користувач вийшов із WhatsApp.');
      }
    }
  };

  private async connectToWhatsApp(): Promise<void> {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('auth_info');
      this.saveCreds = saveCreds;
      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.baileys(this.config.app_name),
        printQRInTerminal: true,
        keepAliveIntervalMs: 60000,
      });
      this.sock.ev.on('creds.update', this.saveCreds);
      this.sock.ev.on('connection.update', this.connectionUpdateHandler);
      await new Promise<void>((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (this.isConnected && this.targetJid) {
            clearInterval(checkInterval);
            clearTimeout(timeoutId);
            resolve();
          }
        }, 1000);
        const timeoutId = setTimeout(() => {
          clearInterval(checkInterval);
          if (this.isConnected && this.targetJid) {
            resolve();
          } else {
            reject(new Error("💥Не вдалося встановити з'єднання або отримати targetJid"));
          }
        }, 30000);
      });
    } catch (err) {
      console.error('💥Помилка підключення до WhatsApp:', err);
      throw err;
    }
  }

  private trySendMessage(): Promise<boolean> {
    return new Promise((resolve) => {
      const intervalId = setInterval(async () => {
        this.attempts++;
        try {
          if (this.isConnected && this.targetJid) {
            await this.sock.sendMessage(this.targetJid, { text: this.config.message });
            this.sent = true;
            clearInterval(intervalId);
            try {
              await fs.writeFile(this.sentOkPath, 'ok');
            } catch (err) {
              console.error('💥Помилка запису файлу sent_ok:', err);
            }
            await this.cleanup();
            resolve(true);
          } else {
            console.log('Очікування підключення або отримання targetJid...');
          }
          if (new Date() >= this.deadline) {
            clearInterval(intervalId);
            if (!this.sent) {
              console.error('❌Не вдалося відправити повідомлення протягом 5 хвилин.');
              await this.cleanup();
              resolve(false);
            }
          }
        } catch (err) {
          console.error('💥Помилка при спробі відправлення:', err);
        }
      }, 30000);
    });
  }

  private async cleanup(): Promise<void> {
    this.finished = true;
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.sock) {
      this.sock.ev.off('creds.update', this.saveCreds);
      this.sock.ev.off('connection.update', this.connectionUpdateHandler);
      if (typeof this.sock.logout === 'function') {
        try {
          await this.sock.logout();
        } catch (error) {
          console.error('Помилка при виході з сесії:', error);
        }
      } else {
        console.error('Метод logout не визначений, неможливо закрити з’єднання.');
      }
    }
  }
}
