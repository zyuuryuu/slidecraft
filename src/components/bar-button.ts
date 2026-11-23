/**
 * bar-button.ts — 上部バーのボタン（shadcn/ui の Button）に共通で足す class（#724 段 1 PR-A）。
 * Toolbar・SettingsMenu（⚙）・MasterPicker（🎨）の 3 か所で同じ見た目にするため、ここ 1 か所に置く。
 * 高さは Button の既定（h-8 = 32px・記号だけのボタンは size="icon" の 32px 四方）が、以前の手製ボタン
 * （text-sm の行高 20px ＋ py-1.5）の実測 32px と同じなので上書きしない。
 */
/** 二次ボタン（bg-edge）のホバー: アプリの他のボタンと同じ accent/40（shadcn の既定は fg を 5% 混ぜる）。 */
export const BAR_HOVER = "hover:bg-accent/40";
/** Tooltip が開くまでの遅延（ms）。main.tsx の TooltipProvider 1 つで、上部バーと原稿入力ダイアログの 🎨 に効く。 */
export const BAR_TOOLTIP_DELAY = 400;
