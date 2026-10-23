"use client";

// Alterna claro/oscuro. El ícono se elige con CSS según data-theme, sin estado en React, así que no
// hay diferencia entre el servidor y el navegador al hidratar.
export function ThemeToggle() {
  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("jarvis-theme", next);
    } catch {
      // Sin almacenamiento (modo privado): el cambio vale solo para esta visita.
    }
  }

  return (
    <button type="button" onClick={toggle} className="btn-secondary w-full gap-2" aria-label="Cambiar entre modo claro y oscuro">
      <svg viewBox="0 0 24 24" className="size-4 dark:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8Z" />
      </svg>
      <svg viewBox="0 0 24 24" className="hidden size-4 dark:block" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <span className="dark:hidden">Modo oscuro</span>
      <span className="hidden dark:inline">Modo claro</span>
    </button>
  );
}
