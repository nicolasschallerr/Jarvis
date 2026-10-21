import Anthropic from "@anthropic-ai/sdk";

// Script de verificación de la Fase 0: confirma que la API key funciona.
// El SDK lee la clave desde la variable de entorno ANTHROPIC_API_KEY.
const client = new Anthropic();

const message = await client.messages.create({
  model: "claude-haiku-5-5",
  max_tokens: 200,
  messages: [
    {
      role: "user",
      content:
        "Respondé en una sola frase, en español rioplatense: ¿estás funcionando?",
    },
  ],
});

for (const block of message.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}

console.log(
  `Tokens: ${message.usage.input_tokens} de entrada, ${message.usage.output_tokens} de salida`,
);
