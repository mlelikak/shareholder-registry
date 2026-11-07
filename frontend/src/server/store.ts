// Off-chain demo state: the cast's testnet keys and names, the demo inbox and
// the agent's readable log. Kept in a git-ignored folder. Names and emails live
// only here, never on-chain.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.DEMO_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), '.demo');

export type KeyedAccount = { accountId: string; privateKey: string };

export type CastMember = KeyedAccount & {
  key: string; // short id: maria, tom, ...
  name: string;
  email: string;
  phone: string;
  helperOf?: string;
};

export type Deployment = {
  createdAt: string;
  funder: string;
  registry: string;
  token: string;
  companyId: string;
  companyName: string;
  eventId: string;
  total: string;
  /** Role accounts. Full-access keys stay with the platform's seed tooling. */
  admin: KeyedAccount;
  kyc: KeyedAccount;
  verifier: KeyedAccount;
  reviewer: KeyedAccount;
  payoutService: KeyedAccount;
  /** The agent account has only a restricted function-call key; this is it. */
  agent: KeyedAccount & { allowedMethods: string[] };
  /** Demo only: an unrelated account used by the attacker panel. */
  attacker?: KeyedAccount;
  cast: CastMember[];
};

export type InboxMessage = {
  id: string;
  at: string;
  channel: 'email' | 'text' | 'letter' | 'helper';
  to: string; // cast key
  toName: string;
  subject?: string;
  body: string;
  from: 'agent' | 'platform';
};

export type AgentLogEntry = {
  id: string;
  at: string;
  runId: string;
  kind: 'report' | 'finding' | 'proposal' | 'message' | 'chain' | 'attestation' | 'refusal' | 'error';
  holder?: string; // cast key
  title: string;
  detail?: string;
  /** sha256 of `detail`, written on-chain by log_agent_action where applicable. */
  summaryHash?: string;
  txHash?: string;
  data?: unknown;
};

function file(name: string) {
  mkdirSync(DIR, { recursive: true });
  return join(DIR, name);
}

function readJson<T>(name: string, fallback: T): T {
  const f = file(name);
  if (!existsSync(f)) return fallback;
  return JSON.parse(readFileSync(f, 'utf8')) as T;
}

function writeJson(name: string, value: unknown) {
  writeFileSync(file(name), JSON.stringify(value, null, 2));
}

export const loadDeployment = (): Deployment => {
  const d = readJson<Deployment | null>('deployment.json', null);
  if (!d) throw new Error('No demo deployment yet: run the seed script first.');
  return d;
};
export const saveDeployment = (d: Deployment) => writeJson('deployment.json', d);

export const loadInbox = () => readJson<InboxMessage[]>('inbox.json', []);
export const saveInbox = (m: InboxMessage[]) => writeJson('inbox.json', m);
export function addToInbox(message: InboxMessage) {
  const all = loadInbox();
  all.push(message);
  saveInbox(all);
}

export const loadAgentLog = () => readJson<AgentLogEntry[]>('agent-log.json', []);
export const saveAgentLog = (e: AgentLogEntry[]) => writeJson('agent-log.json', e);
export function appendAgentLog(entries: AgentLogEntry[]) {
  saveAgentLog([...loadAgentLog(), ...entries]);
}

export function resetDemoState() {
  saveInbox([]);
  saveAgentLog([]);
  writeJson('profiles.json', {});
  writeJson('deliveries.json', []);
}

/** Small off-chain JSON files next to the demo state (e.g. profiles). */
export const readJsonFile = readJson;
export const writeJsonFile = writeJson;
