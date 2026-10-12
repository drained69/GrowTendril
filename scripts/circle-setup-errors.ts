/** Circle reports an already registered entity secret with HTTP 409 or code 156015. */
export function entitySecretAlreadyRegistered(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const response = "response" in error ? error.response : null;
  if (!response || typeof response !== "object") return false;
  const status = "status" in response ? response.status : null;
  const data = "data" in response ? response.data : null;
  const code = data && typeof data === "object" && "code" in data ? data.code : null;
  return status === 409 || code === 156015 || code === "156015";
}
