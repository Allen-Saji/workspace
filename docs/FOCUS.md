# Focus timer

Open **Focus** in the workspace navigation. Choose an unfinished task or write an
intention, then start the timer. A completed focus interval does not mark a task done.

The defaults are 25 minutes of focus, a 5-minute short break and a 15-minute long
break after every four completed focus intervals. Each duration can be set from 1
to 120 minutes in Timer preferences. The next interval always waits for a click;
there is no automatic work/break loop.

Pause preserves the remaining time. Resume continues the same session. Reset
discards the unfinished interval and restores its configured duration; it preserves
completed history. Reset before changing an active interval's duration or task.
Breaks and unfinished intervals do not count toward focus totals.

**Enter focus mode** hides workspace navigation, the companion, assistant controls
and session history. Exit with the visible button or Escape. Leaving focus mode
does not pause the timer. A compact timer remains available on other workspace
screens, and the browser tab title shows the countdown.

## Storage and clock behavior

Settings, the current interval, its linked task ID/title or intention, and the most
recent 200 completed focus intervals are stored in this browser's local storage,
scoped to the workspace ID. Today's totals are derived from retained intervals
using the browser's local date. Clearing site data removes this local history.
It does not sync to Supabase or other devices; localhost and production are separate
browser origins. No task or calendar record is written by the timer.

Running timers use an absolute deadline instead of counting interval callbacks.
Reloading, navigating between workspace views, or returning from a sleeping tab
recovers the remaining time. An overdue interval records one completion at its
deadline and waits; time spent away cannot create extra sessions or breaks. Paused
intervals remain paused across reloads. Changes to the device clock affect the
deadline. No service worker, operating-system alarm, or background scheduler is
installed.

Tabs on the same origin observe storage changes. Web Locks serialize timer commands
where supported; older browsers fall back to ordinary browser storage. Malformed
or oversized snapshots recover to defaults. If storage is unavailable, the timer
continues in memory with a visible warning that refresh will lose it.

The optional completion sound is off by default. Enable it and start/resume from
the tab where you want the cue. Browser audio policies, reloads and suspended tabs
can prevent or delay sound. Visual completion and stored recovery remain available.
No notification permission, microphone access or paid provider call is needed.

## Verification

`node --test tests/focus.test.ts` covers deadline recovery, exact pause/resume,
completion at a pause/reset boundary, four-session break cadence, task locking,
duration validation, corrupt snapshots and bounded history. Browser checks should
also cover reloads, cross-tab pause, compact controls, completion, phone layouts,
keyboard exit and reduced motion.
