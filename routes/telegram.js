const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Send message via Telegram
async function sendTelegramMessage(chatId, message, options = {}) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
  
  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        ...options
      })
    });
    
    const data = await response.json();
    return data.ok;
  } catch (error) {
    console.error('Telegram send error:', error);
    return false;
  }
}

// Send notification to a specific user via Telegram
async function sendTelegramToUser(userId, message) {
  try {
    const result = await pool.query(
      'SELECT telegram_chat_id FROM users WHERE id = $1 AND telegram_chat_id IS NOT NULL',
      [userId]
    );
    
    if (result.rows.length > 0 && result.rows[0].telegram_chat_id) {
      return await sendTelegramMessage(result.rows[0].telegram_chat_id, message);
    }
    return false;
  } catch (error) {
    console.error('sendTelegramToUser error:', error);
    return false;
  }
}

// Send notification to all users with a specific role
async function sendTelegramToRole(role, message) {
  try {
    const result = await pool.query(
      'SELECT telegram_chat_id FROM users WHERE role = $1 AND telegram_chat_id IS NOT NULL',
      [role]
    );
    
    const promises = result.rows.map(user => 
      sendTelegramMessage(user.telegram_chat_id, message)
    );
    
    await Promise.allSettled(promises);
    return true;
  } catch (error) {
    console.error('sendTelegramToRole error:', error);
    return false;
  }
}

// Send notification to writers with specific domain
async function sendTelegramToDomain(domain, message) {
  try {
    const result = await pool.query(
      `SELECT telegram_chat_id FROM users 
       WHERE role = 'writer' 
       AND telegram_chat_id IS NOT NULL
       AND (domains ILIKE $1 OR domains ILIKE $2 OR domains ILIKE $3)`,
      [`%${domain}%`, `${domain},%`, `%,${domain}`]
    );
    
    const promises = result.rows.map(user => 
      sendTelegramMessage(user.telegram_chat_id, message)
    );
    
    await Promise.allSettled(promises);
    return true;
  } catch (error) {
    console.error('sendTelegramToDomain error:', error);
    return false;
  }
}

// Generate a link code for connecting Telegram
router.post('/generate-link-code', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Delete any existing codes for this user
    await pool.query('DELETE FROM telegram_link_codes WHERE user_id = $1', [userId]);
    
    // Generate a random 6-character code
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    await pool.query(
      'INSERT INTO telegram_link_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
      [userId, code, expiresAt]
    );
    
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'YourBotUsername';
    
    res.json({
      code,
      expiresAt,
      botLink: `https://t.me/${botUsername}`,
      instructions: `1. Open Telegram and search for @${botUsername}\n2. Start a chat with the bot\n3. Send this code: ${code}`
    });
  } catch (error) {
    console.error('Generate link code error:', error);
    res.status(500).json({ error: 'Failed to generate link code' });
  }
});

// Check if user has Telegram linked
router.get('/status', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT telegram_chat_id, telegram_username, telegram_linked_at FROM users WHERE id = $1',
      [req.user.id]
    );
    
    const user = result.rows[0];
    res.json({
      linked: !!user.telegram_chat_id,
      username: user.telegram_username,
      linkedAt: user.telegram_linked_at
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Unlink Telegram
router.post('/unlink', authenticate, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = $1',
      [req.user.id]
    );
    
    res.json({ success: true, message: 'Telegram unlinked successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unlink Telegram' });
  }
});

// Telegram webhook endpoint (called by Telegram servers)
router.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text;
      const username = update.message.from.username || update.message.from.first_name;
      
      if (text === '/start') {
        await sendTelegramMessage(chatId, 
          '👋 Welcome to <b>HomeworkPal</b> notifications!\n\n' +
          'To link your account, go to HomeworkPal settings and generate a link code, then send it here.\n\n' +
          'Commands:\n' +
          '/start - Show this message\n' +
          '/status - Check link status\n' +
          '/unlink - Unlink your account'
        );
      } else if (text === '/status') {
        const result = await pool.query(
          'SELECT name FROM users WHERE telegram_chat_id = $1',
          [chatId.toString()]
        );
        
        if (result.rows.length > 0) {
          await sendTelegramMessage(chatId, 
            `✅ Your Telegram is linked to: <b>${result.rows[0].name}</b>`
          );
        } else {
          await sendTelegramMessage(chatId, 
            '❌ Your Telegram is not linked to any HomeworkPal account.\n\n' +
            'Generate a link code in HomeworkPal settings to connect.'
          );
        }
      } else if (text === '/unlink') {
        await pool.query(
          'UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE telegram_chat_id = $1',
          [chatId.toString()]
        );
        await sendTelegramMessage(chatId, '✅ Your account has been unlinked.');
      } else if (text && text.length === 6 && /^[A-F0-9]+$/.test(text.toUpperCase())) {
        // This looks like a link code
        const code = text.toUpperCase();
        
        const result = await pool.query(
          `SELECT user_id FROM telegram_link_codes 
           WHERE code = $1 AND expires_at > NOW()`,
          [code]
        );
        
        if (result.rows.length > 0) {
          const userId = result.rows[0].user_id;
          
          // Link the account
          await pool.query(
            `UPDATE users SET 
              telegram_chat_id = $1, 
              telegram_username = $2, 
              telegram_linked_at = NOW() 
            WHERE id = $3`,
            [chatId.toString(), username, userId]
          );
          
          // Delete the used code
          await pool.query('DELETE FROM telegram_link_codes WHERE code = $1', [code]);
          
          // Get user name
          const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
          
          await sendTelegramMessage(chatId, 
            `✅ <b>Success!</b>\n\n` +
            `Your Telegram is now linked to: <b>${userResult.rows[0].name}</b>\n\n` +
            `You'll receive notifications for:\n` +
            `📋 New job postings\n` +
            `💬 New messages\n` +
            `📢 Important updates`
          );
        } else {
          await sendTelegramMessage(chatId, 
            '❌ Invalid or expired code.\n\n' +
            'Please generate a new code in HomeworkPal settings.'
          );
        }
      } else {
        await sendTelegramMessage(chatId, 
          'ℹ️ Send a valid link code, or use /start for help.'
        );
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(200); // Always return 200 to Telegram
  }
});

module.exports = router;
module.exports.sendTelegramMessage = sendTelegramMessage;
module.exports.sendTelegramToUser = sendTelegramToUser;
module.exports.sendTelegramToRole = sendTelegramToRole;
module.exports.sendTelegramToDomain = sendTelegramToDomain;
