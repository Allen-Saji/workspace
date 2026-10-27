# Agent profiles

Open **Agents** to see the agents registered with your workspace. Each card shows
the registered name, connection state, latest reported work, and counts of loaded
reports and journal days. Filter by connected agents, pending requests, or history.

Click a card to open its profile:

- **Overview** shows the latest work and connection details.
- **Reports** lists that connection's reports. Open a report to read its source and receipt.
- **Journal** shows its daily entries, results, blockers, next steps, and evidence.
  Use the date field to filter, or clear it to read all loaded days.

Names are supplied during agent registration. Work is grouped by connection ID,
so agents with matching names remain separate. Re-pairing creates a separate
connection and does not merge earlier history. Imported reports without a direct
agent connection appear under **Imported reports**.

Expired and revoked connections retain saved work. **Connected** describes valid
connection access, not proof that an agent is running. Status and work summaries
are agent-reported; old status updates are marked out of date. Views show the
records returned by the existing bounded history endpoints.

Section revisits reuse successful reads for one minute. Use **Refresh agents** to
reload profiles and reports immediately. If a partial refresh fails,
the page displays an error and retains previously loaded connection information.

**Manage connections** contains pairing, approval, revocation, and manual JSON
report import. **Request an update** prepares text for you to send in the agent's
own chat or terminal. It does not contact an agent or start a schedule.
