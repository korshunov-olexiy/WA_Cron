import { exec } from 'child_process';
import cron from 'node-cron';
import * as fs from 'fs/promises';
import * as path from 'path';

interface Config {
  group: string;
  message: string;
  sendTime: string;
  alertSoundFile: string;
  successSoundFile: string;
}

class AppCron {
  private config: Config;
  private cronTask: cron.ScheduledTask | null = null;
  private sentOkPath: string;

  constructor(config: Config) {
    this.config = config;
    this.sentOkPath = path.join(__dirname, 'sent_ok');
  }

  public async start() {
    const cronExpression = this.getCronExpression(this.config.sendTime);
    console.log(`Запланована відправка о ${this.config.sendTime}`);
    this.cronTask = cron.schedule(cronExpression, async () => {
      const nextSendStr = this.getNextSendTime();
      try {
        await fs.access(this.sentOkPath);
        console.log('🔔Повідомлення вже відправлялось.');
        console.log(`🕒Наступна запланована відправка: ${nextSendStr}`);
        await fs.unlink(this.sentOkPath);
        return;
      } catch (err) {
        // Файл не існує – продовжуємо виконання
      }
      exec('ts-node WA_bot.ts', async (error, stdout, stderr) => {
        if (error) console.error(`🔥Помилка виконання бота: ${error.message}`);
        console.log(stdout);
        console.error(stderr);
        try {
          await fs.access(this.sentOkPath);
          console.log('✅Повідомлення відправлене.');
          console.log(`🕒Наступна запланована відправка: ${nextSendStr}`);
          await fs.unlink(this.sentOkPath);
          exec(`play-audio "${this.config.successSoundFile}"`, (err) => {
            if (err) console.error('🔇Помилка відтворення звуку успіху:', err);
          });
        } catch (err) {
          console.error('❌Відправка не вдалася.');
          exec(`play-audio "${this.config.alertSoundFile}"`, (err) => {
            if (err) console.error('🔇Помилка відтворення звуку помилки:', err);
          });
        }
      });
    });
  }

  private getCronExpression(time: string): string {
    const [hour, minute] = time.split(':').map(Number);
    return `${minute} ${hour} * * *`;
  }

  private getNextSendTime(): string {
    const [hour, minute] = this.config.sendTime.split(':');
    let tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    return `${dateStr} ${hour}:${minute}`;
  }
}

(async () => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const configData = await fs.readFile(configPath, 'utf-8');
    const config: Config = JSON.parse(configData);
    const appCron = new AppCron(config);
    await appCron.start();
  } catch (err) {
    console.error('🔥Помилка ініціалізації AppCron:', err);
    process.exit(1);
  }
})();
