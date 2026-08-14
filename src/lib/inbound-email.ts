export type InboundEmail = {
  provider: "postmark";
  providerMessageId: string;
  mailboxToken: string;
  from: string;
  subject: string | null;
  text: string;
};
