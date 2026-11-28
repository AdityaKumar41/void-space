'use client';
import { useEffect, useState } from 'react';
/** Credential forms stay inert until their submit handler is attached. */
export function useClientReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}
