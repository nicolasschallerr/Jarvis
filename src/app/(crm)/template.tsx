// A diferencia del layout, el template se vuelve a montar en cada navegación: cada sección entra con un fundido y un
// leve ascenso. Es una animación de CSS (no de JavaScript): arranca apenas se pinta la página, sin esperar a que cargue
// el código, y al terminar no deja ninguna transformación aplicada (las ventanas fijas, como la bienvenida, siguen
// ocupando toda la pantalla). Con menos movimiento no se anima (globals.css).
export default function CrmTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex min-h-0 flex-1 flex-col">{children}</div>;
}
