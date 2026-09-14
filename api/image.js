/* =========================================================
   CHAT LIVRE AI — /api/image
   Geração de imagens via Pollinations.

   CONTRATO (chamado pelo index.html):
     POST /api/image   { prompt: string }   -> { imageUrl: string }

   COMO FUNCIONA:
     O POST não gera a imagem na hora — ele só valida o prompt e
     devolve uma URL própria (/api/image?prompt=...&seed=...). Essa
     URL é usada pelo <img> do front-end, que faz um GET nela.

     É esse GET que efetivamente chama a Pollinations no servidor
     (usando a POLLINATIONS_API_KEY, se configurada) e devolve os
     bytes da imagem. Assim a chave nunca chega ao navegador: ela só
     é usada aqui dentro, na chamada servidor-a-servidor.

     Se a geração falhar por qualquer motivo, o GET devolve uma
     imagem SVG de aviso (em vez de quebrar o <img> do chat), e o
     motivo real do erro fica só no log do servidor (console.error).
========================================================= */

const MAX_PROMPT_LENGTH = 600;

const UNIFIED_BASE_URL = "https://gen.pollinations.ai/image";
const LEGACY_BASE_URL = "https://image.pollinations.ai/prompt";

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#12141f"/>
  <text x="50%" y="47%" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#8c92b3">⚠️</text>
  <text x="50%" y="58%" font-family="sans-serif" font-size="17" text-anchor="middle" fill="#8c92b3">Imagem indisponível</text>
</svg>`;

function validatePrompt(rawPrompt) {
  if (typeof rawPrompt !== "string") return null;
  const trimmed = rawPrompt.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_PROMPT_LENGTH);
}

function buildPollinationsUrl(prompt, seed) {
  const apiKey = process.env.POLLINATIONS_API_KEY;
  const encodedPrompt = encodeURIComponent(prompt);
  const params = new URLSearchParams();
  params.set("seed", String(seed));

  if (apiKey) {
    params.set("key", apiKey);
    return `${UNIFIED_BASE_URL}/${encodedPrompt}?${params.toString()}`;
  }

  // Sem chave configurada: usa o endpoint público/legado da Pollinations,
  // que aceita uso anônimo (com limites mais baixos de taxa de requisições).
  return `${LEGACY_BASE_URL}/${encodedPrompt}?${params.toString()}`;
}

function sendFallbackImage(res) {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(FALLBACK_SVG);
}

/* =========================
   POST /api/image
   Valida o prompt e devolve a URL (própria) que o <img> vai carregar.
========================= */

async function handlePost(req, res) {
  const body = req.body;

  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Requisição inválida." });
  }

  const prompt = validatePrompt(body.prompt);

  if (!prompt) {
    return res.status(400).json({
      error: "Descreva a imagem que você quer gerar.",
    });
  }

  const seed = Math.floor(Math.random() * 1000000000);
  const imageUrl =
    "/api/image?prompt=" + encodeURIComponent(prompt) + "&seed=" + seed;

  return res.status(200).json({ imageUrl });
}

/* =========================
   GET /api/image?prompt=...&seed=...
   Proxy: chama a Pollinations no servidor e devolve os bytes da imagem.
========================= */

async function handleGet(req, res) {
  const prompt = validatePrompt(req.query.prompt);
  const seedParam = String(req.query.seed || "");
  const seed = /^\d+$/.test(seedParam) ? seedParam : String(Date.now());

  if (!prompt) {
    console.error("IMAGE PROXY: prompt ausente ou inválido na URL.");
    return sendFallbackImage(res);
  }

  const targetUrl = buildPollinationsUrl(prompt, seed);

  let upstream;
  try {
    upstream = await fetch(targetUrl);
  } catch (error) {
    console.error("IMAGE PROXY: falha de rede ao chamar a Pollinations:", error);
    return sendFallbackImage(res);
  }

  if (!upstream.ok) {
    const errorBody = await upstream.text().catch(function () {
      return "";
    });
    console.error(
      "IMAGE PROXY: erro da Pollinations (" + upstream.status + "):",
      errorBody
    );
    return sendFallbackImage(res);
  }

  const contentType = upstream.headers.get("content-type") || "";

  if (!contentType.startsWith("image/")) {
    console.error(
      "IMAGE PROXY: resposta da Pollinations não é uma imagem:",
      contentType
    );
    return sendFallbackImage(res);
  }

  let buffer;
  try {
    const arrayBuffer = await upstream.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("IMAGE PROXY: falha ao ler os bytes da imagem:", error);
    return sendFallbackImage(res);
  }

  res.setHeader("Content-Type", contentType);
  // prompt + seed geram sempre a mesma imagem, então o cache pode ser longo.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.status(200).send(buffer);
}

/* =========================
   HANDLER PRINCIPAL
========================= */

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      return await handlePost(req, res);
    }

    if (req.method === "GET") {
      return await handleGet(req, res);
    }

    return res.status(405).json({ error: "Método não permitido." });
  } catch (error) {
    console.error("IMAGE API ERROR:", error);

    if (req.method === "GET") {
      return sendFallbackImage(res);
    }

    return res.status(500).json({
      error: error?.message || "Erro interno ao gerar a imagem.",
    });
  }
}
