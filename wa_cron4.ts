import makeWASocket, { Browsers, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import { existsSync, readFileSync } from 'fs';
import cron from 'node-cron';
import * as path from 'path';
import pino from 'pino';

interface Config {
    app_name: string;
    group: string;
    message: string;
    sendTime: string;
    alertSoundFile: string;
    successSoundFile: string;
}

class DailyMessageBot {
    private sock: WASocket | null = null;
    private config!: Config;

    async init() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState('auth_info');
            this.config = await this.readConfig('./config.json');
            this.sock = makeWASocket({
                auth: state,
                logger: pino({ level: 'silent' }),
                browser: Browsers.baileys(this.config.app_name),
                printQRInTerminal: true,
                keepAliveIntervalMs: 60000,
            });

            this.sock.ev.on('creds.update', saveCreds);
            this.scheduleMessage();
        } catch (error) {
            console.error('Помилка ініціалізації:', error);
        }
    }

    private async readConfig(filePath: string): Promise<Config> {
        const fullPath = path.resolve(__dirname, filePath);
        if (!existsSync(fullPath)) {
            throw new Error(`Файл ${filePath} не знайдено.`);
        }
        return JSON.parse(readFileSync(fullPath, 'utf-8')) as Config;
    }

    // private async readConfig(): Promise<Config> {
    //     try {
    //         const data = await fs.readFile('config.json', 'utf-8');
    //         return JSON.parse(data) as Config;
    //     } catch (error) {
    //         throw new Error('Помилка зчитування config.json');
    //     }
    // }

    private async fetchGroupId(): Promise<string> {
        try {
            const groups = await this.sock!.groupFetchAllParticipating();
            const groupMetadata = Object.values(groups).find((group) => group.subject === this.config.group);
            if (!groupMetadata) {
                throw new Error(`Групу "${this.config.group}" не знайдено`);
            }
            return groupMetadata.id;
        } catch (error) {
            if (error instanceof Error) {
                throw new Error('Помилка отримання ID групи: ' + error.message);
            } else {
                throw new Error('Помилка отримання ID групи: Невідома помилка');
            }
        }
    }

    private scheduleMessage() {
        const [hour, minute] = this.config.sendTime.split(':').map(Number);
        cron.schedule(`${minute} ${hour} * * *`, async () => {
            try {
                await this.sendMessage();
            } catch (error) {
                console.error('Помилка відправки повідомлення:', error);
                this.retrySendMessage();
            }
        });
    }

    private async sendMessage() {
        const groupId = await this.fetchGroupId();
        await this.sock!.sendMessage(groupId, { text: this.config.message });
        console.log('Повідомлення відправлене');
        this.playSound(this.config.successSoundFile);
    }

    private async retrySendMessage() {
        const retryInterval = 60 * 1000; // 1 хвилина
        const maxRetries = 5;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this.sendMessage();
                return;
            } catch {
                console.log(`Повторна спроба (${i + 1}/${maxRetries})...`);
                await new Promise((resolve) => setTimeout(resolve, retryInterval));
            }
        }
        console.error('Не вдалося відправити повідомлення. Наступна спроба завтра.');
        this.playSound(this.config.alertSoundFile);
    }

    private playSound(soundFile: string) {
        const exec = require('child_process').exec;
        exec(`play-audio ${soundFile}`, (error: any) => {
            if (error) {
                console.error('Помилка відтворення звуку:', error);
            }
        });
    }
}

const bot = new DailyMessageBot();
bot.init().catch((error) => console.error('Глобальна помилка:', error));
