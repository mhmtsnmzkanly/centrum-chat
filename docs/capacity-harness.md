# Capacity harness

Run `deno task capacity:config-smoke` (or the compatibility alias `capacity:smoke`) to validate
local-safe argument parsing and the remote-target guard only. Its JSON output explicitly reports
`mode: "config-smoke"` and `networkExecuted: false`; it makes no connection. A live run defaults to
`ws://127.0.0.1:8080/ws`, requires a dedicated test token, and refuses a remote host unless
`--allow-remote true` is explicit. `--allow-remote false` remains denied, and other boolean values
are invalid. A live run emits JSON with successful/failed connections, disconnects, ping/pong count,
error rate, and p50/p95/p99 connect latency.

This initial harness measures connection ramp-up and idle heartbeat behavior. Message write, public
fanout, DM, history, read/unread, notification, reconnect-storm and attachment scenarios remain
planned extensions; do not infer 100/1,000-user capacity from its smoke output.
