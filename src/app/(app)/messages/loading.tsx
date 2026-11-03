import { SkeletonText } from "@/components/feedback";
export default function Loading() { return <section aria-label="Loading messages" role="status"><h1>Messages</h1><SkeletonText lines={4} /></section>; }
