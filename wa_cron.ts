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
  private sentOkPath: string;

  constructor(config: Config) {
    this.config = config;
    this.sentOkPath = path.join(__dirname, 'sent_ok');
  }

  public async start() {
    await this.scheduleSend();
  }

  private async scheduleSend() {
    let nextSend: Date;
    try {
      // Якщо файл sent_ok існує – повідомлення вже відправлено сьогодні
      await fs.access(this.sentOkPath);
      await fs.unlink(this.sentOkPath);
      nextSend = this.getTomorrowSendDate();
    } catch {
      // Файл не існує – плануємо відправку на сьогодні (якщо час ще не минув) або на завтра
      nextSend = this.getTodayOrTomorrowSendDate();
    }
    console.log(`🕜Наступна відправка: ${this.formatDate(nextSend)} ${this.config.sendTime}`);
    const cronExpr = this.getCronExpressionForDate(nextSend);
    const task = cron.schedule(cronExpr, () => {
      exec('ts-node WA_bot.ts', async (error, stdout, stderr) => {
        if (error) console.error(`🔥Помилка виконання бота: ${error.message}`);
        console.log(stdout);
        console.error(stderr);
        try {
          await fs.access(this.sentOkPath);
          console.log('✅Повідомлення відправлено.');
          exec(`play-audio "${this.config.successSoundFile}"`, (err) => {
            if (err) console.error('🔇Помилка відтворення звуку успіху:', err);
          });
        } catch {
          console.error('🔥Відправка не вдалася.');
          exec(`play-audio "${this.config.alertSoundFile}"`, (err) => {
            if (err) console.error('🔇Помилка відтворення звуку помилки:', err);
          });
        }
        task.stop();
        // Після завершення поточного виклику переплановуємо наступну відправку
        await this.scheduleSend();
      });
    });
  }

  private getTodayOrTomorrowSendDate(): Date {
    const now = new Date();
    const [hourStr, minuteStr] = this.config.sendTime.split(':');
    const scheduledToday = new Date(now);
    scheduledToday.setHours(parseInt(hourStr, 10), parseInt(minuteStr, 10), 0, 0);
    // Якщо час сьогодні ще не минув – плануємо на сьогодні, інакше – на завтра
    if (scheduledToday > now) {
      return scheduledToday;
    }
    scheduledToday.setDate(scheduledToday.getDate() + 1);
    return scheduledToday;
  }

  private getTomorrowSendDate(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const [hourStr, minuteStr] = this.config.sendTime.split(':');
    tomorrow.setHours(parseInt(hourStr, 10), parseInt(minuteStr, 10), 0, 0);
    return tomorrow;
  }

  private getCronExpressionForDate(date: Date): string {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    // Формуємо cron-вираз для запуску в конкретний день та місяць
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
