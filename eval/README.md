# Intent evaluation


From the repository root, with Node 24+, a local DeepSeek key in the environment, and the project dependencies installed:

```sh
npm run regression
npx --yes promptfoo@0.126.0 eval -c eval/promptfooconfig.cjs --env-file .env --no-cache --no-share
python3 -m venv /tmp/chiller-evals
/tmp/chiller-evals/bin/pip install -r eval/requirements.txt
/tmp/chiller-evals/bin/python eval/trace_eval.py
/tmp/chiller-evals/bin/python eval/trace_eval.py --holdout
```

The suites use synthetic utterances. DSPy compares the production classifier's
intent and equipment number with the labels. Langfuse SDK observations are
exported to memory for local verification. The WhatsApp process does not export
chat messages to Langfuse. The language glossary and clarification cues live in
`kb/language.json`. Confirm equipment mappings against the site point list before
extending control beyond the simulator.
