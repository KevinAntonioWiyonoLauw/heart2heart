const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL   = process.env.APP_URL; 
const WH_SECRET = process.env.WH_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
  const webhookUrl = `${APP_URL}/api/telegram`;
  const r = await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ url: webhookUrl, secret_token: WH_SECRET })
  });
  const j = await r.json();
  res.status(200).json(j);
}
