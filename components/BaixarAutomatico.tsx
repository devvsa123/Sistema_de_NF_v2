"use client";

import { useEffect } from "react";

/** Dispara o download uma única vez ao abrir a página (logo após emitir o laudo). */
export function BaixarAutomatico({ href }: { href: string }) {
  useEffect(() => {
    const chave = "baixado:" + href;
    try {
      if (sessionStorage.getItem(chave)) return;
      sessionStorage.setItem(chave, "1");
    } catch {}
    window.location.assign(href);
  }, [href]);
  return null;
}
