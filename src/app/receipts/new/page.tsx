import { ocrAvailability } from "@/lib/deployment";
import NewReceiptClient from "./new-receipt-client";

/**
 * A server component purely so the capture screen knows, before the user
 * picks a photo, whether this deployment offers automatic reading
 * (external review findings #9/#10).
 *
 * Read here rather than fetched from an effect on the client: the same
 * mistake in `GmailConnections.tsx` produced the
 * `react-hooks/set-state-in-effect` error that reached production, and
 * server-side configuration is exactly the kind of thing a server
 * component should hand down rather than a client re-derive.
 */
export default function NewReceiptPage() {
  return <NewReceiptClient ocr={ocrAvailability()} />;
}
