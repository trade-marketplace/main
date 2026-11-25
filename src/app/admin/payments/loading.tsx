import { OfficePayments } from "@/components/office/OfficePayments";
import { parseOfficePaymentsQuery } from "@/lib/office-payments";

export default function Loading() {
  return <OfficePayments query={parseOfficePaymentsQuery({})} data={null} loading />;
}
