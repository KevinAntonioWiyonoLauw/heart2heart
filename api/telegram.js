import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, CRISIS_REPLY } from "../lib/prompt.js";
import { isHighRisk } from "../lib/riskFilter.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WH_SECRET = process.env.WH_SECRET;        // secret bebas, opsional tapi disarankan
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // verifikasi secret token dari Telegram (kalau kamu set saat setWebhook)
  const sec = req.headers["x-telegram-bot-api-secret-token"];
  if (WH_SECRET && sec !== WH_SECRET) return res.status(401).end();

  const update = req.body;
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text;

  if (!chatId || !text) return res.status(200).end();

  // Crisis override (jawab cepat)
  if (isHighRisk(text)) {
    await sendMessage(chatId, CRISIS_REPLY);
    return res.status(200).end();
  }

  // Panggil Gemini
  let reply = "Aku denger kamu. Ceritain lebih lanjut, ya.";
  try {
    const { response } = await ai.models.generateContent({
      model: GEMINI_MODEL,
      // system_instruction disarankan agar tone konsisten
      system_instruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text }]}],
    });
    reply = response?.text?.() || reply;
  } catch (e) {
    console.error("Gemini error:", e);
  }

  await sendMessage(chatId, reply.slice(0, 3900)); // jaga di bawah limit 4096
  res.status(200).end();
}
