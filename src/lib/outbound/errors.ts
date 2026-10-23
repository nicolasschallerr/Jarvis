// Error al enviar un mensaje por un canal. "retryable" dice si tiene sentido reintentar más tarde
// (límite de velocidad o falla del proveedor) o si el pedido es inválido y reintentar no sirve.
export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly code: number | string | null,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ChannelSendError";
  }
}

// El canal no permite mandar texto libre en este momento (por ejemplo WhatsApp fuera de la
// ventana de 24 h, donde solo se pueden enviar plantillas aprobadas).
export class OutsideWindowError extends Error {
  constructor(message = "Fuera de la ventana de atención: solo se pueden enviar plantillas") {
    super(message);
    this.name = "OutsideWindowError";
  }
}
