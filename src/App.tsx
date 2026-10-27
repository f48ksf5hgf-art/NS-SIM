import { useState } from 'react';
import { ClassicGame } from './components/ClassicGame';
import { GeneratedGame } from './components/sim/GeneratedGame';
import { createScenario } from './sim/bot';
import { randomSeed } from './sim/rng';
import type { Difficulty, ScenarioSpec } from './sim/types';

type Mode = { kind: 'classic' } | { kind: 'generated'; spec: ScenarioSpec };

export default function App() {
  const [mode, setMode] = useState<Mode>({ kind: 'classic' });

  const startGenerated = (difficulty: Difficulty, seed: number | null) =>
    setMode({ kind: 'generated', spec: createScenario(difficulty, seed ?? randomSeed()) });

  if (mode.kind === 'generated') {
    return (
      <GeneratedGame
        key={`${mode.spec.difficulty}-${mode.spec.seed}`}
        spec={mode.spec}
        onNewScenario={() => startGenerated(mode.spec.difficulty, null)}
        onExit={() => setMode({ kind: 'classic' })}
      />
    );
  }
  return <ClassicGame onStartGenerated={startGenerated} />;
}
