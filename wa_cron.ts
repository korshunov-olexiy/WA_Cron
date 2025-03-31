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
    let scheduledDate: Date;
    try {
      // Файл існує – повідомлення уже відправлялось сьогодні
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
      // Якщо час сьогодні вже минув – плануємо на завтра
      if (scheduledToday <= new Date()) {
        scheduledToday.setDate(scheduledToday.getDate() + 1);
      }
      scheduledDate = scheduledToday;
      console.log(`Запланована відправка: ${this.formatDate(scheduledDate)} ${this.config.sendTime}`);
    }
    const cronExpression = this.getCronExpressionForDate(scheduledDate, this.config.sendTime);
    this.cronTask = cron.schedule(cronExpression, () => {
      exec('ts-node WA_bot.ts', async (error, stdout, stderr) => {
        if (error) console.error(`🔥Помилка виконання бота: ${error.message}`);
        console.log(stdout);
        console.error(stderr);
        try {
          await fs.access(this.sentOkPath);
          console.log('✅Повідомлення відправлене.');
          exec(`play-audio "${this.config.successSoundFile}"`, (err) => {
            if (err) console.error('🔇Помилка відтворення звуку успіху:', err);
          });
        } catch {
          console.error('❌ Відправка не вдалася.');
          exec(`play-audio "${this.config.alertSoundFile}"`, (err) => {
            if (err) console.error('🔇Помилка відтворення звуку помилки:', err);
          });
        }
      });
    });
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
