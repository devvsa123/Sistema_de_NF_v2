"use client";

/** Conversa com o Assinador SERPRO instalado no computador (WebSocket local). */

// Endereços do serviço local do Assinador: as versões novas usam o nome assinador-desktop.serpro.gov.br
// (apontado para 127.0.0.1 no arquivo hosts); as antigas, o IP direto.
const ENDERECOS = [
  "wss://127.0.0.1:65156/signer/",
  "wss://localhost:65156/signer/",
  "wss://assinador-desktop.serpro.gov.br:65156/signer/", // em redes com proxy este nome pode ir para o proxy
];
const GUARDADO = "assinador-serpro-endereco";
export const TUTORIAL_INSTALAR = "https://tutorial.assinadorserpro.estaleiro.serpro.gov.br/html/demo_3.html";
export const TUTORIAL_AUTORIZAR = "https://tutorial.assinadorserpro.estaleiro.serpro.gov.br/html/demo_53.html";


function tentar(url: string): Promise<WebSocket> {
  return new Promise((ok, falha) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (e) { falha(e); return; }
    const t = setTimeout(() => { try { ws.close(); } catch { /* */ } falha(new Error("sem resposta")); }, 5000);
    ws.onopen = () => { clearTimeout(t); ok(ws); };
    ws.onerror = () => { clearTimeout(t); falha(new Error("conexão recusada")); };
  });
}

/** Tenta os endereços do Assinador (primeiro o que funcionou da última vez). */
export async function conectar(registro?: (s: string) => void): Promise<WebSocket> {
  let preferido = "";
  try { preferido = localStorage.getItem(GUARDADO) ?? ""; } catch { /* */ }
  const ordem = [...new Set([preferido, ...ENDERECOS].filter(Boolean))];
  const falhas: string[] = [];
  for (const url of ordem) {
    try {
      const ws = await tentar(url);
      try { localStorage.setItem(GUARDADO, url); } catch { /* */ }
      return ws;
    } catch (e) {
      falhas.push(`${new URL(url.replace("wss:", "https:")).host}: ${e instanceof Error ? e.message : "falha"}`);
    }
  }
  registro?.(falhas.join(" · "));
  throw new Error("sem assinador");
}

/** Envia um comando ao Assinador e espera a resposta com o mesmo requestId. */
export function comando(ws: WebSocket, cmd: Record<string, unknown>, limiteMs = 5 * 60000): Promise<Record<string, unknown>> {
  return new Promise((ok, falha) => {
    const requestId = String(Date.now());
    const t = setTimeout(() => { ws.removeEventListener("message", ouvir); falha(new Error("O Assinador não respondeu a tempo.")); }, limiteMs);
    function ouvir(ev: MessageEvent) {
      let r: Record<string, unknown>;
      try { r = JSON.parse(String(ev.data)); } catch { return; }
      if (r.requestId !== undefined && String(r.requestId) !== requestId) return;
      clearTimeout(t);
      ws.removeEventListener("message", ouvir);
      ok(r);
    }
    ws.addEventListener("message", ouvir);
    ws.send(JSON.stringify({ ...cmd, requestId }));
  });
}


/** Pede ao Assinador para assinar um resumo (base64); devolve a assinatura, ou null se a pessoa cancelou. */
export async function assinarResumo(ws: { atual: WebSocket | null }, resumo: string): Promise<string | null> {
  if (!ws.atual || ws.atual.readyState !== WebSocket.OPEN) ws.atual = await conectar();
  const r = await comando(ws.atual, { command: "sign", type: "hash", inputData: resumo });
  if (r.actionCanceled) return null;
  if (r.error || !r.signature) throw new Error(`O Assinador SERPRO informou: ${String(r.error ?? "sem assinatura")}`);
  return String(r.signature);
}

/** Resumo aleatório, usado para o Assinador identificar o certificado na primeira assinatura. */
export async function resumoAleatorio() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", a))));
}
