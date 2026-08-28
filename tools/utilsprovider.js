import axios from "axios";
import fs from "fs";

export async function benchmarkProviders() {
  const results = {
    ollama: { latency: null, ok: false },
    openrouter: { latency: null, ok: false },
    timestamp: new Date().toISOString(),
  };

  const testPrompt = "Respond with JSON: {\"ok\": true}";

  // --- Ollama benchmark ---
  try {
    const start = performance.now();
    const { data } = await axios.post(
      `${process.env.OLLAMA_HOST || "http://localhost:11434"}/api/generate`,
      { model: "llama3:8b", prompt: testPrompt, stream: false, format: "json" }
    );
    const end = performance.now();
    JSON.parse(data.response); // validate JSON
    results.ollama.latency = end - start;
    results.ollama.ok = true;
  } catch {
    results.ollama.ok = false;
  }

  // --- OpenRouter benchmark ---
  try {
    const start = performance.now();
    const { data } = await axios.post(
      "https://api.openrouter.ai/v1/chat/completions",
      {
        model: "mistral/mistral-7b-instruct",
        messages: [{ role: "user", content: testPrompt }],
        max_tokens: 5,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    const end = performance.now();
    JSON.parse(data.choices[0].message.content);
    results.openrouter.latency = end - start;
    results.openrouter.ok = true;
  } catch {
    results.openrouter.ok = false;
  }

  fs.writeFileSync("./provider_benchmark.json", JSON.stringify(results, null, 2));
  return results;
}
