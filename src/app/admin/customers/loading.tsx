import { OfficeCustomers } from "@/components/office/OfficeCustomers";
export default function Loading() { return <OfficeCustomers query={{ q: "", page: 1, sort: { key: "joined", direction: "desc" } }} data={null} loading />; }
