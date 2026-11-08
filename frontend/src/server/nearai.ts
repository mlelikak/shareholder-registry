// NEAR AI Cloud private inference, with a check that each reply came from the
// attested enclave. Only non-streaming replies: streamed ones are signed by
// the gateway and don't link to a model attestation (checked Nov 1).

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

const BASE = 'https://cloud-api.near.ai/v1';
/** Runs inside a TEE (`verifiable: true` in /v1/model/list). Passed NEAR's verifier on Nov 1. */
export const MODEL = process.env.NEAR_AI_MODEL ?? 'z-ai/glm-5.3-flash';

/** True when a NEAR AI Cloud key is configured. Without one the demo still runs: plain templates replace the AI's words. */
export function hasApiKey(): boolean {
  try {
    apiKey();
    return true;
  } catch {
    return false;
  }
}

export const NO_KEY_NOTE = 'No NEAR AI Cloud key is set (NEAR_AI_API_KEY in .env), so this step used plain templates instead of the AI.';

function apiKey(): string {
  if (!process.env.NEAR_AI_API_KEY) {
    // Local runs: the key lives in the repo-root .env (git-ignored).
    for (const f of [join(/*turbopackIgnore: true*/ process.cwd(), '.env'), join(/*turbopackIgnore: true*/ process.cwd(), '..', '.env')]) {
      if (existsSync(f)) {
        process.loadEnvFile(f);
        break;
      }
    }
  }
  const key = process.env.NEAR_AI_API_KEY;
  if (!key) throw new Error('NEAR_AI_API_KEY is not set (see .env.example)');
  return key;
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Ethereum-style personal_sign recovery, as NEAR AI Cloud signs replies. */
export function recoverAddress(text: string, signature: string): string {
  const msg = Buffer.from(text, 'utf8');
  const prefixed = Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]);
  const digest = keccak_256(prefixed);
  const sig = Buffer.from(signature.replace(/^0x/, ''), 'hex');
  if (sig.length !== 65) throw new Error('signature must be 65 bytes');
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  const recovered = Buffer.concat([Buffer.from([v]), sig.subarray(0, 64)]);
  const compressed = secp256k1.recoverPublicKey(recovered, digest, { prehash: false });
  const full = secp256k1.Point.fromBytes(compressed).toBytes(false);
  return '0x' + hex(keccak_256(full.subarray(1)).subarray(12));
}

export type ReplyProof = {
  model: string;
  chatId: string;
  /** sha256 of the exact request and reply bytes, as signed by the enclave. */
  requestHash: string;
  responseHash: string;
  hashesMatch: boolean;
  signingAddress: string;
  signatureValid: boolean;
  signatureKind?: string;
  /** Filled in once per run by `attest`. */
  attested?: boolean;
};

export type Attestation = {
  model: string;
  nonce: string;
  signingAddress: string;
  /** Intel TDX quote: version 4, TEE type 0x81 (TDX). */
  quoteVersion: number;
  teeType: string;
  /** The quote's report data commits to this enclave key and our fresh nonce. */
  keyInQuote: boolean;
  nonceInQuote: boolean;
  nvidiaEvidence: boolean;
  fetchedAt: string;
};

export type ChatResult = { content: string; finishReason?: string; usage?: unknown; proof: ReplyProof };

/** One non-streaming chat call, then fetches and checks the enclave's signature. */
export async function chat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { maxTokens?: number; json?: boolean } = {},
): Promise<ChatResult> {
  const body = JSON.stringify({
    model: MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: 0.2,
    // This model 'thinks' before answering and can use up the whole budget doing so.
    reasoning_effort: 'low',
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  });
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`NEAR AI Cloud ${res.status}: ${raw.slice(0, 300)}`);
  const parsed = JSON.parse(raw);
  const content: string = parsed.choices?.[0]?.message?.content ?? '';

  const proof = await checkSignature(parsed.id, body, raw);
  return { content, finishReason: parsed.choices?.[0]?.finish_reason, usage: parsed.usage, proof };
}

async function checkSignature(chatId: string, requestBody: string, responseBody: string): Promise<ReplyProof> {
  const requestHash = sha256hex(requestBody);
  const responseHash = sha256hex(responseBody);
  let sig: { text?: string; signature?: string; signing_address?: string; signature_kind?: string } = {};
  // The signature can take a moment to be stored after the reply.
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${BASE}/signature/${chatId}?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    if (r.ok) {
      sig = await r.json();
      break;
    }
    await new Promise((ok) => setTimeout(ok, 1000 * (i + 1)));
  }
  const parts = (sig.text ?? '').split(':');
  const [reqH, resH] = parts.slice(-2);
  const hashesMatch = reqH === requestHash && resH === responseHash;
  let signatureValid = false;
  if (sig.text && sig.signature && sig.signing_address) {
    try {
      signatureValid = recoverAddress(sig.text, sig.signature).toLowerCase() === sig.signing_address.toLowerCase();
    } catch {
      signatureValid = false;
    }
  }
  return {
    model: MODEL,
    chatId,
    requestHash,
    responseHash,
    hashesMatch,
    signingAddress: (sig.signing_address ?? '').toLowerCase(),
    signatureValid,
    signatureKind: sig.signature_kind,
  };
}

/**
 * Fetches the model's attestation with a fresh random nonce and checks that the
 * Intel TDX quote binds the enclave's signing key and our nonce. The quote's
 * certificate chain and the NVIDIA evidence are checked with NEAR's open-source
 * verifier (README); this check ties each reply to the attested hardware.
 */
export async function attest(): Promise<Attestation[]> {
  const nonce = randomBytes(32).toString('hex');
  const r = await fetch(
    `${BASE}/attestation/report?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa&nonce=${nonce}`,
    // The attestation report is public (checked Nov 8), so it works without a key.
    hasApiKey() ? { headers: { Authorization: `Bearer ${apiKey()}` } } : {},
  );
  if (!r.ok) throw new Error(`attestation ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const report = await r.json();
  const list: Record<string, unknown>[] = report.model_attestations ?? report.all_attestations ?? [];
  return list.map((a) => {
    const quote = Buffer.from(String(a.intel_quote ?? ''), 'hex');
    const reportData = quote.length >= 632 ? quote.subarray(568, 632) : Buffer.alloc(64);
    const address = String(a.signing_address ?? '').replace(/^0x/, '').toLowerCase();
    return {
      model: MODEL,
      nonce,
      signingAddress: '0x' + address,
      quoteVersion: quote.length >= 2 ? quote.readUInt16LE(0) : 0,
      teeType: quote.length >= 8 ? '0x' + quote.readUInt32LE(4).toString(16) : '',
      keyInQuote: address.length === 40 && reportData.subarray(0, 32).toString('hex').startsWith(address),
      nonceInQuote: reportData.subarray(32).toString('hex') === nonce && a.request_nonce === nonce,
      nvidiaEvidence: Boolean(a.nvidia_payload),
      fetchedAt: new Date().toISOString(),
    };
  });
}

/** Marks each reply proof as attested if its signing key is in a checked quote. */
export function linkProofs(proofs: ReplyProof[], attestations: Attestation[]): void {
  const good = new Set(
    attestations.filter((a) => a.keyInQuote && a.nonceInQuote && a.teeType === '0x81').map((a) => a.signingAddress),
  );
  for (const p of proofs) p.attested = p.signatureValid && p.hashesMatch && good.has(p.signingAddress);
}
