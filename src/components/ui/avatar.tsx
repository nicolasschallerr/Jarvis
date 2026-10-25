// Avatar con iniciales. El color sale del nombre (siempre el mismo para la misma persona) dentro de una gama
// de tonos de la paleta, así la bandeja se escanea rápido sin depender de fotos.
const TONES = [
  "bg-[#dcebee] text-[#1f5f6b] dark:bg-[#1d3a40] dark:text-[#8fd0dc]",
  "bg-[#f3e6cf] text-[#8a5a12] dark:bg-[#3a2c12] dark:text-[#e8b04f]",
  "bg-[#e3f1e8] text-[#2f7a4f] dark:bg-[#173326] dark:text-[#74c897]",
  "bg-[#ece3f2] text-[#6b3f8a] dark:bg-[#2e2237] dark:text-[#c7a4e0]",
  "bg-[#f6e1dc] text-[#9b3b2a] dark:bg-[#3d1d1a] dark:text-[#f28b7f]",
  "bg-[#e6e0d2] text-[#4c483e] dark:bg-[#2f3436] dark:text-[#d3ccba]",
];

export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase("es-AR");
}

function toneOf(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length] ?? TONES[0] ?? "";
}

export function Avatar({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-11 text-sm" };
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-semibold ${sizes[size]} ${toneOf(name ?? "")}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
