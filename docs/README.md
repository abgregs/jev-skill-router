# Documentation

Everything past the [project README](../README.md): how to install and tune the router,
how it works, what the evals show, and what we learned building it.

| Section | What's in it |
|---|---|
| [Guide](guide/README.md) | Install, configure, and use the router day to day: plugin and CLI setup, `.skillrouter.json`, the `route` and `doctor` commands, the Claude Code hooks. |
| [Architecture](architecture/README.md) | How a routing decision is made (judge every skill in parallel, then plain-code policy) and where the code lives. |
| [Evaluation](evaluation/README.md) | The recorded results the repo stands behind, their caveats, and how to capture new runs. |
| [Findings](findings/README.md) | Numbered write-ups of what the recorded runs and development sessions taught us. |

> [!IMPORTANT]
> Routing-quality claims come only from the recorded runs in
> [Evaluation → Results](evaluation/results.md). Development runs (`bench/results/`) and
> findings marked *development finding* explain design decisions; they are not results for
> the released router.
