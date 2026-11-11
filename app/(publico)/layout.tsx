import Image from "next/image";

export default function LayoutPublico({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-marinha to-[#0d1345] px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center text-white">
        <Image src="/brasao.png" alt="" width={148} height={192} priority className="h-[76px] w-auto" />
        <h1 className="mt-3 text-xl font-bold">Sistema de Controle de Notas Fiscais</h1>
        <p className="text-sm text-white/70">Depósito de Fardamento da Marinha no Rio de Janeiro</p>
      </div>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">{children}</div>
    </div>
  );
}
