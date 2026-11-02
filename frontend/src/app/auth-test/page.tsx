'use client';

// NEAR Auth trial page (testnet). Checks that a real login works from this
// site and shows the NEAR account that login controls. Not part of the demo.

import { useEffect, useState } from 'react';

const RPC_URL = 'https://test.rpc.fastnear.com/';
const CLIENT_ID = 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl'; // shared testnet client, public
const FAST_AUTH_CONTRACT = 'fast-auth.testnet';
const MPC_CONTRACT = 'v1.signer-prod.testnet';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58ToHex(s: string): string {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('not base58');
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let lead = 0;
  while (s[lead] === '1') lead++;
  return '00'.repeat(lead) + hex;
}

// The SDK only needs `provider.query`, so a tiny JSON-RPC stand-in avoids
// pulling a second copy of near-api-js into the page.
const connection = {
  provider: {
    async query(params: Record<string, unknown>) {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'q', method: 'query', params }),
      });
      const json = await res.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json.result;
    },
  },
};

async function accountExists(accountId: string): Promise<boolean> {
  try {
    await connection.provider.query({ request_type: 'view_account', finality: 'final', account_id: accountId });
    return true;
  } catch {
    return false;
  }
}

type Info = { userId: string; publicKey: string; implicitAccount: string; exists: boolean };

async function makeClient() {
  const { JavascriptProvider } = await import('@fast-auth-near/javascript-provider');
  const { FastAuthClient } = await import('@fast-auth-near/browser-sdk');
  const provider = new JavascriptProvider({ network: 'testnet', clientId: CLIENT_ID });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new FastAuthClient(provider as any, connection as any, {
    fastAuthContractId: FAST_AUTH_CONTRACT,
    mpcContractId: MPC_CONTRACT,
  });
  return { provider, client };
}

async function readInfo(): Promise<Info | null> {
  const { provider, client } = await makeClient();
  if (!(await provider.isLoggedIn())) return null;
  const path = await provider.getPath();
  const signer = await client.getSigner();
  const publicKey = String(await signer.getPublicKey());
  const implicitAccount = base58ToHex(publicKey.replace(/^ed25519:/, ''));
  return {
    userId: path.split('#').pop() ?? '',
    publicKey,
    implicitAccount,
    exists: await accountExists(implicitAccount),
  };
}

export default function AuthTest() {
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState('Checking for an existing login…');
  const [error, setError] = useState('');

  useEffect(() => {
    readInfo()
      .then((i) => {
        setInfo(i);
        setStatus(i ? 'Logged in.' : 'Not logged in.');
      })
      .catch((e) => {
        setError(String(e?.message ?? e));
        setStatus('');
      });
  }, []);

  async function login() {
    setError('');
    setStatus('Opening the NEAR Auth login window…');
    try {
      const { client } = await makeClient();
      await client.login(); // popup
      setStatus('Login finished, reading your NEAR key…');
      const i = await readInfo();
      setInfo(i);
      setStatus(i ? 'Logged in.' : 'Login window closed without a session.');
    } catch (e) {
      const err = e as Error;
      setError(String(err?.message ?? e));
      setStatus('');
    }
  }

  async function logout() {
    const { provider } = await makeClient();
    await provider.logout({ logoutParams: { returnTo: window.location.href } });
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 28 }}>NEAR Auth test (testnet)</h1>
      <p style={{ color: '#555' }}>
        Trial page only. It checks that a real NEAR Auth login works from this site and shows the
        NEAR key and account that login controls. Nothing is sent or paid.
      </p>

      {!info && (
        <button onClick={login} style={{ fontSize: 20, padding: '12px 24px', marginTop: 12 }}>
          Log in with NEAR Auth
        </button>
      )}

      {status && <p style={{ fontSize: 18 }}>{status}</p>}
      {error && (
        <p style={{ color: '#b00020', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>Error: {error}</p>
      )}

      {info && (
        <div style={{ marginTop: 16, lineHeight: 1.6, wordBreak: 'break-all' }}>
          <p><b>Login ID</b> (from the login service): {info.userId}</p>
          <p><b>NEAR public key</b> (derived by the NEAR network&apos;s signers): {info.publicKey}</p>
          <p><b>NEAR account</b> (random-looking implicit account): {info.implicitAccount}</p>
          <p><b>Exists on testnet yet?</b> {info.exists ? 'yes' : 'no (the platform creates it by sending it a little NEAR)'}</p>
          <button onClick={logout} style={{ fontSize: 16, padding: '8px 16px' }}>Log out</button>
        </div>
      )}
    </main>
  );
}
