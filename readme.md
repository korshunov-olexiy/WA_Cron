## WhatsApp-бот для відправки повідомлення кожного дня у визначену групу та час.
***Перевірений та працює на Windows, Linux та під Android в Termux***

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
    "app_name": "MY_APP",
    "group": "Назва групи для відправки повідомлення",
    "message": "текст повідомлення",
    "sendTime": "15:28",
    "msgSentToday": false,
    "highlightStart": "\u001b[1;30;42m",
    "highlightEnd": "\u001b[0m",
    "errorHighlightStart": "\u001b[1;37;41m",
    "errorHighlightEnd": "\u001b[0m"
}
```
Після чого можна виконувати програму:
```bash
npx ts-node wa_cron.ts
```
