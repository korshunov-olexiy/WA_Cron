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
  private statusFilePath: string;

  constructor(config: Config) {
    this.config = config;
    this.statusFilePath = path.join(__dirname, 'send_status.json');
  }

  public async start() {
    const cronExpression = this.getCronExpression(this.config.sendTime);
    console.log(`Заплановано виконання WA_bot.ts: ${cronExpression}`);
    this.cronTask = cron.schedule(cronExpression, async () => {
      console.log('Старт WA_bot.ts');
      const today = new Date().toISOString().split('T')[0];
      let status = null;
      try {
        const statusData = await fs.readFile(this.statusFilePath, 'utf-8');
        status = JSON.parse(statusData);
      } catch (err) { }
      if (status && status.date === today && status.sent) {
        console.log('Повідомлення вже було відправлено сьогодні.');
        return;
      }
      exec('ts-node WA_bot.ts', async (error, stdout, stderr) => {
        if (error) console.error(`Помилка виконання WA_bot.ts: ${error.message}`);
        console.log(stdout);
        console.error(stderr);
        let sendStatus = false;
        try {
          const data = await fs.readFile(this.statusFilePath, 'utf-8');
          const sendData = JSON.parse(data);
          if (sendData.date === today && sendData.sent) sendStatus = true;
        } catch (err) {
          console.error('Не вдалося прочитати статус:', err);
        }
        if (sendStatus) {
          console.log('✔ Повідомлення відправлено успішно.');
          exec(`termux-media-player play "${this.config.successSoundFile}"`, (err) => {
            if (err) console.error('Помилка відтворення звуку успіху:', err);
          });
        } else {
          console.error('❌ Відправлення повідомлення не вдалося.');
          exec(`termux-media-player play "${this.config.alertSoundFile}"`, (err) => {
            if (err) console.error('Помилка відтворення звуку помилки:', err);
          });
        }
      });
    });
  }

  private getCronExpression(time: string): string {
    const [hour, minute] = time.split(':').map(Number);
    return `${minute} ${hour} * * *`;
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
    console.error('Помилка ініціалізації AppCron:', err);
    process.exit(1);
  }
})();
