import { CustomerJobs } from "@/components/jobs/CustomerJobs";
export default function Loading() { return <CustomerJobs query={{ tab: "active", q: "", page: 1 }} data={null} loading />; }
