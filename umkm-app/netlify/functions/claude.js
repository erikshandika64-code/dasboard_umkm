exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let prompt;
  try {
    const body = JSON.parse(event.body);
    prompt = body.prompt;
  } catch (err) {
    console.error("Gagal parse request body:", err.message);
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: "Prompt is required" }) };
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY tidak ditemukan di environment variables");
    return { statusCode: 500, body: JSON.stringify({ error: "GEMINI_API_KEY belum diset di Netlify" }) };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error, status:", response.status, "body:", JSON.stringify(data));
      return { statusCode: response.status, body: JSON.stringify({ error: data }) };
    }

    const teks = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";
    console.log("Berhasil generate teks, panjang:", teks.length);
    return { statusCode: 200, body: JSON.stringify({ text: teks }) };
  } catch (err) {
    console.error("Exception saat memanggil Gemini API:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
