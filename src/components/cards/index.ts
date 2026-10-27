// Cards, tiles and rows (#76). How to use each one: docs/components/cards.md. Every variant and state:
// /dev/components/cards. The rules behind them (categories, initials, distances): src/lib/cards.ts.
export { CategoryRail, CategoryTile, type CategoryTileProps } from "./CategoryTile";
export { EmptyCard } from "./EmptyCard";
export { JobRow, type JobRowProps } from "./JobRow";
export { JobTile, type JobTileProps, type JobTileTag } from "./JobTile";
export { ProfileCard, type ProfileCardProps } from "./ProfileCard";
export { KpiCard, StatCard, StatStrip, type KpiCardProps, type StatStripProps } from "./StatCards";
export { CATEGORIES, type Category } from "@/lib/cards";
