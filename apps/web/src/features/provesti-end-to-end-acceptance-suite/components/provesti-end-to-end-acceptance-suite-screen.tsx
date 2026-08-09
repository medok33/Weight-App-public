'use client';

import { useEffect, useState } from 'react';
import { getAcceptanceScenarios } from '../api/provesti-end-to-end-acceptance-suite.client';
import type {
  AcceptanceScenario,
  AcceptanceSuiteState,
} from '../model/provesti-end-to-end-acceptance-suite.types';

export function ProvestiEndToEndAcceptanceSuiteScreen() {
  const [state, setState] = useState<AcceptanceSuiteState>('loading');
  const [scenarios, setScenarios] = useState<AcceptanceScenario[]>([]);

  useEffect(() => {
    getAcceptanceScenarios()
      .then((items) => {
        setScenarios(items);
        setState(items.length ? 'success' : 'empty');
      })
      .catch(() => setState('error'));
  }, []);

  if (state === 'loading') {
    return (
      <main aria-busy="true" data-testid="acceptance-suite-screen">
        <h1>Acceptance suite</h1>
        <p>Loading scenarios…</p>
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main role="alert" data-testid="acceptance-suite-screen">
        <h1>Acceptance suite</h1>
        <p>Acceptance health check failed.</p>
      </main>
    );
  }
  if (state === 'empty') {
    return (
      <main data-testid="acceptance-suite-screen">
        <h1>Acceptance suite</h1>
        <p>No acceptance scenarios configured.</p>
      </main>
    );
  }

  return (
    <main data-testid="acceptance-suite-screen">
      <h1>Acceptance suite</h1>
      <p>Critical end-to-end paths for beta release.</p>
      <ul data-testid="acceptance-scenario-list">
        {scenarios.map((scenario) => (
          <li key={scenario.id} data-testid={`acceptance-scenario-${scenario.id}`}>
            <a href={scenario.route}>{scenario.title}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
