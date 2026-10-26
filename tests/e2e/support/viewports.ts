// The widths every screen must work at (AGENTS.md §3). Heights are typical for each size.
export const VIEWPORTS = [
  { name: "phone-small", width: 320, height: 640 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
