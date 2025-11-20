import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT, CRISIS_REPLY } from '../lib/prompt.js';
import { isHighRisk } from '../lib/riskFilter.js';

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const WH_SECRET   = process.env.WH_SECRET;
const GEMINI_KEY  = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

const userChats = new Map();
const userLastRequest = new Map();
const chatTimestamps = new Map();
const userMessageCount = new Map();

const COOLDOWN_MS = 3000;
const MAX_CHAT_AGE = 30 * 60 * 1000; // 30 menit
const RATE_LIMIT = 10; // Max 10 pesan per menit
const RATE_WINDOW = 60 * 1000;

async function sendMessageWithRetry(chatId, text, retries = 3) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
      });
      
      if (!response.ok) throw new Error(`Telegram API error: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

async function sendTypingAction(chatId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`;
  await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ chat_id: chatId, action: "typing" })
  }).catch(() => {}); // Ignore errors
}

function cleanupOldChats() {
  const now = Date.now();
  for (const [chatId, timestamp] of chatTimestamps.entries()) {
    if (now - timestamp > MAX_CHAT_AGE) {
      userChats.delete(chatId);
      chatTimestamps.delete(chatId);
      userLastRequest.delete(chatId);
    }
  }
}

function getUserChat(chatId) {
  chatTimestamps.set(chatId, Date.now());
  
  if (!userChats.has(chatId)) {
    const chat = ai.chats.create({
      model: 'gemini-2.0-flash-exp',
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.8,
        topP: 0.9,
        maxOutputTokens: 500,
      },
    });
    userChats.set(chatId, chat);
  }
  return userChats.get(chatId);
}

function checkRateLimit(chatId) {
  const now = Date.now();
  const userMessages = userMessageCount.get(chatId) || [];
  
  const recentMessages = userMessages.filter(time => now - time < RATE_WINDOW);
  
  if (recentMessages.length >= RATE_LIMIT) {
    return false;
  }
  
  recentMessages.push(now);
  userMessageCount.set(chatId, recentMessages);
  return true;
}

// Jalankan cleanup setiap 5 menit
setInterval(cleanupOldChats, 5 * 60 * 1000);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sec = req.headers["x-telegram-bot-api-secret-token"];
  if (WH_SECRET && sec !== WH_SECRET) return res.status(401).end();

  const msg    = req.body?.message;
  const chatId = msg?.chat?.id;
  const text   = msg?.text;

  if (!chatId || !text) return res.status(200).end();

  // Rate limiting
  if (!checkRateLimit(chatId)) {
    await sendMessageWithRetry(chatId, "Mohon tunggu sebentar sebelum mengirim pesan lagi ya. 💙");
    return res.status(200).end();
  }

  const now = Date.now();
  const lastRequest = userLastRequest.get(chatId) || 0;
  
  if (now - lastRequest < COOLDOWN_MS && !text.startsWith("/")) {
    return res.status(200).end();
  }
  
  userLastRequest.set(chatId, now);

  if (isHighRisk(text)) {
    await sendMessageWithRetry(chatId, CRISIS_REPLY);
    return res.status(200).end();
  }

  if (text.trim().toLowerCase() === "/start") {
    userChats.delete(chatId);
    chatTimestamps.delete(chatId);
    await sendMessageWithRetry(
      chatId,
      "Hai, terima kasih sudah membuka Heart2Heart. Aku siap mendengarkan. " +
      "Kamu bisa cerita apa yang lagi kamu rasakan. (Catatan: aku bukan pengganti psikolog.)"
    );
    return res.status(200).end();
  }

  if (text.trim().toLowerCase() === "/reset") {
    userChats.delete(chatId);
    chatTimestamps.delete(chatId);
    await sendMessageWithRetry(chatId, "Percakapan telah direset. Mulai cerita lagi yuk! 💙");
    return res.status(200).end();
  }

  // Show typing
  await sendTypingAction(chatId);

  let reply = "Aku denger kamu. Ceritain lebih lanjut, ya.";
  try {
    const chat = getUserChat(chatId);
    
    const stream = await chat.sendMessageStream({ message: text });
    
    let fullResponse = '';
    for await (const chunk of stream) {
      fullResponse += chunk.text;
    }
    
    if (fullResponse) {
      reply = fullResponse;
    }
  } catch (e) {
    console.error("Gemini error:", e?.message || e);
    console.error("Full error:", e);
    
    if (e.status === 429) {
      reply = "Maaf, sistem sedang sibuk. Coba lagi dalam beberapa saat ya. Aku tetap di sini untukmu. 💙";
    } else if (e.status === 404 || e.status === 500) {
      reply = "Maaf, ada masalah teknis. Coba ketik /reset untuk mulai percakapan baru ya.";
      userChats.delete(chatId);
    } else if (e.status === 400) {
      reply = "Maaf, aku kesulitan memahami pesanmu. Bisa coba diulangi dengan kata lain?";
    } else {
      reply = "Maaf, terjadi kesalahan. Aku tetap di sini untukmu. Coba lagi ya. 💙";
    }
  }

  await sendMessageWithRetry(chatId, reply.slice(0, 3900));
  res.status(200).end();
}