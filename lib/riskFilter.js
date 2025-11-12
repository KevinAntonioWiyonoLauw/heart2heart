export function isHighRisk(text = "") {
  const t = text.toLowerCase();
  const keys = [
    "bunuh diri","akhiri hidup","melukai diri","nyakitin diri",
    "mati aja","nggak mau hidup","ga mau hidup","pengen nyerah total", "bundir", "cape hidup"
  ];
  return keys.some(k => t.includes(k));
}
