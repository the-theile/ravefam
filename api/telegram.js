'use strict';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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

    // Send the PLUR auto-reply (threaded under their message)
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: PLUR_REPLY,
        reply_to_message_id: messageId,
      }),
    });

    return res.status(200).send('ok');
  } catch (err) {
    console.error('Telegram webhook error:', err);
    // Still return 200 so Telegram doesn't keep retrying
    return res.status(200).send('ok');
  }
};
