export type MediaItem = { url: string; mimeType: string };

// Muestra un adjunto según su tipo. Las URL son temporales (firmadas) y salen del bucket privado.
export function MessageMedia({ type, media }: { type: string; media: MediaItem }) {
  if (type === "image") {
    return (
      // Una URL firmada y temporal no se puede optimizar con next/image.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={media.url} alt="Imagen enviada" className="max-h-80 rounded-md" loading="lazy" />
    );
  }

  if (type === "audio") {
    return <audio controls preload="none" src={media.url} className="w-64 max-w-full" />;
  }

  if (type === "video") {
    return <video controls preload="none" src={media.url} className="max-h-80 rounded-md" />;
  }

  return (
    <a href={media.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline dark:text-blue-300">
      Abrir archivo ({media.mimeType})
    </a>
  );
}
