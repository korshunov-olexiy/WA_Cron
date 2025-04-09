import { Boom } from '@hapi/boom';
import makeWASocket, { Browsers, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import pino from 'pino';

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
  private sock: WASocket | null = null;
  private targetJid: string | null = null;
  private isConnected = false;
  private saveCreds: any;

  constructor(configPath: string) {
    this.config = this.readConfig(configPath);
    if (!this.config.app_name) this.config.app_name = 'WA_bot';
  }

  private readConfig(filePath: string): Config {
    const fullPath = path.resolve(__dirname, filePath);
    if (!existsSync(fullPath)) {
      throw new Error(`Файл ${filePath} не знайдено.`);
    }
    return JSON.parse(readFileSync(fullPath, 'utf-8'));
  }

  public async run(): Promise<void> {
    await this.connectToWhatsApp();
    if (this.targetJid) {
      await this.sendMessage();
    }
  }

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
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          this.isConnected = true;
          console.log('✅ Успішно підключено до WhatsApp');

          const groups = await this.sock!.groupFetchAllParticipating();
          const groupMetadata = Object.values(groups).find((group) => group.subject === this.config.group);
          this.targetJid = groupMetadata?.id || null;

          if (!this.targetJid) {
            console.error(`⚠ Групу "${this.config.group}" не знайдено.`);
          }
        } else if (connection === 'close') {
          this.isConnected = false;
          const error = lastDisconnect?.error;
          const shouldReconnect = !(error instanceof Boom && error.output?.statusCode === 401);

          console.warn('З\'єднання розірвано:', error?.message || error, '| Перепідключення:', shouldReconnect);
          if (shouldReconnect) {
            setTimeout(() => this.connectToWhatsApp(), 5000);
          } else {
            console.error('❌ Користувач вийшов із WhatsApp.');
          }
        }
      });
    } catch (error) {
      console.error('💥 Помилка підключення до WhatsApp:', error);
      throw error;
    }
  }

  private async sendMessage(): Promise<void> {
    if (!this.isConnected || !this.targetJid) {
      console.error('❌ Відправка повідомлення неможлива: немає підключення або ID групи.');
      return;
    }

    try {
      await this.sock!.sendMessage(this.targetJid, { text: this.config.message });
      console.log('✅ Повідомлення успішно відправлено');
    } catch (error) {
      console.error('💥 Помилка відправки повідомлення:', error);
    }
  }
}

const bot = new WhatsAppBot('./config.json');
bot.run().catch(console.error);
