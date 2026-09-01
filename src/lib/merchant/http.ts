import { NextResponse } from "next/server";
import {
  LastOwnerError,
  MerchantConflictError,
  MerchantForbiddenError,
  MerchantNotFoundError,
} from "./types";

/**
 * Phase 3 Session 1. The one place the merchant service's typed errors are
 * turned into HTTP responses, so every route maps them the same way: a
 * non-member sees 404 (never 403), an under-privileged member sees 403, a
 * taken name or last-owner action sees 409. Anything unrecognised is
 * re-thrown so it surfaces as a real 500 rather than being swallowed as a
 * misleading 4xx.
 */
export function merchantErrorResponse(error: unknown): NextResponse {
  if (error instanceof MerchantForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof MerchantNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof MerchantConflictError || error instanceof LastOwnerError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
}
