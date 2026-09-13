const GEMINI_MODEL = "gemini-3.6-flash";
const OPENROUTER_MODEL = "openrouter/free";

const SYSTEM_PROMPT = `
Você é a IA do Chat Livre AI.

Converse naturalmente com o usuário.
Seja útil, direto, claro e amigável.
Responda em português quando o usuário falar português.
Não invente informações.
`;

function normalizeMessages(messages) {
  return messages
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
    )
    .slice(-40)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 6000),
    }))
    .filter((message) => message.content.length > 0);
}

/* =========================
   GEMINI
========================= */

async function callGemini(messages) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não está configurada no Vercel.");
  }

  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      {
        text: message.content,
      },
    ],
  }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },

      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: SYSTEM_PROMPT,
            },
          ],
        },

        contents,

        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("GEMINI ERROR:", data);

    throw new Error(
      data?.error?.message ||
        `Erro da Gemini (${response.status}).`
    );
  }

  const reply = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!reply) {
    throw new Error("A Gemini não retornou texto.");
  }

  return reply;
}

/* =========================
   OPENROUTER
========================= */

async function callOpenRouter(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY não está configurada no Vercel."
    );
  }

  const openRouterMessages = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },

    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://chat-livre-ai.vercel.app",
        "X-Title": "Chat Livre AI",
      },

      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: openRouterMessages,

        temperature: 0.7,

        max_tokens: 2048,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("OPENROUTER ERROR:", data);

    throw new Error(
      data?.error?.message ||
        `Erro do OpenRouter (${response.status}).`
    );
  }

  const reply =
    data?.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    throw new Error(
      "O OpenRouter não retornou uma resposta."
    );
  }

  return reply;
}

/* =========================
   API PRINCIPAL
========================= */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido.",
    });
  }

  try {
    const body = req.body;

    if (!body || typeof body !== "object") {
      return res.status(400).json({
        error: "Corpo da requisição inválido.",
      });
    }

    if (!Array.isArray(body.messages)) {
      return res.status(400).json({
        error: "O campo messages precisa ser um array.",
      });
    }

    const messages = normalizeMessages(body.messages);

    if (messages.length === 0) {
      return res.status(400).json({
        error: "Nenhuma mensagem válida foi enviada.",
      });
    }

    const provider =
      typeof body.provider === "string"
        ? body.provider.toLowerCase()
        : "gemini";

    let reply;

    if (provider === "gemini") {
      reply = await callGemini(messages);
    }

    else if (
      provider === "openrouter" ||
      provider === "openrouter-free"
    ) {
      reply = await callOpenRouter(messages);
    }

    else {
      return res.status(400).json({
        error:
          "API inválida. Use Gemini ou OpenRouter.",
      });
    }

    return res.status(200).json({
      reply,
      provider,
    });
  }

  catch (error) {
    console.error("CHAT LIVRE AI ERROR:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Erro interno ao conversar com a IA.",
    });
  }
}
