import { OfficeQueues } from "@/components/office/OfficeQueues";
import { parseQueueQuery } from "@/lib/office-queues";
export default function Loading() { return <OfficeQueues query={parseQueueQuery({})} data={null} loading />; }
