import { mimeLabel } from "@/lib/crm/format";

export type MediaItem = { url: string; mimeType: string };

// Muestra un adjunto según su tipo. Las URL son temporales (firmadas) y salen del bucket privado.
export function MessageMedia({ type, media }: { type: string; media: MediaItem }) {
  if (type === "image") {
    return (
      <a href={media.url} target="_blank" rel="noopener noreferrer" className="block" aria-label="Abrir la imagen en otra pestaña">
        {/* Una URL firmada y temporal no se puede optimizar con next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={media.url} alt="Imagen enviada" className="max-h-80 rounded-lg" loading="lazy" />
      </a>
    );
  }

  if (type === "audio") {
    return <audio controls preload="none" src={media.url} className="w-64 max-w-full" />;
  }

  if (type === "video") {
    return <video controls preload="none" src={media.url} className="max-h-80 rounded-lg" />;
  }

  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-current/20 px-3 py-2 font-medium underline-offset-2 hover:underline"
    >
      <span className="rounded bg-current/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase">{mimeLabel(media.mimeType)}</span>
      Abrir archivo
    </a>
  );
}
