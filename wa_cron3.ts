import * as fs from 'fs';
import { exec } from 'child_process';
import cron from 'node-cron';
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';

// Глобальні обробники необроблених помилок – щоб процес не завершувався
process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Читаємо конфігурацію
interface Config {
  app_name: string;
  groupName: string;
  messageText: string;
  sendTime: string;        // час відправки, формат "HH:MM" або cron-вираз
  alertSoundFile?: string; // шлях до звукового файлу для оповіщення (mp3)
}
let config: Config;
try {
  const configData = fs.readFileSync('config.json', 'utf-8');
  config = JSON.parse(configData) as Config;
} catch (e) {
  console.error('Failed to load config.json:', e);
  config = { app_name: '', groupName: '', messageText: '', sendTime: '' }; // продовжимо роботу, хоча відправка неможлива
}

// Підготовка cron-виразу для щоденного запуску
let cronExpression: string;
const [h, m] = config.sendTime.split(':');
cronExpression = `${parseInt(m, 10)} ${parseInt(h, 10)} * * *`;

// Глобальні змінні для стану
let sock: any;                  // сокет Baileys
let isConnected: boolean = false;
let targetJid: string | undefined; 
let lastSentDate: string | null = null;

// Завантажуємо дату останньої відправки з файлу (якщо є)
try {
  const lastData = fs.readFileSync('last_sent.json', 'utf-8');
  const obj = JSON.parse(lastData);
  if (obj && obj.lastSent) {
    lastSentDate = obj.lastSent;
  }
} catch (e) {
  // файл може не існувати - це не критична помилка
  lastSentDate = null;
}

// Функція підключення до WhatsApp
async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({
      auth: state,
      logger: pino({level: 'silent'}),
      browser: Browsers.baileys(config.app_name),
      printQRInTerminal: true
    });
    sock.ev.on('creds.update', saveCreds);

    // Обробник подій підключення/відключення
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        isConnected = true;
        console.log('✅ З\'єднання з WhatsApp успішне');
        // Отримуємо ID групи за назвою (якщо ще не визначено)
        if (!targetJid && config.groupName) {
          try {
            const groups = await sock.groupFetchAllParticipating();
            for (const [jid, groupInfo] of Object.entries(groups)) {
              if ((groupInfo as any).subject === config.groupName) {
                targetJid = jid;
                break;
              }
            }
            if (targetJid) {
              console.log(`Цільова група: "${config.groupName}" знайдена: ${targetJid}`);
            } else {
              console.error(`⚠️ Група "${config.groupName}" не знайдена. Перевірте налаштування.`);
            }
          } catch (err) {
            console.error('Помилка отримання списку груп:', err);
          }
        }
      } else if (connection === 'close') {
        isConnected = false;
        const error = lastDisconnect?.error;
        const shouldReconnect = (error instanceof Boom ? error.output.statusCode : 0) !== DisconnectReason.loggedOut;
        console.warn('Connection closed. Reason:', error?.message || error, '| Reconnect:', shouldReconnect);
        if (shouldReconnect) {
          // спробувати перепідключитися
          connectToWhatsApp().catch(err => {
            console.error('Reconnect attempt failed:', err);
          });
        } else {
          console.log('Logged out from WhatsApp. Reconnection not attempted.');
        }
      }
    });

    // **Вхідні повідомлення не обробляються**, тому обробник sock.ev.on('messages.upsert') тут не потрібен.
  } catch (err) {
    console.error('Помилка підключення до WhatsApp:', err);
  }
}

// Запускаємо початкове підключення
connectToWhatsApp().catch(err => {
  console.error('Помилка підключення:', err);
});

// Функція для запису інформації про останню відправку
function updateLastSentToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  lastSentDate = `${yyyy}-${mm}-${dd}`;
  const data = JSON.stringify({ lastSent: lastSentDate });
  try {
    fs.writeFileSync('last_sent.json', data);
  } catch (e) {
    console.error('Помилка запису в last_sent.json:', e);
  }
}

// Розклад щоденного відправлення повідомлення
cron.schedule(cronExpression, async () => {
  // Переконуємося, що повідомлення цього дня ще не надсилалось
  const todayStr = (() => {
    const d = new Date();
    const yy = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${m}-${dd}`;
  })();
  if (lastSentDate === todayStr) {
    console.log('Повідомлення вже було відправлене сьогодні');
    return; // уникнути повторної відправки в той самий день
  }

  // Готуємо дані повідомлення
  const messageContent = { text: config.messageText || '' };
  const destinationJid = targetJid;

  // Спроба надіслати з повторними спробами у разі невдачі
  let sent = false;
  let attempts = 0;
  const maxAttempts = 10; // ~5 хв при інтервалі 30 сек
  console.log(`⏰ Запланована відправка на ${todayStr} ${config.sendTime}`);
  const intervalId = setInterval(async () => {
    attempts++;
    try {
      if (isConnected && destinationJid) {
        // Якщо раптом targetJid досі не визначено (destinationJid undefined), спробуємо ще раз отримати
        if (!destinationJid) {
          try {
            const groups = await sock.groupFetchAllParticipating();
            for (const [jid, groupInfo] of Object.entries(groups)) {
              if ((groupInfo as any).subject === config.groupName) {
                targetJid = jid;
                break;
              }
            }
          } catch (err) {
            console.error('Group fetch failed during send attempts:', err);
          }
        }
        if (targetJid) {
          // Надсилаємо повідомлення
          await sock.sendMessage(targetJid, messageContent);
          console.log('✔️ Повідомлення успішно відправлене.');
          sent = true;
          // Оновлюємо лог останньої відправки
          updateLastSentToday();
        } else {
          console.error('Відправка не можлива: цільова група не визначена.');
          // Якщо групу не знайдено, подальші спроби безглузді
          clearInterval(intervalId);
        }
      }
      if (sent) {
        clearInterval(intervalId);
        return; // успішно надіслано, виходимо з інтервалу
      }
      if (attempts >= maxAttempts) {
        // Вичерпано 5 хвилин спроб
        clearInterval(intervalId);
        console.error('❌ Не вдалося надіслати повідомлення протягом 5 хв. після запланованого часу.');
        // Відтворюємо звуковий сигнал тривоги (якщо вказано файл звуку)
        if (config.alertSoundFile) {
          exec(`play-audio "${config.alertSoundFile}"`, (err) => {
            if (err) {
              console.error('Помилка відтворення звуку:', err);
            } else {
              console.log('🔔 Відтворений звук помилки відправки повідомлення.');
            }
          });
        }
        // Повідомлення пропущено до наступного дня (lastSentDate не оновлюємо)
      }
    } catch (err) {
      // Обробка будь-яких помилок при відправленні
      console.error('Виникла помилка під час відправки повідомлення:', err);
    }
  }, 30000); // інтервал повторних спроб ~30 секунд
}, {
  timezone: 'Europe/Kyiv'
});
