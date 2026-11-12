"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { DataTable, FilterBar, Pagination, TableItem, type Column } from "@/components/data";
import { EmptyState, ErrorState } from "@/components/feedback";
import { OfflineBanner } from "@/components/feedback/OfflineBanner";
import { CUSTOMER_PAGE_SIZE, customerJobsHref, customersHref, type CustomersPage, type CustomersQuery, type OfficeCustomer } from "@/lib/office/customers";
import styles from "./customers.module.css";
const when = (date: string) => new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium" }).format(new Date(date));
const columns: Column<OfficeCustomer>[] = [
  { key: "name", header: "Name", primary: true, sortable: true, cell: row => <TableItem title={row.name} href={customerJobsHref(row.id)} /> },
  { key: "email", header: "Email", cell: row => <TextLink href={`mailto:${row.email}`} className={styles.contact}>{row.email}</TextLink> },
  { key: "mobile", header: "Mobile", optional: true, cell: row => row.mobile ? <TextLink href={`tel:${row.mobile}`} className={styles.contact}>{row.mobile}</TextLink> : "—" },
  { key: "suburb", header: "Suburb", optional: true, cell: row => row.suburb || "—" },
  { key: "jobs", header: "Jobs", align: "end", sortable: true, firstSort: "desc", sortLabels: ["Fewest first", "Most first"], cell: row => row.jobs },
  { key: "lastJob", header: "Last job", optional: true, sortable: true, firstSort: "desc", sortLabels: ["Oldest first", "Newest first"], nowrap: true, cell: row => row.lastJobAt ? <time dateTime={row.lastJobAt}>{when(row.lastJobAt)}</time> : "—" },
  { key: "joined", header: "Joined", sortable: true, firstSort: "desc", sortLabels: ["Oldest first", "Newest first"], nowrap: true, cell: row => <time dateTime={row.joinedAt}>{when(row.joinedAt)}</time> },
];
export function OfficeCustomers({ query, data, base = "/admin/customers", loading = false, offline = false }: { query: CustomersQuery; data: CustomersPage | null; base?: string; loading?: boolean; offline?: boolean }) {
  const router = useRouter(), [pending, startTransition] = useTransition(), [q, setQ] = useState(query.q), [lastQ, setLastQ] = useState(query.q), latest = useRef(query), typed = useRef(false);
  if (query.q !== lastQ) { setLastQ(query.q); setQ(query.q); }
  useEffect(() => { latest.current = query; }, [query]);
  function go(next: Partial<CustomersQuery>, replace = false) { latest.current = { ...latest.current, page: 1, ...next }; startTransition(() => (replace ? router.replace : router.push)(customersHref(latest.current, base), { scroll: false })); }
  useEffect(() => {
    if (!typed.current || q.trim() === latest.current.q) return;
    const timer = setTimeout(() => go({ q: q.trim() }, true), 300); return () => clearTimeout(timer);
    // Only typing starts a search; go reads the latest URL state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  function clear() { typed.current = false; setQ(""); go({ q: "" }); }
  return <section className={styles.page} data-mode="office"><h1 className={styles.title}>Customers</h1><OfflineBanner online={offline ? false : undefined} sticky={false} />
    <FilterBar label="Filter customers" search={{ label: "Search customers", placeholder: "Search", value: q, onChange: value => { typed.current = true; setQ(value); } }} filters={[]} values={{}} onChange={() => {}} onClear={clear} />
    <DataTable caption="Customers" columns={columns} rows={data?.rows ?? []} rowId={row => row.id} rowLabel={row => row.name} rowHref={row => customerJobsHref(row.id)} sort={query.sort} onSortChange={sort => go({ sort })} loading={loading || pending} loadingLabel="Loading customers"
      error={!data && !loading ? <ErrorState title="Couldn’t load customers" message="Try again." onRetry={() => startTransition(() => router.refresh())} headingLevel={2} /> : undefined}
      empty={<EmptyState icon={query.q ? "search_off" : "group"} title={query.q ? "No customers match that." : "No customers yet."} headingLevel={2} action={query.q ? <Button variant="secondary" onClick={clear}>Clear search</Button> : undefined} />}
      footer={data && data.total > 0 ? <Pagination label="Customers" page={data.query.page} pageSize={CUSTOMER_PAGE_SIZE} total={data.total} getHref={page => customersHref({ ...query, page }, base)} /> : undefined} />
  </section>;
}
