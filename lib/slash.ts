// Did the user type `name` as a slash command? The one rule both hooks share: the
// routing hook promotes slash-typed skills into the invoke band, and the gate always
// lets them through. The slash must open a token (start of the prompt, or after
// whitespace or an opening bracket or quote), so a path like reports/pdf doesn't
// count, and the name must end at a word boundary, so /docs doesn't match /docs-site.
// Plain prose never counts: "our docs" is not /docs.
export function typedSlash(prompt: string, name: string): boolean {
  const text = prompt.toLowerCase()
  const needle = `/${name.toLowerCase()}`
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1]
    const after = text[at + needle.length]
    const opens = before === undefined || /[\s(["'`]/.test(before)
    const ends = after === undefined || !/[a-z0-9:_-]/.test(after)
    if (opens && ends) return true
  }
  return false
}
