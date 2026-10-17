import { shellQuote } from "../../packages/alchemy-nest/src/ssh.ts";

export const mailboxCliEnvironment = (input: {
  readonly home: string;
  readonly serviceDid: string;
  readonly workerUrl: string;
}) =>
  `export RAT_KING_DOCUMENTS=${shellQuote(`${input.home}/.config/rat-king/proof.documents.json`)}\nexport RAT_KING_ENDPOINT=${shellQuote(input.workerUrl)}\nexport RAT_KING_SERVICE_DID=${shellQuote(input.serviceDid)}\n`;
