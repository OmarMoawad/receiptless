import { createRealGmailApiClient, type GmailApiClient } from "./gmail-client";
import { htmlToText } from "./html-to-text";
import { readGmailOAuthConfig } from "./gmail-connection";

/**
 * Builds the real network-backed client from environment configuration.
 * Kept apart from gmail-client.ts so tests import the interface and their
 * own fake without ever pulling in credential reading.
 */
export function createConfiguredGmailApiClient(): GmailApiClient | null {
  const config = readGmailOAuthConfig();
  if (!config) return null;
  return createRealGmailApiClient({ ...config, htmlToText });
}
