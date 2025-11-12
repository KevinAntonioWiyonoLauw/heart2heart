import { GoogleGenerativeAI } from "@google/genai";
import { SYSTEM_PROMPT, CRISIS_REPLY } from "../lib/prompt.js";
import { isHighRisk } from "../lib/riskFilter.js";

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const WH_SECRET   = process.env.WH_SECRET;
const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

// ✅ Perbaikan: Inisialisasi yang benar
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Verifikasi secret (kalau kamu set saat setWebhook)
  const sec = req.headers["x-telegram-bot-api-secret-token"];
  if (WH_SECRET && sec !== WH_SECRET) return res.status(401).end();

  const msg    = req.body?.message;
  const chatId = msg?.chat?.id;
  const text   = msg?.text;

  if (!chatId || !text) return res.status(200).end();

  // Crisis override (jawab cepat)
  if (isHighRisk(text)) {
    await sendMessage(chatId, CRISIS_REPLY);
    return res.status(200).end();
  }

  // /start greeting khusus biar beda dari fallback
  if (text.trim().toLowerCase() === "/start") {
    await sendMessage(
      chatId,
      "Hai, terima kasih sudah membuka Heart2Heart. Aku siap mendengarkan. " +
      "Kamu bisa cerita apa yang lagi kamu rasakan. (Catatan: aku bukan pengganti psikolog.)"
    );
    return res.status(200).end();
  }

  let reply = "Aku denger kamu. Ceritain lebih lanjut, ya."; // fallback
  try {
    // ✅ Perbaikan: Cara yang benar untuk menggunakan Gemini
    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL,
      systemInstruction: SYSTEM_PROMPT
    });

    const result = await model.generateContent(text);
    const response = await result.response;
    
    // ✅ Perbaikan: Mengambil text yang benar
    if (response && response.text()) {
      reply = response.text();
    }
  } catch (e) {
    console.error("Gemini error:", e?.message || e);
    // Log lebih detail untuk debugging
    console.error("Full error:", e);
  }

  await sendMessage(chatId, reply.slice(0, 3900));
  res.status(200).end();
}