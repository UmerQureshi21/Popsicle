"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";
import Compose from "@/components/compose/Compose";

const subscribe = () => () => {};

// Each popsicle fills the space beside the 48rem compose card, minus a 3rem gap on each side.
const POP_WIDTH = "min(340px, calc((100vw - 48rem - 6rem) / 2))";

export default function ComposePage() {
  // The draft lives in localStorage, so render the editor only in the browser.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  return (
    <main className="relative min-h-screen bg-paper pt-[calc(53px+env(safe-area-inset-top))] pb-[calc(60px+env(safe-area-inset-bottom))] sm:bg-cloud sm:px-4 sm:pt-28 sm:pb-16">
      <div aria-hidden className="pointer-events-none fixed inset-0 hidden items-center justify-center gap-12 xl:flex">
        <Image src="/left-pop.png" alt="" width={500} height={500} priority className="h-auto -rotate-6" style={{ width: POP_WIDTH }} />
        <div className="w-full max-w-3xl shrink-0" />
        <Image src="/right-pop.png" alt="" width={500} height={500} priority className="h-auto rotate-6" style={{ width: POP_WIDTH }} />
      </div>
      <div className="relative">{mounted && <Compose />}</div>
    </main>
  );
}
