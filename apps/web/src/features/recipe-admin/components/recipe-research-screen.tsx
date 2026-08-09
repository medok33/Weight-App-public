'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type ResearchRequest = {
  id: string;
  searchDecisionId: string | null;
  coverageSlotId: string | null;
  requestType: string;
  status: string;
  reason: string;
  createdAt: string;
  recommendation?: string | null;
  slotName?: string | null;
};

type SourceRow = {
  id: string;
  code: string;
  name: string;
  adapterType: string;
  dataClass: string;
  enabled: boolean;
  rightsStatus: string;
  parserVersion?: string;
  contractVersion?: string;
  pilotReadiness?: {
    liveExecutionStatus?: string;
    fixtureMode?: string;
    parserVersion?: string | null;
    contractVersion?: string | null;
    networkCalls?: number;
  };
};

type Candidate = {
  id: string;
  requestId: string;
  sourceId: string | null;
  externalId: string;
  title: string;
  status: string;
  reviewStatus: string;
  parserVersion: string;
  createdAt: string;
  normalized?: unknown[];
  reviewItems?: Array<{ id: string; type: string; status: string; severity: string; sourceValue?: string | null }>;
};

const labels = {
  title: 'Исследование рецептов',
  subtitle:
    'Staging-зона: здесь сохраняются внешние или ручные кандидаты, raw snapshot и нормализация. Canonical Recipe/Product отсюда не создаются.',
  loading: 'Загрузка staging-данных…',
  unavailable: 'Раздел исследования рецептов временно недоступен',
  forbidden: 'Нужны права OWNER или ADMIN',
  createManual: 'Создать ручной staging request',
  reason: 'Причина',
  titleField: 'Название кандидата',
  ingredients: 'Ингредиенты JSON',
  steps: 'Шаги JSON',
  create: 'Создать',
  runManual: 'Сохранить manual snapshot',
  runTest: 'Запустить test adapter',
  normalize: 'Нормализовать',
  raw: 'Raw snapshot доступен только OWNER',
  empty: 'Пока нет staging request.',
  sources: 'Тестовый источник',
  requests: 'Заявки',
  candidates: 'Кандидаты',
  details: 'Детали кандидата',
  status: 'Статус',
  persistence: 'Persistence: данные идут через API и PostgreSQL; после reload список загружается заново.',
};

