/** Bounded page links, including both ends, without allocating an array for the whole result set. */
export function pagination(total: number, pageSize: number, requestedPage: number) {
  const size = Math.max(1, Math.floor(Number.isFinite(pageSize) ? pageSize : 25));
  const count = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  const pages = Math.max(1, Math.ceil(count / size));
  const page = Math.max(1, Math.min(pages, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1)));
  const numbers = [...new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  const links: (number | string)[] = [];
  for (const number of numbers) {
    const previous = links.at(-1);
    if (typeof previous === "number" && number - previous > 1) links.push(`gap-${previous}`);
    links.push(number);
  }
  return { page, pages, links, start: count ? (page - 1) * size + 1 : 0, end: Math.min(page * size, count), total: count };
}
