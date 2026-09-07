import { expect, it } from 'vitest';
import type { GraphPresentation, LogicalDag, LogicalLayout, LogicalNode } from '../domain/types';
import { resolveConnectorHints } from './routeConnectors';

it('routes a cache transfer through the column gap and beside its consumer', () => {
  const nodes = [
    { ref: 'cache', stageId: 'prefix' }, { ref: 'read', stageId: 'action' },
  ] as LogicalNode[];
  const dag = { nodes: new Map(nodes.map(node => [node.ref, node])), scopes: [],
    edges: [{ id: 'kv-read', source: 'cache', target: 'read', kind: 'tensor' }],
  } as unknown as LogicalDag;
  const layout = {
    nodeBoxes: new Map([
      ['cache', { x: 250, y: 400, width: 60, height: 28 }],
      ['read', { x: 440, y: 700, width: 30, height: 24 }],
    ]),
    stageBoxes: [
      { stageId: 'prefix', x: 0, y: 10, width: 340 },
      { stageId: 'action', x: 364, y: 10, width: 340 },
    ],
  } as unknown as LogicalLayout;
  const presentation = { connectorHints: [{ id: 'transfer', kind: 'cross', route: 'gutter',
    sourceSide: 'bottom', railOffset: 4, pairs: [['cache', 'read']],
  }] } as unknown as GraphPresentation;
  const result = resolveConnectorHints(dag, presentation, layout);
  expect(result.coverage.uncoveredEdgeIds).toEqual([]);
  expect(result.invalidHints).toEqual([]);
  expect(result.connectors[0]!.paths).toMatchObject([
    { path: 'M 280 428 V 436 H 356 V 690 H 455 V 700', sourceRefs: ['cache'], targetRefs: ['read'] },
  ]);
  const separateExit = { ...presentation, connectorHints: presentation.connectorHints.map(hint => ({ ...hint, sourceOffset: 6 })) };
  expect(resolveConnectorHints(dag, separateExit, layout).connectors[0]!.paths[0]!.path).toContain('V 442 H 356');
  const sideBranch: GraphPresentation = { ...presentation, connectorHints: [{ id: 'side-branch', kind: 'cache',
    route: 'right-to-top', busOffset: -20, pairs: [['cache', 'read']],
  }] };
  expect(resolveConnectorHints(dag, sideBranch, layout).connectors[0]!.paths[0]!.path)
    .toBe('M 310 414 H 318 V 680 H 455 V 700');
});
