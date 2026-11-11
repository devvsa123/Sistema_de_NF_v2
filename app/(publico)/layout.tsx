import Image from "next/image";

export default function LayoutPublico({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-[#0b1736] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "22px 22px" }} />
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <Image src="/brasao.png" alt="" width={148} height={192} priority className="h-14 w-auto" />
          <div className="leading-tight text-white">
            <p className="text-sm font-medium text-slate-300">Marinha do Brasil</p>
            <p className="text-lg font-semibold">Depósito de Fardamento da Marinha no Rio de Janeiro</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">Sistema de Controle de Notas Fiscais</h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            Recebimento, perícia, contagem, estocagem e controle das notas fiscais de fornecimento, com acompanhamento de prazos e indicadores de desempenho.
          </p>
        </div>
        <p className="relative text-xs text-slate-500">Acesso restrito a usuários autorizados.</p>
      </aside>
      <main className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Image src="/brasao.png" alt="" width={148} height={192} priority className="h-12 w-auto" />
            <div className="leading-tight">
              <p className="text-base font-semibold text-slate-900">Controle de Notas Fiscais</p>
              <p className="text-xs text-slate-500">Depósito de Fardamento da Marinha no RJ</p>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