export function RecipeResearchScreen() {
  const [state, setState] = useState<'loading' | 'success' | 'forbidden' | 'error'>('loading');
  const [requests, setRequests] = useState<ResearchRequest[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ResearchRequest | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('Ручная редакционная проверка кандидата');
  const [candidateTitle, setCandidateTitle] = useState('Тестовый салат с курицей');
  const [ingredientsJson, setIngredientsJson] = useState(
    '[{"name":"курица","amountText":"200","unitText":"g","notes":null},{"name":"гречка","amountText":"80","unitText":"g","notes":null}]',
  );
  const [stepsJson, setStepsJson] = useState(
    '[{"ordinal":1,"text":"Подготовить продукты","timeMinutes":5},{"ordinal":2,"text":"Приготовить до готовности","timeMinutes":20}]',
  );

  const testSource = useMemo(
    () => sources.find((s) => s.adapterType === 'TEST_DETERMINISTIC' && s.dataClass !== 'PRODUCTION'),
    [sources],
  );
  const foodRuSource = useMemo(
    () => sources.find((s) => s.adapterType === 'FOOD_RU' && s.dataClass !== 'PRODUCTION'),
    [sources],
  );
  const iamCookSource = useMemo(
    () => sources.find((s) => s.adapterType === 'IAMCOOK' && s.dataClass !== 'PRODUCTION'),
    [sources],
  );
  const russianFoodSource = useMemo(
    () => sources.find((s) => s.adapterType === 'RUSSIANFOOD' && s.dataClass !== 'PRODUCTION'),
    [sources],
  );

  async function reload() {
    setState('loading');
    try {
      const [requestsResponse, sourcesResponse, fixtureSourcesResponse] = await Promise.all([
        fetch('/api/admin/recipe-research', { cache: 'no-store' }),
        fetch('/api/admin/recipe-sources?dataClass=TEST_ONLY', { cache: 'no-store' }),
        fetch('/api/admin/recipe-sources?dataClass=FIXTURE', { cache: 'no-store' }),
      ]);
      if (
        [requestsResponse.status, sourcesResponse.status, fixtureSourcesResponse.status].includes(401) ||
        [requestsResponse.status, sourcesResponse.status, fixtureSourcesResponse.status].includes(403)
      ) {
        setState('forbidden');
        return;
      }
      if (!requestsResponse.ok || !sourcesResponse.ok || !fixtureSourcesResponse.ok) throw new Error('load_failed');
      const requestsData = (await requestsResponse.json()) as { items: ResearchRequest[] };
      const sourcesData = (await sourcesResponse.json()) as { items: SourceRow[] };
      const fixtureData = (await fixtureSourcesResponse.json()) as { items: SourceRow[] };
      setRequests(requestsData.items ?? []);
      setSources([...(sourcesData.items ?? []), ...(fixtureData.items ?? [])]);
      setState('success');
    } catch {
      setState('error');
    }
  }

  async function loadCandidates(requestId: string) {
    const response = await fetch(`/api/admin/recipe-research/${requestId}/candidates`, { cache: 'no-store' });
    if (!response.ok) {
      setMessage(await response.text());
      return;
    }
    const data = (await response.json()) as { items: Candidate[] };
    setCandidates(data.items ?? []);
  }

  async function loadCandidate(candidateId: string) {
    const response = await fetch(`/api/admin/recipe-research/candidates/${candidateId}`, { cache: 'no-store' });
    if (!response.ok) {
      setMessage(await response.text());
      return;
    }
    setSelectedCandidate((await response.json()) as Candidate);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function createManualRequest() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/recipe-research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          manual: true,
          reason,
          idempotencyKey: `manual:${Date.now()}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data));
      setMessage('Manual request создан и сохранён.');
      await reload();
      setSelectedRequest(data as ResearchRequest);
      await loadCandidates(data.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания request');
    } finally {
      setBusy(false);
    }
  }

  async function runManualSnapshot() {
    if (!selectedRequest) return;
    setBusy(true);
    setMessage(null);
    try {
      const ingredients = JSON.parse(ingredientsJson) as unknown[];
      const steps = JSON.parse(stepsJson) as unknown[];
      const response = await fetch(`/api/admin/recipe-research/${selectedRequest.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `manual-run:${selectedRequest.id}:${Date.now()}`,
          manualPayload: {
            title: candidateTitle,
            ingredients,
            steps,
            servings: 2,
            preparationTime: 5,
            cookingTime: 20,
            categories: ['MAIN'],
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data));
      setMessage('Manual raw snapshot и candidate сохранены в PostgreSQL.');
      await loadCandidates(selectedRequest.id);
      if (data.candidate?.id) await loadCandidate(data.candidate.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка manual run');
    } finally {
      setBusy(false);
    }
  }

  async function runTestAdapter() {
    if (!selectedRequest || !testSource) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/recipe-research/${selectedRequest.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: testSource.id,
          externalId: 'test-card-1',
          operation: 'FETCH_CANDIDATE',
          idempotencyKey: `test-run:${selectedRequest.id}:${Date.now()}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data));
      setMessage('TEST_DETERMINISTIC adapter выполнен без внешней сети; candidate сохранён.');
      await loadCandidates(selectedRequest.id);
      if (data.candidate?.id) await loadCandidate(data.candidate.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка test adapter');
    } finally {
      setBusy(false);
    }
  }

  async function runFixtureSource(source: SourceRow | undefined, label: string, externalId: string) {
    if (!selectedRequest || !source) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/recipe-research/${selectedRequest.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: source.id,
          externalId,
          operation: 'FETCH_CANDIDATE',
          idempotencyKey: `${source.adapterType.toLowerCase()}-fixture:${selectedRequest.id}:${Date.now()}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data));
      setMessage(`${label} fixture выполнен: live выключен политикой, networkCalls=0, candidate сохранён.`);
      await loadCandidates(selectedRequest.id);
      if (data.candidate?.id) await loadCandidate(data.candidate.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Ошибка ${label} fixture`);
    } finally {
      setBusy(false);
    }
  }

  async function runFoodRuFixture() {
    await runFixtureSource(foodRuSource, 'Food.ru', 'synthetic-chicken-buckwheat');
  }

  async function runIamCookFixture() {
    await runFixtureSource(iamCookSource, 'Аймкук', 'synthetic-chicken-buckwheat');
  }

  async function runRussianFoodFixture() {
    await runFixtureSource(russianFoodSource, 'RussianFood', 'synthetic-chicken-buckwheat');
  }

  async function runParityDish() {
    if (!selectedRequest) return;
    setBusy(true);
    setMessage(null);
    try {
      const targets = [
        { source: foodRuSource, label: 'Food.ru' },
        { source: iamCookSource, label: 'Аймкук' },
        { source: russianFoodSource, label: 'RussianFood' },
      ].filter((row): row is { source: SourceRow; label: string } => Boolean(row.source));
      for (const target of targets) {
        const response = await fetch(`/api/admin/recipe-research/${selectedRequest.id}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sourceId: target.source.id,
            externalId: 'parity-chicken-buckwheat-salad',
            operation: 'FETCH_CANDIDATE',
            idempotencyKey: `parity:${target.source.adapterType}:${selectedRequest.id}:${Date.now()}`,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(data));
        if (data.candidate?.id) {
          await fetch(`/api/admin/recipe-research/candidates/${data.candidate.id}/normalize`, {
            method: 'POST',
          });
        }
      }
      setMessage('Три fixture-кандидата сохранены без выбора победителя; networkCalls=0.');
      await loadCandidates(selectedRequest.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка parity dish');
    } finally {
      setBusy(false);
    }
  }

  async function normalizeSelected() {
    if (!selectedCandidate) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-research/candidates/${selectedCandidate.id}/normalize`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error(await response.text());
      setMessage('Кандидат нормализован; review items сохранены.');
      await loadCandidate(selectedCandidate.id);
      if (selectedRequest) await loadCandidates(selectedRequest.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка нормализации');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <main className="admin-workspace" aria-busy="true">{labels.loading}</main>;
  if (state === 'forbidden')
    return (
      <main className="admin-workspace" data-testid="admin-recipe-research-forbidden">
        {labels.forbidden}
      </main>
    );
  if (state === 'error') return <main className="admin-workspace" role="alert">{labels.unavailable}</main>;

  return (
    <main className="admin-workspace" data-testid="admin-recipe-research">
      <p>
        <Link href="/admin/recipe-sources">Источники рецептов</Link>
      </p>
      <h1>{labels.title}</h1>
      <p>{labels.subtitle}</p>
      <p data-testid="recipe-research-persistence">{labels.persistence}</p>
      {message ? <p role="status" data-testid="recipe-research-message">{message}</p> : null}

      <section className="admin-toolbar" data-testid="recipe-research-create">
        <h2>{labels.createManual}</h2>
        <label>
          {labels.reason}
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={() => void createManualRequest()}>
          {labels.create}
        </button>
      </section>

      <div className="admin-grid">
        <section>
          <h2>{labels.requests}</h2>
          {requests.length === 0 ? <p>{labels.empty}</p> : null}
          <table data-testid="recipe-research-requests">
            <thead>
              <tr>
                <th>ID</th>
                <th>{labels.status}</th>
                <th>Тип</th>
                <th>Decision</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRequest(request);
                        void loadCandidates(request.id);
                      }}
                    >
                      {request.id.slice(0, 8)}
                    </button>
                  </td>
                  <td>{request.status}</td>
                  <td>{request.requestType}</td>
                  <td>{request.recommendation ?? 'manual'}</td>
                  <td>{new Date(request.createdAt).toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>{labels.candidates}</h2>
          {selectedRequest ? (
            <div className="admin-toolbar">
              <label>
                {labels.titleField}
                <input value={candidateTitle} onChange={(event) => setCandidateTitle(event.target.value)} />
              </label>
              <label>
                {labels.ingredients}
                <textarea value={ingredientsJson} onChange={(event) => setIngredientsJson(event.target.value)} />
              </label>
              <label>
                {labels.steps}
                <textarea value={stepsJson} onChange={(event) => setStepsJson(event.target.value)} />
              </label>
              <button type="button" disabled={busy} onClick={() => void runManualSnapshot()}>
                {labels.runManual}
              </button>
              <button type="button" disabled={busy || !testSource} onClick={() => void runTestAdapter()}>
                {labels.runTest}
              </button>
              <button
                type="button"
                data-testid="recipe-research-foodru-fixture"
                disabled={busy || !foodRuSource}
                onClick={() => void runFoodRuFixture()}
              >
                Запустить Food.ru fixture
              </button>
              <button
                type="button"
                data-testid="recipe-research-iamcook-fixture"
                disabled={busy || !iamCookSource}
                onClick={() => void runIamCookFixture()}
              >
                Запустить fixture Аймкук
              </button>
              <button
                type="button"
                data-testid="recipe-research-russianfood-fixture"
                disabled={busy || !russianFoodSource}
                onClick={() => void runRussianFoodFixture()}
              >
                Запустить fixture RussianFood
              </button>
              <button
                type="button"
                data-testid="recipe-research-parity-dish"
                disabled={busy || !(foodRuSource && iamCookSource && russianFoodSource)}
                onClick={() => void runParityDish()}
              >
                Три источника: тестовое блюдо
              </button>
              {!testSource ? <p>TEST_DETERMINISTIC source не настроен или не разрешён.</p> : null}
              {foodRuSource ? (
                <p data-testid="recipe-research-foodru-status">
                  Food.ru · fixture доступен · live выключен политикой · networkCalls=
                  {foodRuSource.pilotReadiness?.networkCalls ?? 0} · parser=
                  {foodRuSource.pilotReadiness?.parserVersion ?? foodRuSource.parserVersion ?? 'food-ru/v1'}
                </p>
              ) : (
                <p data-testid="recipe-research-foodru-missing">
                  Food.ru TEST_ONLY/FIXTURE source не настроен (production food_ru остаётся без live HTTP).
                </p>
              )}
              {iamCookSource ? (
                <p data-testid="recipe-research-iamcook-status">
                  Аймкук · fixture доступен · live выключен · networkCalls=0 · parser=
                  {iamCookSource.pilotReadiness?.parserVersion ?? 'iamcook/v1'}
                </p>
              ) : null}
              {russianFoodSource ? (
                <p data-testid="recipe-research-russianfood-status">
                  RussianFood · fixture доступен · live выключен · networkCalls=0 · parser=
                  {russianFoodSource.pilotReadiness?.parserVersion ?? 'russianfood/v1'}
                </p>
              ) : null}
            </div>
          ) : (
            <p>Выбери request, чтобы увидеть candidates.</p>
          )}
          <ul data-testid="recipe-research-candidates">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button type="button" onClick={() => void loadCandidate(candidate.id)}>
                  {candidate.title}
                </button>{' '}
                — {candidate.status} / {candidate.reviewStatus} · {candidate.parserVersion}
              </li>
            ))}
          </ul>
          {candidates.length >= 2 ? (
            <section data-testid="multi-source-compare-table">
              <h3>Сравнение кандидатов по источникам</h3>
              <p data-testid="multi-source-no-winner">
                Победитель не выбирается — только сопоставление фактов
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Источник</th>
                    <th>Название</th>
                    <th>Полнота</th>
                    <th>Парсер</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => {
                    const source = sources.find((s) => s.id === candidate.sourceId);
                    return (
                      <tr key={candidate.id} data-testid={`compare-row-${candidate.id}`}>
                        <td>{source?.code ?? candidate.sourceId?.slice(0, 8) ?? '—'}</td>
                        <td>{candidate.title}</td>
                        <td>{candidate.status}</td>
                        <td>{candidate.parserVersion}</td>
                        <td>{candidate.reviewStatus}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ) : null}
        </section>
      </div>

      {selectedCandidate ? (
        <section data-testid="recipe-research-candidate-detail">
          <h2>{labels.details}: {selectedCandidate.title}</h2>
          <p>
            {selectedCandidate.externalId} · {selectedCandidate.parserVersion} · {selectedCandidate.status}
          </p>
          <button type="button" disabled={busy} onClick={() => void normalizeSelected()}>
            {labels.normalize}
          </button>
          <p>{labels.raw}</p>
          <h3>Review items</h3>
          <ul>
            {(selectedCandidate.reviewItems ?? []).map((item) => (
              <li key={item.id}>
                {item.severity} · {item.type} · {item.status} · {item.sourceValue ?? ''}
              </li>
            ))}
          </ul>
          <details>
            <summary>Normalized payload</summary>
            <pre>{JSON.stringify(selectedCandidate.normalized ?? [], null, 2)}</pre>
          </details>
        </section>
      ) : null}
    </main>
  );
}
