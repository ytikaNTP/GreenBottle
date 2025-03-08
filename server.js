const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');
const sharp = require('sharp');

const app = express();
const PORT = 3000;

// Конфигурация
const config = {
  TOKEN: '7857812613:AAGXRbkr5TiJC5z7IxxoPCzw07ZvDNeHjVg',
  OWNER_CHAT_ID: '6966335427',
  UseChatID: true
};

// Инициализация бота
const bot = new TelegramBot(config.TOKEN, {polling: true});
const storage = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

bot.on('message', (msg) => {
  console.log(`Новое сообщение от chat_id: ${msg.chat.id}`);
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1224 * 1224 }
});

const TAGS = {
  checked: { emoji: '✅', text: 'Проверено' },
  rejected: { emoji: '❌', text: 'Отклонено' },
  spam: { emoji: '💣', text: 'Спам' },
  clown: { emoji: '🤡', text: 'Клоун' },
  qwest: { emoji: '❓', text: 'Под вопросом' },
  save: { emoji: '💾', text: 'Позже' }
};

async function sendTicket(chatId, data) {
  try {
    const messages = [];
    let mainMessage;

    // Текст сообщения
    const messageText = `
      🎫 Новый тикет от ${data.name}
      📅 Дата: ${new Date().toLocaleString()}
      👤 Имя: <code>${data.name}</code>
      📞 Телефон: <code>${data.phone}</code>
      📩 Контакт: <code>${data.contact}</code>
      🔗 Ссылка: <code>${data.product_url}</code>
      💬 Комментарий: ${data.comment || 'Отсутствует'}
      
      ━━━━━━━━━━━━━
      🏷 Теги: Нет
    `.replace(/^ +/gm, '');

    // Подготовка изображений
    const media = await Promise.all(
      data.files.map(async file => ({
        type: 'photo',
        media: await sharp(file.buffer)
          .resize(800)
          .jpeg({ quality: 80 })
          .toBuffer()
      }))
    );

    // Клавиатура с кнопками
    const keyboard = {
      inline_keyboard: [
        [
          { text: `${TAGS.checked.emoji} Проверено`, callback_data: 'checked' },
          { text: `${TAGS.rejected.emoji} Отклонено`, callback_data: 'rejected' }
        ],
        [
          { text: `${TAGS.spam.emoji} Спам`, callback_data: 'spam' },
          { text: `${TAGS.clown.emoji} Клоун`, callback_data: 'clown' },
          { text: `${TAGS.qwest.emoji} Под вопросом`, callback_data: 'qwest' },
          { text: `${TAGS.save.emoji} Позже`, callback_data: 'save' }
        ],
        [
          { text: '🗑️ Удалить тикет', callback_data: 'delete' }
        ]
      ]
    };

    if (media.length > 0) {
      // Отправляем медиагруппу с сообщением
      const sentMedia = await bot.sendMediaGroup(chatId, media);
      messages.push(...sentMedia.map(m => m.message_id));
      
      // Отправляем текст с кнопками
      mainMessage = await bot.sendMessage(chatId, messageText, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } else {
      // Отправляем только текстовое сообщение
      mainMessage = await bot.sendMessage(chatId, messageText, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }

    messages.push(mainMessage.message_id);

    // Сохраняем в хранилище
    storage.set(mainMessage.message_id, {
      messages,
      chatId,
      tags: new Set()
    });

  } catch (error) {
    console.error('Ошибка отправки:', error);
  }
}

app.post('/save', upload.array('images', 7), async (req, res) => {
  const targetChat = config.UseChatID ? config.OWNER_CHAT_ID : req.body.chatId;
  
  try {
    await sendTicket(targetChat, {
      ...req.body,
      files: req.files || [],
      chatId: req.body.chatId
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка отправки' });
  }
});

bot.on('callback_query', async (query) => {
  const msg = query.message;
  const ticket = storage.get(msg.message_id);

  if (!ticket) return;

  if (query.data === 'delete') {
    // Удаляем все сообщения тикета
    try {
      await Promise.all(
        ticket.messages.map(messageId => 
          bot.deleteMessage(ticket.chatId, messageId)
        )
      );
      storage.delete(msg.message_id);
    } catch (error) {
      console.error('Ошибка при удалении:', error);
    }
  } else {
    // Обновляем теги
    const tag = query.data;
    const tags = ticket.tags;

    if (tags.has(tag)) {
      tags.delete(tag);
    } else {
      tags.add(tag);
    }

    // Обновляем текст сообщения
    const newText = msg.text.replace(
      /🏷 Теги:[\s\S]*$/,
      `🏷 Теги:\n${
        tags.size > 0 
          ? Array.from(tags).map(t => `${TAGS[t].emoji} ${TAGS[t].text}`).join('\n') 
          : '...'
      }`
    );

    await bot.editMessageText(newText, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: msg.reply_markup,
      parse_mode: 'HTML'
    });

    storage.set(msg.message_id, {...ticket, tags});
  }

  bot.answerCallbackQuery(query.id);
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});