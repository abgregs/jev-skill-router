# TypeSafe Determinism Claim Verification

**Question:** Does TypeSafe's official documentation make any claim resembling "given identical input state data and identical option definitions, repeat calls return the exact same numerical probabilities"?

**Date of research:** 2026-09-26

---

## Sources Checked

### 1. Local SDK package — `/Users/abgregs/Developer/jev-skill-router/node_modules/@typesafe-ai/sdk/`

Files examined:
- `README.md`
- `dist/index.d.mts` (full JSDoc for all exported types and functions)
- `package.json`

Grep for: `determinis`, `identical`, `repeat`, `reproduc`, `consisten`, `stable`, `same probabilit`, `exact`, `temperature`, `sampling`, `precision`

**Result: zero matches.** The README is a 12-line quickstart with no behavioral claims. The type declarations contain no JSDoc language about determinism, reproducibility, or numerical precision. The only quantitative language in the declarations describes field ranges (e.g., `/** Probability of a yes answer, from zero to one. */`).

---

### 2. Live docs — `https://docs.typesafe.ai`

**`https://docs.typesafe.ai/introduction.md`**
No claims about determinism, identical inputs, reproducibility, temperature, or sampling.

**`https://docs.typesafe.ai/primitives/noul.md`**
No claims about determinism, identical inputs, reproducibility, temperature, or sampling. Only mentions a self-consistency cookbook as a link.

**`https://docs.typesafe.ai/concepts/system-one.md`**
One statement: "Calibration is measured across groups of predictions; it does not guarantee that an individual answer is correct." This hedges against per-prediction guarantees; does not claim exact determinism.

**`https://docs.typesafe.ai/confidence.md`**
No claims about determinism, reproducibility, temperature, or sampling.

**`https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md`**  
Contains the strongest official claim found across all sources:

> "System One is designed to return stable answers across repeated evaluations. See the [self-consistency cookbook](/cookbooks/consistency_noul_cookbook)."

This appears under a "Self-consistent" property card in the "What makes System One composable" section. It is a *design intent* statement (the word "designed") about *stable* (not *identical*) answers; it does not assert exact numerical reproducibility.

**`https://docs.typesafe.ai/model-jaggedness/jev-1.13.md`**  
Contains two exact quotes:

> "jev-1.13 is extremely consistent, meaning you should expect quantitatively similar outputs for semantically similar inputs."

> "there are many structural invariants one might imagine to hold that simply aren't guaranteed by the model."

The first claim uses "quantitatively similar" (not "identical") and applies to "semantically similar inputs" (not "byte-identical inputs"). The second claim is an explicit disclaimer that structural invariants are not guaranteed.

**`https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook`**  
This page directly addresses run-to-run variance. Key verbatim quotes:

> "the LLM answers move from run to run, at temperature `0` too, and on the judgment calls the models disagree with *themselves*."

> "TypeSafe's mean per-question probability standard deviation is `0.0102`, below all LLM probability conditions here."

The second quote is the only place TypeSafe publishes a quantified variance figure. A standard deviation of 0.0102 over the test sample is precisely consistent with the ±0.01 variance observed empirically in this project. This page is about TypeSafe's *relative* consistency advantage over LLMs, not about absolute zero variance.

---

### 3. Live marketing — `https://typesafe.ai`

The homepage FAQ lists the question **"Is Jev deterministic?"** but the answer is rendered in a JavaScript-expanded accordion; the text is not returned by any fetch method attempted. No URL at `typesafe.ai/faq` or fragment `#faq` returns the answer body.

The homepage marketing copy includes:
- "reliable, fast, and type-safe" (general)
- "self-consistent" (general)
- "More consistent: returns similar answers for similar inputs." (from the introductory blog post at `typesafe.ai/blog/introducing-system-one-models-and-jev`)

None of these are the target claim.

---

### 4. Web search — third-party sources

**`https://aiagentskit.com/blog/how-to-use-typesafe-ai-jev/`**  
A third-party blog post (not TypeSafe's own documentation) contains:

> "Jev eliminates conversational sampling, generating mathematically deterministic results across identical inputs."

This is the strongest exact-determinism claim found in any source — but it appears in a third-party tutorial blog, not in TypeSafe's official documentation, SDK, or API reference. The same page also claims "100% deterministic reproducibility" in a testing context. These claims are not sourced to TypeSafe's own docs and appear to be the author's characterization of the architecture.

**`https://www.mindstudio.ai/blog/jev-system-one-model-launch`**  
> "Typesafe frames this as being closer to how software behaves: deterministic, fast, and less prone to the kind of open-ended improvisation that leads to hallucination"

Frames determinism as a general design philosophy comparison, not a precise numerical claim. Third-party article.

**`https://gist.github.com/pjburnhill/adf8d28efcad9df037bfdece178ef965`**  
Third-party reference document. Does not claim exact numerical determinism; frames Jev as probabilistic with calibration.

**`https://anthonymaio.substack.com/p/jev-the-language-model-that-wont`**  
Independent analysis, September 2026. Explicitly warns against over-reading determinism:
> "It does nothing to stop the model from picking the wrong option, misreading the evidence, or assigning an unjustifiably high probability to a bad answer."

---

## Conclusion

**Classification: (b) — a softer "consistency/stability" claim exists in official documentation; no exact-determinism claim (a) was found in any primary source.**

TypeSafe's official documentation makes exactly one property statement relevant to run-to-run consistency: "System One is *designed* to return *stable* answers across *repeated* evaluations" (`docs.typesafe.ai/concepts/how-to-build-with-system-one.md`). This is weaker than a determinism claim in three distinct ways: (1) "designed to" is intent, not a guarantee; (2) "stable" means low variance, not zero variance; (3) it is silent on exact numerical values. The jaggedness page further undercuts any strict reading: "quantitatively *similar* outputs for semantically *similar* inputs." The self-consistency cookbook quantifies the actual variance (mean σ = 0.0102 per question), which is consistent with, not in contradiction to, the empirically observed ±0.01 range. The exact-determinism claim ("mathematically deterministic results across identical inputs") appears only in a third-party blog post (`aiagentskit.com`) with no citation to a primary TypeSafe source. The official FAQ lists "Is Jev deterministic?" as a question but the answer body could not be retrieved (JavaScript-rendered accordion). No TypeSafe-authored primary source — SDK, type declarations, docs pages, or API reference — makes a claim resembling "given identical input state data and identical option definitions, repeat calls return the exact same numerical probabilities."
