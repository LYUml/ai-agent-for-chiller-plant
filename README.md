# WhatsApp Chiller Plant Demo

A WhatsApp test group can review operating recommendations, issue commands, and query two simulated chillers (units 2 and 3). An authorized operator must confirm a specific operation before the simulator changes equipment state. The demo recognizes predefined Chinese phrases and requires no model API key.

## Run the local demo

Install Node.js 24 or later, then run the following commands from the repository root:

```sh
npm ci
npm test
npm run demo
```

The replay uses an in-memory SQLite database. It walks through a recommendation, a request for its rationale, a change of target, operator confirmation, and a status report. It runs offline after dependency installation.

## Connect a WhatsApp test group

1. Run `npm start`. In WhatsApp on the test account, open **Linked devices** and scan the terminal QR code. The terminal lists the groups visible to that account. Copy the ID of the intended test group.
2. Stop the process, then run `TEST_GROUP_ID='YOUR_GROUP_ID@g.us' npm start` with the actual group ID. From a second account, send a message in that group. Copy the sender ID printed in the terminal.
3. Stop the process and restart with the sender authorized as an operator:

   ```sh
   TEST_GROUP_ID='YOUR_GROUP_ID@g.us' OPERATOR_IDS='YOUR_SENDER_ID' npm start
   ```

For multiple operators, separate the exact sender IDs with commas. On macOS, the adapter tries the standard Google Chrome installation. Set `CHROME_PATH` to select a different browser executable.

## Try the three interactions

The Chinese examples below are literal inputs. Send chat messages from the second account.

| Interaction | What to do | Expected result |
| --- | --- | --- |
| Issue a command | Send `启动 2 号机` (start unit 2). Quote the bot's proposal and reply `确认` (confirm). | The bot creates a pending operation, then reports the simulated result after confirmation. |
| Review a strategy | With unit 2 stopped, type `strategy` in the **running process terminal**. In WhatsApp, quote the proposal and ask `为什么` (why), then quote the proposal again and send `改成 3 号机` (change to unit 3). | The bot explains the recorded rationale and issues a replacement proposal. Quote the replacement to confirm it. |
| Query the plant | Send `查询 2 号机` (check unit 2) or `报告` (report). | A unit query returns its simulated state and sample time. A report returns both unit states and the cumulative command count. |

Use `暂缓` to hold a proposal or `拒绝` to reject it. To confirm without quoting, send `确认 Sxxxxxxxx`, replacing the placeholder with the operation ID from the bot. To stop a running unit, send a command such as `停止 2 号机` and confirm the resulting proposal.

## Project modules

| Location | Responsibility |
| --- | --- |
| [src/whatsapp.js](src/whatsapp.js) | QR login, group selection, sender identification, quoted replies, and strategy delivery |
| [src/plant.js](src/plant.js) | Phrase matching, approval state, duplicate-message handling, simulated commands, and telemetry |
| [src/demo.js](src/demo.js) | Local replay using the same plant logic as the WhatsApp adapter |
| [test/plant.test.js](test/plant.test.js) | Checks for ambiguous confirmations, revisions, operator permissions, duplicate delivery, and state readback |
| [docs/design](docs/design) and [docs/reference](docs/reference) | Interaction flowchart and original project materials |

## Persistence and integration scope

Group mode persists simulated plant records in a per-group SQLite database under `data/`. The WhatsApp session persists under `.wwebjs_auth/`. Restart the process after a disconnect. Offline message recovery and failed-send retries are not implemented.

The simulator updates its own telemetry when it accepts a command. Live equipment control, InfluxDB readback, and open-ended language understanding are future integration points.

## Upstream references

The WhatsApp adapter uses the client, local authentication, and message events from [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js). The approval flow draws on [LangGraph's human-review examples](https://docs.langchain.com/oss/python/langgraph/interrupts) and stores pending operations directly in SQLite.

## Single-account confirmation test

Run `WA_SELF_TEST=1 TEST_GROUP_NAME=aafcp-testing WA_SHOW_BROWSER=1 npm start`.
From the linked account, send `/test 启动 2 号机` in the test group. Select
`确认操作` (confirm) or `取消操作` (cancel) on the poll. New proposals
expire after ten minutes. The demo reads current poll selections roughly
every five seconds and processes each poll once. Withdrawing a selection
after the bot has processed it does not reverse the outcome. To confirm
by text, send `/test 确认 Sxxxxxxxx` with the actual operation ID.

## Evaluate intent recognition

With Node 24+, a local DeepSeek key in the environment, and the project dependencies installed:

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
