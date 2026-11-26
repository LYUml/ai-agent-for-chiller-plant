"""Replay synthetic cases against the shipped classifier; capture local Langfuse spans."""
import json
from pathlib import Path
import subprocess
import argparse
import dspy
from langfuse import Langfuse
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

root = Path(__file__).resolve().parents[1]
sink = InMemorySpanExporter()
traces = Langfuse(public_key="pk-lf-local", secret_key="sk-lf-local",
                  base_url="http://127.0.0.1:3000", span_exporter=sink)
parser = argparse.ArgumentParser()
parser.add_argument("--holdout", action="store_true")
suite = "holdout.json" if parser.parse_args().holdout else "cases.json"
cases = [dspy.Example(text=text, intent=intent, unit=unit).with_inputs("text")
         for text, intent, unit in json.loads((root / "eval" / suite).read_text())]

class ActualClassifier(dspy.Module):
    def forward(self, text):
        with traces.start_as_current_observation(name="classify-synthetic", as_type="span") as span:
            raw = subprocess.check_output(["node", "--env-file=.env", "eval/classify.mjs", text],
                                          cwd=root, text=True, timeout=30)
            result = json.loads(raw)
            span.update(input=text, output=result)
            return dspy.Prediction(**result)

result = dspy.Evaluate(devset=cases, num_threads=2,
                       metric=lambda gold, pred, trace=None: (gold.intent, gold.unit) == (pred.intent, pred.unit))(ActualClassifier())
traces.flush()
for gold, pred, ok in result.results:
    if not ok: print("Mismatch", gold.text, pred)
count = len(sink.get_finished_spans())
print(f"DSPy exact match: {result.score}%, Langfuse local spans: {count}")
if result.score != 100 or count != len(cases):
    raise SystemExit(1)
