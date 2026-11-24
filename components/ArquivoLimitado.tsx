"use client";

/** Campo de arquivo que avisa, antes de enviar, quando o arquivo passa do limite (evita a tela de erro da hospedagem). */
export function ArquivoLimitado({ name, accept, limiteMb, required, className }: { name: string; accept: string; limiteMb: number; required?: boolean; className?: string }) {
  return (
    <input type="file" name={name} accept={accept} required={required} className={className}
      onChange={(e) => {
        const f = e.target.files?.[0];
        const msg = f && f.size > limiteMb * 1048576
          ? `O arquivo tem ${(f.size / 1048576).toFixed(1)} MB; o limite aqui é ${limiteMb} MB. Digitalize em resolução menor (ex.: 200 dpi, tons de cinza) ou reduza o PDF.` : "";
        e.target.setCustomValidity(msg);
        if (msg) e.target.reportValidity();
      }} />
  );
}
