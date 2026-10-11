"use client";
import { startTransition, useEffect, useState, type FormEvent } from "react";

/**
 * Submit a useActionState form without React 19's automatic form reset, so what someone
 * typed is still there when the server says something is wrong. Use it alongside the form's
 * `action` prop, never instead of it: before hydration the server-rendered action still POSTs
 * (a form with only onSubmit would fall back to a GET and put every field in the URL).
 */
export const keepValues = (dispatch: (fd: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const submitter = (e.nativeEvent as SubmitEvent).submitter;
  const fd = new FormData(e.currentTarget, submitter);
  startTransition(() => dispatch(fd));
};

/**
 * False until the page has hydrated. Forms that submit only through onSubmit keep their submit
 * button disabled until then, so an early Enter or click can't fall back to a native submit.
 */
export function useHydrated(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}
