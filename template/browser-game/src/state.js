export function createInitialState() {
  return Object.freeze({
    screen: 'title',
    score: 0,
    elapsed: 0,
    sound: true,
    reducedMotion: false,
  });
}

export function reduceState(state, action) {
  switch (action?.type) {
    case 'START':
      return { ...state, screen: 'playing', score: 0, elapsed: 0 };
    case 'PAUSE':
      return state.screen === 'playing' ? { ...state, screen: 'paused' } : state;
    case 'RESUME':
      return state.screen === 'paused' ? { ...state, screen: 'playing' } : state;
    case 'TICK':
      return state.screen === 'playing'
        ? { ...state, elapsed: state.elapsed + Math.max(0, Number(action.dt) || 0) }
        : state;
    case 'FINISH':
      return { ...state, screen: 'result', score: Math.max(0, Math.round(Number(action.score) || 0)) };
    case 'TOGGLE_SOUND':
      return { ...state, sound: !state.sound };
    case 'TOGGLE_MOTION':
      return { ...state, reducedMotion: !state.reducedMotion };
    case 'RESET':
      return createInitialState();
    default:
      return state;
  }
}
