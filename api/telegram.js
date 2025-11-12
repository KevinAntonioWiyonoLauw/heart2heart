import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, CRISIS_REPLY } from "../lib/prompt.js";
import { isHighRisk } from "../lib/riskFilter.js";

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const WH_SECRET   = process.env.WH_SECRET;
const GEMINI_KEY  = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

const userChats = new Map();
const userLastRequest = new Map();
const COOLDOWN_MS = 3000;

async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

function getUserChat(chatId) {
  if (!userChats.has(chatId)) {
    const chat = ai.chats.create({
      model: 'gemini-2.0-flash-exp',
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.8,
        topP: 0.9,
      },
    });
    userChats.set(chatId, chat);
  }
  return userChats.get(chatId);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sec = req.headers["x-telegram-bot-api-secret-token"];
  if (WH_SECRET && sec !== WH_SECRET) return res.status(401).end();

  const msg    = req.body?.message;
  const chatId = msg?.chat?.id;
  const text   = msg?.text;

  if (!chatId || !text) return res.status(200).end();

  const now = Date.now();
  const lastRequest = userLastRequest.get(chatId) || 0;
  
  if (now - lastRequest < COOLDOWN_MS && !text.startsWith("/")) {
    return res.status(200).end();
  }
  
  userLastRequest.set(chatId, now);

  if (isHighRisk(text)) {
    await sendMessage(chatId, CRISIS_REPLY);
    return res.status(200).end();
  }

  if (text.trim().toLowerCase() === "/start") {
    userChats.delete(chatId);
    await sendMessage(
      chatId,
      "Hai, terima kasih sudah membuka Heart2Heart. Aku siap mendengarkan. " +
      "Kamu bisa cerita apa yang lagi kamu rasakan. (Catatan: aku bukan pengganti psikolog.)"
    );
    return res.status(200).end();
  }

  if (text.trim().toLowerCase() === "/reset") {
    userChats.delete(chatId);
    await sendMessage(chatId, "Percakapan telah direset. Mulai cerita lagi yuk! 💙");
    return res.status(200).end();
  }

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
    } else if (e.status === 404) {
      reply = "Maaf, ada masalah teknis. Coba ketik /reset untuk mulai percakapan baru ya.";
      userChats.delete(chatId);
    }
  }

  await sendMessage(chatId, reply.slice(0, 3900));
  res.status(200).end();
}