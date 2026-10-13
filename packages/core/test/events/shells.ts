/**
 * A shell command that exits non-zero, as each OpenCode really sends it: a *completed* call with the
 * exit code beside it, never a failed one. Shapes copied from the recorded runs
 * (~/.cache/guildhall/chronicles: v1 1.18 `bash` parts, v2 2.0 `shell` calls), command and code
 * changed. Exit codes live at v1 `part.state.metadata.exit`, v2 `session.tool.success`
 * `data.metadata.exit` (and a stored v2 message's `state.metadata.exit`). Shared with the sim's tests.
 */
export const SESSION = "ses_eec6824d2ffeSjf3oI8DVxBwEj"

/** v1: the bash part as it runs, then as it completes with `metadata.exit`. */
export function v1Shell(command: string, exit: number, output: string): unknown[] {
  const part = (state: Record<string, unknown>) => ({
    type: "message.part.updated",
    properties: {
      part: {
        type: "tool",
        tool: "bash",
        callID: "call_01a11397f789729f8d3e0f77",
        state,
        id: "prt_11397f206001JqHOBQBLWJOOfx",
        sessionID: SESSION,
        messageID: "msg_11397db40001GZHJWDx0JsV0Ss",
      },
    },
  })
  return [
    part({ status: "running", input: { command }, metadata: { output: "" }, time: { start: 1000 } }),
    part({
      status: "completed",
      input: { command },
      output,
      metadata: { output, exit, truncated: false },
      title: command,
      time: { start: 1000, end: 1500 },
    }),
  ]
}

/** v2: the shell call named, called with its input, then succeeding with `metadata.exit`. */
export function v2Shell(command: string, exit: number, output: string): unknown[] {
  const data = { sessionID: SESSION, assistantMessageID: "msg_10f57f2b8001kb49anVrZKMVps" }
  const id = "call_RrEVPZ9GvujHADYniHnUoOaU"
  return [
    { type: "session.tool.input.started", data: { ...data, id, name: "shell" } },
    { type: "session.tool.called", data: { ...data, id, input: { command }, executed: false } },
    {
      type: "session.tool.success",
      data: {
        ...data,
        id,
        content: [{ type: "text", text: output }],
        metadata: { status: "completed", truncated: false, exit },
        executed: false,
      },
    },
  ]
}

export const RED = "bun test v1.3.13\n\n 41 pass\n 3 fail\nRan 44 tests across 6 files.\n"
