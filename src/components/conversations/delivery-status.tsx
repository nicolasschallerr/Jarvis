import { CheckIcon, ClockIcon, DoubleCheckIcon } from "@/components/ui/icons";

// Estado de entrega de un mensaje saliente, al lado de la hora (como en los canales de chat). "failed" no va acá:
// ese se marca con el borde rojo y el aviso debajo de la burbuja.
// `readClass` es el color de "leído": sobre la burbuja en color fuerte el tono `info` no se distingue del fondo
// (en el tema claro es el mismo petróleo), así que quien la dibuja elige otro.
export function DeliveryStatus({ status, readClass = "text-info" }: { status: string; readClass?: string }) {
  switch (status) {
    case "queued":
      // El pulso lo apaga `prefers-reduced-motion` (la regla global de animaciones).
      return <ClockIcon className="size-3.5 animate-pulse motion-reduce:animate-none" label="En cola" />;
    case "sent":
      return <CheckIcon className="size-3.5" label="Enviado" />;
    case "delivered":
      return <DoubleCheckIcon className="size-3.5" label="Entregado" />;
    case "read":
      return <DoubleCheckIcon className={`size-3.5 ${readClass}`} label="Leído" />;
    default:
      return null;
  }
}
