'use strict';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PLUR_REPLY = `Got it raver 💜
Thanks for helping make RaveFAM better. The crew will look at this soon.
PLUR`;

module.exports = async (req, res) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  if (!TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is missing');
    return res.status(500).send('Bot not configured');
  }

  try {
    const update = req.body;

    // We only care about regular messages for now
    const message = update.message || update.edited_message;
    if (!message) {
      return res.status(200).send('ok');
    }

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const from = message.from || {};
    const text = message.text || message.caption || null;

    // Detect media
    let hasMedia = false;
    let mediaType = null;
    if (message.photo) {
      hasMedia = true;
      mediaType = 'photo';
    } else if (message.video) {
      hasMedia = true;
      mediaType = 'video';
    } else if (message.document) {
      hasMedia = true;
      mediaType = 'document';
    } else if (message.voice || message.audio) {
      hasMedia = true;
      mediaType = 'audio';
    }

    // 1. Send the PLUR auto-reply (threaded under their message)
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: PLUR_REPLY,
        reply_to_message_id: messageId,
      }),
    });

    // 2. Forward the original message to the admin for notifications
    if (ADMIN_CHAT_ID) {
      await fetch(`https://api.telegram.org/bot${TOKEN}/forwardMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ADMIN_CHAT_ID,
          from_chat_id: chatId,
          message_id: messageId,
        }),
      });
    }

    // 3. Log into Supabase for structured AI triage later
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/telegram_feedback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            telegram_user_id: from.id || null,
            telegram_username: from.username || null,
            telegram_message_id: messageId,
            message_text: text,
            has_media: hasMedia,
            media_type: mediaType,
          }),
        });
      } catch (logErr) {
        // Don't fail the whole webhook if logging fails
        console.error('Failed to log feedback to Supabase:', logErr);
      }
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('Telegram webhook error:', err);
    // Still return 200 so Telegram doesn't keep retrying
    return res.status(200).send('ok');
  }
};
