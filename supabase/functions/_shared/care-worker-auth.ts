export function careSecretMatches(expected: string | undefined, provided: string | null) {
  if (!expected || expected.length < 32 || !provided || expected.length !== provided.length)
    return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return difference === 0;
}
