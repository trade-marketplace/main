import { OfficeReviews } from "@/components/office/OfficeReviews";
export default function Loading() { return <OfficeReviews query={{ tab: "all", q: "", page: 1 }} data={null} loading />; }
