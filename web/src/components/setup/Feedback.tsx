export function Feedback({ error }: { error: string | null }) {
  return error === null ? null : <p className="text-danger text-sm mt-3">{error}</p>;
}
