## WhatsApp-бот для відправки повідомлення кожного дня у визначену групу та час.
***Перевірений та працює на Windows, Linux та під Android в Termux***

Програма складається з двох частин:<br>
* **wa_cron.ts** - планувальник запуску модуля WA_bot кожного дня у визначений в конгфігураційному файлі **config.json** час.<br>
* **WA_bot.ts** - модуль, в якому реалізований клас **WhatsAppBot**, який виконує відправку вказаного повідомлення у вказану групу.<br><br>
Для роботи даної програми треба встановити TypeScript:
```bash
npm install -g typescript
```
а також **ts-node**:    
глобально:
```bash
npm install -g ts-node
```
або локально:
```bash
npm install ts-node --save-dev
```
І наступні залежності:
```bash
npm install @whiskeysockets/baileys qrcode-terminal node-cron pino @types/node-cron @hapi/boom
```
Ініціалізувати конфігураційний файл:
```bash
tsc --init
```
Створити конфігураційний файл config.json наступного змісту:
```json
{
    "app_name": "MY_BOT",
    "group": "Назва групи для відправки повідомлення",
    "message": "текст повідомлення",
    "sendTime": "15:28",
    "msgSentToday": false,
    "alertSoundFile": "no_sent_msg.mp3",
    "successSoundFile": "sent_msg.mp3"
}
```
Після чого можна виконувати програму:
```bash
npx ts-node wa_cron.ts
```
