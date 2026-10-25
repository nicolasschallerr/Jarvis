import { describe, expect, it } from "vitest";

import { defaultCaseView } from "../src/lib/crm/case-list";
import { contactQueryFrom } from "../src/lib/crm/contact-directory";
import { filterSpec, inboxQueryFrom, lastSenderPrefix, searchTerm } from "../src/lib/crm/inbox";

// Lectura de los filtros de la bandeja y del directorio desde la URL (sin base de datos).

describe("filtros de la bandeja", () => {
  it("sin parámetros: todas, sin canal ni búsqueda, primera página", () => {
    expect(inboxQueryFrom({})).toEqual({ filter: "todas", channel: null, search: "", limit: 50 });
  });

  it("ignora valores que no existen en vez de fallar", () => {
    expect(inboxQueryFrom({ filtro: "cualquiera", canal: "fax", ver: "-3" })).toEqual({ filter: "todas", channel: null, search: "", limit: 50 });
  });

  it("acepta filtro, canal, búsqueda y más resultados, con tope", () => {
    expect(inboxQueryFrom({ filtro: "esperando", canal: "telegram", q: "  ana  ", ver: "100" })).toEqual({
      filter: "esperando",
      channel: "telegram",
      search: "ana",
      limit: 100,
    });
    expect(inboxQueryFrom({ ver: "99999" }).limit).toBe(500);
  });

  it("la búsqueda no puede inyectar condiciones en el filtro de la base", () => {
    // Sin paréntesis ni comas no puede cerrar el ilike y sumar otra condición.
    expect(searchTerm("ana),id.eq.(1")).toBe("ana id.eq. 1");
    expect(searchTerm('a*b%c:d"e\\f')).toBe("a b c d e f");
  });

  it("'Mías' mira la conversación y el caso asignados a quien mira", () => {
    expect(filterSpec("mias", "u-1").or).toBe("assigned_to.eq.u-1,case_assigned_to.eq.u-1");
  });

  it("el último mensaje dice quién lo escribió cuando fue del lado de la organización", () => {
    expect(lastSenderPrefix("agent", "outbound")).toBe("Jarvis: ");
    expect(lastSenderPrefix("operator", "outbound")).toBe("Equipo: ");
    expect(lastSenderPrefix("contact", "inbound")).toBe("");
  });
});

describe("directorio de contactos y casos", () => {
  it("lee la búsqueda y la cantidad con tope", () => {
    expect(contactQueryFrom({ q: " 12.345 ", ver: "100" })).toEqual({ search: "12.345", limit: 100 });
    expect(contactQueryFrom({ ver: "abc" }).limit).toBe(50);
  });

  it("quien atiende ve primero sus casos; el resto, todos", () => {
    expect(defaultCaseView("operator")).toBe("mine");
    expect(defaultCaseView("superadmin")).toBe("all");
    expect(defaultCaseView("viewer")).toBe("all");
  });
});
