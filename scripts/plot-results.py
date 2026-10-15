#!/usr/bin/env python3
"""Regenerate README charts: Python 3 + matplotlib==3.10.8."""
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "results"
rows = json.loads((DATA / "comparison.json").read_text())["configurations"]
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "svg.fonttype": "none"})
colors = ["#64748b", "#64748b", "#0891b2", "#0891b2", "#63836d"]
labels = [r["chartLabel"] for r in rows]
fig, axes = plt.subplots(1, 3, figsize=(16, 4.6), layout="constrained")
for ax, key, title, unit in zip(
    axes,
    ["prefillTps", "generationTps", "agenticSeconds"],
    ["Prefill at largest default prompt ↑", "Generation ↑", "Agentic completion time ↓"],
    ["tokens / second", "tokens / second", "seconds"],
):
    values = [r[key] for r in rows]
    bars = ax.barh(labels, values, color=colors)
    ax.invert_yaxis()
    ax.bar_label(bars, labels=[f"{v:,.1f}" for v in values], padding=4)
    ax.set_xlim(0, max(values) * 1.24)
    ax.set_xlabel(unit)
    ax.set_title(title, loc="left", weight="bold", fontsize=11)
    ax.set_axisbelow(True)
    ax.grid(axis="x", alpha=0.18)
    ax.spines[["top", "right", "left"]].set_visible(False)
fig.suptitle("Local model stacks · historical runs + Ryzen LFM2.5 (2026-10-15)", weight="bold", fontsize=14)
fig.get_layout_engine().set(rect=(0, 0.09, 1, 0.86))
fig.text(0.01, 0.025, "Model, backend, quantization and reasoning differ. Agentic completion is self-reported; functional correctness was not graded.", fontsize=9)
fig.savefig(DATA / "comparison.svg", metadata={"Date": None})
plt.close(fig)

run = json.loads((DATA / "2026-10-15-ryzen-lfm2.5-24b" / "cli.json").read_text())
sweep = [r for r in run["results"] if r["phase"] == "concurrent"]
fig, axes = plt.subplots(1, 2, figsize=(11, 4), layout="constrained")
x = [r["slots"] for r in sweep]
axes[0].plot(x, [r["aggTps"] for r in sweep], "o-", color="#63836d", label="Aggregate output")
axes[0].set_ylim(0, 180)
axes[0].set_ylabel("tokens / second")
axes[0].set_title("Throughput stays flat")
axes[1].plot(x, [r["ttftMs"] / 1000 for r in sweep], "o-", color="#0891b2", label="Median TTFT")
axes[1].plot(x, [r["ttftMaxMs"] / 1000 for r in sweep], "o--", color="#64748b", label="Maximum TTFT")
axes[1].set_ylabel("seconds to first token")
axes[1].set_title("Queueing increases latency")
for ax in axes:
    ax.set_xlabel("Requests in flight")
    ax.set_xticks(x)
    ax.grid(alpha=0.18)
    ax.legend(frameon=False)
    ax.spines[["top", "right"]].set_visible(False)
fig.suptitle("Ryzen / RX 7900 XT · LFM2.5 · observed streaming overlap: 1.0", weight="bold")
fig.savefig(DATA / "ryzen-lfm2.5-concurrency.svg", metadata={"Date": None})
plt.close(fig)

budget_file = DATA / "verified-budget-comparison.json"
if budget_file.exists():
    budgets = json.loads(budget_file.read_text())["runs"]
    tasks = ["money-split", "csv-parser", "ticket-triage"]
    names = ["Bill splitting", "CSV parser", "Ticket routing"]
    fig, ax = plt.subplots(figsize=(11, 6), layout="constrained")
    widest = 0
    palette = ["#64748b", "#0891b2", "#63836d", "#805f9b"]
    bar_height = 0.8 / len(budgets)
    for index, budget in enumerate(budgets):
        trials = {trial["task"]: trial for trial in budget["trials"]}
        values = [trials[task]["seconds"] for task in tasks]
        widest = max(widest, *values)
        bars = ax.barh(
            [i + (index - (len(budgets) - 1) / 2) * bar_height for i in range(len(tasks))],
            values, height=bar_height * 0.88, color=palette[index % len(palette)], label=budget["label"],
        )
        ax.bar_label(bars, labels=[
            f'{trials[task]["seconds"]:.1f}s · {trials[task]["status"].upper()}'
            for task in tasks
        ], padding=5)
    ax.set_yticks(range(len(tasks)), names)
    ax.invert_yaxis()
    ax.set_xlim(0, widest * 1.45)
    ax.set_xlabel("Agent execution seconds (excludes setup and verification)")
    ax.set_axisbelow(True)
    ax.grid(axis="x", alpha=0.18)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.legend(loc="lower right", frameon=False)
    fig.suptitle("LFM2.5 · verified tasks across output budgets", weight="bold")
    fig.get_layout_engine().set(rect=(0, 0.09, 1, 0.90))
    fig.text(0.01, 0.025, "One attempt per task/configuration. Same instructions, graders and model; budgets differ. 32k uses adapter 2 (turn-cap grading fix).", fontsize=8.5)
    fig.savefig(DATA / "verified-budget-comparison.svg", metadata={"Date": None})
    plt.close(fig)

# Matplotlib emits trailing spaces in SVG paths; normalize generated charts.
for chart in ("comparison.svg", "ryzen-lfm2.5-concurrency.svg", "verified-budget-comparison.svg"):
    path = DATA / chart
    if path.exists():
        path.write_text("\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n")
