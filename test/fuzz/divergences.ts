/**
 * Documented native-vs-DOMPurify divergences the fuzzer tolerates. Every entry
 * names a reason a reviewer can read in docs/review/known-divergences.md; an
 * unexplained difference is a failure, never an entry here. (D1 and D2, found by
 * this fuzzer, were FIXED in src/sanitize/dompurify.ts rather than listed.)
 */
export const DIVERGENCE_OVERREMOVAL = "D3 DOMPurify mXSS heuristic over-removes an element (fail-safe)";

function isSubsequence(small: string, big: string): boolean {
  let j = 0;
  for (let i = 0; i < big.length && j < small.length; i++) if (big[i] === small[j]) j++;
  return j === small.length;
}

/** True when the input contains a comment-like token: `<!`, `<?`, or `</` followed by a non-letter. */
function hasCommentLike(input: string): boolean {
  for (let i = 0; i + 2 < input.length; i++) {
    if (input[i] !== "<") continue;
    const next = input[i + 1]!;
    if (next === "!" || next === "?") return true;
    if (next === "/" && !/[a-zA-Z]/.test(input[i + 2]!)) return true;
  }
  return false;
}

/**
 * D3: DOMPurify removes an element whose text contains `<x` when the element's
 * serialization also contains markup-looking text (for example an in-element
 * comment from `</ >`). The native engine keeps it. Tolerated only when DOMPurify's
 * text is a subsequence of native's (it removed, never added) and the input has a
 * comment-like token.
 */
export function divergenceReason(input: string, native: DocumentFragment, dompurify: DocumentFragment): string | undefined {
  const a = native.textContent ?? "";
  const b = dompurify.textContent ?? "";
  if (hasCommentLike(input) && b.length < a.length && isSubsequence(b, a)) return DIVERGENCE_OVERREMOVAL;
  return undefined;
}
