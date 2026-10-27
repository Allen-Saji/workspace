// The meter only observes the stream. The recording hook owns microphone tracks.
export function monitorMicrophone(
  stream: MediaStream,
  onLevel: (level: number) => void,
) {
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    source?.disconnect();
    void context?.close().catch(() => {});
  };
  try {
    context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    // Some browsers start AudioContext suspended. Recording still works if metering fails.
    void context.resume().catch(() => {});
    interval = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const energy = samples.reduce(
        (sum, value) => sum + ((value - 128) / 128) ** 2,
        0,
      );
      onLevel(Math.min(1, Math.sqrt(energy / samples.length) * 4));
    }, 80);
    return close;
  } catch {
    close();
    return () => {};
  }
}
