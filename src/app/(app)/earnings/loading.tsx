import { Earnings } from "@/components/earnings/Earnings";

// While the page's data is on its way (navigating to Earnings): the skeleton in the page's own layout.
export default function Loading() {
  return <Earnings view={null} loading />;
}
