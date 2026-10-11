export interface StructuredResult<T> {
  data: T | null;
  error?: string;
}
