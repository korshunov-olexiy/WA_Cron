import cron from 'node-cron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WhatsAppBot, Config } from './WA_bot';

class AppCron {
  private config: Config;
  private cronTask: cron.ScheduledTask | null = null;
  private sentOkPath: string;

  constructor(config: Config) {
    this.config = config;
    this.sentOkPath = path.join(__dirname, 'sent_ok');
  }

  public async start() {
    let scheduledDate: Date;
    try {
      // Якщо файл існує – повідомлення відправлено сьогодні, плануємо на завтра
      await fs.access(this.sentOkPath);
      await fs.unlink(this.sentOkPath);
      scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + 1);
      console.log(`🔔 Повідомлення вже відправлялось. Наступна відправка: ${this.formatDate(scheduledDate)} ${this.config.sendTime}`);
    } catch {
      // Файл не знайдено – плануємо відправку на сьогодні
      scheduledDate = new Date();
      const [hourStr, minuteStr] = this.config.sendTime.split(':');
      const scheduledToday = new Date(scheduledDate);
      scheduledToday.setHours(parseInt(hourStr, 10), parseInt(minuteStr, 10), 0, 0);
      if (scheduledToday <= new Date()) {
        scheduledToday.setDate(scheduledToday.getDate() + 1);
      }
      scheduledDate = scheduledToday;
      console.log(`🕒Запланована відправка: ${this.formatDate(scheduledDate)} ${this.config.sendTime}`);
    }
    const cronExpression = this.getCronExpressionForDate(scheduledDate, this.config.sendTime);
    this.cronTask = cron.schedule(cronExpression, async () => {
      const result = await this.runBot();
      if (result) {
        console.log('✅Повідомлення відправлене.');
        console.log(`🕒Наступна запланована відправка: ${this.getNextScheduledTime()}`);
        this.playSound(this.config.successSoundFile);
      } else {
        console.error('❌Відправка не вдалася.');
        this.playSound(this.config.alertSoundFile);
      }
    });
  }

  private async runBot(): Promise<boolean> {
    const bot = new WhatsAppBot(this.config);
    return await bot.run();
  }

  private getCronExpressionForDate(date: Date, time: string): string {
    const [hourStr, minuteStr] = time.split(':');
    const minute = parseInt(minuteStr, 10);
    const hour = parseInt(hourStr, 10);
    const day = date.getDate();
    const month = date.getMonth() + 1;
    return `${minute} ${hour} ${day} ${month} *`;
  }

  private formatDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  private getNextScheduledTime(): string {
    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + 1);
    return `${this.formatDate(scheduledDate)} ${this.config.sendTime}`;
  }

  private playSound(soundFile: string) {
    const { exec } = require('child_process');
    exec(`play-audio "${soundFile}"`, (err: any) => {
      if (err) console.error(`🔇Помилка відтворення звуку ${soundFile}:`, err);
    });
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
