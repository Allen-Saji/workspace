import test from "node:test";
import assert from "node:assert/strict";
import { monitorMicrophone } from "../src/ui/microphone-meter.ts";

test("microphone meter observes the signal and releases its audio resources once", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let amplitude = 128,
    disconnected = 0,
    closed = 0,
    tracksStopped = 0;
  class Context {
    createAnalyser() {
      return {
        fftSize: 256,
        getByteTimeDomainData: (samples: Uint8Array) => samples.fill(amplitude),
      };
    }
    createMediaStreamSource() {
      return {
        connect() {},
        disconnect() {
          disconnected++;
        },
      };
    }
    async resume() {}
    async close() {
      closed++;
    }
  }
  const prior = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: Context,
  });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, "AudioContext", prior);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  });
  const stream = {
    getTracks: () => [{ stop: () => tracksStopped++ }],
  } as unknown as MediaStream;
  const levels: number[] = [];
  const stop = monitorMicrophone(stream, (level) => levels.push(level));
  t.mock.timers.tick(80);
  assert.equal(levels.at(-1), 0);
  amplitude = 144;
  t.mock.timers.tick(80);
  assert.equal(levels.at(-1), 0.5);
  amplitude = 255;
  t.mock.timers.tick(80);
  assert.equal(levels.at(-1), 1);
  stop();
  stop();
  t.mock.timers.tick(800);
  assert.equal(levels.length, 3);
  assert.equal(disconnected, 1);
  assert.equal(closed, 1);
  assert.equal(
    tracksStopped,
    0,
    "the recorder retains ownership of microphone tracks",
  );
});

test("meter setup failure closes its context without interrupting recording", (t) => {
  let closed = 0;
  class Context {
    createAnalyser() {
      throw new Error("device unavailable");
    }
    async close() {
      closed++;
    }
  }
  const prior = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: Context,
  });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, "AudioContext", prior);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  });
  const stop = monitorMicrophone({} as MediaStream, () =>
    assert.fail("no sample expected"),
  );
  stop();
  assert.equal(closed, 1);
});
