import { OfficeSupportInbox } from "@/components/office/OfficeSupport";
import { parseOfficeSupportQuery } from "@/lib/office-support";
export default function Loading() { return <OfficeSupportInbox query={parseOfficeSupportQuery({})} data={null} loading />; }
