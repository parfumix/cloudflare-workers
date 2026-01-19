const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(renderHtml(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/roast") {
      return handleRoast(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleRoast(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return new Response("Expected multipart/form-data", { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("resume");
  if (!file || typeof file === "string") {
    return new Response("Missing resume file", { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return new Response("Only PDF or DOCX files are supported", { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return new Response("File too large", { status: 413 });
  }

  if (!env.GEMINI_API_KEY) {
    return new Response("Missing GEMINI_API_KEY", { status: 500 });
  }

  let roastText = "";
  try {
    roastText = await generateRoast(file, env.GEMINI_API_KEY);
  } catch (error) {
    return new Response(`Gemini request failed: ${error.message}`, { status: 502 });
  }

  const svg = buildRoastSvg({
    roastText,
    filename: file.name,
    fileType: file.type,
  });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function generateRoast(file, apiKey) {
  const arrayBuffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  const prompt =
    "You are a brutally honest resume reviewer. Roast the resume with short, punchy callouts. " +
    "Provide 6-10 bullet points. Keep each point under 18 words.";

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: file.type,
              data: base64,
            },
          },
        ],
      },
    ],
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text).join(" ");

  if (!text) {
    return "No roast generated. Try another resume.";
  }

  return text;
}

function buildRoastSvg({ roastText, filename, fileType }) {
  const width = 1200;
  const height = 1600;
  const safeText = escapeXml(roastText);
  const lines = wrapText(safeText, 48);
  const lineHeight = 40;
  const startY = 260;

  const textLines = lines
    .map(
      (line, index) =>
        `<text x="80" y="${startY + index * lineHeight}" class="roast">${line}</text>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .title { font: 700 64px 'Helvetica Neue', Arial, sans-serif; fill: #d62828; }
      .subtitle { font: 500 28px 'Helvetica Neue', Arial, sans-serif; fill: #1f2937; }
      .roast { font: 500 30px 'Helvetica Neue', Arial, sans-serif; fill: #111827; }
      .label { font: 600 20px 'Helvetica Neue', Arial, sans-serif; fill: #6b7280; }
      .scribble { stroke: #d62828; stroke-width: 6; fill: none; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#fdfdfd" />
  <text x="80" y="120" class="title">Resume Roast</text>
  <text x="80" y="170" class="subtitle">${escapeXml(filename)} (${escapeXml(fileType)})</text>
  <path class="scribble" d="M80 190 L1120 190" />
  <text x="80" y="230" class="label">Gemini says:</text>
  ${textLines}
  <path class="scribble" d="M80 ${height - 120} L1120 ${height - 120}" />
  <text x="80" y="${height - 70}" class="label">Keep it clean, concise, and human.</text>
</svg>`;
}

function wrapText(text, maxChars) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if ((current + " " + word).length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function arrayBufferToBase64(arrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Resume Roast</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f9fafb; color: #111827; margin: 0; padding: 40px; }
      .card { max-width: 720px; margin: 0 auto; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
      h1 { margin-top: 0; color: #d62828; }
      p { line-height: 1.6; }
      form { margin-top: 24px; display: grid; gap: 16px; }
      input[type=file] { padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; }
      button { background: #d62828; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-size: 16px; cursor: pointer; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      img { margin-top: 24px; max-width: 100%; border: 1px solid #e5e7eb; border-radius: 12px; }
      .status { font-size: 14px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Resume Roast</h1>
      <p>Upload a PDF or DOCX resume. We will send it to Gemini and return a roast-style image.</p>
      <form id="roast-form">
        <input name="resume" type="file" accept=".pdf,.docx" required />
        <button type="submit">Roast my resume</button>
        <div class="status" id="status"></div>
      </form>
      <img id="output" alt="Roasted resume" hidden />
    </div>
    <script>
      const form = document.getElementById('roast-form');
      const status = document.getElementById('status');
      const output = document.getElementById('output');

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        status.textContent = 'Roasting...';
        output.hidden = true;

        const formData = new FormData(form);
        const response = await fetch('/roast', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const text = await response.text();
          status.textContent = `Error: ${text}`;
          return;
        }

        const blob = await response.blob();
        output.src = URL.createObjectURL(blob);
        output.hidden = false;
        status.textContent = 'Done!';
      });
    </script>
  </body>
</html>`;
}
