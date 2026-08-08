export function createAudioPort() {
  let context = null;
  let enabled = true;
  const ensure = async () => {
    if (!enabled) return null;
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') await context.resume();
    return context;
  };
  return {
    setEnabled(value) { enabled = Boolean(value); },
    async ping(frequency = 440, duration = 0.08) {
      const audio = await ensure();
      if (!audio) return;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + duration + 0.02);
    },
    async suspend() { if (context?.state === 'running') await context.suspend(); },
  };
}
