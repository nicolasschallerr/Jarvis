// Los canales guardan el NOMBRE de la variable de entorno con su token, nunca el token. Antes de leerla se
// verifica que el nombre tenga la forma de un token de canal: así un valor manipulado no puede hacer que el
// sistema lea (y mande a un proveedor) otra variable, como la clave de servicio de la base. La base aplica la
// misma regla (restricción channels_secret_ref_format) y solo deja definirla al servidor (ADR-027).
const CHANNEL_TOKEN_REF = /^(TELEGRAM_BOT_TOKEN|WHATSAPP_ACCESS_TOKEN|CHANNEL_TOKEN)(_[A-Z0-9]+)*$/;

export function isChannelTokenRef(secretRef: string | null | undefined): secretRef is string {
  return typeof secretRef === "string" && CHANNEL_TOKEN_REF.test(secretRef);
}

// El token del canal, o un error claro. El mensaje nombra la variable, nunca su valor.
export function channelToken(secretRef: string | null | undefined): string {
  if (!isChannelTokenRef(secretRef)) throw new Error(`El canal no tiene una referencia de token válida (${secretRef ?? "sin secret_ref"})`);
  const token = process.env[secretRef];
  if (!token) throw new Error(`Falta la variable de entorno del canal (${secretRef})`);
  return token;
}
