import { cn } from "@/components/ui/cn";

const MARK_PATH = "M599.0 991.4C553.3 947.7 528.3 932.5 460.5 907.0C382.4 877.6 349.3 861.0 316.0 834.3C243.6 776.3 205.2 674.1 209.5 551.2C210.5 523.5 209.7 524.2 235.0 526.6C402.0 542.3 474.6 564.5 527.4 615.9C541.2 629.5 553.7 645.6 564.6 664.0L572.4 677.2L573.7 669.6C587.1 590.6 637.3 506.7 725.8 415.9C731.5 410.0 735.8 405.0 735.3 404.7C734.4 404.1 709.1 397.0 688.5 391.5C665.2 385.2 659.7 380.6 661.3 368.8C662.6 359.3 669.7 354.9 756.0 311.6C841.7 268.6 849.8 264.8 858.0 264.2C869.5 263.4 878.6 269.3 882.6 280.3C884.0 284.0 884.3 297.0 884.7 381.5C885.2 491.6 885.8 483.2 876.9 487.8C868.1 492.4 864.0 490.2 838.5 467.0L818.6 448.8L807.6 460.7C801.5 467.2 779.2 490.1 758.0 511.5C721.1 548.9 699.8 572.0 689.3 586.0C650.0 638.2 628.1 690.0 620.5 748.3C617.4 772.1 617.0 795.1 617.7 899.0C618.3 996.0 618.1 1007.0 616.1 1007.0C615.7 1007.0 608.0 1000.0 599.0 991.4ZM636.6 1005.4C635.7 1003.0 637.7 991.8 640.6 983.8C646.2 968.3 653.1 956.5 680.9 914.5C692.3 897.5 706.9 875.0 713.5 864.5C746.3 812.2 765.8 787.1 800.4 752.4C838.9 713.9 883.5 680.5 931.4 654.3L939.5 649.9L930.5 650.5C889.6 653.4 839.3 670.5 801.2 694.4C782.3 706.3 768.1 717.7 751.0 734.9C719.1 766.9 695.4 802.2 659.4 871.5L649.5 890.5L648.7 879.0C647.7 865.3 648.5 816.4 650.0 799.5C658.7 698.8 700.1 623.5 768.5 584.1C817.6 555.8 880.4 540.6 999.2 528.5C1029.7 525.4 1039.3 525.3 1041.8 527.8C1045.5 531.5 1045.6 591.9 1042.0 624.6C1034.7 690.6 1011.3 751.7 976.3 795.7C940.0 841.5 892.1 871.0 799.0 905.0C728.0 930.9 701.6 947.0 652.7 993.8C638.2 1007.6 637.6 1008.0 636.6 1005.4ZM578.7 916.2C576.8 854.6 560.7 807.1 526.0 760.5C481.5 700.9 399.1 656.1 323.4 650.5L314.5 649.8L325.5 656.2C439.9 723.0 509.3 797.3 569.1 917.3C574.3 927.6 578.7 936.0 578.9 936.0C579.1 936.0 579.0 927.1 578.7 916.2Z";

/**
 * The GrowTendril sprout-and-arrow mark. Inherits colour via currentColor.
 * `grow` plays the sprout rising into place once; `sway` keeps it gently moving (loaders, empty states).
 */
export function LogoMark({ size = 24, className, grow, sway }: { size?: number; className?: string; grow?: boolean; sway?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="200 208 854 854" className={cn("shrink-0", !/(^|\s)text-/.test(className ?? "") && "text-ink", sway && "logo-sway", className)} aria-hidden>
      <path d={MARK_PATH} fill="currentColor" className={grow ? "logo-grow" : undefined} />
    </svg>
  );
}

export function Logo({ className, size = 26, grow, wordmark = true }: { className?: string; size?: number; grow?: boolean; wordmark?: boolean }) {
  return (
    <span className={cn("group/logo inline-flex items-center gap-2", className)}>
      <LogoMark size={size} grow={grow} className="text-accent transition-transform duration-500 ease-[cubic-bezier(0.3,1.6,0.5,1)] group-hover/logo:-translate-y-0.5 group-hover/logo:rotate-[-8deg] group-hover/logo:scale-110" />
      {wordmark && <span className="display text-[18px] font-semibold tracking-[-0.01em] text-ink transition-[font-variation-settings] group-hover/logo:[font-variation-settings:'BNCE'_80,'INFM'_60]">GrowTendril</span>}
    </span>
  );
}

/** Full-bleed brand loader: the sprout rises, then breathes while we wait. */
export function GrowthLoader({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center justify-center gap-4 py-16", className)}>
      <div className="relative grid size-20 place-items-center">
        <span className="absolute inset-0 rounded-full bg-accent/10" style={{ animation: "ring-out 2s ease-out infinite" }} />
        <span className="absolute inset-0 rounded-full bg-accent/10" style={{ animation: "ring-out 2s ease-out 1s infinite" }} />
        <LogoMark size={44} grow sway className="text-accent" />
      </div>
      <span className="display text-[15px] text-ink-3">{label}…</span>
    </div>
  );
}
